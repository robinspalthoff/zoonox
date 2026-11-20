import { db } from "@/lib/db";
import type { AuditAction, Prisma } from "@prisma/client";
import { headers } from "next/headers";

interface AuditLogInput {
  action: AuditAction;
  tenantId?: string | null; // NULL erlaubt für plattform-globale Events (LOGIN/LOGOUT)
  userId?: string;
  entityType?: string;
  entityId?: string;
  details?: Prisma.InputJsonValue;
}

/**
 * Erstellt einen Audit-Log-Eintrag.
 * tenantId muss explizit übergeben werden — kein Auto-Lookup, da die Funktion
 * auch aus NextAuth-Events (außerhalb Request-Kontext) aufgerufen wird.
 * userId MUSS vom Caller übergeben werden (kein auth()-Import wegen zirkulärer Imports).
 */
export async function createAuditLog(input: AuditLogInput): Promise<void> {
  try {
    let ipAddress: string | null = null;
    let userAgent: string | null = null;
    try {
      const headerList = await headers();
      ipAddress =
        headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        headerList.get("x-real-ip") ??
        null;
      userAgent = headerList.get("user-agent") ?? null;
    } catch {
      // Not in a request context — IP/userAgent unavailable, entry is still written.
    }

    await db.auditLog.create({
      data: {
        tenantId: input.tenantId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        details: input.details ?? undefined,
        ipAddress,
        userAgent,
      },
    });
  } catch (error) {
    console.error("[AuditLog] Failed to create entry:", error);
  }
}
