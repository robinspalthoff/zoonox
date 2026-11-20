/**
 * Email send pipeline for non-invoice business documents (Angebot / AB).
 *
 * Parallel to lib/invoice/send-email.ts, but much simpler:
 *   • No GoBD archival — quotes/ABs are not immutable, no pdfHash, no R2
 *     object-lock copy. We render fresh on every send.
 *   • No journal entries — revenue is recognized when the *invoice* is
 *     finalized, not the quote/AB.
 *   • No XRechnung XML — only applies to real invoices to public-sector buyers.
 *
 * Effects, in order:
 *   1. Render PDF (via shared BusinessDocPDF)
 *   2. Render HTML email (BusinessDocEmail)
 *   3. Send via Brevo (with optional BCC-to-self)
 *   4. UPDATE row: status → SENT (first send only — re-sends keep status)
 *   5. INSERT AuditLog
 */

import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import type { BusinessDocKind } from "@/emails/business-doc-email";

export type SendBusinessDocResult =
  | { success: true }
  | { success: false; error: string };

export interface SendBusinessDocOptions {
  kind: BusinessDocKind;
  docId: string;
  tenantId: string;
  /** User performing the send. UI passes the session user. */
  actorUserId: string | null;
  customMessage?: string | null;
  sendCopyToSelf?: boolean;
}

const fmt = (val: number | string | { toString(): string }) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(val));
const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

export async function sendBusinessDocEmail(
  opts: SendBusinessDocOptions,
): Promise<SendBusinessDocResult> {
  const { kind, docId, tenantId, actorUserId, customMessage = null, sendCopyToSelf = false } = opts;

  // ── 1. Load row + contact + line items ──────────────────────────────────
  // Single union over the two tables. We branch only where the schemas
  // diverge (deadline field name, status enum, PDF shape, audit action).
  const row =
    kind === "QUOTE"
      ? await db.quote.findFirst({
          where: { id: docId, tenantId },
          include: { contact: true, lineItems: { orderBy: { position: "asc" } } },
        })
      : await db.orderConfirmation.findFirst({
          where: { id: docId, tenantId },
          include: { contact: true, lineItems: { orderBy: { position: "asc" } } },
        });

  if (!row) return { success: false, error: "Dokument nicht gefunden." };

  if (!row.contact.email) {
    return { success: false, error: "Der Kontakt hat keine E-Mail-Adresse." };
  }

  // Forbid sending closed/rejected documents — UI shouldn't even let the
  // user try, but guard defensively. Re-sending SENT is allowed.
  if (kind === "QUOTE") {
    const q = row as { status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED"; convertedAt: Date | null };
    if (q.status === "REJECTED") {
      return { success: false, error: "Abgelehnte Angebote können nicht versendet werden." };
    }
    if (q.convertedAt) {
      return { success: false, error: "Bereits weiterverarbeitete Angebote können nicht erneut versendet werden." };
    }
  } else {
    const o = row as { status: "DRAFT" | "SENT" | "INVOICED" | "CANCELLED" };
    if (o.status === "CANCELLED" || o.status === "INVOICED") {
      return { success: false, error: "Diese Auftragsbestätigung kann nicht (mehr) versendet werden." };
    }
  }

  const settings = await db.companySettings.findUnique({ where: { tenantId } });

  // BCC-to-self resolution — mirrors invoice flow.
  let bccEmail: string | null = null;
  if (sendCopyToSelf && actorUserId) {
    const actor = await db.user.findUnique({
      where: { id: actorUserId },
      select: { email: true },
    });
    if (actor?.email) bccEmail = actor.email;
  }

  const platformEmail = process.env.PLATFORM_SENDER_EMAIL;
  if (!platformEmail) {
    return { success: false, error: "PLATFORM_SENDER_EMAIL ist nicht konfiguriert." };
  }

  // ── 2. Build the doc shape the shared PDF + preview expect ───────────────
  const deadlineDate =
    kind === "QUOTE"
      ? (row as { validUntil: Date | null }).validUntil
      : (row as { deliveryDate: Date | null }).deliveryDate;
  const deadlineLabel =
    deadlineDate
      ? kind === "QUOTE"
        ? "Gültig bis"
        : "Liefertermin"
      : null;

  const pdfDoc = {
    number: row.number,
    issueDate: row.issueDate,
    deadlineDate,
    deadlineLabel: deadlineLabel ?? undefined,
    serviceDate: row.serviceDate,
    serviceDateEnd: row.serviceDateEnd,
    notes: row.notes,
    introText: row.introText,
    vatRegulation: row.vatRegulation,
    subtotal: row.subtotal,
    taxAmount: row.taxAmount,
    total: row.total,
    contact: row.contact,
    lineItems: row.lineItems.map((li) => ({
      id: li.id, position: li.position, description: li.description,
      quantity: li.quantity, unit: li.unit,
      unitPrice: li.unitPrice, vatRate: li.vatRate, amount: li.amount,
    })),
  };

  // ── 3. Render PDF ────────────────────────────────────────────────────────
  let pdfBuffer: Buffer;
  try {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { BusinessDocPDF } = await import("@/components/pdf/business-doc-pdf");
    const React = await import("react");
    pdfBuffer = await renderToBuffer(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(BusinessDocPDF, { doc: pdfDoc, docType: kind, settings }) as any,
    );
  } catch (e) {
    console.error("[business-doc] PDF render failed", e);
    return { success: false, error: "PDF konnte nicht erzeugt werden." };
  }

  // ── 4. Render HTML email ─────────────────────────────────────────────────
  let htmlContent: string;
  try {
    const { render } = await import("@react-email/render");
    const { BusinessDocEmail } = await import("@/emails/business-doc-email");
    const React = await import("react");
    htmlContent = await render(
      React.createElement(BusinessDocEmail, {
        docKind: kind,
        companyName: settings?.name ?? "",
        logoBase64: settings?.logoBase64 ?? null,
        docNumber: row.number,
        docDate: fmtDate(row.issueDate),
        deadlineLabel,
        deadlineDate: deadlineDate ? fmtDate(deadlineDate) : null,
        totalAmount: fmt(row.total),
        customMessage,
        recipientName: row.contact.name,
      }),
    );
  } catch (e) {
    console.error("[business-doc] email render failed", e);
    return { success: false, error: "E-Mail-Template konnte nicht erzeugt werden." };
  }

  // ── 5. Send via Brevo ────────────────────────────────────────────────────
  const subjectLabel = kind === "QUOTE" ? "Angebot" : "Auftragsbestätigung";
  try {
    const { brevo, Brevo } = await import("@/lib/email");
    const sendEmail = new Brevo.SendSmtpEmail();
    sendEmail.subject = `${subjectLabel} ${row.number} von ${settings?.name ?? ""}`;
    const platformName = process.env.PLATFORM_NAME ?? "Zoonox";
    const companyName = settings?.name ?? "";
    sendEmail.sender = {
      name: companyName ? `${companyName} | über ${platformName}` : platformName,
      email: platformEmail,
    };
    sendEmail.replyTo = { email: settings?.email ?? platformEmail };
    sendEmail.to = [{ email: row.contact.email, name: row.contact.name }];
    if (bccEmail && bccEmail.toLowerCase() !== row.contact.email.toLowerCase()) {
      sendEmail.bcc = [{ email: bccEmail }];
    }
    sendEmail.htmlContent = htmlContent;
    sendEmail.attachment = [
      {
        name: `${row.number}.pdf`,
        content: pdfBuffer.toString("base64"),
      },
    ];
    await brevo.sendTransacEmail(sendEmail);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unbekannter Fehler";
    console.error("[business-doc] Brevo error", e);
    return { success: false, error: message };
  }

  // ── 6. Flip status to SENT (first send only) + audit ─────────────────────
  // Re-sends keep the existing status. Quote: only DRAFT advances. AB:
  // same — DRAFT → SENT; SENT re-send is a no-op for status.
  const wasDraft = row.status === "DRAFT";
  if (wasDraft) {
    if (kind === "QUOTE") {
      await db.quote.update({ where: { id: docId }, data: { status: "SENT" } });
    } else {
      await db.orderConfirmation.update({ where: { id: docId }, data: { status: "SENT" } });
    }
  }

  await createAuditLog({
    action: kind === "QUOTE" ? "QUOTE_SENT" : "ORDER_CONFIRMATION_SENT",
    tenantId,
    userId: actorUserId ?? undefined,
    entityType: kind === "QUOTE" ? "Quote" : "OrderConfirmation",
    entityId: docId,
    details: {
      number: row.number,
      pdfSizeBytes: pdfBuffer.length,
      bccSenderCopy: !!bccEmail,
      resend: !wasDraft,
    },
  });

  return { success: true };
}
