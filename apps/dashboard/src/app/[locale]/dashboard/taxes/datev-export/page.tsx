import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { can } from "@/lib/permissions";
import { NoPermissionCard } from "@/components/no-permission-card";
import { DatevExportCard } from "./datev-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taxes.datevExport");
  return { title: t("pageTitle") };
}

/**
 * DATEV-Export hat eine eigene Route unter /dashboard/taxes/, weil er
 * konzeptionell ein steuerlicher Daten-Export ist (genau wie VAT-Return,
 * Journal, P&L). Vorher lag er als Karte unter /dashboard/tax-advisor —
 * dort gehört aber nur die Beziehung zum Berater (Einladung) +
 * Monatsabschluss-Workflow hin, kein Bulk-Daten-Export.
 *
 * Beide Personas erreichen die Page jetzt aus derselben Sidebar-Sektion
 * "Auswertungen → Steuern": Berater sind dort sowieso dauernd unterwegs
 * (VAT-Return + Journal), und der Mandant findet seinen DATEV-Export
 * genau da, wo er ihn semantisch erwartet.
 */
export default async function DatevExportPage() {
  const session = await requireTenant();
  const t = await getTranslations("taxes.datevExport");

  if (!can(session.tenantRole, "datev.export")) {
    return <NoPermissionCard title={t("pageTitle")} description={t("noPermission")} />;
  }

  const today = new Date();
  const fyStart = new Date(today.getFullYear(), 0, 1);
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <DatevExportCard
          defaultFiscalYearStart={iso(fyStart)}
          defaultDateFrom={iso(prevMonthStart)}
          defaultDateTo={iso(prevMonthEnd)}
        />
      </div>
    </div>
  );
}
