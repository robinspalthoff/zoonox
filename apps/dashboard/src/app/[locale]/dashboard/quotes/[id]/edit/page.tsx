import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { QuoteForm, type EditingQuote } from "../../quote-form";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const t = await getTranslations("quotes");
  const { id } = await params;
  const quote = await db.quote.findUnique({ where: { id }, select: { number: true } });
  return { title: quote ? t("editTitle", { number: quote.number }) : t("editTitle", { number: "" }) };
}

function toInputDate(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { tenantId } = await requireTenant();
  const { id } = await params;

  const [quote, clients, settings] = await Promise.all([
    db.quote.findFirst({
      where: { id, tenantId },
      include: { lineItems: { orderBy: { position: "asc" } } },
    }),
    db.contact.findMany({
      where: { tenantId, isActive: true, roles: { has: "CUSTOMER" } },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, email: true, customerNumber: true,
        contactFirstName: true, contactLastName: true,
        address: true, zip: true, city: true, country: true, vatId: true,
      },
    }),
    db.companySettings.findUnique({
      where: { tenantId },
      select: {
        name: true, nameSuffix: true, address: true, zip: true, city: true, country: true,
        email: true, phone: true, website: true, vatId: true, taxId: true,
        bankName: true, iban: true, bic: true, logoBase64: true,
        defaultNotes: true, defaultIntroText: true,
        ownerName: true, managingDirector: true, taxMode: true,
      },
    }),
  ]);
  if (!quote) notFound();
  // A converted quote is locked — editing would silently drift away from
  // the follow-up document. Bounce the user to the detail page.
  if (quote.convertedAt) {
    redirect(`/dashboard/quotes/${quote.id}`);
  }

  const editingQuote: EditingQuote = {
    id: quote.id,
    number: quote.number,
    contactId: quote.contactId,
    issueDate: quote.issueDate.toISOString().slice(0, 10),
    validUntil: toInputDate(quote.validUntil),
    serviceDate: toInputDate(quote.serviceDate),
    serviceDateEnd: toInputDate(quote.serviceDateEnd),
    notes: quote.notes,
    introText: quote.introText,
    vatRegulation: quote.vatRegulation,
    globalDiscountType: quote.globalDiscountType ?? null,
    globalDiscountValue: quote.globalDiscountValue !== null && quote.globalDiscountValue !== undefined
      ? Number(quote.globalDiscountValue) : null,
    lineItems: quote.lineItems.map((li) => ({
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
    <QuoteForm clients={clients} settings={settings} editingQuote={editingQuote} />
  );
}
