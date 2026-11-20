import type { Role, TenantRole } from "@prisma/client";
import type { DefaultSession } from "next-auth";

export interface SessionTenant {
  id: string;
  slug: string;
  name: string;
  role: TenantRole;
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      mustChangePassword: boolean;
      firstName: string | null;
      lastName: string | null;
      tenantId: string | null;       // aktiver Tenant
      tenantSlug: string | null;
      tenantRole: TenantRole | null; // Rolle im aktiven Tenant
      tenants: SessionTenant[];      // alle Memberships
    } & DefaultSession["user"];
  }

  interface User {
    firstName?: string | null;
    lastName?: string | null;
    role?: Role;
    mustChangePassword?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    firstName?: string | null;
    lastName?: string | null;
    mustChangePassword?: boolean;
    tenantId?: string | null;
    tenantSlug?: string | null;
    tenantRole?: TenantRole | null;
    tenants?: SessionTenant[];
  }
}
