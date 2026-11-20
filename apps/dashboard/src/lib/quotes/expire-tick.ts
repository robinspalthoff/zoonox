/**
 * Daily auto-expire job for quotes.
 *
 * Finds all SENT quotes whose `validUntil` lies in the past and flips them
 * to EXPIRED. Skips already-converted quotes (convertedAt set) — a quote
 * that produced an AB/Invoice is fully resolved; flipping it to EXPIRED
 * would muddy the audit trail.
 *
 * Idempotent. Designed to be called from the long-running worker on a
 * daily cron — re-runs are no-ops once the day's batch is processed.
 *
 * Returns counts so the worker log is useful and we can spot anomalies
 * (e.g., a tenant suddenly expiring 200 quotes in a day).
 */

import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export interface ExpireQuotesResult {
  scanned: number;
  expired: number;
  errors: Array<{ quoteId: string; message: string }>;
}

export async function runQuoteExpireTick(now: Date = new Date()): Promise<ExpireQuotesResult> {
  // Single query: SENT quotes whose validUntil has passed and that have
  // NOT been converted into a follow-up doc yet. We don't filter by
  // tenantId — the worker runs platform-wide.
  const candidates = await db.quote.findMany({
    where: {
      status: "SENT",
      validUntil: { lt: now },
      convertedAt: null,
    },
    select: { id: true, tenantId: true, number: true, validUntil: true },
  });

  const result: ExpireQuotesResult = {
    scanned: candidates.length,
    expired: 0,
    errors: [],
  };

  // Sequential is fine — we expect tens, not thousands, per day. Each
  // status flip + audit log lives in its own tx so one failing tenant
  // doesn't block the rest of the batch.
  for (const q of candidates) {
    try {
      // Re-check status inside the update to avoid racing with a manual
      // status change that happened between SELECT and UPDATE. updateMany
      // with the SENT precondition makes this safe.
      const updated = await db.quote.updateMany({
        where: { id: q.id, status: "SENT", convertedAt: null },
        data: { status: "EXPIRED" },
      });
      if (updated.count === 0) {
        // Raced — someone else moved this quote in the meantime. Not an
        // error: just nothing for us to do.
        continue;
      }

      await createAuditLog({
        action: "QUOTE_EXPIRED",
        tenantId: q.tenantId,
        userId: undefined, // system action — not attributable to a user
        entityType: "Quote",
        entityId: q.id,
        details: {
          number: q.number,
          validUntil: q.validUntil?.toISOString() ?? null,
          reason: "auto_expire_tick",
        },
      });
      result.expired += 1;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "unknown";
      result.errors.push({ quoteId: q.id, message });
    }
  }

  return result;
}
