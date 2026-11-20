import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { listRecentMonths } from "@/lib/month-close/queries";
import { can } from "@/lib/permissions";
import { ClosingTable } from "./closing-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("firm.closing");
  return { title: t("pageTitle") };
}

export default async function ClosingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("firm.closing");
  const tenant = await requireTenant();

  const [months, accountantCount] = await Promise.all([
    listRecentMonths(tenant.tenantId, 6),
    db.tenantUser.count({
      where: { tenantId: tenant.tenantId, role: "ACCOUNTANT" },
    }),
  ]);

  // Lokalisierter Monatsname via Intl — vermeidet hartcodierte
  // Übersetzungstabellen pro Sprache.
  const monthFmt = new Intl.DateTimeFormat(locale, { month: "long" });
  function monthLabel(m: number): string {
    return monthFmt.format(new Date(2000, m - 1, 1));
  }

  return (
    <div className="container mx-auto px-6 py-6 max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("description")}</p>
      </header>

      <ClosingTable
        months={months.map((m) => ({ ...m, monthLabel: monthLabel(m.month) }))}
        canSubmit={can(tenant.tenantRole, "monthClose.submit")}
        canFinalize={can(tenant.tenantRole, "monthClose.finalize")}
        canReopen={can(tenant.tenantRole, "monthClose.reopen")}
        canUnfinalize={can(tenant.tenantRole, "monthClose.unfinalize")}
        isAccountant={tenant.tenantRole === "ACCOUNTANT"}
        hasAccountantLinked={accountantCount > 0}
        locale={locale}
      />
    </div>
  );
}
