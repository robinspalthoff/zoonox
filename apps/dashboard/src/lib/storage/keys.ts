// Storage-key construction.
//
// All keys live under a tenant prefix so the adapter can never produce a
// key that crosses tenant boundaries. The prefix is read once at module
// load — see STORAGE_TENANT_PREFIX env. In single-tenant deployments
// (current state) the prefix is just "default".
//
// Key shape:
//   tenants/<tenant>/documents/<yyyy-mm>/<uuid>.<ext>
//   tenants/<tenant>/invoices/<invoiceId>.pdf
//
// Existing rows in the DB whose `storagePath` does not start with
// "tenants/" are legacy — the migration script in scripts/ rewrites them.

import path from "node:path";

// Fallback-Prefix für Migrations-/Skript-Kontexte. Im Request-Pfad wird
// IMMER eine echte tenantId übergeben.
export const LEGACY_PREFIX = process.env.STORAGE_TENANT_PREFIX ?? "default";

function root(tenantId: string): string {
  return `tenants/${tenantId}`;
}

/** Key für ein frisch hochgeladenes User-Document. */
export function buildDocumentKey(tenantId: string, filename: string): string {
  const ext = (path.extname(filename) || ".bin").toLowerCase();
  const uuid = globalThis.crypto.randomUUID();
  const yearMonth = new Date().toISOString().slice(0, 7);
  return `${root(tenantId)}/documents/${yearMonth}/${uuid}${ext}`;
}

/** Key für einen Invoice-PDF-Snapshot. */
export function buildInvoiceKey(tenantId: string, invoiceId: string): string {
  return `${root(tenantId)}/invoices/${invoiceId}.pdf`;
}

/** True if `key` already includes the tenant prefix. */
export function hasTenantPrefix(key: string): boolean {
  return key.startsWith("tenants/");
}

/**
 * Convert a legacy storagePath ("2026-04/abc.pdf") to the current key
 * shape ("tenants/<tenant>/documents/2026-04/abc.pdf"). Idempotent.
 *
 * Used by the local-fs adapter (so legacy rows still resolve) and by
 * the R2 migration script.
 */
export function normalizeLegacyKey(legacyPath: string): string {
  if (hasTenantPrefix(legacyPath)) return legacyPath;
  return `tenants/${LEGACY_PREFIX}/documents/${legacyPath}`;
}
