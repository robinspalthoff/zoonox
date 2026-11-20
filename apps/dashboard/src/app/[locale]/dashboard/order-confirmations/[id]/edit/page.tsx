import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { OCForm, type EditingOC } from "../../oc-form";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const t = await getTranslations("orderConfirmations");
  const { id } = await params;
  const oc = await db.orderConfirmation.findUnique({ where: { id }, select: { number: true } });
  return { title: oc ? t("editTitle", { number: oc.number }) : t("editTitle", { number: "" }) };
}

function toInputDate(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

export default async function EditOCPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenantId } = await requireTenant();
  const { id } = await params;

  const [oc, clients, settings] = await Promise.all([
    db.orderConfirmation.findFirst({
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
  if (!oc) notFound();
  if (oc.status === "INVOICED" || oc.status === "CANCELLED") {
    redirect(`/dashboard/order-confirmations/${oc.id}`);
  }

  const editingOC: EditingOC = {
    id: oc.id,
    number: oc.number,
    contactId: oc.contactId,
    issueDate: oc.issueDate.toISOString().slice(0, 10),
    deliveryDate: toInputDate(oc.deliveryDate),
    serviceDate: toInputDate(oc.serviceDate),
    serviceDateEnd: toInputDate(oc.serviceDateEnd),
    notes: oc.notes,
    introText: oc.introText,
    vatRegulation: oc.vatRegulation,
    quoteId: oc.quoteId,
    globalDiscountType: oc.globalDiscountType ?? null,
    globalDiscountValue: oc.globalDiscountValue !== null && oc.globalDiscountValue !== undefined
      ? Number(oc.globalDiscountValue) : null,
    lineItems: oc.lineItems.map((li) => ({
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

  return <OCForm clients={clients} settings={settings} editingOC={editingOC} />;
}
