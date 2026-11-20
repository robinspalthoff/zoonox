"use server";

import { db } from "@/lib/db";
import { requireTenant } from "@/lib/require-tenant";
import { createAuditLog } from "@/lib/audit";
import { fullName } from "@/lib/user-name";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { Role, TenantRole } from "@prisma/client";

// ─── Invite User ─────────────────────────────────────────────────────────────

export type InviteResult =
  | { success: true; tempPassword: string; emailSent: boolean }
  | { success: false; error: string };

function canManageTeam(role: Role, tenantRole: TenantRole): boolean {
  return (
    role === "SUPER_ADMIN" ||
    role === "ADMIN" ||
    tenantRole === "OWNER" ||
    tenantRole === "ADMIN"
  );
}

// Versendet eine Invite-Mail über Brevo. Best-effort: Fehler werden nur
// geloggt, damit eine fehlende Brevo-Konfig den Onboarding-Flow nicht blockt.
// `tempPassword === null` bedeutet: der User existierte bereits — die Mail
// informiert dann nur über die neue Workspace-Mitgliedschaft.
async function sendInviteEmail(opts: {
  toEmail: string;
  recipientName: string;
  inviterName: string;
  workspaceName: string;
  tempPassword: string | null;
}): Promise<boolean> {
  try {
    if (!process.env.BREVO_API_KEY || !process.env.PLATFORM_SENDER_EMAIL) {
      console.warn("[team] Skipping invite email — Brevo not configured.");
      return false;
    }

    const { render } = await import("@react-email/render");
    const { InviteEmail } = await import("@/emails/invite-email");
    const React = await import("react");

    const platformName = process.env.PLATFORM_NAME ?? "Zoonox";
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
    const loginUrl = `${baseUrl.replace(/\/$/, "")}/de/auth/login`;

    const htmlContent = await render(
      React.createElement(InviteEmail, {
        recipientName: opts.recipientName,
        inviterName: opts.inviterName,
        workspaceName: opts.workspaceName,
        loginUrl,
        tempPassword: opts.tempPassword,
        platformName,
      })
    );

    const { brevo, Brevo } = await import("@/lib/email");
    const sendEmail = new Brevo.SendSmtpEmail();
    sendEmail.subject = `Einladung zu ${opts.workspaceName}`;
    sendEmail.sender = {
      name: platformName,
      email: process.env.PLATFORM_SENDER_EMAIL!,
    };
    sendEmail.to = [{ email: opts.toEmail, name: opts.recipientName }];
    sendEmail.htmlContent = htmlContent;

    await brevo.sendTransacEmail(sendEmail);
    return true;
  } catch (e) {
    console.error("[team] Invite email failed:", e);
    return false;
  }
}

export async function inviteUser(formData: FormData): Promise<InviteResult> {
  const t = await requireTenant();
  if (!canManageTeam(t.role, t.tenantRole)) {
    return { success: false, error: "Insufficient permissions." };
  }

  const firstName = (formData.get("firstName") as string | null)?.trim() ?? "";
  const lastName = (formData.get("lastName") as string | null)?.trim() || null;
  const email = (formData.get("email") as string | null)?.trim().toLowerCase() ?? "";
  const tenantRoleRaw = (formData.get("role") as string | null) ?? "MEMBER";
  const validTenantRoles: TenantRole[] = ["OWNER", "ADMIN", "MEMBER", "ACCOUNTANT"];
  const tenantRole = validTenantRoles.includes(tenantRoleRaw as TenantRole)
    ? (tenantRoleRaw as TenantRole)
    : "MEMBER";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: "Invalid email address." };
  }
  if (!firstName) {
    return { success: false, error: "First name is required." };
  }

  // Only OWNER/SUPER_ADMIN may grant OWNER role
  if (tenantRole === "OWNER" && t.tenantRole !== "OWNER" && t.role !== "SUPER_ADMIN") {
    return { success: false, error: "Only OWNERs can grant the OWNER role." };
  }

  // Find or create the User
  const existing = await db.user.findUnique({ where: { email } });

  let userId: string;
  let tempPassword = "";

  if (existing) {
    userId = existing.id;
    // Check if already member of this tenant
    const already = await db.tenantUser.findUnique({
      where: { tenantId_userId: { tenantId: t.tenantId, userId } },
    });
    if (already) {
      return { success: false, error: "User is already a member of this workspace." };
    }
  } else {
    tempPassword = crypto.randomBytes(12).toString("base64url");
    const hashedPassword = await bcrypt.hash(tempPassword, 12);
    const newUser = await db.user.create({
      data: {
        email,
        firstName,
        lastName,
        password: hashedPassword,
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
      role: tenantRole,
    },
  });

  await createAuditLog({
    action: "USER_CREATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "User",
    entityId: userId,
    details: { tenantRole, email, existing: !!existing },
  });

  // Tenant-Name + Inviter-Name für die Email-Personalisierung holen.
  const [tenant, inviter] = await Promise.all([
    db.tenant.findUnique({ where: { id: t.tenantId }, select: { name: true } }),
    db.user.findUnique({
      where: { id: t.userId },
      select: { firstName: true, lastName: true, email: true },
    }),
  ]);

  const emailSent = await sendInviteEmail({
    toEmail: email,
    recipientName: fullName({ firstName, lastName }) ?? email,
    inviterName: fullName(inviter ?? { firstName: null, lastName: null }) ?? inviter?.email ?? "Ein Administrator",
    workspaceName: tenant?.name ?? "Workspace",
    tempPassword: existing ? null : tempPassword,
  });

  return { success: true, tempPassword, emailSent };
}

// ─── Update User ─────────────────────────────────────────────────────────────

export type UpdateResult =
  | { success: true }
  | { success: false; error: string };

export async function updateUser(formData: FormData): Promise<UpdateResult> {
  const t = await requireTenant();
  if (!canManageTeam(t.role, t.tenantRole)) {
    return { success: false, error: "Insufficient permissions." };
  }

  const userId = formData.get("userId") as string;
  const firstName = (formData.get("firstName") as string | null)?.trim() ?? "";
  const lastName = (formData.get("lastName") as string | null)?.trim() || null;
  const email = (formData.get("email") as string | null)?.trim().toLowerCase() ?? "";
  const tenantRoleRaw = (formData.get("role") as string | null) ?? "MEMBER";
  const validTenantRoles: TenantRole[] = ["OWNER", "ADMIN", "MEMBER", "ACCOUNTANT"];
  const tenantRole = validTenantRoles.includes(tenantRoleRaw as TenantRole)
    ? (tenantRoleRaw as TenantRole)
    : "MEMBER";

  if (!userId || !email || !firstName) {
    return { success: false, error: "Missing required fields." };
  }

  // User can only be updated if they are a member of this tenant
  const membership = await db.tenantUser.findUnique({
    where: { tenantId_userId: { tenantId: t.tenantId, userId } },
  });
  if (!membership) return { success: false, error: "User not in this workspace." };

  if (tenantRole === "OWNER" && t.tenantRole !== "OWNER" && t.role !== "SUPER_ADMIN") {
    return { success: false, error: "Only OWNERs can grant the OWNER role." };
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing && existing.id !== userId) {
    return { success: false, error: "A user with this email already exists." };
  }

  // Last-OWNER-Schutz: wenn das Update einen OWNER zu etwas anderem
  // downgradet, sicherstellen dass mindestens ein weiterer OWNER bleibt.
  if (membership.role === "OWNER" && tenantRole !== "OWNER") {
    const otherOwners = await db.tenantUser.count({
      where: { tenantId: t.tenantId, role: "OWNER", NOT: { userId } },
    });
    if (otherOwners === 0) {
      return { success: false, error: "Cannot remove the last OWNER from this workspace." };
    }
  }

  await db.$transaction([
    db.user.update({
      where: { id: userId },
      data: { firstName, lastName, email },
    }),
    db.tenantUser.update({
      where: { tenantId_userId: { tenantId: t.tenantId, userId } },
      data: { role: tenantRole },
    }),
  ]);

  await createAuditLog({
    action: "USER_UPDATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "User",
    entityId: userId,
    details: { firstName, lastName, email, tenantRole },
  });

  return { success: true };
}

// ─── Toggle User Active (per-tenant: remove membership) ──────────────────────

export async function toggleUserActive(userId: string): Promise<UpdateResult> {
  const t = await requireTenant();
  if (!canManageTeam(t.role, t.tenantRole)) {
    return { success: false, error: "Insufficient permissions." };
  }

  if (userId === t.userId) {
    return { success: false, error: "You cannot remove yourself." };
  }

  const membership = await db.tenantUser.findUnique({
    where: { tenantId_userId: { tenantId: t.tenantId, userId } },
  });
  if (!membership) {
    return { success: false, error: "User not in this workspace." };
  }

  // Last-OWNER-Schutz auch beim Entfernen.
  if (membership.role === "OWNER") {
    const otherOwners = await db.tenantUser.count({
      where: { tenantId: t.tenantId, role: "OWNER", NOT: { userId } },
    });
    if (otherOwners === 0) {
      return { success: false, error: "Cannot remove the last OWNER from this workspace." };
    }
  }

  // For multi-tenant: deactivation = remove membership. The User account remains.
  await db.tenantUser.delete({
    where: { tenantId_userId: { tenantId: t.tenantId, userId } },
  });

  await createAuditLog({
    action: "USER_DEACTIVATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "User",
    entityId: userId,
    details: { removedFromTenant: true },
  });

  return { success: true };
}
