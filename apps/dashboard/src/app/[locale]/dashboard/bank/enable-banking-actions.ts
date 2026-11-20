"use server";

// Server actions for the Enable Banking (PSD2) connection flow.
// Kept separate from bank/actions.ts because these talk to an external API and
// carry their own error surface.

import { requireTenant, type TenantSession } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { getAspsps, startAuth, deleteSession } from "@/lib/enable-banking/client";
import { resyncConnection } from "@/lib/enable-banking/sync";
import {
  ebRedirectUrl,
  EB_CONSENT_VALIDITY_DAYS,
} from "@/lib/enable-banking/config";
import type { Aspsp } from "@/lib/enable-banking/types";

type PsuType = "business" | "personal";
type ActionResult<T = object> =
  | ({ success: true } & T)
  | { success: false; error: string };

/** List selectable banks (ASPSPs) for the connect dialog. */
export async function listAspsps(
  country = "DE",
  psuType: PsuType = "business",
): Promise<ActionResult<{ aspsps: Aspsp[] }>> {
  await requireTenant();
  try {
    const aspsps = await getAspsps({ country, psuType });
    return { success: true, aspsps };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to list banks.",
    };
  }
}

/**
 * Start authorization for one ASPSP. Persists a PENDING BankConnection with a
 * random anti-CSRF `state`, then returns the Enable Banking URL the client
 * should redirect the user to. The flow completes in /api/banking/callback.
 */
export async function startBankConnection(input: {
  aspspName: string;
  country: string;
  psuType?: PsuType;
}): Promise<ActionResult<{ url: string }>> {
  const t = await requireTenant();
  const { aspspName, country, psuType = "business" } = input;

  if (!aspspName || !country) {
    return { success: false, error: "Bank selection is required." };
  }

  return beginAuth(t, { aspspName, country, psuType });
}

/**
 * Re-authorize an existing (typically EXPIRED) connection, reusing its ASPSP
 * and PSU type. Account links survive because the callback re-links accounts
 * by their stored `externalAccountId`.
 */
export async function reconnectConnection(
  connectionId: string,
): Promise<ActionResult<{ url: string }>> {
  const t = await requireTenant();
  const conn = await db.bankConnection.findFirst({
    where: { id: connectionId, tenantId: t.tenantId },
    select: { aspspName: true, aspspCountry: true, psuType: true },
  });
  if (!conn) return { success: false, error: "Connection not found." };

  return beginAuth(
    t,
    {
      aspspName: conn.aspspName,
      country: conn.aspspCountry,
      psuType: (conn.psuType as PsuType) ?? "business",
    },
    connectionId, // reuse the same row so we don't leave an expired duplicate
  );
}

/** Manually pull new transactions for a connection ("Jetzt synchronisieren"). */
export async function syncConnectionNow(
  connectionId: string,
): Promise<ActionResult<{ imported: number; skipped: number }>> {
  const t = await requireTenant();
  const conn = await db.bankConnection.findFirst({
    where: { id: connectionId, tenantId: t.tenantId },
    select: { id: true, status: true },
  });
  if (!conn) return { success: false, error: "Connection not found." };
  if (conn.status !== "ACTIVE") {
    return { success: false, error: "Connection is not active." };
  }

  try {
    const res = await resyncConnection({
      tenantId: t.tenantId,
      userId: t.userId,
      connectionId,
    });
    revalidatePath("/dashboard/bank");
    return { success: true, imported: res.imported, skipped: res.skipped };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Sync failed.",
    };
  }
}

/**
 * Disconnect a connection: revoke the session at Enable Banking (best-effort),
 * mark it REVOKED and unlink its accounts. Historical transactions are kept —
 * only the live link is removed.
 */
export async function disconnectConnection(
  connectionId: string,
): Promise<ActionResult> {
  const t = await requireTenant();
  const conn = await db.bankConnection.findFirst({
    where: { id: connectionId, tenantId: t.tenantId },
    select: { id: true, sessionId: true },
  });
  if (!conn) return { success: false, error: "Connection not found." };

  if (conn.sessionId) {
    // Best-effort — a failure here shouldn't block local disconnect.
    await deleteSession(conn.sessionId).catch(() => {});
  }

  await db.bankAccount.updateMany({
    where: { tenantId: t.tenantId, bankConnectionId: connectionId },
    data: { bankConnectionId: null, externalAccountId: null },
  });
  await db.bankConnection.update({
    where: { id: connectionId },
    data: { status: "REVOKED", sessionId: null },
  });

  await createAuditLog({
    action: "BANK_CONNECTION_REVOKED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "BankConnection",
    entityId: connectionId,
  });

  revalidatePath("/dashboard/bank");
  return { success: true };
}

// ─── internal ───────────────────────────────────────────────────────────────

/**
 * Create (or, for reconnect, reset) a PENDING connection + kick off /auth.
 * Shared by connect + reconnect. When `reuseConnectionId` is given the existing
 * row is reset to PENDING with a fresh state instead of inserting a new one, so
 * a re-authorized bank doesn't leave an expired duplicate behind.
 */
async function beginAuth(
  t: TenantSession,
  input: { aspspName: string; country: string; psuType: PsuType },
  reuseConnectionId?: string,
): Promise<ActionResult<{ url: string }>> {
  const { aspspName, country, psuType } = input;

  // Determine the consent window, clamped to the ASPSP's maximum.
  const now = Date.now();
  let validityMs = EB_CONSENT_VALIDITY_DAYS * 24 * 60 * 60 * 1000;
  try {
    const aspsps = await getAspsps({ country, psuType });
    const match = aspsps.find((a) => a.name === aspspName && a.country === country);
    if (match?.maximum_consent_validity) {
      validityMs = Math.min(validityMs, match.maximum_consent_validity * 1000);
    }
  } catch {
    // Non-fatal: fall back to the default window; /auth will reject if too long.
  }
  // Shave a minute so we never send a value that has drifted past the max.
  const validUntil = new Date(now + validityMs - 60_000);
  const authState = randomBytes(24).toString("hex");

  const connection = reuseConnectionId
    ? await db.bankConnection.update({
        where: { id: reuseConnectionId },
        data: { status: "PENDING", authState, validUntil, error: null, psuType },
        select: { id: true },
      })
    : await db.bankConnection.create({
        data: {
          tenantId: t.tenantId,
          aspspName,
          aspspCountry: country,
          psuType,
          authState,
          validUntil,
          createdBy: t.userId,
        },
        select: { id: true },
      });

  try {
    const { url } = await startAuth({
      access: { valid_until: validUntil.toISOString() },
      aspsp: { name: aspspName, country },
      state: authState,
      redirect_url: ebRedirectUrl(),
      psu_type: psuType,
    });
    return { success: true, url };
  } catch (err) {
    await db.bankConnection.update({
      where: { id: connection.id },
      data: {
        status: "ERROR",
        error: err instanceof Error ? err.message.slice(0, 500) : "auth failed",
      },
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to start bank connection.",
    };
  }
}
