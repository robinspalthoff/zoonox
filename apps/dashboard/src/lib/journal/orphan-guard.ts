// Orphan guard for journal-entry readers.
//
// Background: JournalEntry has only a soft pointer to Invoice/Document
// (sourceType + sourceId: String?). There is no FK relationship and no
// cascade — by design, because GoBD §147 AO requires booking trails to
// survive even after the underlying Beleg is removed.
//
// In practice that design also lets old/bad data drift in: a hard
// SQL/Studio delete on an Invoice or pre-GoBD-aware paths leave behind
// journal entries that point at IDs nobody knows anymore. Every reader
// that aggregates by sourceType (P&L, BWA, UStVA, DATEV export) would
// otherwise count those as live business.
//
// This helper centralises the "is this entry still backed by a live
// source?" check so every reader gets the same answer and we don't drift
// across modules. It's purely read-side; no DB mutation here.

import { db } from "@/lib/db";

export type LiveSourceIds = {
  /** Tenants whose journal entries are being read. */
  tenantId: string;
  /** Invoice IDs still present in the DB. */
  invoices: Set<string>;
  /**
   * Document IDs still present AND not soft-deleted. Soft-deleted
   * documents have had their bookings reversed via storno (see
   * `deleteDocumentById`), so dropping them here keeps the reports
   * tidy without losing the audit chain — the original + storno pair
   * nets to zero anyway.
   */
  documents: Set<string>;
};

export async function loadLiveSourceIds(tenantId: string): Promise<LiveSourceIds> {
  const [invoices, documents] = await Promise.all([
    db.invoice
      .findMany({ where: { tenantId }, select: { id: true } })
      .then((rs) => new Set(rs.map((r) => r.id))),
    db.document
      .findMany({ where: { tenantId, deletedAt: null }, select: { id: true } })
      .then((rs) => new Set(rs.map((r) => r.id))),
  ]);
  return { tenantId, invoices, documents };
}

/**
 * Returns true when the (sourceType, sourceId) pair points at a record
 * that no longer exists in the DB. Entries without a sourceId (MANUAL,
 * BANK_TRANSACTION, FIXED_ASSET_*) are NEVER considered orphans — they
 * stand on their own.
 */
export function isOrphanSource(
  live: LiveSourceIds,
  sourceType: string,
  sourceId: string | null,
): boolean {
  if (!sourceId) return false;
  switch (sourceType) {
    case "INVOICE":
    case "INVOICE_PAYMENT":
      return !live.invoices.has(sourceId);
    case "DOCUMENT":
    case "DOCUMENT_PAYMENT":
      return !live.documents.has(sourceId);
    default:
      return false;
  }
}
