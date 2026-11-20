// Worker tick: scan for due RecurringInvoice schedules and generate one
// Invoice per schedule. Designed to run safely across multiple worker
// replicas via an atomic "claim" on `processingStartedAt` — only one worker
// can ever hold a row at a time.
//
// Strategy:
//   1. SELECT candidate ids (status=ACTIVE, nextRunAt<=now, not currently claimed
//      OR claim is stale > 10 min)  — read-only, no lock.
//   2. For each candidate: atomic updateMany with the same predicate + set
//      processingStartedAt=now. If 1 row updated → we own it; if 0 → someone
//      else got it first, skip.
//   3. Run generateOneRecurring (which clears processingStartedAt on success).
//   4. On failure: write lastError, clear processingStartedAt so a later tick
//      can retry. pg-boss handles the job-level retry via its own scheduler.

import { db } from "@/lib/db";
import { generateOneRecurring, finalizeAutoSentInvoice } from "./generate";

const STALE_LOCK_MINUTES = 10;
/** Max schedules processed per tick — prevents one tick from running forever. */
const BATCH_SIZE = 100;

export interface TickResult {
  scanned: number;
  generated: number;
  finalized: number;
  errors: { scheduleId: string; message: string }[];
}

export async function runRecurringTick(now: Date = new Date()): Promise<TickResult> {
  const staleCutoff = new Date(now.getTime() - STALE_LOCK_MINUTES * 60_000);

  const candidates = await db.recurringInvoice.findMany({
    where: {
      status: "ACTIVE",
      nextRunAt: { lte: now },
      OR: [
        { processingStartedAt: null },
        { processingStartedAt: { lt: staleCutoff } },
      ],
    },
    select: { id: true, autoSend: true, createdById: true },
    take: BATCH_SIZE,
    orderBy: { nextRunAt: "asc" },
  });

  const result: TickResult = {
    scanned: candidates.length,
    generated: 0,
    finalized: 0,
    errors: [],
  };

  for (const candidate of candidates) {
    // Atomic claim — same predicate as the SELECT, so any concurrent worker
    // that already grabbed this row will leave count=0 here.
    const claimed = await db.recurringInvoice.updateMany({
      where: {
        id: candidate.id,
        status: "ACTIVE",
        nextRunAt: { lte: now },
        OR: [
          { processingStartedAt: null },
          { processingStartedAt: { lt: staleCutoff } },
        ],
      },
      data: { processingStartedAt: now },
    });
    if (claimed.count === 0) continue;

    try {
      const gen = await generateOneRecurring(candidate.id);
      result.generated++;

      if (candidate.autoSend) {
        try {
          const send = await finalizeAutoSentInvoice(gen.invoiceId, candidate.createdById);
          if (send.success) {
            result.finalized++;
          } else {
            // Email delivery failed (no client email, Brevo down, etc.). The
            // invoice itself was generated successfully and stays DRAFT for
            // manual review. Surface the message so the user can react.
            console.error(
              `[recurring] autoSend failed for invoice ${gen.invoiceId}: ${send.error}`,
            );
            await db.recurringInvoice.update({
              where: { id: candidate.id },
              data: { lastError: `Auto-Versand fehlgeschlagen: ${send.error}`.slice(0, 1000) },
            });
          }
        } catch (e) {
          // Unexpected throw inside email send — same non-fatal handling.
          console.error(
            `[recurring] autoSend threw for invoice ${gen.invoiceId}:`,
            e,
          );
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[recurring] generation failed for schedule ${candidate.id}:`, e);
      result.errors.push({ scheduleId: candidate.id, message });
      // Release the claim and record the error so the next tick can retry,
      // and the user sees the message in the UI.
      await db.recurringInvoice.update({
        where: { id: candidate.id },
        data: {
          processingStartedAt: null,
          lastError: message.slice(0, 1000),
        },
      });
    }
  }

  return result;
}
