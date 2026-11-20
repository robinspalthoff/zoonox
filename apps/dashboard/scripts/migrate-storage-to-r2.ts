/**
 * One-shot migration: local filesystem → Cloudflare R2.
 *
 * For each Document row whose `storagePath` does NOT yet have the
 * "tenants/<tenant>/" prefix:
 *   1. Read the file from the local UPLOAD_DIR
 *   2. Upload it to R2 under the new tenant-scoped key
 *   3. Update Document.storagePath to the new key
 *
 * Idempotent: re-running skips rows that are already migrated. Failures
 * are logged but do not abort the run — review the summary at the end.
 *
 * Usage:
 *   STORAGE_DRIVER=r2 R2_ACCOUNT_ID=… R2_ACCESS_KEY=… R2_SECRET_ACCESS_KEY=… \
 *   R2_BUCKET_NAME=… npx tsx scripts/migrate-storage-to-r2.ts [--dry-run]
 *
 * Always run --dry-run first against production data.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "../src/lib/db";
import { r2Adapter } from "../src/lib/storage/r2";
import {
  hasTenantPrefix,
  normalizeLegacyKey,
} from "../src/lib/storage/keys";

const LEGACY_DIR = process.env.DOCUMENT_STORAGE_PATH ?? "uploads/documents";
const DRY_RUN = process.argv.includes("--dry-run");

function inferContentType(filename: string, fallback?: string): string {
  if (fallback) return fallback;
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

async function main() {
  console.log(`[migrate] Driver target: r2  |  Dry run: ${DRY_RUN}`);
  console.log(`[migrate] Legacy dir: ${LEGACY_DIR}`);

  const docs = await db.document.findMany({
    select: { id: true, storagePath: true, fileName: true, fileType: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`[migrate] Found ${docs.length} documents in DB.`);

  let skipped = 0;
  let migrated = 0;
  let alreadyInR2 = 0;
  let missingFile = 0;
  let failed = 0;

  for (const doc of docs) {
    if (hasTenantPrefix(doc.storagePath)) {
      // Already migrated — verify the object exists in R2 (best effort).
      const exists = await r2Adapter.exists(doc.storagePath).catch(() => false);
      if (exists) alreadyInR2++;
      else {
        console.warn(
          `[migrate] DB row already prefixed but object missing in R2: ${doc.id} (${doc.storagePath})`,
        );
      }
      skipped++;
      continue;
    }

    const newKey = normalizeLegacyKey(doc.storagePath);
    const localPath = path.join(process.cwd(), LEGACY_DIR, doc.storagePath);

    let buf: Buffer;
    try {
      buf = await fs.readFile(localPath);
    } catch {
      console.warn(`[migrate] MISSING on disk: ${doc.id} → ${localPath}`);
      missingFile++;
      continue;
    }

    if (DRY_RUN) {
      console.log(
        `[migrate] DRY: would upload ${doc.id} (${buf.length} B) → ${newKey}`,
      );
      migrated++;
      continue;
    }

    try {
      await r2Adapter.put(newKey, buf, inferContentType(doc.fileName, doc.fileType));
      await db.document.update({
        where: { id: doc.id },
        data: { storagePath: newKey },
      });
      console.log(`[migrate] OK   ${doc.id} → ${newKey}`);
      migrated++;
    } catch (err) {
      console.error(`[migrate] FAIL ${doc.id}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log("\n[migrate] Summary");
  console.log(`  migrated:      ${migrated}`);
  console.log(`  already in R2: ${alreadyInR2}`);
  console.log(`  skipped:       ${skipped}`);
  console.log(`  missing file:  ${missingFile}`);
  console.log(`  failed:        ${failed}`);
  if (DRY_RUN) console.log("  (dry-run — no writes performed)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
