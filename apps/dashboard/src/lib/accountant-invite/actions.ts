"use server";

import { db } from "@/lib/db";
import { requireTenant } from "@/lib/require-tenant";
import { createAuditLog } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { fullName } from "@/lib/user-name";
import bcrypt from "bcryptjs";
import crypto from "crypto";

/**
 * Steuerberater-spezifischer Einladungs-Flow. Bewusst von `inviteUser`
 * getrennt, weil hier ein Klartext-Begleittext, eine Anrede und ein
 * eigenes Email-Template ins Spiel kommen — Sachen, die der allgemeine
 * Team-Invite nicht braucht. Die DB-Schritte (User/Membership/Audit-Log)
 * sind bewusst dieselben Schritte wie im Team-Invite, damit das Verhalten
 * identisch ist.
 */

export type Salutation = "MR" | "MRS" | "DIVERSE" | "NONE";

export type InviteAccountantResult =
  | { success: true; tempPassword: string; emailSent: boolean }
  | { success: false; errorCode: string };

/**
 * Versendet die Steuerberater-Einladung als HTML-Mail. Best-effort:
 * Fehler werden geloggt, blockieren die Invite-Action nicht — die
 * Zugangsdaten werden in jedem Fall im Dialog angezeigt, damit der
 * Owner sie notfalls manuell weitergeben kann.
 */
async function sendAccountantInviteEmail(opts: {
  toEmail: string;
  recipientName: string;
  salutation: Salutation;
  inviterName: string;
  workspaceName: string;
  customMessage: string;
  tempPassword: string | null;
}): Promise<boolean> {
  try {
    if (!process.env.BREVO_API_KEY || !process.env.PLATFORM_SENDER_EMAIL) {
      console.warn("[accountant-invite] Skipping email — Brevo not configured.");
      return false;
    }

    const { render } = await import("@react-email/render");
    const { AccountantInviteEmail } = await import("@/emails/accountant-invite-email");
    const React = await import("react");
    const { brevo, Brevo } = await import("@/lib/email");

    const platformName = process.env.PLATFORM_NAME ?? "Zoonox";
    // Kurzer Brand-Name (z. B. "zoonox") für den Footer-Disclaimer.
    // Bewusst getrennt vom Subject-/Header-Namen, damit "Diese E-Mail wurde
    // automatisch von … versendet" nicht zu sperrig klingt.
    const brandName = process.env.NEXT_PUBLIC_APP_NAME ?? "zoonox";
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001").replace(/\/$/, "");
    const loginUrl = `${baseUrl}/de/auth/login`;
    const logoUrl = `${baseUrl}/logo.png`;

    const htmlContent = await render(
      React.createElement(AccountantInviteEmail, {
        recipientName: opts.recipientName,
        salutation: opts.salutation,
        inviterName: opts.inviterName,
        workspaceName: opts.workspaceName,
        customMessage: opts.customMessage,
        loginUrl,
        tempPassword: opts.tempPassword,
        platformName,
        brandName,
        logoUrl,
      }),
    );

    const sendEmail = new Brevo.SendSmtpEmail();
    sendEmail.subject = `Einladung als Steuerberater für ${opts.workspaceName}`;
    sendEmail.sender = {
      name: platformName,
      email: process.env.PLATFORM_SENDER_EMAIL!,
    };
    sendEmail.to = [{ email: opts.toEmail, name: opts.recipientName }];
    sendEmail.htmlContent = htmlContent;

    await brevo.sendTransacEmail(sendEmail);
    return true;
  } catch (e) {
    console.error("[accountant-invite] Email failed:", e);
    return false;
  }
}

const VALID_SALUTATIONS = new Set<Salutation>(["MR", "MRS", "DIVERSE", "NONE"]);

function parseSalutation(raw: string | null | undefined): Salutation {
  if (!raw) return "NONE";
  return VALID_SALUTATIONS.has(raw as Salutation) ? (raw as Salutation) : "NONE";
}

export async function inviteAccountant(formData: FormData): Promise<InviteAccountantResult> {
  const t = await requireTenant();
  if (!can(t.tenantRole, "team.write")) {
    return { success: false, errorCode: "FORBIDDEN" };
  }

  const salutation = parseSalutation(formData.get("salutation") as string | null);
  const firstName = (formData.get("firstName") as string | null)?.trim() ?? "";
  const lastName = (formData.get("lastName") as string | null)?.trim() || null;
  const email = (formData.get("email") as string | null)?.trim().toLowerCase() ?? "";
  const customMessage = ((formData.get("customMessage") as string | null) ?? "").trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, errorCode: "EMAIL_INVALID" };
  }
  if (!firstName) {
    return { success: false, errorCode: "FIRST_NAME_REQUIRED" };
  }
  if (customMessage.length > 4000) {
    return { success: false, errorCode: "MESSAGE_TOO_LONG" };
  }

  // Findet bestehenden User oder legt einen neuen mit Initial-Passwort an.
  const existing = await db.user.findUnique({ where: { email } });

  let userId: string;
  let tempPassword = "";

  if (existing) {
    userId = existing.id;
    const already = await db.tenantUser.findUnique({
      where: { tenantId_userId: { tenantId: t.tenantId, userId } },
    });
    if (already) {
      return { success: false, errorCode: "ALREADY_MEMBER" };
    }
  } else {
    tempPassword = crypto.randomBytes(12).toString("base64url");
    const hashed = await bcrypt.hash(tempPassword, 12);
    const newUser = await db.user.create({
      data: {
        email,
        firstName,
        lastName,
        password: hashed,
        role: "USER",
        mustChangePassword: true,
      },
    });
    userId = newUser.id;
  }

  await db.tenantUser.create({
    data: {
      tenantId: t.tenantId,
      userId,
      role: "ACCOUNTANT",
    },
  });

  await createAuditLog({
    action: "USER_CREATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "User",
    entityId: userId,
    details: { tenantRole: "ACCOUNTANT", email, existing: !!existing, salutation },
  });

  const [tenant, inviter] = await Promise.all([
    db.tenant.findUnique({ where: { id: t.tenantId }, select: { name: true } }),
    db.user.findUnique({
      where: { id: t.userId },
      select: { firstName: true, lastName: true, email: true },
    }),
  ]);

  const emailSent = await sendAccountantInviteEmail({
    toEmail: email,
    recipientName: fullName({ firstName, lastName }) ?? email,
    salutation,
    inviterName:
      fullName(inviter ?? { firstName: null, lastName: null }) ?? inviter?.email ?? "Mandant",
    workspaceName: tenant?.name ?? "Workspace",
    customMessage,
    tempPassword: existing ? null : tempPassword,
  });

  return { success: true, tempPassword, emailSent };
}

export type RemoveAccountantResult =
  | { success: true }
  | { success: false; errorCode: string };

/**
 * Trennt die Tenant-User-Verknüpfung eines Steuerberaters. Der User-
 * Datensatz bleibt erhalten — andere Mandanten könnten dieselbe
 * Berater-Identität referenzieren, und das Löschen würde dort still
 * mit kaskadieren. Hier verschwindet bloß die `TenantUser`-Membership,
 * dieser Mandant ist damit für den Berater nicht mehr sichtbar.
 */
export async function removeAccountant(userId: string): Promise<RemoveAccountantResult> {
  const t = await requireTenant();
  if (!can(t.tenantRole, "team.write")) {
    return { success: false, errorCode: "FORBIDDEN" };
  }

  const membership = await db.tenantUser.findUnique({
    where: { tenantId_userId: { tenantId: t.tenantId, userId } },
    select: { role: true },
  });
  if (!membership) return { success: false, errorCode: "NOT_FOUND" };
  if (membership.role !== "ACCOUNTANT") {
    // Defensive: diese Action ist nur für Berater-Memberships gedacht.
    // Team-Mitglieder werden über den Team-Flow entfernt.
    return { success: false, errorCode: "WRONG_ROLE" };
  }

  await db.tenantUser.delete({
    where: { tenantId_userId: { tenantId: t.tenantId, userId } },
  });

  await createAuditLog({
    action: "USER_DEACTIVATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "User",
    entityId: userId,
    details: { tenantRole: "ACCOUNTANT", reason: "accountant-disconnect" },
  });

  return { success: true };
}
