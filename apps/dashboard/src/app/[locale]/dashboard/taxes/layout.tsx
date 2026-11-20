import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { TaxesTabs, type TaxesTabSpec } from "./taxes-tabs";

const ALL_TABS: readonly TaxesTabSpec[] = [
  { key: "vatReturn", href: "/dashboard/taxes/vat-return" },
  { key: "profitLoss", href: "/dashboard/taxes/profit-loss" },
  { key: "journal", href: "/dashboard/taxes/journal" },
  { key: "datevExport", href: "/dashboard/taxes/datev-export" },
];

export default async function TaxesLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("taxes");
  const session = await requireTenant();

  // ── Journal-tab gating ────────────────────────────────────────────────────
  // The Buchungsjournal is power-user / accountant territory. Showing
  // raw Soll/Haben entries to a typical solo founder creates noise and
  // surface-area for "wait, why is my invoice booked to 8400?" tickets.
  // We hide the *navigation entry* for plain MEMBER roles but keep the
  // route itself reachable — so accountants can land on a shared link and
  // power users can bookmark `/dashboard/taxes/journal` directly. The CSV/
  // DATEV export of the journal remains visible to everyone via the
  // VAT-return / P&L tabs, which is the touchpoint that actually matters
  // for hand-off to the Steuerberater.
  const canSeeJournalTab =
    session.role === "SUPER_ADMIN" ||
    session.tenantRole === "OWNER" ||
    session.tenantRole === "ADMIN" ||
    session.tenantRole === "ACCOUNTANT";

  // Der P&L-Tab spiegelt die zentral gewählte Berechnungsart (EÜR/GuV).
  const settings = await db.companySettings.findUnique({
    where: { tenantId: session.tenantId },
    select: { profitLossMethod: true },
  });
  const isGuV = settings?.profitLossMethod === "GUV";

  const tabs: readonly TaxesTabSpec[] = ALL_TABS.filter(
    (tab) => tab.key !== "journal" || canSeeJournalTab,
  ).map((tab) =>
    tab.key === "profitLoss"
      ? { ...tab, label: isGuV ? t("tabs.profitLossGuV") : t("tabs.profitLoss") }
      : tab,
  );

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-7">
      <div>
        <h1 className="text-2xl font-bold">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <TaxesTabs tabs={tabs} />

      {children}
    </div>
  );
}
