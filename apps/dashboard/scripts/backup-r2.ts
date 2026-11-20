/**
 * On-demand cross-region backup: primary R2 → secondary R2 bucket.
 *
 * The same routine the worker runs nightly (BACKUP_QUEUE), exposed as a
 * standalone command for manual runs, first-time seeding of the secondary
 * bucket, or CI/ops verification.
 *
 * Requires the BACKUP_R2_* env vars (see docs/deployment.md). If they are
 * absent the run is a no-op and exits 0.
 *
 * Usage:
 *   npx tsx scripts/backup-r2.ts
 */

import "dotenv/config";
import { runR2Backup } from "../src/lib/backup/r2-backup";

async function main() {
  console.log("[backup-r2] starting cross-region backup…");
  const res = await runR2Backup();

  if (res.skipped) {
    console.log(`[backup-r2] skipped: ${res.reason}`);
    return;
  }

  console.log("[backup-r2] Summary");
  console.log(`  scanned:    ${res.scanned}`);
  console.log(`  copied:     ${res.copied}`);
  console.log(`  up to date: ${res.upToDate}`);
  console.log(`  errors:     ${res.errors.length}`);
  for (const err of res.errors) {
    console.error(`  └─ ${err.key}: ${err.message}`);
  }
  if (res.errors.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("[backup-r2] fatal:", e);
  process.exitCode = 1;
});
