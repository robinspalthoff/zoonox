// Generate a single Invoice from a RecurringInvoice schedule.
//
// Used by:
//   - the worker process (apps/dashboard/scripts/worker.ts) on each cron tick
//   - the "Run now" server action (manual user trigger)
//
// Contract: this function does NOT take an outer claim. The caller must
// have already acquired the row (worker: via atomic update of
// processingStartedAt; server action: via tenant ownership check). After a
// successful generation it advances nextRunAt / lastRunAt / generatedCount
// and writes an audit log entry — all in one transaction.

import type { RecurringInvoice, RecurringInvoiceLineItem } from "@prisma/client";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { sendInvoiceEmailInternal } from "@/lib/invoice/send-email";
import { issueNumber } from "@/lib/number-ranges";
import { addInterval } from "./interval";

export interface GenerateResult {
  ok: true;
  invoiceId: string;
  invoiceNumber: string;
  /** Whether the schedule reached its endDate after this generation. */
  completed: boolean;
  /** Next scheduled issueDate after this run (null if completed). */
  nextRunAt: Date | null;
}

type RecurringWithLines = RecurringInvoice & { lineItems: RecurringInvoiceLineItem[] };

/**
 * Generate one Invoice from a schedule. Returns the result; on failure throws.
 *
 * Side effects, all in one transaction:
 *   - INSERT Invoice + InvoiceLineItem[] (status=DRAFT)
 *   - UPDATE RecurringInvoice (nextRunAt, lastRunAt, generatedCount,
 *     status=COMPLETED if endDate exceeded)
 *   - INSERT AuditLog
 *
 * Side effects AFTER the transaction (best-effort, can fail without rolling
 * back the invoice):
 *   - Post journal entries (only when autoSend triggers finalization)
 *
 * @param scheduleId — the RecurringInvoice id to generate from
 * @returns GenerateResult with the new invoice id + whether the series completed
 */
export async function generateOneRecurring(scheduleId: string): Promise<GenerateResult> {
  const schedule = await db.recurringInvoice.findUnique({
    where: { id: scheduleId },
    include: { lineItems: { orderBy: { position: "asc" } } },
  });
  if (!schedule) throw new Error(`Recurring schedule not found: ${scheduleId}`);
  if (schedule.status === "COMPLETED") {
    throw new Error(`Schedule already completed: ${scheduleId}`);
  }
  if (schedule.lineItems.length === 0) {
    throw new Error(`Schedule has no line items: ${scheduleId}`);
  }

  const issueDate = schedule.nextRunAt;
  const dueDate = schedule.paymentTermDays
    ? addDays(issueDate, schedule.paymentTermDays)
    : null;

  // Compute the *next* nextRunAt (after this generation completes).
  const candidateNext = addInterval(issueDate, schedule.interval);
  const reachedEnd = schedule.endDate ? candidateNext > schedule.endDate : false;
  const newStatus = reachedEnd ? "COMPLETED" : schedule.status;
  const newNextRunAt = reachedEnd ? issueDate : candidateNext; // keep last value, won't fire again

  // Calculate totals from template line items (same math as createInvoice).
  let subtotal = 0;
  let taxAmount = 0;
  const itemsToInsert = schedule.lineItems.map((li) => {
    const amount = Math.round(Number(li.quantity) * Number(li.unitPrice) * 100) / 100;
    const tax = Math.round(amount * (li.vatRate / 100) * 100) / 100;
    subtotal += amount;
    taxAmount += tax;
    return {
      position: li.position,
      description: li.description,
      quantity: li.quantity,
      unit: li.unit,
      unitPrice: li.unitPrice,
      vatRate: li.vatRate,
      amount,
    };
  });
  const total = Math.round((subtotal + taxAmount) * 100) / 100;

  const result = await db.$transaction(async (tx) => {
    const number = await issueNumber(tx, schedule.tenantId, "INVOICE", issueDate);

    const invoice = await tx.invoice.create({
      data: {
        tenantId: schedule.tenantId,
        number,
        contactId: schedule.contactId,
        issueDate,
        dueDate,
        notes: schedule.notes,
        introText: schedule.introText,
        vatRegulation: schedule.vatRegulation,
        leitwegId: schedule.leitwegId,
        buyerReference: schedule.buyerReference,
        recurringInvoiceId: schedule.id,
        createdById: schedule.createdById,
        subtotal,
        taxAmount,
        total,
        lineItems: { create: itemsToInsert },
      },
    });

    await tx.recurringInvoice.update({
      where: { id: schedule.id },
      data: {
        status: newStatus,
        nextRunAt: newNextRunAt,
        lastRunAt: new Date(),
        generatedCount: { increment: 1 },
        processingStartedAt: null,
        lastError: null,
      },
    });

    return { invoice, number };
  });

  await createAuditLog({
    action: "INVOICE_CREATED",
    tenantId: schedule.tenantId,
    userId: schedule.createdById ?? undefined,
    entityType: "Invoice",
    entityId: result.invoice.id,
    details: {
      number: result.number,
      total,
      source: "recurring",
      recurringInvoiceId: schedule.id,
    },
  });

  return {
    ok: true,
    invoiceId: result.invoice.id,
    invoiceNumber: result.number,
    completed: reachedEnd,
    nextRunAt: reachedEnd ? null : newNextRunAt,
  };
}

/**
 * Auto-finalize a generated invoice when the schedule had `autoSend = true`.
 * Delegates to `sendInvoiceEmailInternal` which handles PDF render, Brevo
 * delivery, XRechnung XML, status transition (DRAFT → SENT), audit hash,
 * audit log and journal posting — exactly the same effects as a user
 * clicking "Send" in the UI.
 *
 * @returns the underlying send result so the caller can surface errors
 *          (e.g. missing client email) to the user.
 */
export async function finalizeAutoSentInvoice(
  invoiceId: string,
  userId: string | null,
): Promise<{ success: true } | { success: false; error: string }> {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, tenantId: true, status: true },
  });
  if (!invoice) return { success: false, error: "Invoice not found." };
  if (invoice.status !== "DRAFT") return { success: true }; // already finalized — idempotent

  return sendInvoiceEmailInternal({
    invoiceId: invoice.id,
    tenantId: invoice.tenantId,
    actorUserId: userId,
    customMessage: null,
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}
