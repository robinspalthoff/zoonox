import type { TenantRole } from "@prisma/client";

/**
 * Granulare Permissions je TenantRole. Das ist die einzige Quelle der Wahrheit
 * für rollenbasierte Sichtbarkeit (Sidebar) und Aktions-Gates (Server Actions).
 *
 * ACCOUNTANT (Steuerberater): liest die Geschäftsdaten, kommentiert, prüft und
 * schließt Monate ab — darf aber KEINE eigenen Belege/Rechnungen erstellen,
 * KEINE Stammdaten oder Settings ändern und KEINE Team-Mitglieder verwalten.
 */
export type Permission =
  // Lese-Permissions
  | "documents.read"
  | "invoices.read"
  | "quotes.read"
  | "orderConfirmations.read"
  | "bank.read"
  | "reports.read"
  | "datev.export"
  | "auditLog.read"
  | "contacts.read"
  // Schreib-Permissions (Geschäftsdaten)
  | "documents.write"
  | "invoices.write"
  | "quotes.write"
  | "orderConfirmations.write"
  | "bank.write"
  | "contacts.write"
  // Settings & Verwaltung
  | "settings.read"
  | "settings.write"
  | "team.read"
  | "team.write"
  | "numberRanges.write"
  // Steuerberater-Workflow
  | "comments.read"
  | "comments.write"
  | "comments.resolve"
  | "monthClose.submit"
  | "monthClose.finalize"
  | "monthClose.reopen"
  | "monthClose.unfinalize"
  | "firmOverview.view";

// Aktionen am Monatsabschluss sind streng nach Rolle aufgeteilt:
//
//   submit      → Mandant (OWNER/ADMIN/MEMBER). Der Steuerberater reicht
//                 nichts ein, er prüft nur.
//   reopen      → nur Steuerberater. Aus Sicht des Mandanten passiert das
//                 von außen — "Korrekturen nötig" ist eine Berater-Aktion.
//   finalize    → primär Steuerberater. OWNER darf als Notnagel selbst
//                 abschließen, falls (noch) kein Berater verknüpft ist —
//                 damit der Workflow nicht hängt. Mandant-MEMBER nicht.
//   unfinalize  → Reverse für seltene Fehlklick-Fälle. OWNER + Steuer-
//                 berater. Keine GoBD-Implikation, weil der MonthClose
//                 nur Workflow-State ist (Belege/Buchungen bleiben über
//                 ihre eigenen `finalizedAt`-Felder immutable).
const OWNER_PERMISSIONS: Permission[] = [
  "documents.read", "invoices.read", "quotes.read", "orderConfirmations.read",
  "bank.read", "reports.read", "datev.export", "auditLog.read", "contacts.read",
  "documents.write", "invoices.write", "quotes.write", "orderConfirmations.write",
  "bank.write", "contacts.write",
  "settings.read", "settings.write", "team.read", "team.write", "numberRanges.write",
  "comments.read", "comments.write", "comments.resolve",
  "monthClose.submit", "monthClose.finalize", "monthClose.unfinalize",
  "firmOverview.view",
];

const ADMIN_PERMISSIONS: Permission[] = [
  "documents.read", "invoices.read", "quotes.read", "orderConfirmations.read",
  "bank.read", "reports.read", "datev.export", "auditLog.read", "contacts.read",
  "documents.write", "invoices.write", "quotes.write", "orderConfirmations.write",
  "bank.write", "contacts.write",
  "settings.read", "settings.write", "team.read", "team.write", "numberRanges.write",
  "comments.read", "comments.write", "comments.resolve",
  "monthClose.submit", "monthClose.finalize", "monthClose.unfinalize",
  "firmOverview.view",
];

const MEMBER_PERMISSIONS: Permission[] = [
  "documents.read", "invoices.read", "quotes.read", "orderConfirmations.read",
  "bank.read", "reports.read", "contacts.read",
  "documents.write", "invoices.write", "quotes.write", "orderConfirmations.write",
  "bank.write", "contacts.write",
  "settings.read", "numberRanges.write",
  "comments.read", "comments.write",
  "monthClose.submit",
  "firmOverview.view",
];

const ACCOUNTANT_PERMISSIONS: Permission[] = [
  "documents.read", "invoices.read", "quotes.read", "orderConfirmations.read",
  "bank.read", "reports.read", "datev.export", "auditLog.read", "contacts.read",
  "settings.read",
  "comments.read", "comments.write", "comments.resolve",
  "monthClose.finalize", "monthClose.reopen", "monthClose.unfinalize",
  "firmOverview.view",
];

const PERMISSIONS_BY_ROLE: Record<TenantRole, Permission[]> = {
  OWNER: OWNER_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  MEMBER: MEMBER_PERMISSIONS,
  ACCOUNTANT: ACCOUNTANT_PERMISSIONS,
};

export function getPermissions(role: TenantRole): ReadonlyArray<Permission> {
  return PERMISSIONS_BY_ROLE[role];
}

export function can(role: TenantRole, permission: Permission): boolean {
  return PERMISSIONS_BY_ROLE[role].includes(permission);
}

export function canAny(role: TenantRole, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

export function canAll(role: TenantRole, permissions: Permission[]): boolean {
  return permissions.every((p) => can(role, p));
}

/**
 * Wirft, wenn die Rolle die Permission nicht hat. Für Server Actions /
 * API-Routes nach `requireTenant()` zu rufen.
 */
export function requirePermission(role: TenantRole, permission: Permission): void {
  if (!can(role, permission)) {
    throw new Error(`FORBIDDEN: missing permission ${permission} for role ${role}`);
  }
}
