// Document deletion — GoBD-aware.
//
// Two regimes, decided by whether the document has Belegfunktion (i.e. it
// underpins a journal booking):
//
//   • Un-booked (PENDING / DRAFT / FAILED) — no booking, no retention duty.
//     Hard-deleted: row and R2 object both removed.
//
//   • Booked (DONE / PAID) — subject to the §147 AO 10-year retention.
//     "Deleting" it must NOT destroy the Beleg. Instead the journal entries
//     are reversed (storno) and the row is soft-deleted (deletedAt set), so
//     it disappears from the user's lists while the row and the
//     Object-Lock-protected file are retained. This matches how SevDesk &
//     co. handle a "delete" of an already-recorded receipt.
//
// Either way the deletion is written to the audit log.

import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { createAuditLog } from "@/lib/audit";
import { reverseDocumentBooked, reverseDocumentPayment } from "@/lib/journal";
import { TransactionStatus } from "@prisma/client";

export type DeleteDocumentResult =
  | { success: true; mode: "hard" | "soft" }
  | { success: false; error: string };

export async function deleteDocumentById(
  documentId: string,
  tenantId: string,
  userId: string | null,
): Promise<DeleteDocumentResult> {
  const doc = await db.document.findFirst({
    where: { id: documentId, tenantId, deletedAt: null },
    select: {
      id: true,
      status: true,
      storagePath: true,
      fileName: true,
      fixedAsset: { select: { id: true } },
    },
  });
  if (!doc) return { success: false, error: "Document not found." };

  // A document that is the source receipt of a fixed asset cannot be removed
  // on its own — the asset's depreciation schedule depends on it.
  if (doc.fixedAsset) {
    return {
      success: false,
      error:
        "Beleg ist mit einem Anlagegut verknüpft und kann nicht gelöscht werden. Bitte zuerst das Anlagegut entfernen.",
    };
  }

  // GoBD-Retention greift erst, wenn der Beleg tatsächlich gebucht wurde —
  // d.h. wenn ein Journal-Entry mit sourceType=DOCUMENT existiert. Status
  // allein reicht NICHT: nach reiner OCR-Fertigstellung steht der Beleg
  // ebenfalls auf DONE, ist aber noch ungebucht und darf hart gelöscht
  // werden. Wir zählen über sourceType+sourceId (Pre-Booking-Belege haben
  // keinen Entry → Count 0 → Hard-Delete).
  const journalCount = await db.journalEntry.count({
    where: { tenantId, sourceType: "DOCUMENT", sourceId: documentId },
  });
  const isBooked = journalCount > 0;

  if (isBooked) {
    // Reverse the bookings so the P&L / VAT no longer count this document.
    if (doc.status === "PAID") {
      await reverseDocumentPayment(tenantId, documentId, userId);
    }
    await reverseDocumentBooked(tenantId, documentId, userId);

    await db.$transaction([
      // Matched bank transactions lose their Beleg — set them back to unmatched.
      db.bankTransaction.updateMany({
        where: { tenantId, documentId },
        data: { documentId: null, status: TransactionStatus.UNMATCHED },
      }),
      db.document.update({
        where: { id: documentId },
        data: { deletedAt: new Date() },
      }),
    ]);

    await createAuditLog({
      action: "DOCUMENT_DELETED",
      tenantId,
      userId: userId ?? undefined,
      entityType: "Document",
      entityId: documentId,
      details: {
        mode: "soft",
        status: doc.status,
        fileName: doc.fileName,
        note: "booked document — bookings reversed, file retained under Object Lock (GoBD §147 AO)",
      },
    });
    return { success: true, mode: "soft" };
  }

  // Un-booked: no retention duty — remove the file and the row outright.
  // Manuell angelegte file-lose Belege (storagePath="") überspringen den
  // Storage-Call: lokal liefe das auf fs.unlink des Uploads-Roots, R2/S3
  // verweigert leere Keys mit InvalidKey → würde den ganzen Delete abbrechen.
  if (doc.storagePath) {
    await storage.delete(doc.storagePath);
  }
  await db.document.delete({ where: { id: documentId } });

  await createAuditLog({
    action: "DOCUMENT_DELETED",
    tenantId,
    userId: userId ?? undefined,
    entityType: "Document",
    entityId: documentId,
    details: { mode: "hard", status: doc.status, fileName: doc.fileName },
  });
  return { success: true, mode: "hard" };
}
