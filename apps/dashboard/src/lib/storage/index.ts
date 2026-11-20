// Storage facade.
//
// `storage` is the single entry point used by routes/services. The
// driver is selected once at module load via STORAGE_DRIVER:
//   - "local" (default in dev) → local filesystem under uploads/documents
//   - "r2"                       → Cloudflare R2 via S3 API
//
// Adding a new backend (e.g. Backblaze B2, MinIO) means: add an adapter
// next to local-fs.ts / r2.ts and extend the switch below. No call-site
// changes.

import type { StorageAdapter } from "./types";
import { localFsAdapter } from "./local-fs";
import { r2Adapter } from "./r2";

const driver = (process.env.STORAGE_DRIVER ?? "local").toLowerCase();

function pick(): StorageAdapter {
  if (driver === "r2") return r2Adapter;
  if (driver === "local" || driver === "fs") return localFsAdapter;
  throw new Error(
    `[storage] Unknown STORAGE_DRIVER="${driver}". Use "local" or "r2".`,
  );
}

export const storage: StorageAdapter = pick();
export const STORAGE_DRIVER = driver;

export {
  buildDocumentKey,
  buildInvoiceKey,
  hasTenantPrefix,
  normalizeLegacyKey,
  LEGACY_PREFIX,
} from "./keys";
export {
  gobdRetainUntil,
  GOBD_OBJECT_LOCK_MODE,
  GOBD_RETENTION_YEARS,
} from "./retention";
export type { ObjectLockMode } from "./retention";
export type { StorageAdapter, ObjectLock, PutOptions } from "./types";
