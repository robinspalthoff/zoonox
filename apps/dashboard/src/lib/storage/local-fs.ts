// Local-filesystem adapter.
//
// Used in dev (STORAGE_DRIVER=local) and as a fallback when R2 env
// is missing. The key is mapped 1:1 onto a path under UPLOAD_DIR —
// e.g. key "tenants/default/documents/2026-04/abc.pdf" lands at
// <cwd>/uploads/documents/tenants/default/documents/2026-04/abc.pdf.
//
// Legacy rows whose storagePath has no "tenants/" prefix are still
// resolved correctly because the migration script normalises them
// before flipping the driver.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { StorageAdapter } from "./types";
import { hasTenantPrefix, normalizeLegacyKey } from "./keys";

const UPLOAD_DIR = process.env.DOCUMENT_STORAGE_PATH ?? "uploads/documents";

function abs(key: string): string {
  // Accept legacy keys for transparent backwards compat in local dev.
  const normalised = hasTenantPrefix(key) ? key : normalizeLegacyKey(key);
  return path.join(process.cwd(), UPLOAD_DIR, normalised);
}

export const localFsAdapter: StorageAdapter = {
  async put(key, body) {
    const target = abs(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
  },

  async get(key) {
    try {
      // Try the canonical mapping first.
      return await fs.readFile(abs(key));
    } catch {
      // Fallback: a key like "tenants/default/documents/2026-04/x.pdf"
      // might correspond to a legacy file at "2026-04/x.pdf".
      if (hasTenantPrefix(key)) {
        const legacy = key.replace(/^tenants\/[^/]+\/documents\//, "");
        try {
          return await fs.readFile(path.join(process.cwd(), UPLOAD_DIR, legacy));
        } catch {
          return null;
        }
      }
      return null;
    }
  },

  async delete(key) {
    try {
      await fs.unlink(abs(key));
    } catch {
      /* ignore — idempotent */
    }
  },

  async exists(key) {
    try {
      await fs.access(abs(key));
      return true;
    } catch {
      return false;
    }
  },

  async signedUrl() {
    // Local-fs has no notion of presigned URLs. Callers should branch
    // on STORAGE_DRIVER and stream via storage.get() in local mode.
    throw new Error(
      "[storage/local-fs] signedUrl is not supported. Use storage.get() and stream in local-fs mode.",
    );
  },

  async setRetention() {
    // The local filesystem has no Object Lock. Dev-only no-op — GoBD
    // immutability is enforced in production where STORAGE_DRIVER=r2.
  },
};
