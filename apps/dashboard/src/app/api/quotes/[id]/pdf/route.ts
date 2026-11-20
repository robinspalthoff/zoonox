/**
 * GET /api/quotes/[id]/pdf — render and stream the quote PDF.
 *
 * Quotes are not GoBD-archived: every download renders fresh from the
 * current row. The shared BusinessDocPDF component handles layout; the
 * locale query param picks DE/EN label set.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantOrThrow } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { renderToBuffer } from "@react-pdf/renderer";
import { BusinessDocPDF } from "@/components/pdf/business-doc-pdf";
import React from "react";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = req.nextUrl.searchParams.get("locale") ?? "de";

  let t;
  try {
    t = await requireTenantOrThrow();
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;

  const [quote, settings] = await Promise.all([
    db.quote.findFirst({
      where: { id, tenantId: t.tenantId },
      include: { contact: true, lineItems: { orderBy: { position: "asc" } } },
    }),
    db.companySettings.findUnique({ where: { tenantId: t.tenantId } }),
  ]);
  if (!quote) return new NextResponse("Not found", { status: 404 });

  const doc = {
    number: quote.number,
    issueDate: quote.issueDate,
    deadlineDate: quote.validUntil,
    deadlineLabel: quote.validUntil ? (locale === "en" ? "Valid until" : "Gültig bis") : undefined,
    serviceDate: quote.serviceDate,
    serviceDateEnd: quote.serviceDateEnd,
    notes: quote.notes,
    introText: quote.introText,
    vatRegulation: quote.vatRegulation,
    subtotal: quote.subtotal,
    taxAmount: quote.taxAmount,
    total: quote.total,
    contact: quote.contact,
    lineItems: quote.lineItems.map((li) => ({
      id: li.id, position: li.position, description: li.description,
      quantity: li.quantity, unit: li.unit,
      unitPrice: li.unitPrice, vatRate: li.vatRate, amount: li.amount,
    })),
  };

  const buffer = await renderToBuffer(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(BusinessDocPDF, { doc, docType: "QUOTE", settings, locale }) as any
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${quote.number}.pdf"`,
    },
  });
}
