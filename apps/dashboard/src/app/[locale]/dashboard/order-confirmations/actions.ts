"use server";

import { db } from "@/lib/db";
import { requireTenant } from "@/lib/require-tenant";
import { createAuditLog } from "@/lib/audit";
import { issueNumber } from "@/lib/number-ranges";
import { sendBusinessDocEmail } from "@/lib/business-doc/send-email";
import { computeDocumentTotals, type DiscountType } from "@/lib/invoice/discount";
import { revalidatePath } from "next/cache";
import type { OrderConfirmationStatus } from "@prisma/client";

export type OCResult =
  | { success: true; id: string }
  | { success: false; error: string };

export interface OCLineItemInput {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  vatRate: number;
  amount?: number;
  discountType?: DiscountType;
  discountValue?: number | null;
}

export interface OCInput {
  contactId: string;
  issueDate: string;
  deliveryDate: string | null;
  serviceDate: string | null;
  serviceDateEnd: string | null;
  notes: string;
  introText: string | null;
  vatRegulation: string | null;
  quoteId?: string | null;
  items: OCLineItemInput[];
  globalDiscountType?: DiscountType;
  globalDiscountValue?: number | null;
}

function computeTotals(input: OCInput) {
  const lineItems = input.items.map((item, i) => {
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
    input.globalDiscountType ?? null,
    input.globalDiscountValue ?? null,
  );
  return {
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    total: totals.total,
    lineItems,
  };
}

export async function createOrderConfirmation(input: OCInput): Promise<OCResult> {
  const t = await requireTenant();
  if (!input.contactId) return { success: false, error: "Kunde ist erforderlich." };
  if (input.items.length === 0) return { success: false, error: "Mindestens eine Position erforderlich." };

  const client = await db.contact.findFirst({
    where: { id: input.contactId, tenantId: t.tenantId },
    select: { id: true },
  });
  if (!client) return { success: false, error: "Kunde nicht gefunden." };

  const { subtotal, taxAmount, total, lineItems } = computeTotals(input);

  const oc = await db.$transaction(async (tx) => {
    const number = await issueNumber(tx, t.tenantId, "ORDER_CONFIRMATION", new Date(input.issueDate));
    return tx.orderConfirmation.create({
      data: {
        tenantId: t.tenantId,
        number,
        contactId: input.contactId,
        issueDate: new Date(input.issueDate),
        deliveryDate: input.deliveryDate ? new Date(input.deliveryDate) : null,
        serviceDate: input.serviceDate ? new Date(input.serviceDate) : null,
        serviceDateEnd: input.serviceDateEnd ? new Date(input.serviceDateEnd) : null,
        notes: input.notes || null,
        introText: input.introText?.trim() || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vatRegulation: (input.vatRegulation as any) ?? "STANDARD",
        subtotal,
        taxAmount,
        total,
        globalDiscountType: input.globalDiscountType ?? null,
        globalDiscountValue: input.globalDiscountValue ?? null,
        createdById: t.userId,
        quoteId: input.quoteId || null,
        lineItems: { create: lineItems },
      },
    });
  });

  await createAuditLog({
    action: "ORDER_CONFIRMATION_CREATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "OrderConfirmation",
    entityId: oc.id,
    details: { number: oc.number, total },
  });

  revalidatePath("/dashboard/order-confirmations");
  return { success: true, id: oc.id };
}

export async function updateOrderConfirmation(id: string, input: OCInput): Promise<OCResult> {
  const t = await requireTenant();
  if (!input.contactId) return { success: false, error: "Kunde ist erforderlich." };
  if (input.items.length === 0) return { success: false, error: "Mindestens eine Position erforderlich." };

  const existing = await db.orderConfirmation.findFirst({
    where: { id, tenantId: t.tenantId },
    select: { id: true, status: true, number: true },
  });
  if (!existing) return { success: false, error: "Auftragsbestätigung nicht gefunden." };
  // ABs are locked once a follow-up invoice has been issued.
  if (existing.status === "INVOICED") {
    return { success: false, error: "Bereits fakturierte Auftragsbestätigungen können nicht mehr bearbeitet werden." };
  }
  if (existing.status === "CANCELLED") {
    return { success: false, error: "Stornierte Auftragsbestätigungen können nicht mehr bearbeitet werden." };
  }

  const { subtotal, taxAmount, total, lineItems } = computeTotals(input);

  await db.$transaction([
    db.orderConfirmationLineItem.deleteMany({ where: { orderConfirmationId: id } }),
    db.orderConfirmation.update({
      where: { id },
      data: {
        contactId: input.contactId,
        issueDate: new Date(input.issueDate),
        deliveryDate: input.deliveryDate ? new Date(input.deliveryDate) : null,
        serviceDate: input.serviceDate ? new Date(input.serviceDate) : null,
        serviceDateEnd: input.serviceDateEnd ? new Date(input.serviceDateEnd) : null,
        notes: input.notes || null,
        introText: input.introText?.trim() || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vatRegulation: (input.vatRegulation as any) ?? "STANDARD",
        subtotal,
        taxAmount,
        total,
        globalDiscountType: input.globalDiscountType ?? null,
        globalDiscountValue: input.globalDiscountValue ?? null,
        lineItems: { create: lineItems },
      },
    }),
  ]);

  await createAuditLog({
    action: "ORDER_CONFIRMATION_UPDATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "OrderConfirmation",
    entityId: id,
    details: { number: existing.number, total },
  });

  revalidatePath("/dashboard/order-confirmations");
  revalidatePath(`/dashboard/order-confirmations/${id}`);
  return { success: true, id };
}

export async function updateOrderConfirmationStatus(
  id: string,
  status: OrderConfirmationStatus,
): Promise<{ success: boolean; error?: string }> {
  const t = await requireTenant();
  const current = await db.orderConfirmation.findFirst({
    where: { id, tenantId: t.tenantId },
    select: { status: true },
  });
  if (!current) return { success: false, error: "Auftragsbestätigung nicht gefunden." };

  // INVOICED is only set automatically when an invoice is created from this
  // AB — the user can't toggle it manually. Same for un-invoicing.
  if (status === "INVOICED" || current.status === "INVOICED") {
    return { success: false, error: "Der Status INVOICED wird nur über die Rechnungserstellung gesetzt." };
  }

  await db.orderConfirmation.update({ where: { id }, data: { status } });

  const actionMap: Record<OrderConfirmationStatus, "ORDER_CONFIRMATION_SENT" | "ORDER_CONFIRMATION_CANCELLED" | "ORDER_CONFIRMATION_UPDATED" | "ORDER_CONFIRMATION_INVOICED"> = {
    DRAFT: "ORDER_CONFIRMATION_UPDATED",
    SENT: "ORDER_CONFIRMATION_SENT",
    INVOICED: "ORDER_CONFIRMATION_INVOICED",
    CANCELLED: "ORDER_CONFIRMATION_CANCELLED",
  };
  await createAuditLog({
    action: actionMap[status],
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "OrderConfirmation",
    entityId: id,
    details: { status },
  });

  revalidatePath("/dashboard/order-confirmations");
  revalidatePath(`/dashboard/order-confirmations/${id}`);
  return { success: true };
}

// ─── Email versand ──────────────────────────────────────────────────────────

export async function sendOrderConfirmationEmail(
  ocId: string,
  customMessage: string | null,
  sendCopyToSelf: boolean = false,
): Promise<{ success: boolean; error?: string }> {
  const t = await requireTenant();
  const result = await sendBusinessDocEmail({
    kind: "ORDER_CONFIRMATION",
    docId: ocId,
    tenantId: t.tenantId,
    actorUserId: t.userId,
    customMessage,
    sendCopyToSelf,
  });
  if (!result.success) return result;
  revalidatePath("/dashboard/order-confirmations");
  revalidatePath(`/dashboard/order-confirmations/${ocId}`);
  return { success: true };
}

export async function deleteOrderConfirmation(id: string): Promise<{ success: boolean; error?: string }> {
  const t = await requireTenant();
  const oc = await db.orderConfirmation.findFirst({
    where: { id, tenantId: t.tenantId },
    select: { status: true, number: true, invoices: { select: { id: true } } },
  });
  if (!oc) return { success: false, error: "Auftragsbestätigung nicht gefunden." };
  if (oc.invoices.length > 0) {
    return { success: false, error: "Eine Auftragsbestätigung mit verknüpfter Rechnung kann nicht gelöscht werden." };
  }

  await db.orderConfirmation.delete({ where: { id } });

  await createAuditLog({
    action: "ORDER_CONFIRMATION_DELETED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "OrderConfirmation",
    entityId: id,
    details: { number: oc.number },
  });

  revalidatePath("/dashboard/order-confirmations");
  return { success: true };
}
