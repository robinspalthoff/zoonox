// RS256 JWT signing for Enable Banking API authentication.
//
// Enable Banking authenticates every request with a self-signed JWT (there is
// no token endpoint / OAuth client-credentials step). We sign a short-lived
// bearer with our application's private key; the API validates it against the
// public key registered for the application (`kid` = application id).
//
// Zero external dependencies — Node's built-in crypto does RS256 natively,
// matching the rest of this codebase (see lib/inbound uses of `crypto`).

import { createSign } from "crypto";
import { readFileSync } from "fs";
import {
  EB_APP_ID,
  EB_API_URL,
  EB_PRIVATE_KEY_B64,
  EB_PRIVATE_KEY_PATH,
} from "./config";

/** Max TTL accepted by Enable Banking is 24h; we use a small window and cache. */
const TOKEN_TTL_SECONDS = 60 * 55; // 55 minutes
/** Refresh a bit before expiry to avoid clock-skew rejections at the edge. */
const REFRESH_SKEW_SECONDS = 60;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// The private key rarely changes; read it once per process.
let cachedKey: string | null = null;
function getPrivateKey(): string {
  if (cachedKey) return cachedKey;

  if (EB_PRIVATE_KEY_B64) {
    const pem = Buffer.from(EB_PRIVATE_KEY_B64, "base64").toString("utf8");
    if (!pem.includes("-----BEGIN")) {
      throw new Error(
        "ENABLEBANKING_PRIVATE_KEY_B64 does not decode to a PEM — expected " +
          "base64 of the whole key file (base64 -w0 < key.pem)",
      );
    }
    cachedKey = pem;
    return cachedKey;
  }

  try {
    cachedKey = readFileSync(EB_PRIVATE_KEY_PATH, "utf8");
  } catch (err) {
    throw new Error(
      `Enable Banking private key not readable: set ENABLEBANKING_PRIVATE_KEY_B64, ` +
        `or provide the file at ${EB_PRIVATE_KEY_PATH} (${(err as Error).message})`,
    );
  }
  return cachedKey;
}

// Cache the signed token across requests until shortly before it expires.
let cachedToken: { jwt: string; exp: number } | null = null;

/**
 * Returns a valid (cached or freshly signed) application JWT for the
 * `Authorization: Bearer` header. Host is derived from EB_API_URL so the
 * `aud` claim stays correct if the base URL is overridden.
 */
export function getAppJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - REFRESH_SKEW_SECONDS > now) {
    return cachedToken.jwt;
  }

  if (!EB_APP_ID) {
    throw new Error("ENABLEBANKING_APP_ID is not set — cannot sign JWT");
  }

  const aud = new URL(EB_API_URL).host; // e.g. "api.enablebanking.com"
  const exp = now + TOKEN_TTL_SECONDS;

  const header = { typ: "JWT", alg: "RS256", kid: EB_APP_ID };
  const payload = {
    iss: "enablebanking.com",
    aud,
    iat: now,
    exp,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(payload),
  )}`;

  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = base64url(signer.sign(getPrivateKey()));

  const jwt = `${signingInput}.${signature}`;
  cachedToken = { jwt, exp };
  return jwt;
}

/** Test/ops hook: drop cached key + token (e.g. after key rotation). */
export function resetJwtCache(): void {
  cachedKey = null;
  cachedToken = null;
}
