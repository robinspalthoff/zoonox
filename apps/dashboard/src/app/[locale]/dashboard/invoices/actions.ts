"use server";

import { db } from "@/lib/db";
import { requireTenant } from "@/lib/require-tenant";
import { createAuditLog } from "@/lib/audit";
import {
  recordInvoiceIssued,
  recordInvoicePaid,
  reverseInvoicePayment,
} from "@/lib/journal";
import { sendInvoiceEmailInternal } from "@/lib/invoice/send-email";
import { archiveInvoicePdf } from "@/lib/invoice/archive-pdf";
import { issueNumber } from "@/lib/number-ranges";
import { computeDocumentTotals, type DiscountType } from "@/lib/invoice/discount";
import { revalidatePath } from "next/cache";
import type { InvoiceStatus, PaymentMethod } from "@prisma/client";
import { TransactionStatus } from "@prisma/client";

export type InvoiceResult =
  | { success: true; id: string }
  | { success: false; error: string };

export interface LineItemInput {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  vatRate: number;
  /** Netto nach Positions-Rabatt. Wenn gesetzt, Source of Truth; sonst aus qty × unitPrice gerechnet. */
  amount?: number;
  /** Positions-Rabatt-Typ. */
  discountType?: DiscountType;
  discountValue?: number | null;
}

export interface GlobalDiscountInput {
  type: DiscountType;
  value: number | null;
}

export async function deleteDraftInvoice(id: string): Promise<{ success: boolean; error?: string }> {
  const t = await requireTenant();

  const invoice = await db.invoice.findFirst({
    where: { id, tenantId: t.tenantId },
    select: { status: true },
  });
  if (!invoice) return { success: false, error: "Invoice not found." };
  if (invoice.status !== "DRAFT") {
    return { success: false, error: "Only DRAFT invoices can be deleted." };
  }

  // GoBD defence: DRAFTs should never have journal entries — the
  // ledger is only written when the invoice transitions to SENT/PAID
  // (see updateInvoiceStatus). If any entry exists pointing at this
  // ID we refuse the delete instead of leaving orphans behind. This
  // is the path that historically produced phantom rows in the BWA;
  // see lib/journal/orphan-guard for the read-side defence and
  // scripts/cleanup-orphan-journal-entries.ts for the recovery tool.
  const ghostJournalCount = await db.journalEntry.count({
    where: {
      tenantId: t.tenantId,
      sourceType: { in: ["INVOICE", "INVOICE_PAYMENT"] },
      sourceId: id,
    },
  });
  if (ghostJournalCount > 0) {
    return {
      success: false,
      error:
        "Diese Rechnung hat bereits Journal-Einträge und kann nicht als Entwurf gelöscht werden. " +
        "Bitte den Status zunächst per Storno zurückführen.",
    };
  }

  await db.invoice.delete({ where: { id } });

  await createAuditLog({
    action: "INVOICE_CANCELLED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Invoice",
    entityId: id,
    details: { reason: "draft_deleted" },
  });

  revalidatePath("/dashboard/invoices");
  return { success: true };
}

export async function createInvoice(
  contactId: string,
  issueDate: string,
  dueDate: string | null,
  serviceDate: string | null,
  serviceDateEnd: string | null,
  notes: string,
  items: LineItemInput[],
  leitwegId?: string | null,
  buyerReference?: string | null,
  introText?: string | null,
  vatRegulation?: string | null,
  paymentQrEnabled: boolean = true,
  sourceQuoteId?: string | null,
  sourceOrderConfirmationId?: string | null,
  globalDiscount?: GlobalDiscountInput | null,
): Promise<InvoiceResult> {
  const t = await requireTenant();

  if (!contactId) return { success: false, error: "Client is required." };
  if (items.length === 0) return { success: false, error: "At least one line item is required." };

  // Verify client belongs to this tenant
  const client = await db.contact.findFirst({
    where: { id: contactId, tenantId: t.tenantId },
    select: { id: true },
  });
  if (!client) return { success: false, error: "Client not found." };

  const lineItems = items.map((item, i) => {
    const amount = item.amount !== undefined
      ? Math.round(item.amount * 100) / 100
      : Math.round(item.quantity * item.unitPrice * 100) / 100;
    return {
      position: i + 1,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit ?? null,
      unitPrice: item.unitPrice,
      vatRate: item.vatRate,
      discountType: item.discountType ?? null,
      discountValue: item.discountValue ?? null,
      amount,
    };
  });
  const totals = computeDocumentTotals(
    lineItems.map((li) => ({ amount: li.amount, vatRate: li.vatRate })),
    globalDiscount?.type ?? null,
    globalDiscount?.value ?? null,
  );
  const { subtotal, taxAmount, total } = totals;

  // Verify the source quote / AB belongs to this tenant before linking. The
  // FK is set later inside the create transaction; pulling these reads up
  // front keeps the tx body tight and lets us short-circuit on bad input.
  let verifiedQuoteId: string | null = null;
  let verifiedOcId: string | null = null;
  if (sourceQuoteId) {
    const q = await db.quote.findFirst({
      where: { id: sourceQuoteId, tenantId: t.tenantId },
      select: { id: true },
    });
    if (q) verifiedQuoteId = q.id;
  }
  if (sourceOrderConfirmationId) {
    const o = await db.orderConfirmation.findFirst({
      where: { id: sourceOrderConfirmationId, tenantId: t.tenantId },
      select: { id: true },
    });
    if (o) verifiedOcId = o.id;
  }

  // Number issue + invoice insert share a transaction so the counter never
  // hands out the same number twice under concurrent creates. The source
  // documents (Quote / AB) are also updated here so the conversion is
  // atomic — either everything lands or nothing does.
  const invoice = await db.$transaction(async (tx) => {
    const number = await issueNumber(tx, t.tenantId, "INVOICE", new Date(issueDate));
    const created = await tx.invoice.create({
      data: {
        tenantId: t.tenantId,
        number,
        contactId,
        issueDate: new Date(issueDate),
        dueDate: dueDate ? new Date(dueDate) : null,
        serviceDate: serviceDate ? new Date(serviceDate) : null,
        serviceDateEnd: serviceDateEnd ? new Date(serviceDateEnd) : null,
        notes: notes || null,
        introText: introText?.trim() || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vatRegulation: (vatRegulation as any) ?? "STANDARD",
        paymentQrEnabled,
        subtotal,
        taxAmount,
        total,
        globalDiscountType: globalDiscount?.type ?? null,
        globalDiscountValue: globalDiscount?.value ?? null,
        createdById: t.userId,
        leitwegId: leitwegId?.trim() || null,
        buyerReference: buyerReference?.trim() || null,
        quoteId: verifiedQuoteId,
        orderConfirmationId: verifiedOcId,
        lineItems: { create: lineItems },
      },
    });

    // Flip the source documents to their "successful" state. We only touch
    // them if the link landed (verifiedQuoteId / verifiedOcId set). Status
    // transitions follow the model agreed with the user:
    //   • Quote      → status ACCEPTED + convertedAt = now()
    //   • OC         → status INVOICED
    if (verifiedQuoteId) {
      await tx.quote.update({
        where: { id: verifiedQuoteId },
        data: { status: "ACCEPTED", convertedAt: new Date() },
      });
    }
    if (verifiedOcId) {
      await tx.orderConfirmation.update({
        where: { id: verifiedOcId },
        data: { status: "INVOICED" },
      });
    }

    return created;
  });

  await createAuditLog({
    action: "INVOICE_CREATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Invoice",
    entityId: invoice.id,
    details: { number: invoice.number, total, fromQuoteId: verifiedQuoteId, fromOrderConfirmationId: verifiedOcId },
  });

  // Conversion audit trail — separate entries on the source documents so
  // the audit log of a Quote / AB independently shows the conversion.
  if (verifiedQuoteId) {
    await createAuditLog({
      action: "QUOTE_CONVERTED",
      tenantId: t.tenantId,
      userId: t.userId,
      entityType: "Quote",
      entityId: verifiedQuoteId,
      details: { target: "INVOICE", targetId: invoice.id, targetNumber: invoice.number },
    });
  }
  if (verifiedOcId) {
    await createAuditLog({
      action: "ORDER_CONFIRMATION_INVOICED",
      tenantId: t.tenantId,
      userId: t.userId,
      entityType: "OrderConfirmation",
      entityId: verifiedOcId,
      details: { invoiceId: invoice.id, invoiceNumber: invoice.number },
    });
  }

  revalidatePath("/dashboard/invoices");
  if (verifiedQuoteId) revalidatePath(`/dashboard/quotes/${verifiedQuoteId}`);
  if (verifiedOcId) revalidatePath(`/dashboard/order-confirmations/${verifiedOcId}`);
  return { success: true, id: invoice.id };
}

// ─── Update a DRAFT invoice ─────────────────────────────────────────────────
//
// Same shape as `createInvoice` but updates an existing record. Only allowed
// while the invoice is in DRAFT status — once finalized (SENT/PAID/etc.) the
// invoice is GoBD-immutable and the caller must create a credit note instead.
//
// Recomputes subtotal/taxAmount/total from the new line items just like
// createInvoice. The invoice `number` and `createdAt` are NOT touched so the
// audit trail stays intact.
export async function updateDraftInvoice(
  id: string,
  contactId: string,
  issueDate: string,
  dueDate: string | null,
  serviceDate: string | null,
  serviceDateEnd: string | null,
  notes: string,
  items: LineItemInput[],
  leitwegId?: string | null,
  buyerReference?: string | null,
  introText?: string | null,
  vatRegulation?: string | null,
  paymentQrEnabled: boolean = true,
  globalDiscount?: GlobalDiscountInput | null,
): Promise<InvoiceResult> {
  const t = await requireTenant();

  if (!contactId) return { success: false, error: "Client is required." };
  if (items.length === 0) return { success: false, error: "At least one line item is required." };

  const existing = await db.invoice.findFirst({
    where: { id, tenantId: t.tenantId },
    select: { id: true, status: true, number: true },
  });
  if (!existing) return { success: false, error: "Invoice not found." };
  if (existing.status !== "DRAFT") {
    return {
      success: false,
      error: "Only DRAFT invoices can be edited — finalized invoices need a credit note.",
    };
  }

  const client = await db.contact.findFirst({
    where: { id: contactId, tenantId: t.tenantId },
    select: { id: true },
  });
  if (!client) return { success: false, error: "Client not found." };

  const lineItems = items.map((item, i) => {
    const amount = item.amount !== undefined
      ? Math.round(item.amount * 100) / 100
      : Math.round(item.quantity * item.unitPrice * 100) / 100;
    return {
      position: i + 1,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit ?? null,
      unitPrice: item.unitPrice,
      vatRate: item.vatRate,
      discountType: item.discountType ?? null,
      discountValue: item.discountValue ?? null,
      amount,
    };
  });
  const totals = computeDocumentTotals(
    lineItems.map((li) => ({ amount: li.amount, vatRate: li.vatRate })),
    globalDiscount?.type ?? null,
    globalDiscount?.value ?? null,
  );
  const { subtotal, taxAmount, total } = totals;

  // Atomic re-write: delete existing line items + create new ones in one tx
  // so the invoice never has a partial state visible to readers.
  await db.$transaction([
    db.invoiceLineItem.deleteMany({ where: { invoiceId: id } }),
    db.invoice.update({
      where: { id },
      data: {
        contactId,
        issueDate: new Date(issueDate),
        dueDate: dueDate ? new Date(dueDate) : null,
        serviceDate: serviceDate ? new Date(serviceDate) : null,
        serviceDateEnd: serviceDateEnd ? new Date(serviceDateEnd) : null,
        notes: notes || null,
        introText: introText?.trim() || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vatRegulation: (vatRegulation as any) ?? "STANDARD",
        paymentQrEnabled,
        leitwegId: leitwegId?.trim() || null,
        buyerReference: buyerReference?.trim() || null,
        subtotal,
        taxAmount,
        total,
        globalDiscountType: globalDiscount?.type ?? null,
        globalDiscountValue: globalDiscount?.value ?? null,
        lineItems: { create: lineItems },
      },
    }),
  ]);

  await createAuditLog({
    action: "INVOICE_UPDATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Invoice",
    entityId: id,
    details: { number: existing.number, total },
  });

  revalidatePath("/dashboard/invoices");
  revalidatePath(`/dashboard/invoices/${id}`);
  return { success: true, id };
}

// Toggle the EPC payment QR-Code on/off for an invoice. The QR-Code is baked
// into the PDF, so this only has an effect while the invoice is a DRAFT —
// once finalized the PDF is GoBD-immutable and the toggle is rejected.
export async function setInvoicePaymentQr(
  id: string,
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  const t = await requireTenant();

  const invoice = await db.invoice.findFirst({
    where: { id, tenantId: t.tenantId },
    select: { status: true },
  });
  if (!invoice) return { success: false, error: "Invoice not found." };
  if (invoice.status !== "DRAFT") {
    return {
      success: false,
      error: "The payment QR-Code can only be changed while the invoice is a draft.",
    };
  }

  await db.invoice.update({ where: { id }, data: { paymentQrEnabled: enabled } });

  revalidatePath("/dashboard/invoices");
  revalidatePath(`/dashboard/invoices/${id}`);
  return { success: true };
}

export async function updateInvoiceStatus(id: string, status: InvoiceStatus): Promise<{ success: boolean; error?: string }> {
  const t = await requireTenant();

  const current = await db.invoice.findFirst({
    where: { id, tenantId: t.tenantId },
    select: { status: true },
  });
  if (!current) return { success: false, error: "Invoice not found." };

  const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
    DRAFT:     ["SENT", "CANCELLED"],
    SENT:      ["PAID"],
    PAID:      [],
    OVERDUE:   ["PAID"],
    CANCELLED: [],
  };

  if (!ALLOWED_TRANSITIONS[current.status].includes(status)) {
    return {
      success: false,
      error: `Transition from ${current.status} to ${status} is not permitted (GoBD).`,
    };
  }

  const now = new Date();
  const isFirstFinalization = current.status === "DRAFT" && (status === "SENT" || status === "PAID");

  await db.invoice.update({
    where: { id },
    data: {
      status,
      ...(isFirstFinalization ? { finalizedAt: now } : {}),
      ...(status === "PAID" ? { paidAt: now } : {}),
    },
  });

  const actionMap: Record<string, "INVOICE_SENT" | "INVOICE_PAID" | "INVOICE_CANCELLED" | "INVOICE_UPDATED" | "INVOICE_FINALIZED"> = {
    SENT: "INVOICE_SENT",
    PAID: "INVOICE_PAID",
    CANCELLED: "INVOICE_CANCELLED",
  };

  await createAuditLog({
    action: actionMap[status] ?? "INVOICE_UPDATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Invoice",
    entityId: id,
    details: { status, ...(isFirstFinalization ? { finalizedAt: now.toISOString() } : {}) },
  });

  if (isFirstFinalization) {
    await recordInvoiceIssued(t.tenantId, id, t.userId);
    // "Mark as sent" finalizes the invoice without an email — render and
    // archive the PDF here so it gets the same immutable, Object-Lock-
    // protected GoBD artifact (+ pdfHash, InvoiceAuditHash) as an email send.
    const archive = await archiveInvoicePdf(id, t.tenantId, t.userId);
    if (!archive.success) {
      console.error(`[invoice] archive on status change failed: ${archive.error}`);
    }
  }
  if (status === "PAID") {
    await recordInvoicePaid(t.tenantId, id, now, "BANK_TRANSFER", t.userId);
  }

  revalidatePath("/dashboard/invoices");
  revalidatePath(`/dashboard/invoices/${id}`);
  return { success: true };
}

export async function sendInvoiceEmail(
  invoiceId: string,
  customMessage: string | null,
  sendCopyToSelf: boolean = false,
): Promise<{ success: boolean; error?: string }> {
  const t = await requireTenant();
  const result = await sendInvoiceEmailInternal({
    invoiceId,
    tenantId: t.tenantId,
    actorUserId: t.userId,
    customMessage,
    sendCopyToSelf,
  });
  if (!result.success) return result;
  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  return { success: true };
}

export async function createCreditNote(
  invoiceId: string,
  options?: { markAsRefunded?: boolean }
): Promise<InvoiceResult> {
  const t = await requireTenant();

  const original = await db.invoice.findFirst({
    where: { id: invoiceId, tenantId: t.tenantId },
    include: { lineItems: true },
  });
  if (!original) return { success: false, error: "Invoice not found." };

  if (
    original.status !== "SENT" &&
    original.status !== "OVERDUE" &&
    original.status !== "PAID"
  ) {
    return {
      success: false,
      error: "A credit note can only be created for a finalized (SENT/OVERDUE/PAID) invoice.",
    };
  }

  const existingCreditNote = await db.invoice.findFirst({
    where: { tenantId: t.tenantId, creditNoteForId: invoiceId },
  });
  if (existingCreditNote) {
    return {
      success: false,
      error: `A credit note already exists for this invoice (${existingCreditNote.number}).`,
    };
  }

  const subtotal = -Math.abs(Number(original.subtotal));
  const taxAmount = -Math.abs(Number(original.taxAmount));
  const total = -Math.abs(Number(original.total));
  const now = new Date();
  const originalWasPaid = original.status === "PAID";
  // `refunded` = real money was paid back to the customer. Only possible if
  // the customer actually paid in the first place.
  const refunded = originalWasPaid && (options?.markAsRefunded ?? false);
  // The credit note is created in a finalized, closed state (status PAID) in
  // two cases:
  //   • Storno of an UNPAID invoice — there is nothing to settle, the
  //     document is complete the moment it is issued (no lingering draft,
  //     no manual "send" step). It is revenue-neutral: see the dashboard,
  //     which only offsets a credit note when its original was itself PAID.
  //   • A Gutschrift for a paid invoice whose refund has been paid out.
  // A Gutschrift for a paid-but-not-yet-refunded invoice stays DRAFT until
  // the user actually issues the refund.
  const closed = !originalWasPaid || refunded;
  // A storno of an unpaid invoice is a "Stornorechnung"; a credit note that
  // refunds an already-paid invoice is a "Gutschrift" — distinct documents
  // in German invoicing practice.
  const docLabel = originalWasPaid ? "Gutschrift" : "Stornorechnung";

  const creditNote = await db.$transaction(async (tx) => {
    // An unpaid invoice is cancelled outright — it produced no revenue and
    // never will. A PAID invoice stays PAID: the payment genuinely happened
    // and must remain on the books; the credit note is a separate
    // corrective document linked back via creditNoteForId. Flipping a paid
    // invoice to CANCELLED would silently erase its booked revenue.
    if (!originalWasPaid) {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: "CANCELLED" },
      });
    }

    // Atomic counter advance — same transaction as the insert below.
    const creditNumber = await issueNumber(tx, t.tenantId, "CREDIT_NOTE", now);

    return tx.invoice.create({
      data: {
        tenantId: t.tenantId,
        number: creditNumber,
        type: "CREDIT_NOTE",
        status: closed ? "PAID" : "DRAFT",
        contactId: original.contactId,
        issueDate: now,
        dueDate: null,
        serviceDate: original.serviceDate,
        serviceDateEnd: original.serviceDateEnd,
        subtotal,
        taxAmount,
        total,
        notes: `${docLabel} zu Rechnung ${original.number}`,
        createdById: t.userId,
        creditNoteForId: invoiceId,
        ...(closed ? { finalizedAt: now, paidAt: now } : {}),
        // Gesamtrabatt der Originalrechnung gespiegelt — auf der Gutschrift
        // wirkt er negativ, da subtotal/total bereits negativ sind und die
        // Anzeige aus globalDiscountType/Value rekonstruiert wird.
        globalDiscountType: original.globalDiscountType,
        globalDiscountValue: original.globalDiscountValue,
        lineItems: {
          create: original.lineItems.map((item) => ({
            position: item.position,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            vatRate: item.vatRate,
            discountType: item.discountType,
            discountValue: item.discountValue,
            amount: -Math.abs(Number(item.amount)),
          })),
        },
      },
    });
  });

  // The original is only logged as cancelled when it actually was. A PAID
  // invoice keeps its status — its correction is recorded on the credit note.
  if (!originalWasPaid) {
    await createAuditLog({
      action: "INVOICE_CANCELLED",
      tenantId: t.tenantId,
      userId: t.userId,
      entityType: "Invoice",
      entityId: invoiceId,
      details: { reason: "credit_note", creditNoteId: creditNote.id, creditNoteNumber: creditNote.number },
    });
  }

  await createAuditLog({
    action: "INVOICE_CREDIT_NOTE_CREATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Invoice",
    entityId: creditNote.id,
    details: { originalInvoiceId: invoiceId, originalNumber: original.number, number: creditNote.number },
  });

  // ── Journal ───────────────────────────────────────────────────────────
  // A credit note created in a closed state skips the normal finalize flow
  // (updateInvoiceStatus / send-email), so its journal entries are posted
  // here — exactly as that flow would:
  //   • recordInvoiceIssued books the revenue reversal. The credit note's
  //     amounts are negative, so it nets the original invoice's revenue
  //     entry — making the storno revenue-neutral in the journal too.
  //   • recordInvoicePaid is posted ONLY when real money was refunded. A
  //     storno of an unpaid invoice carries status PAID as a lifecycle
  //     marker, but no cash moved — so it gets NO payment entry.
  // A non-closed (DRAFT) Gutschrift is journalled later, when the user
  // finalizes it through the normal flow.
  if (closed) {
    await recordInvoiceIssued(t.tenantId, creditNote.id, t.userId);
    if (refunded) {
      await recordInvoicePaid(t.tenantId, creditNote.id, now, "BANK_TRANSFER", t.userId);
    }
    // The credit note is finalized — archive its PDF (Object-Lock-protected).
    const archive = await archiveInvoicePdf(creditNote.id, t.tenantId, t.userId);
    if (!archive.success) {
      console.error(`[invoice] credit-note archive failed: ${archive.error}`);
    }
  }

  revalidatePath("/dashboard/invoices");
  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  return { success: true, id: creditNote.id };
}

// ─── Rechnungskorrektur ──────────────────────────────────────────────────────
//
// The correction is a standalone document that supersedes the original
// invoice: it lists the corrected line items as positives and carries the
// full corrected total, exactly like a regular invoice — only a reference
// line ("Korrigiert Rechnung X vom Y") and a separate number scheme set it
// apart. The original keeps its own status for the audit trail; the dashboard
// stops counting it as revenue once a finalised correction exists so the
// numbers don't double-count.
//
// Number scheme: `<original-number>-<suffix>` (e.g. RE-2026-005-1, -2, …).
// This keeps the correction visually tied to its origin and avoids inflating
// a separate sequence. Mehrere Korrekturen pro Original sind erlaubt — der
// Suffix wird hochgezählt.
//
// VAT regulation + per-line VAT rates are inherited from the original and
// not editable in the form — corrections never change the tax treatment of
// the underlying transaction.

export interface CorrectionInput {
  originalInvoiceId: string;
  issueDate: string;
  notes: string;
  introText?: string | null;
  lineItems: LineItemInput[];
}

export async function createInvoiceCorrection(
  input: CorrectionInput,
): Promise<InvoiceResult> {
  const t = await requireTenant();

  if (input.lineItems.length === 0) {
    return { success: false, error: "Mindestens eine korrigierte Position erforderlich." };
  }

  const original = await db.invoice.findFirst({
    where: { id: input.originalInvoiceId, tenantId: t.tenantId },
    include: { lineItems: { orderBy: { position: "asc" } } },
  });
  if (!original) return { success: false, error: "Invoice not found." };
  if (original.type !== "INVOICE") {
    return {
      success: false,
      error: "Nur Rechnungen können korrigiert werden — Gutschriften und Korrekturen nicht.",
    };
  }
  if (
    original.status !== "SENT" &&
    original.status !== "OVERDUE" &&
    original.status !== "PAID"
  ) {
    return {
      success: false,
      error: "Nur finalisierte Rechnungen können korrigiert werden — Entwürfe lassen sich direkt bearbeiten.",
    };
  }

  // ── VAT rates are locked to the original. Build a per-position map and a
  //    fallback rate for newly added items (the first original line's rate).
  const originalRateByPosition = new Map<number, number>();
  original.lineItems.forEach((li, i) => {
    originalRateByPosition.set(i, li.vatRate);
  });
  const inheritedRate = original.lineItems[0]?.vatRate ?? 19;

  // ── Compute the corrected line items + totals. Pure positives — the
  //    document reads exactly like an invoice with the *correct* values.
  let subtotal = 0;
  let taxAmount = 0;
  const lineItems = input.lineItems.map((item, i) => {
    const amount =
      item.amount !== undefined
        ? Math.round(item.amount * 100) / 100
        : Math.round(item.quantity * item.unitPrice * 100) / 100;
    // Force the VAT rate to the original's rate at this position; new
    // positions inherit the first original's rate. Never trust the client.
    const vatRate = originalRateByPosition.get(i) ?? inheritedRate;
    const tax = Math.round(amount * (vatRate / 100) * 100) / 100;
    subtotal += amount;
    taxAmount += tax;
    return {
      position: i + 1,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit ?? null,
      unitPrice: item.unitPrice,
      vatRate,
      discountType: item.discountType ?? null,
      discountValue: item.discountValue ?? null,
      amount,
    };
  });

  subtotal = Math.round(subtotal * 100) / 100;
  taxAmount = Math.round(taxAmount * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;

  const correction = await db.$transaction(async (tx) => {
    // Number scheme: `<original>-<suffix>`. Suffix = highest existing + 1
    // among this original's corrections so concurrent creates stay
    // disambiguated. (DB-level uniqueness on (tenantId, number) would be
    // even stronger — for now the read+create runs inside one transaction.)
    const existingCorrections = await tx.invoice.findMany({
      where: {
        tenantId: t.tenantId,
        type: "CORRECTION",
        creditNoteForId: input.originalInvoiceId,
      },
      select: { number: true },
    });
    let maxSuffix = 0;
    for (const ex of existingCorrections) {
      const m = ex.number.match(/-(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > maxSuffix) maxSuffix = n;
      }
    }
    const correctionNumber = `${original.number}-${maxSuffix + 1}`;

    return tx.invoice.create({
      data: {
        tenantId: t.tenantId,
        number: correctionNumber,
        type: "CORRECTION",
        status: "DRAFT",
        contactId: original.contactId,
        issueDate: new Date(input.issueDate),
        dueDate: null,
        serviceDate: original.serviceDate,
        serviceDateEnd: original.serviceDateEnd,
        subtotal,
        taxAmount,
        total,
        notes:
          input.notes?.trim() ||
          `Korrektur zu Rechnung ${original.number}`,
        introText: input.introText?.trim() || null,
        // VAT regulation copied verbatim — never altered by a correction.
        vatRegulation: original.vatRegulation,
        // Corrections inherit the original's QR setting (defaults to true so
        // payable corrections show the GiroCode like any other invoice).
        paymentQrEnabled: original.paymentQrEnabled,
        createdById: t.userId,
        creditNoteForId: input.originalInvoiceId,
        lineItems: { create: lineItems },
      },
    });
  });

  await createAuditLog({
    action: "INVOICE_CREDIT_NOTE_CREATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Invoice",
    entityId: correction.id,
    details: {
      kind: "correction",
      originalInvoiceId: input.originalInvoiceId,
      originalNumber: original.number,
      number: correction.number,
      delta: total,
    },
  });

  revalidatePath("/dashboard/invoices");
  revalidatePath(`/dashboard/invoices/${input.originalInvoiceId}`);
  return { success: true, id: correction.id };
}

export async function markInvoiceAsPaid(
  invoiceId: string,
  data: {
    paidAt: string;
    method: PaymentMethod;
    bankTransactionId?: string | null;
  },
): Promise<{ success: boolean; error?: string }> {
  const t = await requireTenant();

  const current = await db.invoice.findFirst({
    where: { id: invoiceId, tenantId: t.tenantId },
    select: { status: true },
  });
  if (!current) return { success: false, error: "Invoice not found." };
  if (current.status !== "SENT" && current.status !== "OVERDUE") {
    return {
      success: false,
      error: `Only SENT or OVERDUE invoices can be marked as paid (currently ${current.status}).`,
    };
  }

  const paidAt = new Date(data.paidAt);
  if (isNaN(paidAt.getTime())) return { success: false, error: "Invalid payment date." };

  await db.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        status: "PAID",
        paidAt,
        paymentMethod: data.method,
      },
    });

    if (data.bankTransactionId) {
      // Verify the bank tx belongs to this tenant before linking
      await tx.bankTransaction.updateMany({
        where: { id: data.bankTransactionId, tenantId: t.tenantId },
        data: {
          invoiceId,
          documentId: null,
          status: TransactionStatus.MATCHED,
        },
      });
    }
  });

  await createAuditLog({
    action: "INVOICE_PAID",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Invoice",
    entityId: invoiceId,
    details: {
      paidAt: paidAt.toISOString(),
      method: data.method,
      bankTransactionId: data.bankTransactionId ?? null,
    },
  });

  await recordInvoicePaid(t.tenantId, invoiceId, paidAt, data.method, t.userId);

  revalidatePath("/dashboard/invoices");
  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  revalidatePath("/dashboard/bank");
  return { success: true };
}

export async function revertInvoicePayment(
  invoiceId: string,
): Promise<{ success: boolean; error?: string }> {
  const t = await requireTenant();

  const current = await db.invoice.findFirst({
    where: { id: invoiceId, tenantId: t.tenantId },
    select: { status: true, paidAt: true, paymentMethod: true },
  });
  if (!current) return { success: false, error: "Invoice not found." };
  if (current.status !== "PAID") {
    return { success: false, error: "Only PAID invoices can be reverted." };
  }

  await db.$transaction(async (tx) => {
    await tx.bankTransaction.updateMany({
      where: { tenantId: t.tenantId, invoiceId },
      data: {
        invoiceId: null,
        status: TransactionStatus.UNMATCHED,
      },
    });

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        status: "SENT",
        paidAt: null,
        paymentMethod: null,
      },
    });
  });

  await createAuditLog({
    action: "INVOICE_PAYMENT_REVERTED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Invoice",
    entityId: invoiceId,
    details: {
      previousPaidAt: current.paidAt?.toISOString() ?? null,
      previousMethod: current.paymentMethod,
    },
  });

  await reverseInvoicePayment(t.tenantId, invoiceId, t.userId);

  revalidatePath("/dashboard/invoices");
  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  revalidatePath("/dashboard/bank");
  return { success: true };
}

export async function listUnmatchedBankTransactionsForInvoice(
  invoiceId: string,
): Promise<
  Array<{
    id: string;
    date: string;
    amount: number;
    counterpartName: string | null;
    purpose: string | null;
    accountName: string;
    exactMatch: boolean;
  }>
> {
  const t = await requireTenant();

  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, tenantId: t.tenantId },
    select: { total: true },
  });
  if (!invoice) return [];
  const target = Number(invoice.total);

  const txs = await db.bankTransaction.findMany({
    where: {
      tenantId: t.tenantId,
      status: TransactionStatus.UNMATCHED,
      amount: { gt: 0 },
      isPrivate: false,
    },
    select: {
      id: true,
      date: true,
      amount: true,
      counterpartName: true,
      purpose: true,
      bankAccount: { select: { name: true } },
    },
    orderBy: { date: "desc" },
    take: 50,
  });

  return txs.map((tx) => {
    const amt = Number(tx.amount);
    return {
      id: tx.id,
      date: tx.date.toISOString(),
      amount: amt,
      counterpartName: tx.counterpartName,
      purpose: tx.purpose,
      accountName: tx.bankAccount.name,
      exactMatch: Math.abs(amt - target) < 0.01,
    };
  });
}
