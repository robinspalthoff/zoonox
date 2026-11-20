/**
 * GET /api/order-confirmations/[id]/pdf — render and stream the AB PDF.
 *
 * Order confirmations are not GoBD-archived; the PDF is rendered fresh
 * on every download from the current row.
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

  const [oc, settings] = await Promise.all([
    db.orderConfirmation.findFirst({
      where: { id, tenantId: t.tenantId },
      include: { contact: true, lineItems: { orderBy: { position: "asc" } } },
    }),
    db.companySettings.findUnique({ where: { tenantId: t.tenantId } }),
  ]);
  if (!oc) return new NextResponse("Not found", { status: 404 });

  const doc = {
    number: oc.number,
    issueDate: oc.issueDate,
    deadlineDate: oc.deliveryDate,
    deadlineLabel: oc.deliveryDate ? (locale === "en" ? "Delivery date" : "Liefertermin") : undefined,
    serviceDate: oc.serviceDate,
    serviceDateEnd: oc.serviceDateEnd,
    notes: oc.notes,
    introText: oc.introText,
    vatRegulation: oc.vatRegulation,
    subtotal: oc.subtotal,
    taxAmount: oc.taxAmount,
    total: oc.total,
    contact: oc.contact,
    lineItems: oc.lineItems.map((li) => ({
      id: li.id, position: li.position, description: li.description,
      quantity: li.quantity, unit: li.unit,
      unitPrice: li.unitPrice, vatRate: li.vatRate, amount: li.amount,
    })),
  };

  const buffer = await renderToBuffer(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(BusinessDocPDF, { doc, docType: "ORDER_CONFIRMATION", settings, locale }) as any
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${oc.number}.pdf"`,
    },
  });
}
