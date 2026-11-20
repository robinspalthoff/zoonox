import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { InvoicesView, type InvoiceRow } from "./invoices-view";
import { NewInvoiceSplitButton } from "./new-invoice-split-button";
import { countOpenCommentsByEntity } from "@/lib/comments/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices");
  return { title: t("pageTitle") };
}

export default async function InvoicesPage() {
  const { tenantId, tenantRole } = await requireTenant();
  // Steuerberater bekommen die Liste read-only — Anlege-CTAs (Standard
  // & wiederkehrend) werden ausgeblendet. Backend ist über `can()`
  // bereits dicht; das ist nur die UI-Konsequenz, damit der Berater
  // gar keinen Knopf zum Klicken sieht.
  const canCreate = tenantRole !== "ACCOUNTANT";

  const t = await getTranslations("invoices");

  const invoices = await db.invoice.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: { contact: { select: { name: true, email: true } } },
  });

  const openCommentCounts = await countOpenCommentsByEntity(
    tenantId,
    "INVOICE",
    invoices.map((i) => i.id),
  );

  const rows: InvoiceRow[] = invoices.map((inv) => ({
    id: inv.id,
    number: inv.number,
    status: inv.status,
    type: inv.type,
    issueDate: inv.issueDate.toISOString(),
    dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
    total: Number(inv.total),
    clientName: inv.contact.name,
    clientEmail: inv.contact.email,
    recurringInvoiceId: inv.recurringInvoiceId,
    openCommentCount: openCommentCounts.get(inv.id) ?? 0,
  }));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
        </div>
        {canCreate && <NewInvoiceSplitButton />}
      </div>

      <InvoicesView invoices={rows} canWrite={canCreate} />
    </div>
  );
}
