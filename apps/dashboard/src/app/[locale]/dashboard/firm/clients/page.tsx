import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { ClientsList, type ClientCard } from "./clients-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("firm.clients");
  return { title: t("pageTitle") };
}

export default async function ClientsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("firm.clients");
  const tenant = await requireTenant();

  const memberships = await db.tenantUser.findMany({
    where: { userId: tenant.userId },
    include: {
      tenant: { select: { id: true, slug: true, name: true, plan: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const tenantIds = memberships.map((m) => m.tenant.id);
  if (tenantIds.length === 0) {
    return (
      <div className="container mx-auto px-6 py-6 max-w-4xl">
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      </div>
    );
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [lastUploads, monthStatuses, openTxCounts] = await Promise.all([
    db.document.groupBy({
      by: ["tenantId"],
      where: { tenantId: { in: tenantIds }, deletedAt: null },
      _max: { createdAt: true },
    }),
    db.monthClose.findMany({
      where: { tenantId: { in: tenantIds }, year: currentYear, month: currentMonth },
      select: { tenantId: true, status: true },
    }),
    db.bankTransaction.groupBy({
      by: ["tenantId"],
      where: { tenantId: { in: tenantIds }, status: "UNMATCHED" },
      _count: { _all: true },
    }),
  ]);

  const lastUploadByTenant = new Map<string, Date | null>();
  for (const row of lastUploads) lastUploadByTenant.set(row.tenantId, row._max.createdAt ?? null);

  const monthStatusByTenant = new Map<string, "OPEN" | "SUBMITTED" | "CLOSED">();
  for (const row of monthStatuses) monthStatusByTenant.set(row.tenantId, row.status);

  const openTxByTenant = new Map<string, number>();
  for (const row of openTxCounts) openTxByTenant.set(row.tenantId, row._count._all);

  const cards: ClientCard[] = memberships.map((m) => ({
    id: m.tenant.id,
    name: m.tenant.name,
    slug: m.tenant.slug,
    plan: m.tenant.plan,
    role: m.role,
    isActive: m.tenant.id === tenant.tenantId,
    lastUploadAt: lastUploadByTenant.get(m.tenant.id)?.toISOString() ?? null,
    monthStatus: monthStatusByTenant.get(m.tenant.id) ?? "OPEN",
    openTransactionCount: openTxByTenant.get(m.tenant.id) ?? 0,
  }));

  const monthFmt = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" });
  const currentMonthLabel = monthFmt.format(new Date(currentYear, currentMonth - 1, 1));

  return (
    <div className="container mx-auto px-6 py-6 max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("description", { month: currentMonthLabel })}
        </p>
      </header>

      <ClientsList cards={cards} />
    </div>
  );
}
