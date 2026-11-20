import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Plus, FileSignature } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { OCView, type OCRow } from "./oc-view";
import { BusinessDocEmptyState } from "@/components/business-doc/empty-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("orderConfirmations");
  return { title: t("pageTitle") };
}

export default async function OrderConfirmationsPage() {
  const { tenantId, tenantRole } = await requireTenant();
  const canCreate = tenantRole !== "ACCOUNTANT";
  const t = await getTranslations("orderConfirmations");

  const ocs = await db.orderConfirmation.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: {
      contact: { select: { name: true, email: true } },
      quote:   { select: { number: true } },
    },
  });

  if (ocs.length === 0 && canCreate) {
    return (
      <div className="p-6">
        <BusinessDocEmptyState
          icon={FileSignature}
          eyebrow={t("emptyState.eyebrow")}
          title={t("emptyState.title")}
          subtitle={t("emptyState.subtitle")}
          bullets={[
            t("emptyState.bullet1"),
            t("emptyState.bullet2"),
            t("emptyState.bullet3"),
          ]}
          ctaLabel={t("emptyState.cta")}
          ctaHref="/dashboard/order-confirmations/new"
          helpText={t("emptyState.helpText")}
        />
      </div>
    );
  }

  const rows: OCRow[] = ocs.map((o) => ({
    id: o.id,
    number: o.number,
    status: o.status,
    issueDate: o.issueDate.toISOString(),
    deliveryDate: o.deliveryDate ? o.deliveryDate.toISOString() : null,
    total: Number(o.total),
    clientName: o.contact.name,
    clientEmail: o.contact.email,
    quoteNumber: o.quote?.number ?? null,
  }));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
        </div>
        {canCreate && (
          <Link href="/dashboard/order-confirmations/new"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors">
            <Plus className="w-4 h-4" />
            {t("new")}
          </Link>
        )}
      </div>

      <OCView rows={rows} />
    </div>
  );
}
