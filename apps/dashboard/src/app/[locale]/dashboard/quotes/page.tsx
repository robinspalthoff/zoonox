import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Plus, ClipboardList } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { QuotesView, type QuoteRow } from "./quotes-view";
import { BusinessDocEmptyState } from "@/components/business-doc/empty-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("quotes");
  return { title: t("pageTitle") };
}

export default async function QuotesPage() {
  const { tenantId, tenantRole } = await requireTenant();
  const canCreate = tenantRole !== "ACCOUNTANT";
  const t = await getTranslations("quotes");

  const quotes = await db.quote.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: { contact: { select: { name: true, email: true } } },
  });

  // First-run experience: zero quotes → show focused empty state without
  // tabs, search or table headers. Reduces decision overhead for new
  // users and keeps the screen calm until there's something to manage.
  if (quotes.length === 0 && canCreate) {
    return (
      <div className="p-6">
        <BusinessDocEmptyState
          icon={ClipboardList}
          eyebrow={t("emptyState.eyebrow")}
          title={t("emptyState.title")}
          subtitle={t("emptyState.subtitle")}
          bullets={[
            t("emptyState.bullet1"),
            t("emptyState.bullet2"),
            t("emptyState.bullet3"),
          ]}
          ctaLabel={t("emptyState.cta")}
          ctaHref="/dashboard/quotes/new"
          helpText={t("emptyState.helpText")}
        />
      </div>
    );
  }

  const rows: QuoteRow[] = quotes.map((q) => ({
    id: q.id,
    number: q.number,
    status: q.status,
    issueDate: q.issueDate.toISOString(),
    validUntil: q.validUntil ? q.validUntil.toISOString() : null,
    total: Number(q.total),
    clientName: q.contact.name,
    clientEmail: q.contact.email,
    convertedAt: q.convertedAt ? q.convertedAt.toISOString() : null,
  }));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
        </div>
        {canCreate && (
          <Link href="/dashboard/quotes/new"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors">
            <Plus className="w-4 h-4" />
            {t("new")}
          </Link>
        )}
      </div>

      <QuotesView quotes={rows} />
    </div>
  );
}
