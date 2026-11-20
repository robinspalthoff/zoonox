import type { NextAuthConfig } from "next-auth";
import type { Role, TenantRole } from "@prisma/client";
import type { SessionTenant } from "@/types/next-auth";
import { fullName } from "@/lib/user-name";

// Edge-kompatible Konfiguration (kein Prisma, kein Node.js-only Code).
// Wird im Proxy (Middleware) verwendet — sowie als Basis von auth.ts.
//
// WICHTIG: Der `session`-Callback hier ist edge-safe (reines Token→Session-
// Mapping, kein DB-Zugriff). Er muss hier definiert werden, weil der Proxy
// `req.auth.user.mustChangePassword`, `tenantId` usw. liest. Ohne diesen
// Callback enthielte `session.user` auf Edge-Ebene nur die NextAuth-Defaults
// (id/name/email), und Logik wie der Force-Password-Change-Redirect oder der
// Tenant-Guard würden stillschweigend nicht greifen.
export default {
  pages: {
    signIn: "/auth/login",
  },
  providers: [],
  callbacks: {
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.mustChangePassword = token.mustChangePassword as boolean;
        session.user.firstName = (token.firstName as string | null) ?? null;
        session.user.lastName = (token.lastName as string | null) ?? null;
        session.user.name = fullName({
          firstName: session.user.firstName,
          lastName: session.user.lastName,
        });
        session.user.tenantId = (token.tenantId as string | null) ?? null;
        session.user.tenantSlug = (token.tenantSlug as string | null) ?? null;
        session.user.tenantRole = (token.tenantRole as TenantRole | null) ?? null;
        session.user.tenants = (token.tenants as SessionTenant[] | undefined) ?? [];
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
