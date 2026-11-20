// Adapter für Brevo Inbound Parsing.
//
// Brevo liefert eingehende Mails als JSON an unseren Webhook. Anhänge sind im
// Payload NICHT eingebettet, sondern werden per DownloadToken über die Inbound-
// API nachgeladen: GET /v3/inbound/attachments/{token} mit `api-key`-Header.
//
// Docs: https://developers.brevo.com/docs/inbound-parse-webhooks
//       https://developers.brevo.com/reference/get-inbound-email-attachment

const BREVO_INBOUND_ATTACHMENT_URL =
  "https://api.brevo.com/v3/inbound/attachments";

type BrevoMailbox = {
  Address?: string;
  Name?: string;
};

export type BrevoAttachment = {
  Name?: string;
  ContentType?: string;
  ContentLength?: number;
  ContentID?: string;
  DownloadToken?: string;
};

export type BrevoInboundItem = {
  Uuid?: string[];
  MessageId?: string;
  From?: BrevoMailbox;
  To?: BrevoMailbox[];
  Cc?: BrevoMailbox[];
  Recipients?: string[];
  Subject?: string;
  Attachments?: BrevoAttachment[];
};

export type BrevoInboundPayload = {
  items?: BrevoInboundItem[];
};

/** Sammelt alle Empfänger-Adressen (To + Cc + Recipients) eines Items. */
export function collectRecipientAddresses(item: BrevoInboundItem): string[] {
  const out: string[] = [];
  for (const m of item.To ?? []) if (m.Address) out.push(m.Address);
  for (const m of item.Cc ?? []) if (m.Address) out.push(m.Address);
  for (const r of item.Recipients ?? []) if (r) out.push(r);
  return out;
}

export function senderAddress(item: BrevoInboundItem): string {
  return (item.From?.Address ?? "").trim().toLowerCase();
}

/**
 * Lädt einen Anhang über seinen DownloadToken. Liefert die rohen Bytes oder
 * null bei Fehler (geloggt vom Aufrufer). Benötigt BREVO_API_KEY.
 */
export async function downloadAttachment(
  downloadToken: string,
): Promise<Buffer | null> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("[inbound] BREVO_API_KEY missing — cannot download attachment");
    return null;
  }
  try {
    const res = await fetch(`${BREVO_INBOUND_ATTACHMENT_URL}/${downloadToken}`, {
      headers: { "api-key": apiKey, accept: "application/octet-stream" },
    });
    if (!res.ok) {
      console.error(
        `[inbound] attachment download failed: HTTP ${res.status} ${res.statusText}`,
      );
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error("[inbound] attachment download error:", err);
    return null;
  }
}
