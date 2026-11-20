// Storage adapter contract.
//
// Every concrete adapter (local FS for dev, Cloudflare R2 for prod) must
// implement this interface. Call-sites depend ONLY on this contract — no
// driver-specific imports leak into routes/services.
//
// "key" is an opaque storage path, e.g. "tenants/default/documents/
// 2026-04/<uuid>.pdf". Adapters treat it as a flat identifier; callers
// build keys via the helpers in ./keys.ts.

import type { ObjectLockMode } from "./retention";

/** S3/R2 Object Lock retention applied to a single object. */
export interface ObjectLock {
  mode: ObjectLockMode;
  /** Until this date the object cannot be deleted or overwritten. */
  retainUntil: Date;
}

export interface PutOptions {
  /**
   * Apply Object Lock retention to the newly-stored object. Used for
   * GoBD-relevant records (invoice PDFs) that must be immutable from the
   * moment they are written. Requires Object Lock to be enabled on the
   * bucket — adapters without support (local FS) ignore this.
   */
  objectLock?: ObjectLock;
}

export interface StorageAdapter {
  /** Upload a buffer under `key`. Overwrites if it already exists. */
  put(
    key: string,
    body: Buffer,
    contentType: string,
    opts?: PutOptions,
  ): Promise<void>;

  /** Read a buffer back. Returns null if the object does not exist. */
  get(key: string): Promise<Buffer | null>;

  /** Best-effort delete. Idempotent — no error if the object is missing. */
  delete(key: string): Promise<void>;

  /** Whether an object exists. Cheap HEAD-style check. */
  exists(key: string): Promise<boolean>;

  /**
   * Get a short-lived URL the browser can fetch directly. For LocalFs
   * this returns a route URL the API serves; for R2 it returns a
   * presigned S3 URL with the requested TTL.
   *
   * Callers SHOULD prefer this over streaming through the app server,
   * to save bandwidth and CPU.
   */
  signedUrl(key: string, ttlSec: number): Promise<string>;

  /**
   * Apply Object Lock retention to an ALREADY-stored object. Used when a
   * record transitions to "finalized" some time after upload (e.g. an
   * uploaded receipt that is later booked into the journal).
   *
   * Idempotent: retention may be extended but — in COMPLIANCE mode — never
   * shortened or removed. No-op for adapters without Object Lock support
   * (local FS). Throws if the bucket has Object Lock disabled.
   */
  setRetention(key: string, lock: ObjectLock): Promise<void>;
}
