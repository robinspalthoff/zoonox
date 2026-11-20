import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Plus, ArrowLeft } from "lucide-react";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { RecurringList, type RecurringRow } from "./recurring-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices.recurring");
  return { title: t("pageTitle") };
}

export default async function RecurringInvoicesPage() {
  const { tenantId, tenantRole } = await requireTenant();
  const canCreate = tenantRole !== "ACCOUNTANT";
  const t = await getTranslations("invoices.recurring");

  const schedules = await db.recurringInvoice.findMany({
    where: { tenantId },
    orderBy: [{ status: "asc" }, { nextRunAt: "asc" }],
    include: {
      contact: { select: { name: true } },
      _count: { select: { generatedInvoices: true, lineItems: true } },
    },
  });

  const rows: RecurringRow[] = schedules.map((s) => ({
    id: s.id,
    title: s.title,
    clientName: s.contact.name,
    interval: s.interval,
    status: s.status,
    autoSend: s.autoSend,
    nextRunAt: s.nextRunAt.toISOString(),
    lastRunAt: s.lastRunAt?.toISOString() ?? null,
    endDate: s.endDate?.toISOString() ?? null,
    generatedCount: s._count.generatedInvoices,
    lineItemCount: s._count.lineItems,
    hasError: !!s.lastError,
  }));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <Link
            href="/dashboard/invoices"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t("backToInvoices")}
          </Link>
          <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
        </div>
        {canCreate && (
          <Link
            href="/dashboard/invoices/recurring/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t("new")}
          </Link>
        )}
      </div>

      <RecurringList rows={rows} />
    </div>
  );
}
