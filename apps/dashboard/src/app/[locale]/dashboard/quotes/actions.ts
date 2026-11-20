"use server";

import { db } from "@/lib/db";
import { requireTenant } from "@/lib/require-tenant";
import { createAuditLog } from "@/lib/audit";
import { issueNumber } from "@/lib/number-ranges";
import { sendBusinessDocEmail } from "@/lib/business-doc/send-email";
import { computeDocumentTotals, type DiscountType } from "@/lib/invoice/discount";
import { revalidatePath } from "next/cache";
import type { QuoteStatus } from "@prisma/client";

export type QuoteResult =
  | { success: true; id: string }
  | { success: false; error: string };

export interface QuoteLineItemInput {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  vatRate: number;
  amount?: number;
  discountType?: DiscountType;
  discountValue?: number | null;
}

export interface QuoteInput {
  contactId: string;
  issueDate: string;
  validUntil: string | null;
  serviceDate: string | null;
  serviceDateEnd: string | null;
  notes: string;
  introText: string | null;
  vatRegulation: string | null;
  items: QuoteLineItemInput[];
  globalDiscountType?: DiscountType;
  globalDiscountValue?: number | null;
}

function computeTotals(input: QuoteInput) {
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

export async function createQuote(input: QuoteInput): Promise<QuoteResult> {
  const t = await requireTenant();
  if (!input.contactId) return { success: false, error: "Kunde ist erforderlich." };
  if (input.items.length === 0) return { success: false, error: "Mindestens eine Position erforderlich." };

  const client = await db.contact.findFirst({
    where: { id: input.contactId, tenantId: t.tenantId },
    select: { id: true },
  });
  if (!client) return { success: false, error: "Kunde nicht gefunden." };

  const { subtotal, taxAmount, total, lineItems } = computeTotals(input);

  const quote = await db.$transaction(async (tx) => {
    const number = await issueNumber(tx, t.tenantId, "QUOTE", new Date(input.issueDate));
    return tx.quote.create({
      data: {
        tenantId: t.tenantId,
        number,
        contactId: input.contactId,
        issueDate: new Date(input.issueDate),
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
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
        lineItems: { create: lineItems },
      },
    });
  });

  await createAuditLog({
    action: "QUOTE_CREATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Quote",
    entityId: quote.id,
    details: { number: quote.number, total },
  });

  revalidatePath("/dashboard/quotes");
  return { success: true, id: quote.id };
}

export async function updateQuote(id: string, input: QuoteInput): Promise<QuoteResult> {
  const t = await requireTenant();
  if (!input.contactId) return { success: false, error: "Kunde ist erforderlich." };
  if (input.items.length === 0) return { success: false, error: "Mindestens eine Position erforderlich." };

  const existing = await db.quote.findFirst({
    where: { id, tenantId: t.tenantId },
    select: { id: true, status: true, number: true, convertedAt: true },
  });
  if (!existing) return { success: false, error: "Angebot nicht gefunden." };
  // Quotes remain editable until they are converted (Rechnung/AB drauf erstellt).
  // Once converted, content is locked to keep the link to the follow-up doc
  // honest — corrections then go through a brand-new quote.
  if (existing.convertedAt) {
    return { success: false, error: "Bereits weiterverarbeitete Angebote können nicht mehr bearbeitet werden." };
  }

  const { subtotal, taxAmount, total, lineItems } = computeTotals(input);

  await db.$transaction([
    db.quoteLineItem.deleteMany({ where: { quoteId: id } }),
    db.quote.update({
      where: { id },
      data: {
        contactId: input.contactId,
        issueDate: new Date(input.issueDate),
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
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
    action: "QUOTE_UPDATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Quote",
    entityId: id,
    details: { number: existing.number, total },
  });

  revalidatePath("/dashboard/quotes");
  revalidatePath(`/dashboard/quotes/${id}`);
  return { success: true, id };
}

export async function updateQuoteStatus(id: string, status: QuoteStatus): Promise<{ success: boolean; error?: string }> {
  const t = await requireTenant();
  const current = await db.quote.findFirst({
    where: { id, tenantId: t.tenantId },
    select: { status: true, convertedAt: true },
  });
  if (!current) return { success: false, error: "Angebot nicht gefunden." };

  // Quotes are NOT GoBD-frozen — the user can move between any two
  // statuses except *out of* a finalised follow-up state. ACCEPTED is a
  // soft target: ACCEPTED can still be set to REJECTED if the customer
  // changes their mind before invoicing. Once a follow-up doc exists
  // (convertedAt != null), the status is locked to ACCEPTED to keep the
  // link meaningful.
  if (current.convertedAt && status !== current.status) {
    return { success: false, error: "Status kann nach Konvertierung nicht mehr geändert werden." };
  }

  await db.quote.update({ where: { id }, data: { status } });

  const actionMap: Record<QuoteStatus, "QUOTE_SENT" | "QUOTE_ACCEPTED" | "QUOTE_REJECTED" | "QUOTE_EXPIRED" | "QUOTE_UPDATED"> = {
    DRAFT: "QUOTE_UPDATED",
    SENT: "QUOTE_SENT",
    ACCEPTED: "QUOTE_ACCEPTED",
    REJECTED: "QUOTE_REJECTED",
    EXPIRED: "QUOTE_EXPIRED",
  };
  await createAuditLog({
    action: actionMap[status],
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Quote",
    entityId: id,
    details: { status },
  });

  revalidatePath("/dashboard/quotes");
  revalidatePath(`/dashboard/quotes/${id}`);
  return { success: true };
}

export async function deleteQuote(id: string): Promise<{ success: boolean; error?: string }> {
  const t = await requireTenant();
  const quote = await db.quote.findFirst({
    where: { id, tenantId: t.tenantId },
    select: { status: true, convertedAt: true, number: true },
  });
  if (!quote) return { success: false, error: "Angebot nicht gefunden." };
  if (quote.convertedAt) {
    return { success: false, error: "Bereits weiterverarbeitete Angebote können nicht gelöscht werden." };
  }

  await db.quote.delete({ where: { id } });

  await createAuditLog({
    action: "QUOTE_DELETED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Quote",
    entityId: id,
    details: { number: quote.number },
  });

  revalidatePath("/dashboard/quotes");
  return { success: true };
}

/**
 * Lightweight read used by the partial-conversion modal — returns just the
 * line items so the modal can render checkboxes + quantity overrides
 * without re-querying the full quote.
 */
export async function getQuoteLineItemsForConversion(quoteId: string): Promise<
  Array<{ id: string; position: number; description: string; quantity: number; unit: string | null; unitPrice: number; vatRate: number; amount: number }>
> {
  const t = await requireTenant();
  const quote = await db.quote.findFirst({
    where: { id: quoteId, tenantId: t.tenantId },
    include: { lineItems: { orderBy: { position: "asc" } } },
  });
  if (!quote) return [];
  return quote.lineItems.map((li) => ({
    id: li.id,
    position: li.position,
    description: li.description,
    quantity: Number(li.quantity),
    unit: li.unit,
    unitPrice: Number(li.unitPrice),
    vatRate: li.vatRate,
    amount: Number(li.amount),
  }));
}

// ─── Email versand ──────────────────────────────────────────────────────────

export async function sendQuoteEmail(
  quoteId: string,
  customMessage: string | null,
  sendCopyToSelf: boolean = false,
): Promise<{ success: boolean; error?: string }> {
  const t = await requireTenant();
  const result = await sendBusinessDocEmail({
    kind: "QUOTE",
    docId: quoteId,
    tenantId: t.tenantId,
    actorUserId: t.userId,
    customMessage,
    sendCopyToSelf,
  });
  if (!result.success) return result;
  revalidatePath("/dashboard/quotes");
  revalidatePath(`/dashboard/quotes/${quoteId}`);
  return { success: true };
}

// ─── Convert quote → Auftragsbestätigung ────────────────────────────────────
//
// Creates a new OrderConfirmation pre-filled from this quote's content. The
// quote itself flips to ACCEPTED + sets convertedAt. Returns the new AB id
// so the caller can navigate the user straight to it. The OC keeps its own
// number range (ORDER_CONFIRMATION) — the AB number is independent of the
// quote number.

/**
 * Per-line override the modal can pass when the user wants to convert a
 * subset of the quote's positions (and optionally adjust quantities on
 * the surviving ones). The keys are quote line-item IDs.
 *   • Missing from the map → line is dropped from the AB.
 *   • `null` quantity → use the quote's original quantity verbatim.
 *   • numeric → override (must be > 0; smaller-or-equal to original is
 *     not enforced here, leaves flexibility for "we'll deliver more").
 */
export type LineItemOverride = { quantity: number | null };

export async function convertQuoteToOrderConfirmation(
  quoteId: string,
  selection?: Record<string, LineItemOverride>,
): Promise<QuoteResult> {
  const t = await requireTenant();
  const quote = await db.quote.findFirst({
    where: { id: quoteId, tenantId: t.tenantId },
    include: { lineItems: { orderBy: { position: "asc" } } },
  });
  if (!quote) return { success: false, error: "Angebot nicht gefunden." };

  const now = new Date();

  // Resolve which line items make it into the AB. No selection passed →
  // full conversion (back-compat with the existing "alle Positionen
  // übernehmen"-button). Partial conversions must include at least one
  // line — otherwise the AB would be empty and the conversion is
  // meaningless.
  const sourceLines = selection
    ? quote.lineItems.filter((li) => selection[li.id])
    : quote.lineItems;
  if (sourceLines.length === 0) {
    return { success: false, error: "Mindestens eine Position muss übernommen werden." };
  }

  // Compute new totals from the surviving lines + per-line quantity
  // overrides. Unit price, VAT rate, Einheit und Rabatte werden verbatim
  // übernommen — Conversion ändert keinen Preis, das wäre ein Re-Quote.
  // Bei Mengen-Override wird der Positions-Rabatt analog skaliert:
  //   • percent → bleibt unverändert (relativ zur Basis)
  //   • amount  → proportional zur neuen Menge angepasst (Euro/Stück bleibt
  //     gleich), damit das Quote-Verhältnis erhalten bleibt
  const ocLines = sourceLines.map((li, i) => {
    const override = selection?.[li.id]?.quantity ?? null;
    const qty = override !== null ? override : Number(li.quantity);
    if (!(qty > 0)) {
      throw new Error(`Ungültige Menge für Position "${li.description}".`);
    }
    const unitPrice = Number(li.unitPrice);
    const originalQty = Number(li.quantity);
    const discountType = li.discountType ?? null;
    let discountValue: number | null = li.discountValue !== null && li.discountValue !== undefined
      ? Number(li.discountValue)
      : null;
    let amount: number;
    if (discountType === "percent" && discountValue !== null) {
      amount = Math.round(qty * unitPrice * (1 - Math.min(Math.max(discountValue, 0), 100) / 100) * 100) / 100;
    } else if (discountType === "amount" && discountValue !== null && originalQty > 0) {
      const scaledDiscount = Math.round((discountValue * (qty / originalQty)) * 100) / 100;
      discountValue = scaledDiscount;
      amount = Math.round(Math.max(0, qty * unitPrice - scaledDiscount) * 100) / 100;
    } else {
      amount = Math.round(qty * unitPrice * 100) / 100;
    }
    return {
      position: i + 1, // renumber sequentially after the filter
      description: li.description,
      quantity: qty,
      unit: li.unit,
      unitPrice,
      vatRate: li.vatRate,
      discountType,
      discountValue,
      amount,
    };
  });
  const totals = computeDocumentTotals(
    ocLines.map((li) => ({ amount: li.amount, vatRate: li.vatRate })),
    (quote.globalDiscountType as DiscountType) ?? null,
    quote.globalDiscountValue !== null && quote.globalDiscountValue !== undefined
      ? Number(quote.globalDiscountValue)
      : null,
  );
  const { subtotal, taxAmount, total } = totals;

  const oc = await db.$transaction(async (tx) => {
    const number = await issueNumber(tx, t.tenantId, "ORDER_CONFIRMATION", now);
    const created = await tx.orderConfirmation.create({
      data: {
        tenantId: t.tenantId,
        number,
        contactId: quote.contactId,
        issueDate: now,
        serviceDate: quote.serviceDate,
        serviceDateEnd: quote.serviceDateEnd,
        notes: quote.notes,
        introText: quote.introText,
        vatRegulation: quote.vatRegulation,
        subtotal,
        taxAmount,
        total,
        globalDiscountType: quote.globalDiscountType,
        globalDiscountValue: quote.globalDiscountValue,
        createdById: t.userId,
        quoteId: quote.id,
        lineItems: { create: ocLines },
      },
    });

    // Mark the quote as ACCEPTED + converted. ACCEPTED is the "logical"
    // status that maps best to "the customer agreed → we're now fulfilling".
    await tx.quote.update({
      where: { id: quoteId },
      data: {
        status: "ACCEPTED",
        convertedAt: quote.convertedAt ?? now,
      },
    });

    return created;
  });

  const isPartial = ocLines.length !== quote.lineItems.length;
  await createAuditLog({
    action: "QUOTE_CONVERTED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Quote",
    entityId: quoteId,
    details: {
      target: "ORDER_CONFIRMATION",
      targetId: oc.id,
      targetNumber: oc.number,
      partial: isPartial,
      linesIncluded: ocLines.length,
      linesTotal: quote.lineItems.length,
    },
  });
  await createAuditLog({
    action: "ORDER_CONFIRMATION_CREATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "OrderConfirmation",
    entityId: oc.id,
    details: { number: oc.number, fromQuoteId: quoteId, partial: isPartial },
  });

  revalidatePath("/dashboard/quotes");
  revalidatePath(`/dashboard/quotes/${quoteId}`);
  revalidatePath("/dashboard/order-confirmations");
  return { success: true, id: oc.id };
}
