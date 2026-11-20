/**
 * GET /api/invoices/[id]/pdf
 *
 * Returns the invoice PDF. For a finalized invoice this serves the PDF that
 * was archived in R2 at send time (GoBD: sent == archived — a later font or
 * template change must never alter an already-sent document). DRAFT invoices
 * and legacy invoices without an archive are rendered on the fly.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantOrThrow } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { storage, STORAGE_DRIVER } from "@/lib/storage";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePDF } from "@/components/pdf/invoice-pdf";
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

  const [invoice, settings] = await Promise.all([
    db.invoice.findFirst({
      where: { id, tenantId: t.tenantId },
      include: {
        contact: true,
        lineItems: { orderBy: { position: "asc" } },
        // Needed by the PDF/preview to print the "corrects invoice X" line
        // on corrections (also present on credit notes — harmless there).
        creditNoteFor: { select: { number: true, issueDate: true } },
      },
    }),
    db.companySettings.findUnique({ where: { tenantId: t.tenantId } }),
  ]);

  if (!invoice) return new NextResponse("Not found", { status: 404 });

  // Serve the archived PDF when one exists — this is the GoBD-authoritative copy.
  if (invoice.pdfStoragePath) {
    if (STORAGE_DRIVER === "r2") {
      const url = await storage.signedUrl(invoice.pdfStoragePath, 300);
      return NextResponse.redirect(url, 302);
    }
    const archived = await storage.get(invoice.pdfStoragePath);
    if (archived) {
      return new NextResponse(new Uint8Array(archived), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${invoice.number}.pdf"`,
        },
      });
    }
    // Archive missing — fall through to a fresh render.
  }

  const buffer = await renderToBuffer(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(InvoicePDF, { invoice, settings, locale }) as any
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.number}.pdf"`,
    },
  });
}
