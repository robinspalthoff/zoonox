/**
 * TOTP (RFC 6238) — Implementierung mit Node-Bordmitteln.
 * ──────────────────────────────────────────────────────
 * Bewusst ohne externe Abhängigkeit: HMAC-SHA1 + Base32 sind klein
 * genug, dass eine eigene Variante weniger Risiko trägt als ein
 * weiteres npm-Paket. Kompatibel mit Google Authenticator, 1Password,
 * Authy etc. (SHA1, 6 Stellen, 30-Sekunden-Fenster).
 *
 * Nur serverseitig verwenden — hängt an `node:crypto`.
 */
import crypto from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD = 30;
const DIGITS = 6;

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Erzeugt ein neues, zufälliges Base32-TOTP-Secret. */
export function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/**
 * Prüft einen 6-stelligen Code gegen das Secret. `window` erlaubt
 * Codes aus benachbarten Zeitfenstern (Toleranz für Uhren-Drift).
 */
export function verifyTotp(secretBase32: string, token: string, window = 1): boolean {
  const cleaned = token.replace(/\D/g, "");
  if (cleaned.length !== DIGITS) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / PERIOD);
  for (let i = -window; i <= window; i++) {
    const candidate = hotp(secret, counter + i);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(cleaned))) {
      return true;
    }
  }
  return false;
}

/** Baut die otpauth://-URL, die als QR-Code gescannt wird. */
export function buildOtpauthUrl(
  secretBase32: string,
  accountLabel: string,
  issuer: string,
): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
