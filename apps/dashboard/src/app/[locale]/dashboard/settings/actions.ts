"use server";

import { db } from "@/lib/db";
import { auth } from "@/auth";
import { requireTenant } from "@/lib/require-tenant";
import { createAuditLog } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { appConfig } from "@/config/app";
import { generateSecret, verifyTotp, buildOtpauthUrl } from "@/lib/totp";

// ─── Eigenes Passwort ändern ─────────────────────────────────────────────────

export type ChangeOwnPasswordResult =
  | { success: true }
  | { success: false; error: string; field?: "currentPassword" | "newPassword" | "confirmPassword" };

export async function changeOwnPassword(
  _prev: ChangeOwnPasswordResult | null,
  formData: FormData
): Promise<ChangeOwnPasswordResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated." };
  }

  const currentPassword = (formData.get("currentPassword") as string | null) ?? "";
  const newPassword = (formData.get("newPassword") as string | null) ?? "";
  const confirmPassword = (formData.get("confirmPassword") as string | null) ?? "";

  if (!currentPassword) {
    return { success: false, error: "Current password is required.", field: "currentPassword" };
  }
  if (!newPassword) {
    return { success: false, error: "New password is required.", field: "newPassword" };
  }
  if (newPassword.length < 12) {
    return { success: false, error: "Password must be at least 12 characters.", field: "newPassword" };
  }
  if (newPassword !== confirmPassword) {
    return { success: false, error: "Passwords do not match.", field: "confirmPassword" };
  }
  if (newPassword === currentPassword) {
    return { success: false, error: "New password must differ from current password.", field: "newPassword" };
  }

  // Aktuelles Passwort verifizieren — gegen Account-Hijack bei offener Session.
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { password: true },
  });
  if (!user?.password) {
    return { success: false, error: "Not authenticated." };
  }
  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) {
    return { success: false, error: "Current password is incorrect.", field: "currentPassword" };
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);
  await db.user.update({
    where: { id: session.user.id },
    data: { password: hashedPassword, mustChangePassword: false },
  });

  await createAuditLog({
    action: "PASSWORD_CHANGED",
    tenantId: session.user.tenantId ?? null,
    userId: session.user.id,
    entityType: "User",
    entityId: session.user.id,
    details: { source: "self-service" },
  });

  return { success: true };
}

// ─── Eigenes Profil ändern ───────────────────────────────────────────────────

export type UpdateProfileResult =
  | { success: true }
  | { success: false; error: string; field?: "firstName" | "lastName" | "email" };

export async function updateProfile(
  _prev: UpdateProfileResult | null,
  formData: FormData
): Promise<UpdateProfileResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated." };
  }

  const firstName = ((formData.get("firstName") as string | null) ?? "").trim();
  const lastName = ((formData.get("lastName") as string | null) ?? "").trim();
  const email = ((formData.get("email") as string | null) ?? "").trim().toLowerCase();

  if (!firstName) {
    return { success: false, error: "First name is required.", field: "firstName" };
  }
  if (!lastName) {
    return { success: false, error: "Last name is required.", field: "lastName" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: "A valid email address is required.", field: "email" };
  }

  // E-Mail-Eindeutigkeit prüfen — die Spalte ist unique, ein blinder Update
  // würde sonst mit einem rohen Prisma-Fehler abbrechen.
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing && existing.id !== session.user.id) {
    return { success: false, error: "This email address is already in use.", field: "email" };
  }

  await db.user.update({
    where: { id: session.user.id },
    data: { firstName, lastName, email },
  });

  await createAuditLog({
    action: "USER_UPDATED",
    tenantId: session.user.tenantId ?? null,
    userId: session.user.id,
    entityType: "User",
    entityId: session.user.id,
    details: { source: "self-service-profile" },
  });

  revalidatePath("/dashboard/settings");
  return { success: true };
}

// ─── Zwei-Faktor-Authentifizierung (TOTP) ────────────────────────────────────

export type Generate2faResult = {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
};

/**
 * Erzeugt ein frisches TOTP-Secret samt QR-Code. Das Secret wird noch
 * NICHT gespeichert — erst `enable2fa` persistiert es, nachdem der User
 * einen gültigen Code aus seiner App nachgewiesen hat. Bis dahin lebt
 * das Secret nur im Client und ist wertlos (2FA ist nicht aktiv).
 */
export async function generate2faSecret(): Promise<Generate2faResult> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    throw new Error("Not authenticated.");
  }
  const secret = generateSecret();
  const otpauthUrl = buildOtpauthUrl(secret, session.user.email, appConfig.name);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
  return { secret, otpauthUrl, qrDataUrl };
}

export type Toggle2faResult =
  | { success: true }
  | { success: false; error: string; field?: "password" | "code" };

export async function enable2fa(
  _prev: Toggle2faResult | null,
  formData: FormData
): Promise<Toggle2faResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated." };
  }

  const password = (formData.get("password") as string | null) ?? "";
  const code = (formData.get("code") as string | null) ?? "";
  const secret = (formData.get("secret") as string | null) ?? "";

  if (!password) {
    return { success: false, error: "Password is required.", field: "password" };
  }
  if (!secret) {
    return { success: false, error: "Setup expired. Please start again." };
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { password: true, twoFactorEnabled: true },
  });
  if (!user?.password) {
    return { success: false, error: "Not authenticated." };
  }
  if (user.twoFactorEnabled) {
    return { success: false, error: "Two-factor authentication is already enabled." };
  }

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return { success: false, error: "Password is incorrect.", field: "password" };
  }

  if (!verifyTotp(secret, code)) {
    return { success: false, error: "The code is invalid or expired.", field: "code" };
  }

  await db.user.update({
    where: { id: session.user.id },
    data: { twoFactorEnabled: true, twoFactorSecret: secret },
  });

  await createAuditLog({
    action: "TWO_FACTOR_ENABLED",
    tenantId: session.user.tenantId ?? null,
    userId: session.user.id,
    entityType: "User",
    entityId: session.user.id,
  });

  revalidatePath("/dashboard/settings");
  return { success: true };
}

export async function disable2fa(
  _prev: Toggle2faResult | null,
  formData: FormData
): Promise<Toggle2faResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated." };
  }

  const password = (formData.get("password") as string | null) ?? "";
  if (!password) {
    return { success: false, error: "Password is required.", field: "password" };
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { password: true, twoFactorEnabled: true },
  });
  if (!user?.password) {
    return { success: false, error: "Not authenticated." };
  }
  if (!user.twoFactorEnabled) {
    return { success: true };
  }

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return { success: false, error: "Password is incorrect.", field: "password" };
  }

  await db.user.update({
    where: { id: session.user.id },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });

  await createAuditLog({
    action: "TWO_FACTOR_DISABLED",
    tenantId: session.user.tenantId ?? null,
    userId: session.user.id,
    entityType: "User",
    entityId: session.user.id,
  });

  revalidatePath("/dashboard/settings");
  return { success: true };
}

// ─── Workspace (Tenant) Stammdaten ───────────────────────────────────────────

export type UpdateWorkspaceResult =
  | { success: true; slug: string }
  | { success: false; error: string };

/**
 * Aktualisiert Name + Slug des aktiven Tenants. Der Slug wird automatisch
 * aus dem Namen abgeleitet und bei Kollisionen mit "-2", "-3" … erweitert.
 * Nur OWNER/ADMIN des Tenants (oder Plattform-Admins) dürfen editieren.
 */
export async function updateWorkspace(name: string): Promise<UpdateWorkspaceResult> {
  const t = await requireTenant();
  const canEdit =
    ["SUPER_ADMIN", "ADMIN"].includes(t.role) ||
    ["OWNER", "ADMIN"].includes(t.tenantRole);
  if (!canEdit) return { success: false, error: "Insufficient permissions." };

  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "Name is required." };
  if (trimmed.length > 80) {
    return { success: false, error: "Name is too long (max. 80 characters)." };
  }

  // Slug neu ableiten. Bei unverändertem Slug bleibt alles wie es ist —
  // erst bei tatsächlich neuem Slug greift der Uniqueness-Check.
  const baseSlug = slugifyWorkspace(trimmed);
  const current = await db.tenant.findUnique({
    where: { id: t.tenantId },
    select: { slug: true, name: true },
  });
  if (!current) return { success: false, error: "Workspace not found." };

  let slug = current.slug;
  if (baseSlug !== current.slug) {
    slug = baseSlug;
    for (
      let i = 2;
      await db.tenant.findFirst({
        where: { slug, NOT: { id: t.tenantId } },
        select: { id: true },
      });
      i++
    ) {
      slug = `${baseSlug}-${i}`;
    }
  }

  await db.tenant.update({
    where: { id: t.tenantId },
    data: { name: trimmed, slug },
  });

  await createAuditLog({
    action: "SETTINGS_CHANGED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Tenant",
    entityId: t.tenantId,
    details: { source: "workspace-rename", from: current.name, to: trimmed, slug },
  });

  // Layout-weit revalidieren: Header (TenantSwitcher), Sidebar, alle
  // Listen-Views lesen den Tenant-Namen direkt aus der Session-Wrap.
  revalidatePath("/dashboard", "layout");

  return { success: true, slug };
}

function slugifyWorkspace(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace"
  );
}

// ─── Firmen-Stammdaten ───────────────────────────────────────────────────────

// Optionale Freitextfelder. Alle anderen Felder (Enums, Felder mit
// DB-Default) werden unten gesondert behandelt.
const COMPANY_TEXT_FIELDS = [
  "name", "nameSuffix", "ownerName", "legalForm", "address", "city", "zip",
  "email", "senderEmail", "senderName", "phone", "website",
  "taxId", "vatId", "registerCourt", "registerNumber",
  "managingDirector", "bankName", "iban", "bic",
  "defaultNotes", "defaultIntroText",
] as const;

// Plain-Objekt-Form, gemeinsam für update + create der upsert verwendbar.
type CompanySettingsPatch = Partial<{
  name: string | null; nameSuffix: string | null; ownerName: string | null;
  legalForm: string | null; address: string | null; city: string | null;
  zip: string | null; email: string | null; senderEmail: string | null;
  senderName: string | null; phone: string | null; website: string | null;
  taxId: string | null; vatId: string | null; registerCourt: string | null;
  registerNumber: string | null; managingDirector: string | null;
  bankName: string | null; iban: string | null; bic: string | null;
  defaultNotes: string | null; defaultIntroText: string | null;
  logoBase64: string | null; country: string; invoicePrefix: string;
  taxMode: "STANDARD" | "SMALL_BUSINESS"; skrType: "SKR03" | "SKR04";
  profitLossMethod: "EUR" | "GUV";
}>;

/**
 * Speichert die Firmen-Stammdaten. Aktualisiert wird ausschließlich, was
 * tatsächlich im Formular enthalten ist (`formData.has`) — so können die
 * über mehrere Settings-Unterseiten verteilten Teilformulare gespeichert
 * werden, ohne Felder anderer Seiten auf NULL zu überschreiben.
 */
export async function saveCompanySettings(formData: FormData): Promise<void> {
  const t = await requireTenant();
  if (!["SUPER_ADMIN", "ADMIN"].includes(t.role) && t.tenantRole !== "OWNER" && t.tenantRole !== "ADMIN") return;

  const data: CompanySettingsPatch = {};

  for (const field of COMPANY_TEXT_FIELDS) {
    if (formData.has(field)) {
      data[field] = (formData.get(field) as string)?.trim() || null;
    }
  }
  if (formData.has("country")) {
    data.country = (formData.get("country") as string)?.trim() || "DE";
  }
  // invoicePrefix is no longer surfaced — superseded by the NumberRange
  // configuration under /dashboard/settings/number-ranges. The DB column
  // stays in place for backward compatibility but isn't written from here.
  if (formData.has("logoBase64")) {
    data.logoBase64 = (formData.get("logoBase64") as string) || null;
  }
  if (formData.has("taxMode")) {
    const mode = (formData.get("taxMode") as string)?.trim();
    data.taxMode = mode === "SMALL_BUSINESS" ? "SMALL_BUSINESS" : "STANDARD";
  }
  if (formData.has("skrType")) {
    const skr = (formData.get("skrType") as string)?.trim();
    data.skrType = skr === "SKR04" ? "SKR04" : "SKR03";
  }
  if (formData.has("profitLossMethod")) {
    const method = (formData.get("profitLossMethod") as string)?.trim();
    data.profitLossMethod = method === "GUV" ? "GUV" : "EUR";
  }

  await db.companySettings.upsert({
    where: { tenantId: t.tenantId },
    update: data,
    create: { tenantId: t.tenantId, ...data },
  });

  await createAuditLog({
    action: "SETTINGS_CHANGED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "CompanySettings",
    entityId: t.tenantId,
  });

  revalidatePath("/dashboard/settings", "layout");
}
