import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { DocumentsView } from "./documents-view";
import { countOpenCommentsByEntity } from "@/lib/comments/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("documents");
  return { title: t("pageTitle") };
}

export default async function DocumentsPage() {
  const { tenantId } = await requireTenant();

  const documents = await db.document.findMany({
    // Soft-gelöschte Belege (gebuchte Dokumente mit deletedAt-Marker, GoBD-
    // retention-bound) gehören NICHT in die User-Liste.
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      status: true,
      source: true,
      documentType: true,
      recognizedAmount: true,
      recognizedDate: true,
      recognizedSupplier: true,
      contact: { select: { id: true, name: true } },
      currency: true,
      exchangeRate: true,
      dueDate: true,
      recognizedDueDate: true,
      createdAt: true,
      uploadedBy: { select: { firstName: true, lastName: true } },
      payment: { select: { id: true } },
    },
  });

  const openCommentCounts = await countOpenCommentsByEntity(
    tenantId,
    "DOCUMENT",
    documents.map((d) => d.id),
  );

  return (
    <DocumentsView
      documents={documents.map((d) => ({
        ...d,
        recognizedAmount: d.recognizedAmount?.toString() ?? null,
        recognizedDate: d.recognizedDate?.toISOString() ?? null,
        // Anzeige bevorzugt den verknüpften Kontakt; Fallback ist der
        // OCR-Freitext, damit alte Belege ohne FK weiterhin lesbar bleiben.
        recognizedSupplier: d.contact?.name ?? d.recognizedSupplier,
        currency: d.currency,
        exchangeRate: d.exchangeRate?.toString() ?? null,
        // Liste zeigt – wie bei Betrag/Datum/Lieferant – den besten verfügbaren
        // Wert: bestätigtes Fälligkeitsdatum, sonst den OCR-Vorschlag (analog zur
        // Detailansicht, die ebenfalls dueDate ?? recognizedDueDate nutzt).
        dueDate: (d.dueDate ?? d.recognizedDueDate)?.toISOString() ?? null,
        isPaid: d.payment !== null,
        createdAt: d.createdAt.toISOString(),
        openCommentCount: openCommentCounts.get(d.id) ?? 0,
      }))}
    />
  );
}
