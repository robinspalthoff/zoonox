import { randomInt } from "crypto";
import { db } from "@/lib/db";

// Unrätselbares Token als primärer Auth-Faktor der Alias-Adresse. Alphabet ohne
// optisch verwechselbare Zeichen (kein 0/O/1/l/I), damit die Adresse vorlesbar
// und fehlerarm abtippbar bleibt. 12 Zeichen ≈ 60 Bit Entropie.
const TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const TOKEN_LENGTH = 12;

// Lokalteil-Präfix der Alias-Adresse: beleg-<token>@<domain>.
const LOCAL_PREFIX = "beleg-";

export function generateMailboxToken(): string {
  let token = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token += TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)];
  }
  return token;
}

/**
 * Domain, unter der eingehende Belege empfangen werden (Catch-all-Subdomain mit
 * MX-Records auf den Inbound-Provider). Konfiguriert über INBOUND_EMAIL_DOMAIN.
 */
export function inboundDomain(): string {
  return (process.env.INBOUND_EMAIL_DOMAIN ?? "").trim().toLowerCase();
}

export function buildInboundAddress(token: string): string {
  const domain = inboundDomain();
  return `${LOCAL_PREFIX}${token}@${domain}`;
}

/**
 * Extrahiert das Mailbox-Token aus einer Empfänger-Adresse der Form
 * beleg-<token>@<INBOUND_EMAIL_DOMAIN>. Liefert null, wenn die Adresse nicht
 * zum erwarteten Schema/zur konfigurierten Domain passt.
 */
export function parseTokenFromAddress(address: string): string | null {
  const domain = inboundDomain();
  if (!domain) return null;
  const normalized = address.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at === -1) return null;
  const local = normalized.slice(0, at);
  const host = normalized.slice(at + 1);
  if (host !== domain) return null;
  if (!local.startsWith(LOCAL_PREFIX)) return null;
  const token = local.slice(LOCAL_PREFIX.length);
  return /^[a-z0-9]+$/.test(token) ? token : null;
}

/**
 * Durchsucht eine Liste möglicher Empfänger (To + Cc) und gibt die erste
 * aktive Mailbox zurück, deren Token passt. So funktionieren auch Mails, die
 * den Alias nur im Cc tragen (häufig bei Weiterleitungsregeln).
 */
export async function resolveMailboxFromRecipients(
  addresses: string[],
): Promise<{ id: string; tenantId: string; allowedSenders: string[] } | null> {
  const tokens = Array.from(
    new Set(
      addresses
        .map((a) => parseTokenFromAddress(a))
        .filter((t): t is string => Boolean(t)),
    ),
  );
  if (tokens.length === 0) return null;

  const mailbox = await db.inboundMailbox.findFirst({
    where: { token: { in: tokens }, active: true },
    select: { id: true, tenantId: true, allowedSenders: true },
  });
  return mailbox;
}

/** Lädt die Mailbox eines Mandanten oder legt sie mit frischem Token an. */
export async function getOrCreateMailbox(tenantId: string) {
  const existing = await db.inboundMailbox.findUnique({ where: { tenantId } });
  if (existing) return existing;
  return db.inboundMailbox.create({
    data: { tenantId, token: generateMailboxToken() },
  });
}
