// Central configuration for the Enable Banking (PSD2 open-banking) integration.
//
// Everything that differs between sandbox and production lives here so the
// switch is a matter of environment variables + swapping the private key —
// no code changes. See the module README notes in client.ts for the go-live
// checklist.

import path from "path";

/** Base URL of the Enable Banking API. Same host for sandbox & production —
 *  the environment is determined by which application (APP_ID + key) you use. */
export const EB_API_URL =
  process.env.ENABLEBANKING_API_URL?.replace(/\/$/, "") ??
  "https://api.enablebanking.com";

/** Application ID (a.k.a. `kid`) from the Enable Banking control panel. */
export const EB_APP_ID = process.env.ENABLEBANKING_APP_ID ?? "";

/** RS256 private key (PKCS#8 PEM), base64-encoded, that pairs with the public
 *  key registered for this application. Preferred in container deploys: the
 *  key file is gitignored and therefore never part of the build context.
 *  Base64 rather than raw PEM because newlines in env vars survive poorly. */
export const EB_PRIVATE_KEY_B64 = process.env.ENABLEBANKING_PRIVATE_KEY_B64 ?? "";

/** Absolute path to the same key on disk. Dev fallback — used when
 *  EB_PRIVATE_KEY_B64 is empty. Gitignored under secrets/. */
export const EB_PRIVATE_KEY_PATH =
  process.env.ENABLEBANKING_PRIVATE_KEY_PATH ??
  path.join(process.cwd(), "secrets", "enablebanking-private-key.pem");

/** Path segment of our registered redirect URL. Must match the value
 *  registered in the Enable Banking control panel exactly. */
export const EB_CALLBACK_PATH = "/api/banking/callback";

/** Fully-qualified redirect URL derived from NEXT_PUBLIC_APP_URL, e.g.
 *  http://localhost:3001/api/banking/callback */
export function ebRedirectUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!base) {
    throw new Error("NEXT_PUBLIC_APP_URL is not set — cannot build redirect URL");
  }
  return `${base}${EB_CALLBACK_PATH}`;
}

/** How long we request consent for, in days. Capped per-ASPSP by
 *  `maximum_consent_validity`; we clamp against that in startAuth. */
export const EB_CONSENT_VALIDITY_DAYS = Number(
  process.env.ENABLEBANKING_CONSENT_DAYS ?? 90,
);

/** PSU type for our users. Accounting SaaS ⇒ business accounts by default. */
export const EB_DEFAULT_PSU_TYPE: "business" | "personal" = "business";

/** Whether we are pointed at a sandbox application. Purely informational —
 *  used to surface a banner / pick sandbox defaults in the UI. */
export const EB_IS_SANDBOX =
  process.env.ENABLEBANKING_ENV?.toLowerCase() !== "production";

export function assertEbConfigured(): void {
  if (!EB_APP_ID) {
    throw new Error("ENABLEBANKING_APP_ID is not set");
  }
}
