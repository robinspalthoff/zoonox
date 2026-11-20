import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { CashbookView } from "./cashbook-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("bank.cashbook");
  return { title: t("title") };
}

export default async function CashbookPage() {
  const { tenantId } = await requireTenant();

  const entries = await db.cashbookEntry.findMany({
    where: { tenantId },
    orderBy: { date: "asc" },
    include: {
      document: { select: { id: true, fileName: true, recognizedSupplier: true } },
    },
  });

  return (
    <CashbookView
      entries={entries.map((e) => ({
        id: e.id,
        date: e.date.toISOString(),
        amount: Number(e.amount),
        entryType: e.entryType,
        description: e.description,
        category: e.category,
        vatRate: e.vatRate != null ? Number(e.vatRate) : null,
        documentId: e.documentId,
        documentName: e.document?.recognizedSupplier || e.document?.fileName || null,
      }))}
    />
  );
}
