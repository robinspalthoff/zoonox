// Orphaned-upload cleanup — bucket hygiene.
//
// A Document row (and its R2 object) is created the moment a file is
// uploaded, before the user has categorised or booked it. If the user
// abandons that upload, the row and the object linger indefinitely. This
// job removes such orphans:
//
//   - status PENDING or FAILED — never reached a booked (DONE/PAID) or
//     user-saved (DRAFT) state
//   - untouched (updatedAt) for at least DOCUMENT_ORPHAN_TTL_DAYS
//   - not linked to any invoice, bank transaction, cashbook entry,
//     fixed asset or payment
//
// Finalized GoBD records (DONE/PAID) are never matched — and their R2
// objects carry Object Lock retention, so a delete would fail anyway.
// DRAFT documents are user work-in-progress and are likewise excluded.

import { db } from "@/lib/db";
import { storage } from "@/lib/storage";

const DEFAULT_TTL_DAYS = 30;

export interface OrphanCleanupResult {
  scanned: number;
  deleted: number;
  errors: { documentId: string; message: string }[];
}

export async function runOrphanCleanup(): Promise<OrphanCleanupResult> {
  const ttlDays = Number(process.env.DOCUMENT_ORPHAN_TTL_DAYS ?? DEFAULT_TTL_DAYS);
  const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

  const orphans = await db.document.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      updatedAt: { lt: cutoff },
      invoiceId: null,
      payment: { is: null },
      fixedAsset: { is: null },
      transactions: { none: {} },
      cashbookEntries: { none: {} },
    },
    select: { id: true, storagePath: true },
  });

  const result: OrphanCleanupResult = {
    scanned: orphans.length,
    deleted: 0,
    errors: [],
  };

  for (const doc of orphans) {
    try {
      await storage.delete(doc.storagePath);
      await db.document.delete({ where: { id: doc.id } });
      result.deleted++;
    } catch (e) {
      result.errors.push({
        documentId: doc.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
