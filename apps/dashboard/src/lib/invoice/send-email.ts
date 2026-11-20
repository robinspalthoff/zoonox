// Tenant-agnostic invoice email send.
//
// Lives outside the "use server"-marked actions.ts so it can be imported from
// both the UI server action (`sendInvoiceEmail` — which guards with requireTenant)
// AND from worker-driven background flows (`finalizeAutoSentInvoice` — no session
// available, tenantId comes from the RecurringInvoice schedule).
//
// Effects, in order — kept identical to the original UI action so behaviour
// stays consistent whether email is sent by a user or by the worker:
//   1. Render PDF
//   2. Render HTML email
//   3. Send via Brevo
//   4. Generate XRechnung XML (best-effort)
//   5. UPDATE invoice (status, pdfHash, eInvoiceXml, finalizedAt)
//   6. INSERT InvoiceAuditHash
//   7. INSERT AuditLog
//   8. Post journal entries (first finalization only)

import { createHash } from "crypto";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { recordInvoiceIssued } from "@/lib/journal";
import { storage } from "@/lib/storage";
import { archiveInvoicePdf } from "@/lib/invoice/archive-pdf";

const FROZEN_STATUSES = ["SENT", "PAID", "OVERDUE", "CANCELLED"] as const;

export type SendEmailResult =
  | { success: true }
  | { success: false; error: string };

export interface SendInvoiceEmailOptions {
  invoiceId: string;
  tenantId: string;
  /** User performing the send (UI) or owner of the recurring schedule (worker). */
  actorUserId: string | null;
  /** Optional personal message included in the email body. */
  customMessage?: string | null;
  /**
   * Send a blind-carbon-copy of the email (incl. PDF attachment) to the
   * acting user's address. Implemented as BCC, never CC, so the recipient
   * cannot see who else received the mail. Defaults to false.
   *
   * Falls back silently if actorUserId is null (e.g. recurring-worker run
   * where there's no acting user with a deliverable email).
   */
  sendCopyToSelf?: boolean;
}

export async function sendInvoiceEmailInternal(
  opts: SendInvoiceEmailOptions,
): Promise<SendEmailResult> {
  const {
    invoiceId,
    tenantId,
    actorUserId,
    customMessage = null,
    sendCopyToSelf = false,
  } = opts;

  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: {
      contact: true,
      lineItems: { orderBy: { position: "asc" } },
      creditNoteFor: { select: { number: true, issueDate: true } },
    },
  });
  if (!invoice) return { success: false, error: "Invoice not found" };

  // Allow re-sending an already-SENT invoice (e.g., resend); refuse PAID/OVERDUE/CANCELLED.
  if (
    FROZEN_STATUSES.includes(invoice.status as (typeof FROZEN_STATUSES)[number]) &&
    invoice.status !== "SENT"
  ) {
    return { success: false, error: `Invoice is ${invoice.status} and cannot be sent.` };
  }

  if (!invoice.contact.email) {
    return { success: false, error: "Client has no email address" };
  }

  const settings = await db.companySettings.findUnique({ where: { tenantId } });

  // Resolve the BCC target (acting user's email) up-front. Doing this here
  // and not inside the Brevo block keeps the "should we BCC?" decision in
  // one place and ensures we never accidentally CC instead of BCC.
  let bccEmail: string | null = null;
  if (sendCopyToSelf && actorUserId) {
    const actor = await db.user.findUnique({
      where: { id: actorUserId },
      select: { email: true, firstName: true, lastName: true },
    });
    if (actor?.email) {
      bccEmail = actor.email;
    }
  }

  const platformEmail = process.env.PLATFORM_SENDER_EMAIL;
  if (!platformEmail) {
    return { success: false, error: "PLATFORM_SENDER_EMAIL is not configured" };
  }

  // ── 1. Obtain the PDF ────────────────────────────────────────────────────
  // GoBD: the archived PDF must stay byte-identical to what was sent. On the
  // first send we render fresh; every re-send replays the archived bytes
  // verbatim — a later font/template change must never retroactively alter
  // a PDF that has already been sent to a customer.
  let pdfBuffer: Buffer | undefined;

  if (invoice.pdfStoragePath) {
    const archived = await storage.get(invoice.pdfStoragePath).catch((e) => {
      console.warn("[invoice] archived PDF fetch failed, will re-render:", e);
      return null;
    });
    if (archived) pdfBuffer = archived;
  }

  if (!pdfBuffer) {
    try {
      const { renderToBuffer } = await import("@react-pdf/renderer");
      const { InvoicePDF } = await import("@/components/pdf/invoice-pdf");
      const React = await import("react");
      pdfBuffer = await renderToBuffer(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(InvoicePDF, { invoice, settings }) as any,
      );
    } catch (e) {
      console.error("PDF generation failed", e);
      return { success: false, error: "PDF generation failed" };
    }
  }

  const pdfHash = createHash("sha256").update(pdfBuffer).digest("hex");

  const fmt = (val: number | string | { toString(): string }) =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(val));
  const fmtDate = (d: Date | string) =>
    new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

  const isCreditNote = invoice.type === "CREDIT_NOTE";
  const docLabel = isCreditNote ? "Gutschrift" : "Rechnung";

  // ── 2. Render HTML email ─────────────────────────────────────────────────
  let htmlContent: string;
  try {
    const { render } = await import("@react-email/render");
    const { InvoiceEmail } = await import("@/emails/invoice-email");
    const React = await import("react");
    htmlContent = await render(
      React.createElement(InvoiceEmail, {
        companyName: settings?.name ?? "",
        logoBase64: settings?.logoBase64 ?? null,
        invoiceNumber: invoice.number,
        invoiceDate: fmtDate(invoice.issueDate),
        dueDate: invoice.dueDate ? fmtDate(invoice.dueDate) : null,
        totalAmount: fmt(invoice.total),
        customMessage,
        recipientName: invoice.contact.name,
        isCreditNote,
      }),
    );
  } catch (e) {
    console.error("Email render failed", e);
    return { success: false, error: "Email rendering failed" };
  }

  // ── 3. Send via Brevo ────────────────────────────────────────────────────
  try {
    const { brevo, Brevo } = await import("@/lib/email");
    const sendEmail = new Brevo.SendSmtpEmail();
    sendEmail.subject = `${docLabel} ${invoice.number} von ${settings?.name ?? ""}`;
    const platformName = process.env.PLATFORM_NAME ?? "Zoonox";
    const companyName = settings?.name ?? "";
    sendEmail.sender = {
      name: companyName ? `${companyName} | über ${platformName}` : platformName,
      email: platformEmail,
    };
    sendEmail.replyTo = { email: settings?.email ?? platformEmail };
    sendEmail.to = [{ email: invoice.contact.email, name: invoice.contact.name }];
    // BCC the acting user — invisible to the recipient by design.
    if (bccEmail && bccEmail.toLowerCase() !== invoice.contact.email.toLowerCase()) {
      sendEmail.bcc = [{ email: bccEmail }];
    }
    sendEmail.htmlContent = htmlContent;
    sendEmail.attachment = [
      {
        name: `${invoice.number}.pdf`,
        content: pdfBuffer.toString("base64"),
      },
    ];
    await brevo.sendTransacEmail(sendEmail);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unbekannter Fehler";
    console.error("Brevo error", e);
    return { success: false, error: message };
  }

  // ── 4. Generate XRechnung XML (best-effort) ──────────────────────────────
  let eInvoiceXml: string | null = invoice.eInvoiceXml ?? null;
  if (!eInvoiceXml) {
    try {
      if (settings) {
        const { generateZugferdXml, validateForEInvoice } = await import("@/lib/e-invoice");
        const validation = validateForEInvoice({ invoice, settings });
        if (validation.valid) {
          eInvoiceXml = generateZugferdXml({ invoice, settings });
        }
      }
    } catch (xmlErr) {
      console.warn("[e-invoice] XML generation skipped:", xmlErr);
    }
  }

  // ── 4b. Archive the sent PDF in R2 ───────────────────────────────────────
  // The email is already out; archiving the exact bytes that were sent is
  // best-effort and never fails the send. archiveInvoicePdf writes the
  // Object-Lock-protected copy, persists pdfHash + pdfStoragePath and the
  // InvoiceAuditHash row. Re-sends are a no-op there — the archive exists.
  const archive = await archiveInvoicePdf(
    invoiceId,
    tenantId,
    actorUserId,
    pdfBuffer,
  );
  const pdfStoragePath = archive.success ? archive.storagePath : null;

  // ── 5–8. Persist state, audit, journal ───────────────────────────────────
  const now = new Date();
  const isFirstFinalization = invoice.status === "DRAFT";

  await db.invoice.update({
    where: { id: invoiceId },
    data: {
      status: "SENT",
      pdfHash,
      ...(eInvoiceXml ? { eInvoiceXml } : {}),
      ...(isFirstFinalization ? { finalizedAt: now } : {}),
    },
  });

  await createAuditLog({
    action: "INVOICE_SENT",
    tenantId,
    userId: actorUserId ?? undefined,
    entityType: "Invoice",
    entityId: invoiceId,
    details: {
      pdfHash,
      pdfSizeBytes: pdfBuffer.length,
      pdfArchived: !!pdfStoragePath,
      eInvoiceArchived: !!eInvoiceXml,
      bccSenderCopy: !!bccEmail,
      ...(isFirstFinalization ? { finalizedAt: now.toISOString() } : {}),
    },
  });

  if (isFirstFinalization) {
    await recordInvoiceIssued(tenantId, invoiceId, actorUserId);
  }

  return { success: true };
}
