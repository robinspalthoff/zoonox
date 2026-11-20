import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { peekNumber } from "@/lib/number-ranges";
import { InvoiceForm, type InvoiceTemplate } from "../invoice-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices");
  return { title: t("newTitle") };
}

export default async function NewInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    template?: string;
    fromQuote?: string;
    fromOrderConfirmation?: string;
  }>;
}) {
  const { tenantId, tenantRole } = await requireTenant();
  const { locale } = await params;
  // Steuerberater dürfen keine Rechnungen anlegen (USt-rechtlich Sache
  // des leistenden Unternehmers). Direkt-URL führt zurück zur Liste.
  if (tenantRole === "ACCOUNTANT") redirect(`/${locale}/dashboard/invoices`);
  const sp = await searchParams;

  const [clients, settings] = await Promise.all([
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

  // Pre-compute next invoice number for display (advisory only — real number
  // assigned atomically on save via the INVOICE number range).
  const nextNumber = await peekNumber(tenantId, "INVOICE");

  // Resolve template source: existing invoice (?template), Quote (?fromQuote)
  // or OrderConfirmation (?fromOrderConfirmation). The Quote/AB paths also
  // pass the source id so the resulting invoice is linked + the source's
  // status flipped on save (see invoice actions).
  let template: InvoiceTemplate | undefined;
  let sourceQuoteId: string | undefined;
  let sourceOrderConfirmationId: string | undefined;

  if (sp.template) {
    const src = await db.invoice.findUnique({
      where: { id: sp.template, tenantId },
      include: { lineItems: { orderBy: { position: "asc" } } },
    });
    if (src) {
      template = {
        contactId: src.contactId,
        introText: src.introText,
        notes: src.notes,
        vatRegulation: src.vatRegulation,
        buyerReference: src.buyerReference,
        globalDiscountType: (src.globalDiscountType as "percent" | "amount" | null) ?? null,
        globalDiscountValue: src.globalDiscountValue !== null && src.globalDiscountValue !== undefined
          ? Number(src.globalDiscountValue) : null,
        lineItems: src.lineItems.map((li) => ({
          description: li.description,
          quantity: Number(li.quantity),
          unit: li.unit,
          unitPrice: Number(li.unitPrice),
          vatRate: Number(li.vatRate),
          discountType: (li.discountType as "percent" | "amount" | null) ?? null,
          discountValue: li.discountValue !== null && li.discountValue !== undefined
            ? Number(li.discountValue) : null,
        })),
      };
    }
  } else if (sp.fromQuote) {
    const q = await db.quote.findUnique({
      where: { id: sp.fromQuote, tenantId },
      include: { lineItems: { orderBy: { position: "asc" } } },
    });
    if (q) {
      template = {
        contactId: q.contactId,
        introText: q.introText,
        notes: q.notes,
        vatRegulation: q.vatRegulation,
        buyerReference: null,
        globalDiscountType: (q.globalDiscountType as "percent" | "amount" | null) ?? null,
        globalDiscountValue: q.globalDiscountValue !== null && q.globalDiscountValue !== undefined
          ? Number(q.globalDiscountValue) : null,
        lineItems: q.lineItems.map((li) => ({
          description: li.description,
          quantity: Number(li.quantity),
          unit: li.unit,
          unitPrice: Number(li.unitPrice),
          vatRate: Number(li.vatRate),
          discountType: (li.discountType as "percent" | "amount" | null) ?? null,
          discountValue: li.discountValue !== null && li.discountValue !== undefined
            ? Number(li.discountValue) : null,
        })),
      };
      sourceQuoteId = q.id;
    }
  } else if (sp.fromOrderConfirmation) {
    const oc = await db.orderConfirmation.findUnique({
      where: { id: sp.fromOrderConfirmation, tenantId },
      include: { lineItems: { orderBy: { position: "asc" } } },
    });
    if (oc) {
      template = {
        contactId: oc.contactId,
        introText: oc.introText,
        notes: oc.notes,
        vatRegulation: oc.vatRegulation,
        buyerReference: null,
        globalDiscountType: (oc.globalDiscountType as "percent" | "amount" | null) ?? null,
        globalDiscountValue: oc.globalDiscountValue !== null && oc.globalDiscountValue !== undefined
          ? Number(oc.globalDiscountValue) : null,
        lineItems: oc.lineItems.map((li) => ({
          description: li.description,
          quantity: Number(li.quantity),
          unit: li.unit,
          unitPrice: Number(li.unitPrice),
          vatRate: Number(li.vatRate),
          discountType: (li.discountType as "percent" | "amount" | null) ?? null,
          discountValue: li.discountValue !== null && li.discountValue !== undefined
            ? Number(li.discountValue) : null,
        })),
      };
      sourceOrderConfirmationId = oc.id;
      // Inherit the originating quote (if any) so the invoice keeps the
      // full chain Quote → AB → Invoice on the detail page.
      if (oc.quoteId) sourceQuoteId = oc.quoteId;
    }
  }

  return (
    <InvoiceForm
      clients={clients}
      settings={settings}
      nextNumber={nextNumber}
      template={template}
      sourceQuoteId={sourceQuoteId}
      sourceOrderConfirmationId={sourceOrderConfirmationId}
    />
  );
}
