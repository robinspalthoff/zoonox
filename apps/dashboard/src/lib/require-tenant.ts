import { auth } from "@/auth";
import { redirect } from "next/navigation";
import type { Role, TenantRole } from "@prisma/client";

export type TenantSession = {
  userId: string;
  role: Role;
  tenantId: string;
  tenantSlug: string;
  tenantRole: TenantRole;
};

/**
 * Lädt die aktuelle Session und stellt sicher, dass ein Tenant aktiv ist.
 * Redirected zu /auth/login bei fehlender Session und zu /auth/no-tenant
 * bei eingeloggtem User ohne Workspace-Zugehörigkeit.
 */
export async function requireTenant(): Promise<TenantSession> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login");
  const tenantId = session.user.tenantId;
  if (!tenantId || !session.user.tenantSlug || !session.user.tenantRole) {
    redirect("/auth/no-tenant");
  }
  return {
    userId: session.user.id,
    role: session.user.role,
    tenantId,
    tenantSlug: session.user.tenantSlug,
    tenantRole: session.user.tenantRole,
  };
}

/**
 * Wirft einen Fehler statt zu redirected — für API-Routes, die JSON antworten.
 */
export async function requireTenantOrThrow(): Promise<TenantSession> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("UNAUTHENTICATED");
  const tenantId = session.user.tenantId;
  if (!tenantId || !session.user.tenantSlug || !session.user.tenantRole) {
    throw new Error("NO_ACTIVE_TENANT");
  }
  return {
    userId: session.user.id,
    role: session.user.role,
    tenantId,
    tenantSlug: session.user.tenantSlug,
    tenantRole: session.user.tenantRole,
  };
}
