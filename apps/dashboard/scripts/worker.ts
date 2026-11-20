// Recurring-invoice worker.
//
// Long-running Node process started alongside the Next.js server (see
// docker-compose.yml, `worker` service). Uses pg-boss as the cron driver
// because (1) it runs on the Postgres we already operate — no new infra,
// and (2) it gives us production-grade retries, dead-letter, singleton
// locks and SKIP LOCKED for free instead of hand-rolling them.
//
// Architecture:
//   pg-boss schedule "*/5 * * * *" → enqueues one TICK_QUEUE job
//   → handler invokes runRecurringTick(), which claims+generates due
//     invoices using row-level locking on RecurringInvoice.processingStartedAt
//   → pg-boss handles retry/backoff on handler throws
//
// Run:   npm run worker            (dev — via tsx)
// Build: included in `npm run build` via tsc step in package.json
//
// Env:   DATABASE_URL              (same as the Next.js app)
//        WORKER_TICK_CRON          (override cron, default */5 * * * *)
//        WORKER_LOG_LEVEL          (info | warn | error; default info)

import "dotenv/config";
import { PgBoss } from "pg-boss";
import type { Job } from "pg-boss";
import { runRecurringTick } from "../src/lib/recurring/tick";
import { runDepreciationTick } from "../src/lib/fixed-assets/tick";
import { runOrphanCleanup } from "../src/lib/documents/cleanup";
import { runR2Backup } from "../src/lib/backup/r2-backup";
import { runQuoteExpireTick } from "../src/lib/quotes/expire-tick";
import { runBankSyncTick } from "../src/lib/enable-banking/tick";

const TICK_QUEUE = "recurring-invoices-tick";
const AFA_QUEUE = "fixed-assets-depreciation-tick";
const CLEANUP_QUEUE = "documents-orphan-cleanup";
const BACKUP_QUEUE = "r2-cross-region-backup";
const QUOTE_EXPIRE_QUEUE = "quotes-expire-tick";
const BANK_SYNC_QUEUE = "enable-banking-sync";
// Hourly is the sweet spot: smallest user-facing interval is "every 7 days",
// so a max 60-min latency between schedule-due and invoice-generated is
// invisible. Hourly also gives us headroom for additional background jobs
// (overdue reminders, OCR re-runs, …) on the same cadence without thrashing
// the DB. Users in a hurry have the "Jetzt generieren" button which fires
// the same generation logic inline.
const TICK_SCHEDULE = process.env.WORKER_TICK_CRON ?? "0 * * * *";
// AfA-Buchung: einmal pro Monat am Monatsersten um 02:00 (Europe/Berlin).
// Idempotent — verpasste Monate werden vom Tick selbst nachgeholt.
const AFA_SCHEDULE = process.env.WORKER_AFA_CRON ?? "0 2 1 * *";
// Orphan-Cleanup: täglich um 03:00. Räumt verwaiste Uploads (Bucket-Hygiene).
const CLEANUP_SCHEDULE = process.env.WORKER_CLEANUP_CRON ?? "0 3 * * *";
// Cross-Region-Backup: täglich um 04:00. No-op solange BACKUP_R2_* fehlt.
const BACKUP_SCHEDULE = process.env.WORKER_BACKUP_CRON ?? "0 4 * * *";
// Quote auto-expire: daily at 01:30 (Europe/Berlin). Cheap, idempotent —
// flips SENT quotes whose validUntil has passed to EXPIRED.
const QUOTE_EXPIRE_SCHEDULE = process.env.WORKER_QUOTE_EXPIRE_CRON ?? "30 1 * * *";
// Enable Banking sync: every 6 hours. Banks rate-limit AIS polling (often a
// few "free" refreshes per day beyond user-present calls), so a modest cadence
// keeps us well inside limits while transactions stay reasonably fresh. Users
// who need it sooner have the per-connection "Jetzt synchronisieren" button.
const BANK_SYNC_SCHEDULE = process.env.WORKER_BANK_SYNC_CRON ?? "0 */6 * * *";
const LOG_LEVEL = (process.env.WORKER_LOG_LEVEL ?? "info") as "info" | "warn" | "error";

function log(level: "info" | "warn" | "error", ...args: unknown[]) {
  const priority = { error: 0, warn: 1, info: 2 } as const;
  if (priority[level] <= priority[LOG_LEVEL]) {
    const ts = new Date().toISOString();
    console[level](`[worker ${ts}]`, ...args);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    // pg-boss uses its own schema "pgboss" so it doesn't collide with app tables.
    schema: "pgboss",
  });

  boss.on("error", (e: unknown) => log("error", "pg-boss error:", e));

  await boss.start();
  log("info", "pg-boss started");

  // Create the queue (idempotent — safe to call on every boot).
  await boss.createQueue(TICK_QUEUE);

  // Register the handler BEFORE scheduling so the first fire has somewhere
  // to land. Concurrency=1 because runRecurringTick is itself batched; we
  // don't want two ticks running simultaneously and racing on the same rows
  // (the claim pattern protects us, but no need to thrash the DB).
  await boss.work(TICK_QUEUE, { batchSize: 1 }, async ([job]: Job[]) => {
    const id = job?.id ?? "<unknown>";
    log("info", `tick start (job ${id})`);
    try {
      const res = await runRecurringTick();
      log(
        "info",
        `tick done (job ${id}): scanned=${res.scanned} generated=${res.generated} finalized=${res.finalized} errors=${res.errors.length}`,
      );
      if (res.errors.length > 0) {
        for (const err of res.errors) {
          log("warn", `  └─ ${err.scheduleId}: ${err.message}`);
        }
      }
    } catch (e) {
      log("error", `tick failed (job ${id}):`, e);
      throw e; // re-throw so pg-boss marks the job as failed → retry
    }
  });

  // Schedule. `schedule` is idempotent — calling it on every boot just
  // updates the cron expression if it changed.
  await boss.schedule(TICK_QUEUE, TICK_SCHEDULE, {}, { tz: "Europe/Berlin" });
  log("info", `scheduled "${TICK_QUEUE}" with cron "${TICK_SCHEDULE}" (Europe/Berlin)`);

  // ── Fixed-asset depreciation tick ─────────────────────────────────────
  await boss.createQueue(AFA_QUEUE);
  await boss.work(AFA_QUEUE, { batchSize: 1 }, async ([job]: Job[]) => {
    const id = job?.id ?? "<unknown>";
    log("info", `afa tick start (job ${id})`);
    try {
      const res = await runDepreciationTick();
      log(
        "info",
        `afa tick done (job ${id}): scanned=${res.scanned} postedRows=${res.postedRows} errors=${res.errors.length}`,
      );
      if (res.errors.length > 0) {
        for (const err of res.errors) {
          log("warn", `  └─ ${err.assetId}: ${err.message}`);
        }
      }
    } catch (e) {
      log("error", `afa tick failed (job ${id}):`, e);
      throw e;
    }
  });
  await boss.schedule(AFA_QUEUE, AFA_SCHEDULE, {}, { tz: "Europe/Berlin" });
  log("info", `scheduled "${AFA_QUEUE}" with cron "${AFA_SCHEDULE}" (Europe/Berlin)`);

  // ── Orphaned-upload cleanup ───────────────────────────────────────────
  await boss.createQueue(CLEANUP_QUEUE);
  await boss.work(CLEANUP_QUEUE, { batchSize: 1 }, async ([job]: Job[]) => {
    const id = job?.id ?? "<unknown>";
    log("info", `cleanup start (job ${id})`);
    try {
      const res = await runOrphanCleanup();
      log(
        "info",
        `cleanup done (job ${id}): scanned=${res.scanned} deleted=${res.deleted} errors=${res.errors.length}`,
      );
      for (const err of res.errors) {
        log("warn", `  └─ ${err.documentId}: ${err.message}`);
      }
    } catch (e) {
      log("error", `cleanup failed (job ${id}):`, e);
      throw e;
    }
  });
  await boss.schedule(CLEANUP_QUEUE, CLEANUP_SCHEDULE, {}, { tz: "Europe/Berlin" });
  log("info", `scheduled "${CLEANUP_QUEUE}" with cron "${CLEANUP_SCHEDULE}" (Europe/Berlin)`);

  // ── Cross-region backup (R2 → secondary R2) ───────────────────────────
  // The handler is a no-op until BACKUP_R2_* env vars are configured.
  await boss.createQueue(BACKUP_QUEUE);
  await boss.work(BACKUP_QUEUE, { batchSize: 1 }, async ([job]: Job[]) => {
    const id = job?.id ?? "<unknown>";
    log("info", `backup start (job ${id})`);
    try {
      const res = await runR2Backup();
      if (res.skipped) {
        log("info", `backup skipped (job ${id}): ${res.reason}`);
        return;
      }
      log(
        "info",
        `backup done (job ${id}): scanned=${res.scanned} copied=${res.copied} upToDate=${res.upToDate} errors=${res.errors.length}`,
      );
      for (const err of res.errors) {
        log("warn", `  └─ ${err.key}: ${err.message}`);
      }
    } catch (e) {
      log("error", `backup failed (job ${id}):`, e);
      throw e;
    }
  });
  await boss.schedule(BACKUP_QUEUE, BACKUP_SCHEDULE, {}, { tz: "Europe/Berlin" });
  log("info", `scheduled "${BACKUP_QUEUE}" with cron "${BACKUP_SCHEDULE}" (Europe/Berlin)`);

  // ── Quote auto-expire ──────────────────────────────────────────────────
  // Cheap daily sweep — only touches SENT quotes whose validUntil has
  // passed. Idempotent: re-runs find nothing left to do.
  await boss.createQueue(QUOTE_EXPIRE_QUEUE);
  await boss.work(QUOTE_EXPIRE_QUEUE, { batchSize: 1 }, async ([job]: Job[]) => {
    const id = job?.id ?? "<unknown>";
    log("info", `quote-expire start (job ${id})`);
    try {
      const res = await runQuoteExpireTick();
      log(
        "info",
        `quote-expire done (job ${id}): scanned=${res.scanned} expired=${res.expired} errors=${res.errors.length}`,
      );
      for (const err of res.errors) {
        log("warn", `  └─ ${err.quoteId}: ${err.message}`);
      }
    } catch (e) {
      log("error", `quote-expire failed (job ${id}):`, e);
      throw e;
    }
  });
  await boss.schedule(QUOTE_EXPIRE_QUEUE, QUOTE_EXPIRE_SCHEDULE, {}, { tz: "Europe/Berlin" });
  log("info", `scheduled "${QUOTE_EXPIRE_QUEUE}" with cron "${QUOTE_EXPIRE_SCHEDULE}" (Europe/Berlin)`);

  // ── Enable Banking sync ────────────────────────────────────────────────
  // Expires stale consents, incrementally re-syncs active connections and
  // cleans up abandoned PENDING auths. No-op when there are no connections.
  await boss.createQueue(BANK_SYNC_QUEUE);
  await boss.work(BANK_SYNC_QUEUE, { batchSize: 1 }, async ([job]: Job[]) => {
    const id = job?.id ?? "<unknown>";
    log("info", `bank-sync start (job ${id})`);
    try {
      const res = await runBankSyncTick();
      log(
        "info",
        `bank-sync done (job ${id}): expired=${res.expired} synced=${res.synced} imported=${res.imported} cleanedPending=${res.cleanedPending} errors=${res.errors.length}`,
      );
      for (const err of res.errors) {
        log("warn", `  └─ ${err.connectionId}: ${err.message}`);
      }
    } catch (e) {
      log("error", `bank-sync failed (job ${id}):`, e);
      throw e;
    }
  });
  await boss.schedule(BANK_SYNC_QUEUE, BANK_SYNC_SCHEDULE, {}, { tz: "Europe/Berlin" });
  log("info", `scheduled "${BANK_SYNC_QUEUE}" with cron "${BANK_SYNC_SCHEDULE}" (Europe/Berlin)`);

  // Graceful shutdown — drain in-flight jobs before exit.
  const shutdown = async (signal: string) => {
    log("info", `received ${signal}, stopping pg-boss…`);
    try {
      await boss.stop({ graceful: true, timeout: 30_000 });
    } catch (e) {
      log("error", "shutdown error:", e);
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
