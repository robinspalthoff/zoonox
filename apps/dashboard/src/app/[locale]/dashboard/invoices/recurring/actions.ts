"use server";

import { revalidatePath } from "next/cache";
import type { RecurringInterval, VatRegulation } from "@prisma/client";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/require-tenant";
import { createAuditLog } from "@/lib/audit";
import { generateOneRecurring, finalizeAutoSentInvoice } from "@/lib/recurring/generate";

export type RecurringResult =
  | { success: true; id: string }
  | { success: false; error: string };

export type RecurringActionResult =
  | { success: true }
  | { success: false; error: string };

export type RecurringRunResult =
  | { success: true; invoiceId: string; invoiceNumber: string; completed: boolean }
  | { success: false; error: string };

export interface RecurringLineItemInput {
  description: string;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
  vatRate: number;
}

export interface RecurringInvoiceInput {
  contactId: string;
  title?: string | null;
  firstIssueDate: string; // ISO date (YYYY-MM-DD)
  endDate?: string | null;
  interval: RecurringInterval;
  autoGenerate: boolean; // maps to status ACTIVE/PAUSED
  autoSend: boolean;
  paymentTermDays?: number | null;
  notes?: string | null;
  introText?: string | null;
  vatRegulation?: VatRegulation | null;
  leitwegId?: string | null;
  buyerReference?: string | null;
  items: RecurringLineItemInput[];
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createRecurringInvoice(
  input: RecurringInvoiceInput,
): Promise<RecurringResult> {
  const t = await requireTenant();

  const validation = validateInput(input);
  if (!validation.ok) return { success: false, error: validation.error };

  // Verify client belongs to this tenant
  const client = await db.contact.findFirst({
    where: { id: input.contactId, tenantId: t.tenantId },
    select: { id: true },
  });
  if (!client) return { success: false, error: "Client not found." };

  const firstIssueDate = new Date(input.firstIssueDate);
  const endDate = input.endDate ? new Date(input.endDate) : null;

  const schedule = await db.recurringInvoice.create({
    data: {
      tenantId: t.tenantId,
      contactId: input.contactId,
      title: input.title?.trim() || null,
      firstIssueDate,
      endDate,
      interval: input.interval,
      status: input.autoGenerate ? "ACTIVE" : "PAUSED",
      autoSend: input.autoSend,
      paymentTermDays: input.paymentTermDays ?? null,
      notes: input.notes?.trim() || null,
      introText: input.introText?.trim() || null,
      vatRegulation: input.vatRegulation ?? "STANDARD",
      leitwegId: input.leitwegId?.trim() || null,
      buyerReference: input.buyerReference?.trim() || null,
      nextRunAt: firstIssueDate,
      createdById: t.userId,
      lineItems: {
        create: input.items.map((it, i) => ({
          position: i + 1,
          description: it.description,
          quantity: it.quantity,
          unit: it.unit ?? null,
          unitPrice: it.unitPrice,
          vatRate: it.vatRate,
        })),
      },
    },
  });

  await createAuditLog({
    action: "INVOICE_CREATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "RecurringInvoice",
    entityId: schedule.id,
    details: {
      source: "recurring-create",
      interval: input.interval,
      autoSend: input.autoSend,
      status: schedule.status,
    },
  });

  // UX: if the user picked today (or earlier) as firstIssueDate AND
  // automatic generation is on, fire off the first invoice immediately
  // rather than making them click "Run now" right after saving. Saving
  // a template that's supposed to run "now" should produce a result now.
  // Failures here are non-fatal — the template stays valid and the cron
  // will pick up tomorrow at the latest.
  const todayMidnight = new Date();
  todayMidnight.setHours(23, 59, 59, 999);
  const shouldRunImmediately =
    input.autoGenerate && firstIssueDate <= todayMidnight;

  if (shouldRunImmediately) {
    try {
      const gen = await generateOneRecurring(schedule.id);
      if (input.autoSend) {
        const send = await finalizeAutoSentInvoice(gen.invoiceId, t.userId);
        if (!send.success) {
          await db.recurringInvoice.update({
            where: { id: schedule.id },
            data: { lastError: `Auto-Versand fehlgeschlagen: ${send.error}`.slice(0, 1000) },
          });
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[recurring] immediate generation failed:", e);
      await db.recurringInvoice.update({
        where: { id: schedule.id },
        data: { lastError: message.slice(0, 1000) },
      });
    }
    revalidatePath("/dashboard/invoices");
  }

  revalidatePath("/dashboard/invoices/recurring");
  return { success: true, id: schedule.id };
}

// ── Update ──────────────────────────────────────────────────────────────────

export async function updateRecurringInvoice(
  id: string,
  input: RecurringInvoiceInput,
): Promise<RecurringResult> {
  const t = await requireTenant();

  const existing = await db.recurringInvoice.findFirst({
    where: { id, tenantId: t.tenantId },
    select: { id: true, firstIssueDate: true, nextRunAt: true, generatedCount: true },
  });
  if (!existing) return { success: false, error: "Schedule not found." };

  const validation = validateInput(input);
  if (!validation.ok) return { success: false, error: validation.error };

  const client = await db.contact.findFirst({
    where: { id: input.contactId, tenantId: t.tenantId },
    select: { id: true },
  });
  if (!client) return { success: false, error: "Client not found." };

  const newFirstIssue = new Date(input.firstIssueDate);
  const endDate = input.endDate ? new Date(input.endDate) : null;

  // If nothing has been generated yet, we let firstIssueDate move freely and
  // anchor nextRunAt to it. After the first generation we DON'T touch
  // nextRunAt (the cron-clock keeps its own rhythm — moving it would either
  // skip generations or duplicate them).
  const shouldRebaseNextRun = existing.generatedCount === 0;

  await db.$transaction([
    db.recurringInvoiceLineItem.deleteMany({ where: { recurringInvoiceId: id } }),
    db.recurringInvoice.update({
      where: { id },
      data: {
        contactId: input.contactId,
        title: input.title?.trim() || null,
        firstIssueDate: newFirstIssue,
        endDate,
        interval: input.interval,
        status: input.autoGenerate ? "ACTIVE" : "PAUSED",
        autoSend: input.autoSend,
        paymentTermDays: input.paymentTermDays ?? null,
        notes: input.notes?.trim() || null,
        introText: input.introText?.trim() || null,
        vatRegulation: input.vatRegulation ?? "STANDARD",
        leitwegId: input.leitwegId?.trim() || null,
        buyerReference: input.buyerReference?.trim() || null,
        ...(shouldRebaseNextRun ? { nextRunAt: newFirstIssue } : {}),
        // Clear stale error on edit — user just changed something, give it
        // a fresh chance on the next tick.
        lastError: null,
        lineItems: {
          create: input.items.map((it, i) => ({
            position: i + 1,
            description: it.description,
            quantity: it.quantity,
            unit: it.unit ?? null,
            unitPrice: it.unitPrice,
            vatRate: it.vatRate,
          })),
        },
      },
    }),
  ]);

  await createAuditLog({
    action: "INVOICE_UPDATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "RecurringInvoice",
    entityId: id,
    details: { source: "recurring-update" },
  });

  revalidatePath("/dashboard/invoices/recurring");
  revalidatePath(`/dashboard/invoices/recurring/${id}`);
  return { success: true, id };
}

// ── Delete ──────────────────────────────────────────────────────────────────

export async function deleteRecurringInvoice(id: string): Promise<RecurringActionResult> {
  const t = await requireTenant();

  const existing = await db.recurringInvoice.findFirst({
    where: { id, tenantId: t.tenantId },
    select: { id: true },
  });
  if (!existing) return { success: false, error: "Schedule not found." };

  await db.recurringInvoice.delete({ where: { id } });

  await createAuditLog({
    action: "INVOICE_CANCELLED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "RecurringInvoice",
    entityId: id,
    details: { source: "recurring-delete" },
  });

  revalidatePath("/dashboard/invoices/recurring");
  return { success: true };
}

// ── Pause / Resume ──────────────────────────────────────────────────────────

export async function setRecurringAutoGenerate(
  id: string,
  autoGenerate: boolean,
): Promise<RecurringActionResult> {
  const t = await requireTenant();

  const existing = await db.recurringInvoice.findFirst({
    where: { id, tenantId: t.tenantId },
    select: { id: true, status: true },
  });
  if (!existing) return { success: false, error: "Schedule not found." };
  if (existing.status === "COMPLETED") {
    return { success: false, error: "Schedule is already completed." };
  }

  await db.recurringInvoice.update({
    where: { id },
    data: { status: autoGenerate ? "ACTIVE" : "PAUSED" },
  });

  await createAuditLog({
    action: "INVOICE_UPDATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "RecurringInvoice",
    entityId: id,
    details: {
      source: "recurring-toggle",
      status: autoGenerate ? "ACTIVE" : "PAUSED",
    },
  });

  revalidatePath("/dashboard/invoices/recurring");
  revalidatePath(`/dashboard/invoices/recurring/${id}`);
  return { success: true };
}

// ── Manual Run ──────────────────────────────────────────────────────────────

/**
 * Manually generate the next invoice immediately, regardless of nextRunAt.
 * Useful for testing or "I want this invoice today" flows. Honors autoSend.
 */
export async function runRecurringNow(id: string): Promise<RecurringRunResult> {
  const t = await requireTenant();

  const existing = await db.recurringInvoice.findFirst({
    where: { id, tenantId: t.tenantId },
    select: { id: true, status: true, autoSend: true, createdById: true },
  });
  if (!existing) return { success: false, error: "Schedule not found." };
  if (existing.status === "COMPLETED") {
    return { success: false, error: "Schedule is already completed." };
  }

  try {
    const result = await generateOneRecurring(id);
    if (existing.autoSend) {
      const send = await finalizeAutoSentInvoice(
        result.invoiceId,
        existing.createdById ?? t.userId,
      );
      if (!send.success) {
        await db.recurringInvoice.update({
          where: { id },
          data: { lastError: `Auto-Versand fehlgeschlagen: ${send.error}`.slice(0, 1000) },
        });
        // Invoice was created successfully, but email delivery failed. We
        // still report success on the schedule + invoice but with a hint.
        revalidatePath("/dashboard/invoices/recurring");
        revalidatePath(`/dashboard/invoices/recurring/${id}`);
        revalidatePath("/dashboard/invoices");
        return {
          success: false,
          error: `Rechnung ${result.invoiceNumber} wurde erstellt, aber der Auto-Versand schlug fehl: ${send.error}`,
        };
      }
    }
    revalidatePath("/dashboard/invoices/recurring");
    revalidatePath(`/dashboard/invoices/recurring/${id}`);
    revalidatePath("/dashboard/invoices");
    return {
      success: true,
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceNumber,
      completed: result.completed,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.recurringInvoice.update({
      where: { id },
      data: { lastError: message.slice(0, 1000) },
    });
    return { success: false, error: message };
  }
}

// ── Validation ──────────────────────────────────────────────────────────────

function validateInput(input: RecurringInvoiceInput): { ok: true } | { ok: false; error: string } {
  if (!input.contactId) return { ok: false, error: "Client is required." };
  if (!input.firstIssueDate) return { ok: false, error: "First issue date is required." };
  if (Number.isNaN(new Date(input.firstIssueDate).getTime())) {
    return { ok: false, error: "Invalid first issue date." };
  }
  if (input.endDate) {
    const end = new Date(input.endDate);
    if (Number.isNaN(end.getTime())) return { ok: false, error: "Invalid end date." };
    if (end < new Date(input.firstIssueDate)) {
      return { ok: false, error: "End date must be after first issue date." };
    }
  }
  if (!input.items || input.items.length === 0) {
    return { ok: false, error: "At least one line item is required." };
  }
  for (const it of input.items) {
    if (!it.description?.trim()) return { ok: false, error: "Line item description is required." };
    if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
      return { ok: false, error: "Line item quantity must be greater than 0." };
    }
    // Reject zero/negative prices — a recurring template that bills 0,00 €
    // is almost always a user mistake (forgotten field) and would create
    // worthless invoices. If we ever need free-of-charge templates, add an
    // explicit "no charge" flag instead of overloading unitPrice=0.
    if (!Number.isFinite(it.unitPrice) || it.unitPrice <= 0) {
      return { ok: false, error: "Line item unit price must be greater than 0." };
    }
    if (![0, 7, 19].includes(it.vatRate)) {
      return { ok: false, error: "Line item VAT rate must be 0, 7 or 19." };
    }
  }
  return { ok: true };
}
