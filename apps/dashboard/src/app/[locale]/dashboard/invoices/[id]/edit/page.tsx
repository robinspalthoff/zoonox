import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { InvoiceForm, type EditingInvoice } from "../../invoice-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const t = await getTranslations("invoices");
  const { id } = await params;
  const invoice = await db.invoice.findUnique({ where: { id }, select: { number: true } });
  return { title: invoice ? t("editTitle", { number: invoice.number }) : t("editTitle", { number: "" }) };
}

function toInputDate(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenantId } = await requireTenant();
  const { id } = await params;

  const [invoice, clients, settings] = await Promise.all([
    db.invoice.findFirst({
      where: { id, tenantId },
      include: { lineItems: { orderBy: { position: "asc" } } },
    }),
    db.contact.findMany({
      where: { tenantId, isActive: true, roles: { has: "CUSTOMER" } },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, email: true, customerNumber: true,
        contactFirstName: true, contactLastName: true, address: true, zip: true, city: true, country: true, vatId: true,
      },
    }),
    db.companySettings.findUnique({
      where: { tenantId },
      select: {
        name: true, nameSuffix: true, legalForm: true, address: true, zip: true, city: true, country: true,
        email: true, phone: true, website: true, vatId: true, taxId: true,
        bankName: true, iban: true, bic: true, logoBase64: true,
        defaultNotes: true, defaultIntroText: true,
        ownerName: true, managingDirector: true,
        taxMode: true,
      },
    }),
  ]);
  if (!invoice) notFound();

  // GoBD: only DRAFT invoices may be edited in-place. Anything else has to
  // go through the credit-note flow — silently bouncing the user back to the
  // detail page is the friendliest behaviour here.
  if (invoice.status !== "DRAFT") {
    redirect(`/dashboard/invoices/${invoice.id}`);
  }

  const editingInvoice: EditingInvoice = {
    id: invoice.id,
    number: invoice.number,
    contactId: invoice.contactId,
    issueDate: invoice.issueDate.toISOString().slice(0, 10),
    dueDate: toInputDate(invoice.dueDate),
    serviceDate: toInputDate(invoice.serviceDate),
    serviceDateEnd: toInputDate(invoice.serviceDateEnd),
    notes: invoice.notes,
    introText: invoice.introText,
    vatRegulation: invoice.vatRegulation,
    leitwegId: invoice.leitwegId,
    buyerReference: invoice.buyerReference,
    paymentQrEnabled: invoice.paymentQrEnabled,
    globalDiscountType: invoice.globalDiscountType ?? null,
    globalDiscountValue: invoice.globalDiscountValue !== null && invoice.globalDiscountValue !== undefined
      ? Number(invoice.globalDiscountValue) : null,
    lineItems: invoice.lineItems.map((li) => ({
      description: li.description,
      quantity: Number(li.quantity),
      unit: li.unit,
      unitPrice: Number(li.unitPrice),
      vatRate: Number(li.vatRate),
      amount: Number(li.amount),
      discountType: li.discountType ?? null,
      discountValue: li.discountValue !== null && li.discountValue !== undefined
        ? Number(li.discountValue) : null,
    })),
  };

  return (
    <InvoiceForm
      clients={clients}
      settings={settings}
      editingInvoice={editingInvoice}
    />
  );
}
