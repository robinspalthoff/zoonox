import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { peekNumber } from "@/lib/number-ranges";
import { QuoteForm, type QuoteTemplate } from "../quote-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("quotes");
  return { title: t("newTitle") };
}

export default async function NewQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ template?: string }>;
}) {
  const { tenantId, tenantRole } = await requireTenant();
  const { locale } = await params;
  if (tenantRole === "ACCOUNTANT") redirect(`/${locale}/dashboard/quotes`);
  const { template: templateId } = await searchParams;

  const [clients, settings] = await Promise.all([
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

  const nextNumber = await peekNumber(tenantId, "QUOTE");

  let template: QuoteTemplate | undefined;
  if (templateId) {
    const src = await db.quote.findUnique({
      where: { id: templateId, tenantId },
      include: { lineItems: { orderBy: { position: "asc" } } },
    });
    if (src) {
      template = {
        contactId: src.contactId,
        introText: src.introText,
        notes: src.notes,
        vatRegulation: src.vatRegulation,
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
  }

  return (
    <QuoteForm
      clients={clients}
      settings={settings}
      nextNumber={nextNumber}
      template={template}
    />
  );
}
