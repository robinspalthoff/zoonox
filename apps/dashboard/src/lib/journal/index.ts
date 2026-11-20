// Public façade for the journal subsystem.
// Action handlers should call these — they handle context loading and
// shadow-mode error swallowing.

import { db } from "@/lib/db";
import type { PaymentMethod } from "@prisma/client";
import type { PostingContext } from "./types";
import {
  buildInvoiceIssuedEntry,
  buildInvoicePaymentEntry,
  buildDocumentBookedEntry,
  buildDocumentPaymentEntry,
  buildBankPrivateMovementEntry,
  buildCashbookEntry,
} from "./posting-rules";
import { safelyPost, safelyReverse } from "./post";

export async function loadPostingContext(tenantId: string): Promise<PostingContext> {
  const settings = await db.companySettings.findUnique({ where: { tenantId } });
  return {
    tenantId,
    skrType: settings?.skrType ?? "SKR03",
    accountingMode: settings?.accountingMode ?? "DOUBLE_ENTRY",
    taxMode: settings?.taxMode ?? "STANDARD",
  };
}

// ── Invoice events ──────────────────────────────────────────────────────────

/**
 * Idempotency note: invoice issuance and payment are FINAL events
 * (GoBD: a finalized invoice is immutable, a payment that has cleared
 * doesn't cancel itself). The caller guards (status === DRAFT, !paidAt,
 * !finalizedAt) are correct *in spec*, but rely on the row state being
 * honest. Raw SQL, Prisma Studio or an early bug can leave the guard
 * false and cause a second posting — which the BWA then multiplies.
 *
 * We add a second line of defence here: before posting, look for an
 * existing POSTED entry of the same sourceType+sourceId. If one is
 * present, skip the post and log a warning. The existing entry is the
 * canonical truth; a duplicate would only inflate the books. This
 * mirrors the reverse-and-repost pattern already in place for
 * `recordDocumentBooked` and `recordBankPrivateMovement`, just with
 * skip-on-conflict semantics because invoices and payments are
 * immutable rather than re-editable.
 */
async function hasActivePostedEntry(
  tenantId: string,
  sourceType: "INVOICE" | "INVOICE_PAYMENT" | "DOCUMENT" | "DOCUMENT_PAYMENT",
  sourceId: string,
): Promise<boolean> {
  // "Active" means: status=POSTED, not itself a storno (reverses.none()),
  // and not reversed by a later storno (reversedById=null).
  //
  // The `reverses.none()` filter is critical: after a legitimate
  // `reverseInvoicePayment` (e.g. user reverted a wrong payment), the
  // original is REVERSED and its storno is POSTED. Without filtering
  // out stornos, a follow-up `recordInvoicePaid` for the corrected
  // payment would see "POSTED exists" and skip — silently dropping
  // the re-payment from the books. Filtering them out correctly
  // distinguishes "live canonical posting exists" from "balanced
  // reversal chain exists".
  const count = await db.journalEntry.count({
    where: {
      tenantId,
      sourceType,
      sourceId,
      status: "POSTED",
      reversedById: null,
      reverses: { none: {} },
    },
  });
  return count > 0;
}

export async function recordInvoiceIssued(
  tenantId: string,
  invoiceId: string,
  createdById: string | null,
) {
  if (await hasActivePostedEntry(tenantId, "INVOICE", invoiceId)) {
    console.warn(
      `[journal] recordInvoiceIssued skipped — existing POSTED entry found for invoice ${invoiceId}`,
    );
    return;
  }
  const ctx = await loadPostingContext(tenantId);
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { lineItems: true },
  });
  if (!invoice) return;
  await safelyPost(buildInvoiceIssuedEntry(invoice, ctx), ctx, createdById);
}

export async function recordInvoicePaid(
  tenantId: string,
  invoiceId: string,
  paidAt: Date,
  method: PaymentMethod,
  createdById: string | null,
) {
  if (await hasActivePostedEntry(tenantId, "INVOICE_PAYMENT", invoiceId)) {
    console.warn(
      `[journal] recordInvoicePaid skipped — existing POSTED entry found for invoice ${invoiceId}`,
    );
    return;
  }
  const ctx = await loadPostingContext(tenantId);
  const invoice = await db.invoice.findFirst({ where: { id: invoiceId, tenantId } });
  if (!invoice) return;
  await safelyPost(buildInvoicePaymentEntry(invoice, paidAt, method, ctx), ctx, createdById);
}

export async function reverseInvoicePayment(
  tenantId: string,
  invoiceId: string,
  createdById: string | null,
) {
  const ctx = await loadPostingContext(tenantId);
  await safelyReverse("INVOICE_PAYMENT", invoiceId, ctx, createdById, "Zahlung zurückgesetzt");
}

export async function reverseInvoiceIssued(
  tenantId: string,
  invoiceId: string,
  createdById: string | null,
) {
  const ctx = await loadPostingContext(tenantId);
  await safelyReverse("INVOICE", invoiceId, ctx, createdById, "Rechnung storniert");
}

// ── Document events ─────────────────────────────────────────────────────────

export async function recordDocumentBooked(
  tenantId: string,
  documentId: string,
  createdById: string | null,
) {
  const ctx = await loadPostingContext(tenantId);
  const doc = await db.document.findFirst({
    where: { id: documentId, tenantId },
    include: { lineItems: true, fixedAsset: { select: { id: true } } },
  });
  if (!doc) return;
  // First reverse any prior posting for this document (re-save case),
  // then post the current state.
  await safelyReverse("DOCUMENT", documentId, ctx, createdById, "Beleg-Neufassung");
  // If the document is linked to a fixed asset, the acquisition is already
  // booked through the FIXED_ASSET_ACQUISITION journal entry — the regular
  // expense booking would double-count and would also book the gross to an
  // expense account instead of activating the asset. Skip it.
  if (doc.fixedAsset) return;
  await safelyPost(buildDocumentBookedEntry(doc, ctx), ctx, createdById);
}

export async function recordDocumentPaid(
  tenantId: string,
  documentId: string,
  paidAt: Date,
  method: PaymentMethod,
  createdById: string | null,
) {
  // Same idempotency guard as the invoice payment path — see comment
  // on `hasPostedEntry` above. A second call with the same documentId
  // would otherwise add another payment line and inflate the books.
  if (await hasActivePostedEntry(tenantId, "DOCUMENT_PAYMENT", documentId)) {
    console.warn(
      `[journal] recordDocumentPaid skipped — existing POSTED entry found for document ${documentId}`,
    );
    return;
  }
  const ctx = await loadPostingContext(tenantId);
  const doc = await db.document.findFirst({ where: { id: documentId, tenantId } });
  if (!doc) return;
  await safelyPost(buildDocumentPaymentEntry(doc, paidAt, method, ctx), ctx, createdById);
}

export async function reverseDocumentPayment(
  tenantId: string,
  documentId: string,
  createdById: string | null,
) {
  const ctx = await loadPostingContext(tenantId);
  await safelyReverse("DOCUMENT_PAYMENT", documentId, ctx, createdById, "Zahlung zurückgesetzt");
}

export async function reverseDocumentBooked(
  tenantId: string,
  documentId: string,
  createdById: string | null,
) {
  const ctx = await loadPostingContext(tenantId);
  await safelyReverse("DOCUMENT", documentId, ctx, createdById, "Beleg gelöscht");
}

// ── Bank events ─────────────────────────────────────────────────────────────
//
// `recordBankPrivateMovement` is idempotent: it reverses any previous posting
// for the same bank-transaction id and reposts the current state. That lets
// callers blindly call it on create, on isPrivate-toggle, on amount-flip,
// etc., without having to track "did we already post this one?".
//
// Non-private bank transactions don't get a dedicated journal entry — they
// hit the books exclusively via the invoice/document payment flow when the
// user matches them.

export async function recordBankPrivateMovement(
  tenantId: string,
  transactionId: string,
  createdById: string | null,
) {
  const ctx = await loadPostingContext(tenantId);
  const tx = await db.bankTransaction.findFirst({
    where: { id: transactionId, tenantId },
  });
  if (!tx) return;
  await safelyReverse("BANK_TRANSACTION", transactionId, ctx, createdById, "Bank-Bewegung Neufassung");
  if (tx.isPrivate) {
    await safelyPost(buildBankPrivateMovementEntry(tx, ctx), ctx, createdById);
  }
}

export async function reverseBankPrivateMovement(
  tenantId: string,
  transactionId: string,
  createdById: string | null,
) {
  const ctx = await loadPostingContext(tenantId);
  await safelyReverse("BANK_TRANSACTION", transactionId, ctx, createdById, "Bank-Bewegung gelöscht");
}

// ── Cashbook events ─────────────────────────────────────────────────────────
//
// Each cashbook entry is journalled against the cash account on save and
// reversed on delete. Re-save reverses + reposts so descriptions, categories,
// and dates stay in sync between the two stores.

export async function recordCashbookEntry(
  tenantId: string,
  entryId: string,
  createdById: string | null,
) {
  const ctx = await loadPostingContext(tenantId);
  const entry = await db.cashbookEntry.findFirst({
    where: { id: entryId, tenantId },
  });
  if (!entry) return;
  await safelyReverse("MANUAL", entryId, ctx, createdById, "Kassenbuch Neufassung");
  await safelyPost(buildCashbookEntry(entry, ctx), ctx, createdById);
}

export async function reverseCashbookEntry(
  tenantId: string,
  entryId: string,
  createdById: string | null,
) {
  const ctx = await loadPostingContext(tenantId);
  await safelyReverse("MANUAL", entryId, ctx, createdById, "Kassenbuch-Eintrag gelöscht");
}
