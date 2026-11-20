"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/require-tenant";
import { createAuditLog } from "@/lib/audit";
import { generateMailboxToken, getOrCreateMailbox } from "@/lib/inbound/mailbox";

const SETTINGS_PATH = "/dashboard/settings/email-inbound";

export type InboundActionResult =
  | { success: true }
  | { success: false; error: string };

function canEditSettings(role: string, tenantRole: string): boolean {
  return (
    ["SUPER_ADMIN", "ADMIN"].includes(role) ||
    ["OWNER", "ADMIN"].includes(tenantRole)
  );
}

/** Aktiviert/deaktiviert den E-Mail-Posteingang des Mandanten. */
export async function setInboundActive(
  active: boolean,
): Promise<InboundActionResult> {
  const t = await requireTenant();
  if (!canEditSettings(t.role, t.tenantRole)) {
    return { success: false, error: "Insufficient permissions." };
  }
  const mailbox = await getOrCreateMailbox(t.tenantId);
  await db.inboundMailbox.update({
    where: { id: mailbox.id },
    data: { active },
  });
  await createAuditLog({
    action: "SETTINGS_CHANGED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "InboundMailbox",
    entityId: mailbox.id,
    details: { active },
  });
  revalidatePath(SETTINGS_PATH);
  return { success: true };
}

/** Rotiert das Token (neue Alias-Adresse) — etwa bei Leak/Spam. */
export async function rotateInboundToken(): Promise<InboundActionResult> {
  const t = await requireTenant();
  if (!canEditSettings(t.role, t.tenantRole)) {
    return { success: false, error: "Insufficient permissions." };
  }
  const mailbox = await getOrCreateMailbox(t.tenantId);

  // Kollisionen sind bei 60 Bit Entropie praktisch ausgeschlossen, aber wir
  // probieren ein paar Mal, falls das @unique-Constraint doch zuschlägt.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await db.inboundMailbox.update({
        where: { id: mailbox.id },
        data: { token: generateMailboxToken() },
      });
      await createAuditLog({
        action: "SETTINGS_CHANGED",
        tenantId: t.tenantId,
        userId: t.userId,
        entityType: "InboundMailbox",
        entityId: mailbox.id,
        details: { tokenRotated: true },
      });
      revalidatePath(SETTINGS_PATH);
      return { success: true };
    } catch {
      // erneut versuchen
    }
  }
  return { success: false, error: "Token konnte nicht rotiert werden." };
}

/** Speichert die optionale Absender-Allowlist (eine Adresse pro Zeile). */
export async function saveAllowedSenders(
  raw: string,
): Promise<InboundActionResult> {
  const t = await requireTenant();
  if (!canEditSettings(t.role, t.tenantRole)) {
    return { success: false, error: "Insufficient permissions." };
  }
  const senders = Array.from(
    new Set(
      raw
        .split(/[\n,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.includes("@")),
    ),
  );
  const mailbox = await getOrCreateMailbox(t.tenantId);
  await db.inboundMailbox.update({
    where: { id: mailbox.id },
    data: { allowedSenders: senders },
  });
  await createAuditLog({
    action: "SETTINGS_CHANGED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "InboundMailbox",
    entityId: mailbox.id,
    details: { allowedSenders: senders },
  });
  revalidatePath(SETTINGS_PATH);
  return { success: true };
}
