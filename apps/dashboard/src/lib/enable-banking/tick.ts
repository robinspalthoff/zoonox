/**
 * Background sync tick for Enable Banking connections.
 *
 * Runs platform-wide from the long-running worker (see scripts/worker.ts):
 *   1. Expire consents whose validUntil has passed (ACTIVE → EXPIRED).
 *   2. Incrementally re-sync every still-ACTIVE connection (new transactions
 *      since lastSyncedAt). Consent-expiry mid-sync flips it to EXPIRED.
 *   3. Clean up abandoned PENDING connections (user started /auth, never
 *      returned) after a short TTL.
 *
 * Idempotent and resilient: one failing connection never blocks the batch.
 */

import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { resyncConnection } from "./sync";

/** How long a PENDING connection may linger before we treat it as abandoned. */
const PENDING_TTL_MINUTES = 60;

export interface BankSyncTickResult {
  expired: number;
  synced: number;
  imported: number;
  cleanedPending: number;
  errors: Array<{ connectionId: string; message: string }>;
}

export async function runBankSyncTick(now: Date = new Date()): Promise<BankSyncTickResult> {
  const result: BankSyncTickResult = {
    expired: 0,
    synced: 0,
    imported: 0,
    cleanedPending: 0,
    errors: [],
  };

  // 1) Expire consents that have run out (audit each individually).
  const toExpire = await db.bankConnection.findMany({
    where: { status: "ACTIVE", validUntil: { not: null, lt: now } },
    select: { id: true, tenantId: true, validUntil: true },
  });
  for (const c of toExpire) {
    await db.bankConnection.update({
      where: { id: c.id },
      data: { status: "EXPIRED", error: "consent_expired" },
    });
    await createAuditLog({
      action: "BANK_CONNECTION_EXPIRED",
      tenantId: c.tenantId,
      userId: undefined, // system action
      entityType: "BankConnection",
      entityId: c.id,
      details: { validUntil: c.validUntil?.toISOString() ?? null, reason: "consent_validity_elapsed" },
    });
  }
  result.expired = toExpire.length;

  // 2) Re-sync everything still active.
  const active = await db.bankConnection.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, tenantId: true },
  });
  for (const conn of active) {
    try {
      const res = await resyncConnection({
        tenantId: conn.tenantId,
        connectionId: conn.id,
      });
      result.synced += 1;
      result.imported += res.imported;
    } catch (e) {
      result.errors.push({
        connectionId: conn.id,
        message: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  // 3) Clean up abandoned PENDING connections (never linked any account).
  const cutoff = new Date(now.getTime() - PENDING_TTL_MINUTES * 60 * 1000);
  const cleaned = await db.bankConnection.deleteMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
  });
  result.cleanedPending = cleaned.count;

  return result;
}
