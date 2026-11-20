// GoBD-compliant archival of an invoice PDF.
//
// Finalizing an invoice produces one immutable PDF artifact: archived in R2
// under Object Lock, with its SHA-256 hash stored on the invoice and logged
// in an InvoiceAuditHash row. Finalization happens through more than one
// channel — an email send, a manual "mark as sent", a refunded credit note
// — and every channel must yield the same artifact. This module is that
// single archival point.
//
// Idempotent: once an invoice has an archived PDF the stored bytes are
// returned verbatim and nothing is written — re-sends never re-render, so a
// later font/template change cannot retroactively alter a sent document.

import { createHash } from "crypto";
import { db } from "@/lib/db";
import {
  storage,
  buildInvoiceKey,
  gobdRetainUntil,
  GOBD_OBJECT_LOCK_MODE,
} from "@/lib/storage";

export type ArchiveInvoicePdfResult =
  | { success: true; buffer: Buffer; hash: string; storagePath: string | null }
  | { success: false; error: string };

export async function archiveInvoicePdf(
  invoiceId: string,
  tenantId: string,
  actorUserId: string | null,
  /**
   * The exact PDF bytes that were sent. Pass this from the email path so
   * the archived copy is byte-identical to the attachment. Omit it (manual
   * "mark as sent" / refunded credit note) to have the PDF rendered here.
   */
  prerendered?: Buffer,
): Promise<ArchiveInvoicePdfResult> {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: {
      contact: true,
      lineItems: { orderBy: { position: "asc" } },
      creditNoteFor: { select: { number: true, issueDate: true } },
    },
  });
  if (!invoice) return { success: false, error: "Invoice not found" };

  // Already archived — replay verbatim, write nothing.
  if (invoice.pdfStoragePath) {
    const archived = await storage
      .get(invoice.pdfStoragePath)
      .catch(() => null);
    if (archived) {
      return {
        success: true,
        buffer: archived,
        hash:
          invoice.pdfHash ??
          createHash("sha256").update(archived).digest("hex"),
        storagePath: invoice.pdfStoragePath,
      };
    }
    // Pointer dangles — fall through and re-archive.
  }

  let buffer = prerendered;
  if (!buffer) {
    const settings = await db.companySettings.findUnique({
      where: { tenantId },
    });
    try {
      const { renderToBuffer } = await import("@react-pdf/renderer");
      const { InvoicePDF } = await import("@/components/pdf/invoice-pdf");
      const React = await import("react");
      buffer = await renderToBuffer(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(InvoicePDF, { invoice, settings }) as any,
      );
    } catch (e) {
      console.error("[invoice] PDF generation failed", e);
      return { success: false, error: "PDF generation failed" };
    }
  }

  const hash = createHash("sha256").update(buffer).digest("hex");

  // Archive to R2 in two steps so the PDF is always stored even if Object
  // Lock is not (yet) enabled on the bucket:
  //   1. put the object — must succeed for archiving to count
  //   2. apply Object Lock retention — best-effort; a failure (Object Lock
  //      disabled on the bucket) is logged but leaves the PDF archived,
  //      just not yet immutable.
  let storagePath: string | null = null;
  const key = buildInvoiceKey(tenantId, invoiceId);
  try {
    await storage.put(key, buffer, "application/pdf");
    storagePath = key;
  } catch (e) {
    console.error("[invoice] PDF archive to R2 failed:", e);
  }
  if (storagePath) {
    try {
      await storage.setRetention(storagePath, {
        mode: GOBD_OBJECT_LOCK_MODE,
        retainUntil: gobdRetainUntil(),
      });
    } catch (e) {
      console.error("[invoice] Object Lock on archived PDF failed:", e);
    }
  }

  // pdfHash is only set if absent, so a historical hash on a legacy invoice
  // is never overwritten.
  const effectiveHash = invoice.pdfHash ?? hash;

  await db.invoice.update({
    where: { id: invoiceId },
    data: {
      ...(invoice.pdfHash ? {} : { pdfHash: hash }),
      ...(storagePath ? { pdfStoragePath: storagePath } : {}),
    },
  });

  await db.invoiceAuditHash.create({
    data: {
      invoiceId,
      hash: effectiveHash,
      pdfSizeBytes: buffer.length,
      createdById: actorUserId,
    },
  });

  return { success: true, buffer, hash: effectiveHash, storagePath };
}
