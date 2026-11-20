import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { DocumentPreviewPanel } from "./document-preview-panel";
import { DocumentDetailSidebar } from "./document-detail-sidebar";
import { getSkrAccounts, getSkrAccountLabel } from "@/lib/skr-accounts";
import { listComments } from "@/lib/comments/queries";
import { can } from "@/lib/permissions";
import { CommentSection } from "@/components/comments/comment-section";
import { getMonthCloseStatus } from "@/lib/month-close/queries";
import { MonthCloseBanner } from "@/components/month-close/month-close-banner";
import { monthLabelFromDate } from "@/components/month-close/month-label";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const doc = await db.document.findFirst({
    where: { id, deletedAt: null },
    select: { fileName: true },
  });
  return { title: doc?.fileName ?? "Dokument" };
}

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const tenant = await requireTenant();
  const { tenantId, tenantRole, userId } = tenant;

  const tSkr = await getTranslations("skrAccounts");

  const [doc, companySettings] = await Promise.all([
    db.document.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        uploadedBy: { select: { firstName: true, lastName: true, email: true } },
        invoice: { select: { id: true, number: true } },
        lineItems: { orderBy: { position: "asc" } },
        payment: { select: { paidAt: true, method: true } },
        fixedAsset: { select: { id: true, assetNumber: true, name: true } },
        contact: { select: { id: true, name: true, supplierNumber: true } },
      },
    }),
    db.companySettings.findUnique({ where: { tenantId }, select: { skrType: true, taxMode: true } }),
  ]);
  if (!doc) notFound();

  // ── Auto-Verknüpfung mit bestehendem Kreditor ──────────────────────────
  // Wenn der Beleg noch keinen Contact hat, aber OCR einen Lieferantennamen
  // erkannt hat, suchen wir nach einem existierenden Kontakt mit identischem
  // Namen (case-insensitive). Bevorzugt Rolle SUPPLIER; bei eindeutigem
  // Treffer wird der Beleg sofort verknüpft, damit Duplikate vermieden werden.
  if (!doc.contactId && doc.recognizedSupplier) {
    const needle = doc.recognizedSupplier.trim();
    if (needle.length > 0) {
      const candidates = await db.contact.findMany({
        where: {
          tenantId,
          name: { equals: needle, mode: "insensitive" },
        },
        select: { id: true, name: true, supplierNumber: true, roles: true },
        take: 5,
      });
      // Bevorzugt einen Kontakt mit Rolle SUPPLIER, fallback auf den ersten
      // Treffer (kann CUSTOMER/PARTNER/OTHER sein — Rolle SUPPLIER wird
      // dann beim ersten Bearbeiten ergänzt).
      const match = candidates.find((c) => c.roles.includes("SUPPLIER")) ?? candidates[0];
      if (match) {
        await db.document.update({
          where: { id: doc.id },
          data: {
            contactId: match.id,
            // OCR-Freitext mit kanonischem Namen abgleichen, damit alle
            // Anzeigen konsistent sind.
            recognizedSupplier: match.name,
          },
        });
        // In-Memory-Refresh, damit der weitere Code mit dem verknüpften
        // Kontakt rechnet, ohne den ganzen findFirst-Query erneut zu fahren.
        doc.contactId = match.id;
        doc.contact = { id: match.id, name: match.name, supplierNumber: match.supplierNumber };
        doc.recognizedSupplier = match.name;
      }
    }
  }

  const skrType = (companySettings?.skrType ?? "SKR03") as "SKR03" | "SKR04";
  const taxMode = companySettings?.taxMode ?? "STANDARD";

  // Ist der Beleg tatsächlich gebucht?
  //
  // Der Status allein taugt dafür nicht: die OCR setzt am Ende ebenfalls DONE,
  // obwohl der Nutzer den Beleg noch gar nicht fertiggestellt hat. Maßgeblich
  // ist, ob ein Journal-Eintrag existiert — dieselbe Prüfung wie in
  // lib/documents/delete.ts, wo derselbe Fallstrick schon dokumentiert ist.
  const journalEntryCount = await db.journalEntry.count({
    where: { tenantId, sourceType: "DOCUMENT", sourceId: doc.id },
  });
  const isBooked = journalEntryCount > 0;

  // Prev / Next document
  const [prevDoc, nextDoc] = await Promise.all([
    db.document.findFirst({
      where: { tenantId, deletedAt: null, createdAt: { lt: doc.createdAt } },
      orderBy: { createdAt: "desc" },
      select: { id: true, fileName: true },
    }),
    db.document.findFirst({
      where: { tenantId, deletedAt: null, createdAt: { gt: doc.createdAt } },
      orderBy: { createdAt: "asc" },
      select: { id: true, fileName: true },
    }),
  ]);

  // Build full SKR account list for the picker modal
  const skrAccountOptions = getSkrAccounts(skrType).map((a) => ({
    number: a.number,
    label: getSkrAccountLabel(a.number, skrType, (key) => tSkr(key)),
    group: tSkr(`groups.${a.group}`),
  }));

  // Serialize document data for client component (Decimal → string, Date → ISO string)
  const serializedDoc = {
    id: doc.id,
    fileName: doc.fileName,
    fileType: doc.fileType,
    fileSize: doc.fileSize,
    status: doc.status,
    documentType: doc.documentType,
    bookingAccount: doc.bookingAccount,
    suggestedCategory: doc.suggestedCategory,
    recognizedAmount: doc.recognizedAmount?.toString() ?? null,
    recognizedDate: doc.recognizedDate?.toISOString() ?? null,
    recognizedDueDate: doc.recognizedDueDate?.toISOString() ?? null,
    recognizedVatRate: doc.recognizedVatRate?.toString() ?? null,
    dueDate: doc.dueDate?.toISOString() ?? null,
    vatRate: doc.vatRate?.toString() ?? null,
    inputVatKind: doc.inputVatKind ?? null,
    deliveryDate: doc.deliveryDate?.toISOString() ?? null,
    deliveryDateEnd: doc.deliveryDateEnd?.toISOString() ?? null,
    recognizedSupplier: doc.recognizedSupplier,
    recognizedDescription: doc.recognizedDescription,
    documentNumber: doc.documentNumber,
    recognizedDocNumber: doc.recognizedDocNumber,
    ocrText: doc.ocrText,
    ocrConfidence: doc.ocrConfidence,
    notes: doc.notes,
    tags: doc.tags,
    currency: doc.currency,
    exchangeRate: doc.exchangeRate?.toString() ?? null,
    contact: doc.contact ?? null,
    createdAt: doc.createdAt.toISOString(),
    uploadedBy: doc.uploadedBy,
    invoice: doc.invoice,
    payment: doc.payment
      ? { paidAt: doc.payment.paidAt.toISOString(), method: doc.payment.method }
      : null,
    lineItems: doc.lineItems.map((item) => ({
      id: item.id,
      position: item.position,
      description: item.description,
      skrAccount: item.skrAccount,
      depreciation: item.depreciation,
      amount: item.amount?.toString() ?? null,
      vatRule: item.vatRule,
      vatRate: item.vatRate?.toString() ?? null,
      vatAmount: item.vatAmount?.toString() ?? null,
      total: item.total?.toString() ?? null,
    })),
  };

  const comments = await listComments(tenantId, "DOCUMENT", doc.id);
  // Datum für den MonthClose-Lookup: confirmed deliveryDate hat Vorrang,
  // fällt sonst auf das OCR-erkannte oder das createdAt zurück.
  const bookingDate = doc.deliveryDate ?? doc.recognizedDate ?? doc.createdAt;
  const monthInfo = monthLabelFromDate(bookingDate, locale);
  const monthStatus = await getMonthCloseStatus(tenantId, bookingDate);

  return (
    <div className="flex flex-col">
      <div className="flex overflow-hidden" style={{ height: "calc(100vh - 4rem)" }}>
        <DocumentPreviewPanel
          documentId={doc.id}
          fileName={doc.fileName}
          fileType={doc.fileType}
          status={doc.status}
        />
        <DocumentDetailSidebar
          doc={serializedDoc}
          prevDoc={prevDoc}
          nextDoc={nextDoc}
          locale={locale}
          skrType={skrType}
          skrAccountOptions={skrAccountOptions}
          initialPayment={serializedDoc.payment}
          taxMode={taxMode}
          fixedAsset={doc.fixedAsset}
          isBooked={isBooked}
        />
      </div>
      <div className="px-6 py-4 border-t border-border bg-background space-y-3">
        <div className="max-w-3xl mx-auto space-y-3">
          <MonthCloseBanner
            status={monthStatus}
            monthLabel={monthInfo.monthLabel}
            year={monthInfo.year}
          />
          <CommentSection
            entityType="DOCUMENT"
            entityId={doc.id}
            comments={comments}
            currentUserId={userId}
            canWrite={can(tenantRole, "comments.write")}
            canResolve={can(tenantRole, "comments.resolve")}
          />
        </div>
      </div>
    </div>
  );
}
