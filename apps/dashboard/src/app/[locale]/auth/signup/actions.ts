"use server";

import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { appConfig } from "@/config/app";
import { generateSecret, verifyTotp, buildOtpauthUrl } from "@/lib/totp";
import { isSignupEnabled } from "@/lib/signup";

export type SignupField =
  | "firstName"
  | "lastName"
  | "email"
  | "password"
  | "confirmPassword"
  | "companyName"
  | "twoFactorCode";

export type SignupResult =
  | { ok: true; firstName: string }
  | { ok: false; error: string; field?: SignupField };

export type EmailCheckResult =
  | { available: true }
  | { available: false; reason: "taken" | "invalid" };

function slugify(input: string): string {
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function checkEmailAvailable(emailRaw: string): Promise<EmailCheckResult> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return { available: false, reason: "invalid" };
  }
  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  return existing ? { available: false, reason: "taken" } : { available: true };
}

export interface CreateAccountInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  companyName: string;
  /** Verified TOTP secret — present only when the user opted into 2FA. */
  twoFactorSecret?: string;
  /** Current 6-digit code, re-verified server-side against the secret. */
  twoFactorCode?: string;
}

export type Prepare2faResult = {
  secret: string;
  qrDataUrl: string;
};

/**
 * Generates a fresh TOTP secret + QR code for the sign-up flow. Nothing
 * is persisted here — the secret only becomes real once `createAccount`
 * receives it together with a valid code. Until then it lives in the
 * browser and is worthless on its own.
 */
export async function prepare2faSecret(emailRaw: string): Promise<Prepare2faResult> {
  const email = emailRaw.trim().toLowerCase() || "account";
  const secret = generateSecret();
  const otpauthUrl = buildOtpauthUrl(secret, email, appConfig.name);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 200 });
  return { secret, qrDataUrl };
}

export async function createAccount(input: CreateAccountInput): Promise<SignupResult> {
  // Closed development: self-service sign-up is gated. Enforced here so a
  // direct action call can't bypass the disabled UI.
  if (!isSignupEnabled()) {
    return { ok: false, error: "Die Registrierung ist derzeit nicht verfügbar." };
  }

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  const confirmPassword = input.confirmPassword;
  const companyNameRaw = input.companyName.trim();

  if (!firstName) return { ok: false, error: "Vorname ist erforderlich.", field: "firstName" };
  if (!lastName) return { ok: false, error: "Nachname ist erforderlich.", field: "lastName" };
  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, error: "Ungültige E-Mail-Adresse.", field: "email" };
  }
  if (!password || password.length < 12) {
    return { ok: false, error: "Passwort muss mindestens 12 Zeichen haben.", field: "password" };
  }
  if (password !== confirmPassword) {
    return { ok: false, error: "Passwörter stimmen nicht überein.", field: "confirmPassword" };
  }

  // 2FA opt-in: the secret is only trusted once a fresh code proves the
  // user has it in their authenticator app. Re-verified here so a
  // tampered client can't enable 2FA with a secret nobody can satisfy.
  const twoFactorSecret = input.twoFactorSecret?.trim() || null;
  if (twoFactorSecret) {
    const code = input.twoFactorCode?.trim() ?? "";
    if (!verifyTotp(twoFactorSecret, code)) {
      return {
        ok: false,
        error: "Der Code ist ungültig oder abgelaufen.",
        field: "twoFactorCode",
      };
    }
  }

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return {
      ok: false,
      error: "Diese E-Mail ist bereits registriert.",
      field: "email",
    };
  }

  const workspaceName = companyNameRaw || `${firstName}'s Workspace`;
  const baseSlug = slugify(workspaceName);
  let slug = baseSlug;
  for (let i = 1; await db.tenant.findUnique({ where: { slug }, select: { id: true } }); i++) {
    slug = `${baseSlug}-${i}`;
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  // Jeder Self-Service-Signup legt einen neuen, isolierten Workspace an —
  // der Ersteller ist immer dessen Admin und braucht Vollzugriff auf alle
  // Workspace-Settings (Team, Audit-Log, …). Mehrere Seitenwächter prüfen
  // ausschliesslich die Plattform-Rolle (audit-log/page, team/page, sidebar),
  // daher SUPER_ADMIN statt USER. TenantRole.OWNER wird zusätzlich gesetzt
  // und schützt die per-Tenant-Invarianten (z.B. last-OWNER-Schutz).
  const platformRole = "SUPER_ADMIN" as const;

  const { newUser, tenant } = await db.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email,
        firstName,
        lastName,
        password: hashedPassword,
        role: platformRole,
        ...(twoFactorSecret
          ? { twoFactorEnabled: true, twoFactorSecret }
          : {}),
      },
    });

    const tenant = await tx.tenant.create({
      data: {
        slug,
        name: workspaceName,
        members: {
          create: { userId: newUser.id, role: "OWNER", isDefault: true },
        },
        companySettings: {
          create: {
            name: companyNameRaw || null,
          },
        },
      },
    });

    return { newUser, tenant };
  });

  await createAuditLog({
    action: "USER_CREATED",
    tenantId: tenant.id,
    userId: newUser.id,
    entityType: "User",
    entityId: newUser.id,
    details: { source: "signup", role: platformRole, tenantSlug: tenant.slug },
  });

  if (twoFactorSecret) {
    await createAuditLog({
      action: "TWO_FACTOR_ENABLED",
      tenantId: tenant.id,
      userId: newUser.id,
      entityType: "User",
      entityId: newUser.id,
      details: { source: "signup" },
    });
  }

  return { ok: true, firstName };
}
