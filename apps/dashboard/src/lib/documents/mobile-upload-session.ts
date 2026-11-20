import { randomBytes } from "crypto";
import { db } from "@/lib/db";

export const MOBILE_UPLOAD_TTL_MINUTES = 15;
const MAX_ACTIVE_SESSIONS_PER_USER = 5;

export type MobileSessionTokenInfo = {
  token: string;
  expiresAt: Date;
  url: string;
};

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function buildAppOrigin(): string {
  const raw = (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000"
  ).trim().replace(/\/+$/, "");
  // Schema-Tippfehler in der .env (z. B. „192.168.x.x:3000") würde im QR
  // landen und vom Handy als Google-Suchanfrage interpretiert.
  return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
}

export function buildMobileUploadUrl(token: string): string {
  return `${buildAppOrigin()}/m/u/${token}`;
}

export async function createMobileUploadSession(args: {
  tenantId: string;
  userId: string;
}): Promise<MobileSessionTokenInfo> {
  const now = new Date();
  const activeCount = await db.mobileUploadSession.count({
    where: {
      userId: args.userId,
      revokedAt: null,
      expiresAt: { gt: now },
    },
  });
  if (activeCount >= MAX_ACTIVE_SESSIONS_PER_USER) {
    throw new Error("RATE_LIMITED");
  }

  const token = generateToken();
  const expiresAt = new Date(now.getTime() + MOBILE_UPLOAD_TTL_MINUTES * 60_000);

  await db.mobileUploadSession.create({
    data: {
      token,
      tenantId: args.tenantId,
      userId: args.userId,
      expiresAt,
    },
  });

  return { token, expiresAt, url: buildMobileUploadUrl(token) };
}

export type ValidatedMobileSession = {
  id: string;
  tenantId: string;
  userId: string;
  expiresAt: Date;
};

export async function resolveActiveMobileSession(
  token: string,
): Promise<ValidatedMobileSession | null> {
  if (!token || token.length < 16 || token.length > 200) return null;
  const session = await db.mobileUploadSession.findUnique({ where: { token } });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  return {
    id: session.id,
    tenantId: session.tenantId,
    userId: session.userId,
    expiresAt: session.expiresAt,
  };
}

export async function appendDocumentToSession(
  sessionId: string,
  documentId: string,
): Promise<void> {
  await db.mobileUploadSession.update({
    where: { id: sessionId },
    data: { documentIds: { push: documentId } },
  });
}

export async function revokeMobileSession(args: {
  token: string;
  userId: string;
}): Promise<void> {
  await db.mobileUploadSession.updateMany({
    where: { token: args.token, userId: args.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
