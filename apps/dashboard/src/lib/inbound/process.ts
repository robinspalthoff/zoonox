import { db } from "@/lib/db";
import {
  createDocumentFromUpload,
  UPLOAD_ACCEPTED_TYPES,
  UPLOAD_MAX_FILE_SIZE,
} from "@/lib/documents/create-from-upload";
import {
  collectRecipientAddresses,
  downloadAttachment,
  senderAddress,
  type BrevoAttachment,
  type BrevoInboundItem,
} from "./brevo";
import { resolveMailboxFromRecipients } from "./mailbox";
import { extractZip, isZipAttachment } from "./zip";
import { sendNoAttachmentHint } from "./notify";

// Spam-/Flut-Schutz: max. eingehende Mails pro Mandant und Stunde.
const MAX_MAILS_PER_HOUR = 60;

// Inline-Bilder (Signatur-Logos) tragen eine ContentID und sind klein — solche
// Bild-Anhänge unterhalb dieser Schwelle werden ausgefiltert, damit nicht jedes
// Mail-Logo als „Beleg" landet. PDFs sind davon nie betroffen.
const INLINE_IMAGE_MAX_BYTES = 40 * 1024;

// ZIP-Archive dürfen größer als ein Einzelbeleg sein (mehrere Belege gebündelt),
// werden aber gegen DoS gedeckelt. Inhalt/Entpacken limitiert zusätzlich zip.ts.
const ZIP_MAX_DOWNLOAD = 25 * 1024 * 1024;

const EXT_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export type InboundLogStatus =
  | "RECEIVED"
  | "PROCESSED"
  | "REJECTED"
  | "NO_ATTACHMENT";

/**
 * Liefert einen akzeptierten MIME-Typ für eine Datei oder null. Bevorzugt den
 * gemeldeten Content-Type, fällt sonst auf die Dateiendung zurück (Brevo meldet
 * Anhänge gelegentlich generisch als application/octet-stream).
 */
function resolveAcceptedMime(name: string, contentType: string): string | null {
  const ct = contentType.toLowerCase();
  if ((UPLOAD_ACCEPTED_TYPES as readonly string[]).includes(ct)) return ct;
  const lower = name.toLowerCase();
  const ext = Object.keys(EXT_TO_MIME).find((e) => lower.endsWith(e));
  return ext ? EXT_TO_MIME[ext] : null;
}

function isInlineSignatureImage(att: BrevoAttachment): boolean {
  const ct = (att.ContentType ?? "").toLowerCase();
  const isImage = ct.startsWith("image/");
  const small = (att.ContentLength ?? Infinity) < INLINE_IMAGE_MAX_BYTES;
  return Boolean(att.ContentID) && isImage && small;
}

/**
 * Anhänge auf verwertbare Kandidaten reduzieren: akzeptierte Belegformate ODER
 * ZIP-Archive. Inline-Signatur-Logos und überscharfe Größen werden gefiltert.
 */
function selectAttachments(item: BrevoInboundItem): BrevoAttachment[] {
  return (item.Attachments ?? []).filter((att) => {
    if (!att.DownloadToken || isInlineSignatureImage(att)) return false;
    const name = att.Name ?? "";
    if (isZipAttachment(name, att.ContentType ?? "")) {
      return (att.ContentLength ?? 0) <= ZIP_MAX_DOWNLOAD;
    }
    return (
      resolveAcceptedMime(name, att.ContentType ?? "") !== null &&
      (att.ContentLength ?? 0) <= UPLOAD_MAX_FILE_SIZE
    );
  });
}

async function writeLog(args: {
  tenantId: string | null;
  fromAddress: string;
  subject: string | null;
  messageId: string | null;
  status: InboundLogStatus;
  rejectReason?: string;
  documentIds?: string[];
}): Promise<void> {
  try {
    await db.inboundMailLog.create({
      data: {
        tenantId: args.tenantId,
        fromAddress: args.fromAddress,
        subject: args.subject,
        messageId: args.messageId,
        status: args.status,
        rejectReason: args.rejectReason,
        documentIds: args.documentIds ?? [],
      },
    });
  } catch (err) {
    // Unique-Verletzung auf messageId = paralleler Doppel-Webhook; harmlos.
    console.warn("[inbound] log write skipped:", err);
  }
}

/**
 * Verarbeitet ein einzelnes eingegangenes Mail-Item:
 * Idempotenz → Mandant auflösen → Allowlist → Rate-Limit → Anhänge → Belege.
 * Wirft nie; Ergebnis landet im InboundMailLog.
 */
export async function processInboundItem(item: BrevoInboundItem): Promise<void> {
  const from = senderAddress(item);
  const subject = item.Subject ?? null;
  const messageId = item.MessageId ?? null;

  // 1. Idempotenz: schon verarbeitet?
  if (messageId) {
    const seen = await db.inboundMailLog.findUnique({
      where: { messageId },
      select: { id: true },
    });
    if (seen) {
      console.info(`[inbound] duplicate webhook ignored (messageId=${messageId})`);
      return;
    }
  }

  // 2. Mandant über Alias-Token auflösen.
  const mailbox = await resolveMailboxFromRecipients(
    collectRecipientAddresses(item),
  );
  if (!mailbox) {
    await writeLog({
      tenantId: null,
      fromAddress: from,
      subject,
      messageId,
      status: "REJECTED",
      rejectReason: "Kein aktiver Posteingang für die Empfängeradresse.",
    });
    return;
  }

  // 3. Optionale Absender-Allowlist.
  if (mailbox.allowedSenders.length > 0) {
    const allowed = mailbox.allowedSenders.map((s) => s.trim().toLowerCase());
    if (!allowed.includes(from)) {
      await writeLog({
        tenantId: mailbox.tenantId,
        fromAddress: from,
        subject,
        messageId,
        status: "REJECTED",
        rejectReason: `Absender ${from} steht nicht auf der Allowlist.`,
      });
      return;
    }
  }

  // 4. Rate-Limit pro Mandant.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentCount = await db.inboundMailLog.count({
    where: { tenantId: mailbox.tenantId, createdAt: { gte: oneHourAgo } },
  });
  if (recentCount >= MAX_MAILS_PER_HOUR) {
    await writeLog({
      tenantId: mailbox.tenantId,
      fromAddress: from,
      subject,
      messageId,
      status: "REJECTED",
      rejectReason: "Stündliches Limit erreicht.",
    });
    return;
  }

  // 5. Anhänge filtern.
  const attachments = selectAttachments(item);
  if (attachments.length === 0) {
    await writeLog({
      tenantId: mailbox.tenantId,
      fromAddress: from,
      subject,
      messageId,
      status: "NO_ATTACHMENT",
      rejectReason: "Keine verwertbaren Anhänge (PDF/PNG/JPG/ZIP).",
    });
    // Mailbox gültig aufgelöst → Absender bekommt einen Hinweis (best-effort).
    await sendNoAttachmentHint(from);
    return;
  }

  // 6. Pro Anhang (bzw. pro ZIP-Eintrag) ein Beleg — gleiche Pipeline wie der
  //    manuelle Upload.
  const documentIds: string[] = [];
  for (const att of attachments) {
    const buffer = await downloadAttachment(att.DownloadToken!);
    if (!buffer) continue;
    const name = att.Name ?? "";

    if (isZipAttachment(name, att.ContentType ?? "")) {
      for (const file of await extractZip(buffer)) {
        await ingestFile(mailbox.tenantId, file.fileName, "", file.buffer, documentIds);
      }
    } else {
      await ingestFile(mailbox.tenantId, name, att.ContentType ?? "", buffer, documentIds);
    }
  }

  const processed = documentIds.length > 0;
  await writeLog({
    tenantId: mailbox.tenantId,
    fromAddress: from,
    subject,
    messageId,
    status: processed ? "PROCESSED" : "NO_ATTACHMENT",
    rejectReason: processed ? undefined : "Anhänge konnten nicht verarbeitet werden.",
    documentIds,
  });
  if (!processed) await sendNoAttachmentHint(from);
}

/** Legt aus einem Datei-Buffer einen Beleg an und sammelt die erzeugte ID. */
async function ingestFile(
  tenantId: string,
  fileName: string,
  contentType: string,
  buffer: Buffer,
  collected: string[],
): Promise<void> {
  const mime = resolveAcceptedMime(fileName, contentType);
  if (!mime) return;
  const result = await createDocumentFromUpload({
    tenantId,
    userId: null,
    fileName: fileName || `email-beleg-${Date.now()}.pdf`,
    fileType: mime,
    size: buffer.length,
    buffer,
    source: "EMAIL",
  });
  if (result.ok) {
    collected.push(result.document.id);
  } else {
    console.warn(`[inbound] attachment rejected: ${result.error}`);
  }
}
