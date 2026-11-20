// Worker tick: scan for fixed-asset depreciation rows whose period is due
// and post them to the journal. Mirrors the design of `lib/recurring/tick.ts`:
//
//   1. SELECT candidate assets (ACTIVE or PLANNED, depreciationStart ≤ now,
//      not currently claimed OR stale).
//   2. atomic updateMany claim on processingStartedAt.
//   3. for each owned asset, walk every plan row with postedAt = NULL and
//      period <= current → call postPeriod (idempotent via unique constraint).
//   4. clear the claim on success/failure, surface lastError on failure.
//
// Catchup-safe: if the cron didn't fire for two months, the next tick posts
// both missed months in order. The unique constraint on
// (assetId, periodYear, periodMonth) plus the inner postedAt check guarantee
// no double-posting under concurrent workers.

import { db } from "@/lib/db";
import { postPeriod } from "./service";

const STALE_LOCK_MINUTES = 10;
const BATCH_SIZE = 500;

export interface DepreciationTickResult {
  scanned: number;
  postedRows: number;
  errors: { assetId: string; message: string }[];
}

export async function runDepreciationTick(
  now: Date = new Date(),
): Promise<DepreciationTickResult> {
  const staleCutoff = new Date(now.getTime() - STALE_LOCK_MINUTES * 60_000);
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  const candidates = await db.fixedAsset.findMany({
    where: {
      status: { in: ["PLANNED", "ACTIVE"] },
      depreciationStart: { lte: now },
      OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: staleCutoff } }],
    },
    select: { id: true, tenantId: true, createdById: true },
    take: BATCH_SIZE,
    orderBy: { depreciationStart: "asc" },
  });

  const result: DepreciationTickResult = {
    scanned: candidates.length,
    postedRows: 0,
    errors: [],
  };

  for (const candidate of candidates) {
    const claimed = await db.fixedAsset.updateMany({
      where: {
        id: candidate.id,
        status: { in: ["PLANNED", "ACTIVE"] },
        OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: staleCutoff } }],
      },
      data: { processingStartedAt: now },
    });
    if (claimed.count === 0) continue;

    try {
      const duePeriods = await db.fixedAssetDepreciation.findMany({
        where: {
          assetId: candidate.id,
          postedAt: null,
          OR: [
            { periodYear: { lt: currentYear } },
            { periodYear: currentYear, periodMonth: { lte: currentMonth } },
          ],
        },
        orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }],
        select: { periodYear: true, periodMonth: true },
      });

      for (const p of duePeriods) {
        const r = await postPeriod(
          candidate.tenantId,
          candidate.id,
          p.periodYear,
          p.periodMonth,
          candidate.createdById,
        );
        if (!r.skipped) result.postedRows++;
      }

      await db.fixedAsset.update({
        where: { id: candidate.id },
        data: { processingStartedAt: null, lastError: null },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      result.errors.push({ assetId: candidate.id, message });
      await db.fixedAsset.update({
        where: { id: candidate.id },
        data: { processingStartedAt: null, lastError: message },
      });
    }
  }

  return result;
}
