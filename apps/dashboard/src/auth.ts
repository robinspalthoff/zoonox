import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { fullName } from "@/lib/user-name";
import { verifyTotp } from "@/lib/totp";
import { isSignupEnabled } from "@/lib/signup";
import authConfig from "./auth.config";
import type { Role } from "@prisma/client";
import type { SessionTenant } from "@/types/next-auth";

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

async function ensureWorkspaceForOAuthUser(userId: string): Promise<void> {
  // Idempotent: läuft nur, wenn der User noch keiner Tenant-Mitgliedschaft
  // zugeordnet ist. Bei Account-Linking (gleiche E-Mail wie bestehender
  // Credentials-User) feuert events.createUser nicht — dieser Pfad bleibt
  // davon also unberührt.
  const existingMembership = await db.tenantUser.findFirst({
    where: { userId },
    select: { id: true },
  });
  if (existingMembership) return;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });
  if (!user) return;

  const firstName = user.firstName?.trim() || user.email.split("@")[0] || "Workspace";
  const workspaceName = `${firstName}'s Workspace`;
  const baseSlug = slugify(workspaceName);
  let slug = baseSlug;
  for (let i = 1; await db.tenant.findUnique({ where: { slug }, select: { id: true } }); i++) {
    slug = `${baseSlug}-${i}`;
  }

  const platformRole = "SUPER_ADMIN" as const;

  const tenant = await db.$transaction(async (tx) => {
    // OAuth-Signups bekommen — wie der klassische Self-Service-Flow — die
    // Plattform-Rolle SUPER_ADMIN, damit Settings/Audit-Log/Team zugänglich
    // sind. Siehe Begründung in /auth/signup/actions.ts.
    await tx.user.update({
      where: { id: userId },
      data: { role: platformRole },
    });

    return tx.tenant.create({
      data: {
        slug,
        name: workspaceName,
        members: {
          create: { userId, role: "OWNER", isDefault: true },
        },
        companySettings: {
          create: { name: null },
        },
      },
    });
  });

  await createAuditLog({
    action: "USER_CREATED",
    tenantId: tenant.id,
    userId,
    entityType: "User",
    entityId: userId,
    details: { source: "oauth-google", role: platformRole, tenantSlug: tenant.slug },
  });
}

async function loadTenantsForUser(userId: string): Promise<SessionTenant[]> {
  const memberships = await db.tenantUser.findMany({
    where: { userId, tenant: { isActive: true } },
    select: {
      role: true,
      isDefault: true,
      tenant: { select: { id: true, slug: true, name: true } },
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return memberships.map((m) => ({
    id: m.tenant.id,
    slug: m.tenant.slug,
    name: m.tenant.name,
    role: m.role,
  }));
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(db),

  // JWT-Strategie: Edge-kompatibel, kein DB-Lookup bei jedem Request
  session: { strategy: "jwt" },

  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Google verifiziert die E-Mail bereits — wir verknüpfen einen
      // OAuth-Account daher mit einem bestehenden Credentials-User mit
      // identischer E-Mail. Andernfalls wirft NextAuth
      // OAuthAccountNotLinked, was UX-seitig hässlich ist.
      allowDangerousEmailAccountLinking: true,
      profile(profile) {
        const given = profile.given_name?.trim() || null;
        const family = profile.family_name?.trim() || null;
        return {
          id: profile.sub,
          email: profile.email,
          firstName: given,
          lastName: family,
          image: profile.picture ?? null,
          emailVerified: profile.email_verified ? new Date() : null,
        } as unknown as { id: string; email: string };
      },
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        totp: { label: "2FA Code", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await db.user.findUnique({
          where: { email: credentials.email as string },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            password: true,
            role: true,
            image: true,
            isActive: true,
            mustChangePassword: true,
            twoFactorEnabled: true,
            twoFactorSecret: true,
          },
        });

        if (!user?.password) return null;

        // Deaktivierte User können sich nicht einloggen
        if (!user.isActive) return null;

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        );

        if (!isValid) return null;

        // Zweiter Faktor: Bei aktivem 2FA muss ein gültiger TOTP-Code
        // mitgeliefert werden, sonst schlägt der Login fehl. Das
        // Login-Formular fragt den Code erst nach erfolgreicher
        // Passwortprüfung in einem zweiten Schritt ab.
        if (user.twoFactorEnabled) {
          const code = (credentials.totp as string | undefined) ?? "";
          if (!user.twoFactorSecret || !verifyTotp(user.twoFactorSecret, code)) {
            return null;
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: fullName(user),
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          image: user.image,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],

  events: {
    async createUser({ user }) {
      // Feuert nur für Adapter-basierte Signups (OAuth). Credentials-Signup
      // legt den User direkt via Server-Action an und löst dieses Event
      // nicht aus. Bei Account-Linking (gleiche E-Mail) wird kein neuer
      // User erstellt, also feuert createUser ebenfalls nicht — der
      // bestehende Workspace bleibt unangetastet.
      if (user.id) {
        await ensureWorkspaceForOAuthUser(user.id);
      }
    },
    async signIn({ user }) {
      await createAuditLog({
        action: "LOGIN",
        userId: user.id!,
        entityType: "User",
        entityId: user.id!,
      });
    },
    async signOut(message) {
      // With JWT strategy the message carries { token }, with DB sessions { session }.
      const userId =
        "token" in message
          ? (message.token?.id as string | undefined)
          : message.session?.userId;
      if (userId) {
        await createAuditLog({
          action: "LOGOUT",
          userId,
          entityType: "User",
          entityId: userId,
        });
      }
    },
  },

  callbacks: {
    // Session-Callback wird aus authConfig übernommen (edge-safe Token→Session-Mapping).
    ...authConfig.callbacks,
    async signIn({ account, user }) {
      // Closed development: block NEW self-service sign-ups via Google OAuth.
      // Existing users (matched by verified email) may still log in / link —
      // only brand-new accounts are refused, so Google can't bypass the
      // createAccount gate and silently provision a workspace.
      if (account?.provider === "google" && !isSignupEnabled()) {
        const email = user?.email?.toLowerCase();
        if (!email) return false;
        const existing = await db.user.findUnique({
          where: { email },
          select: { id: true },
        });
        if (!existing) return false;
      }
      return true;
    },
    async jwt({ token, user, trigger, session: updateSession }) {
      // Beim Login: User-Daten + Tenant-Memberships ins Token
      if (user) {
        token.id = user.id;
        // Bei OAuth-Erstanmeldung ist das `user`-Objekt der Snapshot vor
        // events.createUser (in dem wir Rolle setzen und Workspace bauen).
        // Wir lesen die persistierten Felder daher frisch aus der DB.
        const fresh = await db.user.findUnique({
          where: { id: user.id! },
          select: { role: true, mustChangePassword: true, firstName: true, lastName: true },
        });
        token.role = fresh?.role ?? (user as { role: Role }).role;
        token.mustChangePassword =
          fresh?.mustChangePassword ?? (user as { mustChangePassword?: boolean }).mustChangePassword ?? false;
        token.firstName = fresh?.firstName ?? (user as { firstName?: string | null }).firstName ?? null;
        token.lastName = fresh?.lastName ?? (user as { lastName?: string | null }).lastName ?? null;

        const tenants = await loadTenantsForUser(user.id!);
        token.tenants = tenants;
        // Default-Tenant aktivieren (oder erster, falls keiner als default markiert)
        const active = tenants[0] ?? null;
        token.tenantId = active?.id ?? null;
        token.tenantSlug = active?.slug ?? null;
        token.tenantRole = active?.role ?? null;
      }

      // Token-Update: Profil/Passwort, oder Tenant-Switch via update({ tenantId })
      if (trigger === "update") {
        const freshUser = await db.user.findUnique({
          where: { id: token.id as string },
          select: { role: true, mustChangePassword: true, firstName: true, lastName: true, email: true },
        });
        if (freshUser) {
          token.role = freshUser.role;
          token.mustChangePassword = freshUser.mustChangePassword;
          token.firstName = freshUser.firstName;
          token.lastName = freshUser.lastName;
          token.name = fullName(freshUser);
          token.email = freshUser.email;
        }

        // Tenant-Memberships immer refreshen
        const tenants = await loadTenantsForUser(token.id as string);
        token.tenants = tenants;

        // Tenant-Switch: client ruft update({ tenantId: "..." }) auf
        const requestedTenantId = (updateSession as { tenantId?: string } | undefined)?.tenantId;
        if (requestedTenantId) {
          const match = tenants.find((t) => t.id === requestedTenantId);
          if (match) {
            token.tenantId = match.id;
            token.tenantSlug = match.slug;
            token.tenantRole = match.role;
          }
        } else {
          // Sicherstellen, dass der aktive Tenant noch existiert
          const stillMember = tenants.find((t) => t.id === token.tenantId);
          if (!stillMember) {
            const fallback = tenants[0] ?? null;
            token.tenantId = fallback?.id ?? null;
            token.tenantSlug = fallback?.slug ?? null;
            token.tenantRole = fallback?.role ?? null;
          }
        }
      }

      return token;
    },
  },
});
