import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { CorrectionForm } from "./correction-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const inv = await db.invoice.findUnique({
    where: { id },
    select: { number: true },
  });
  const t = await getTranslations("invoices.correction");
  return { title: inv ? t("pageTitleFor", { number: inv.number }) : t("pageTitle") };
}

export default async function CorrectInvoicePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const { tenantId } = await requireTenant();

  const invoice = await db.invoice.findFirst({
    where: { id, tenantId },
    include: {
      contact: { select: { name: true } },
      lineItems: { orderBy: { position: "asc" } },
    },
  });
  if (!invoice) notFound();

  // Only finalised invoices can be corrected. Drafts → edit them directly,
  // credit notes / earlier corrections → not correctable.
  if (invoice.type !== "INVOICE") {
    redirect(`/${locale}/dashboard/invoices/${id}`);
  }
  if (
    invoice.status !== "SENT" &&
    invoice.status !== "OVERDUE" &&
    invoice.status !== "PAID"
  ) {
    redirect(`/${locale}/dashboard/invoices/${id}`);
  }

  // Plain shape for the client form — Prisma Decimal/Date don't cross the
  // RSC boundary safely.
  const original = {
    id: invoice.id,
    number: invoice.number,
    issueDate: invoice.issueDate.toISOString(),
    contactName: invoice.contact.name,
    total: Number(invoice.total),
    lineItems: invoice.lineItems.map((li) => ({
      description: li.description,
      quantity: Number(li.quantity),
      unit: li.unit,
      unitPrice: Number(li.unitPrice),
      vatRate: li.vatRate,
      amount: Number(li.amount),
    })),
  };

  return <CorrectionForm original={original} />;
}
