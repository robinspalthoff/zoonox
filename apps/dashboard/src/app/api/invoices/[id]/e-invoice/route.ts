/**
 * GET /api/invoices/[id]/e-invoice
 *
 * Returns a ZUGFeRD hybrid PDF/A-3 with the factur-x.xml embedded.
 * The document is machine-readable (XML) and human-readable (PDF) simultaneously.
 *
 * Query params:
 *   ?format=zugferd   → ZUGFeRD hybrid PDF (default)
 *   ?format=xrechnung → XRechnung UBL XML only (B2G)
 *
 * Auth: Required (session cookie)
 * GoBD: The generated XML is also stored in the DB for 10-year archival.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantOrThrow } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePDF } from "@/components/pdf/invoice-pdf";
import React from "react";
import {
  generateEInvoice,
  validateForEInvoice,
} from "@/lib/e-invoice";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let t;
  try {
    t = await requireTenantOrThrow();
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const formatParam = req.nextUrl.searchParams.get("format")?.toUpperCase();
  const format =
    formatParam === "XRECHNUNG" ? "XRECHNUNG" : "ZUGFERD";

  const [invoice, settings] = await Promise.all([
    db.invoice.findFirst({
      where: { id, tenantId: t.tenantId },
      include: {
        contact: true,
        lineItems: { orderBy: { position: "asc" } },
        creditNoteFor: { select: { number: true, issueDate: true } },
      },
    }),
    db.companySettings.findUnique({ where: { tenantId: t.tenantId } }),
  ]);

  if (!invoice) {
    return new NextResponse("Rechnung nicht gefunden.", { status: 404 });
  }

  if (!settings) {
    return new NextResponse(
      "Unternehmenseinstellungen fehlen. Bitte zuerst konfigurieren.",
      { status: 422 }
    );
  }

  // ── Pre-flight validation ────────────────────────────────────────────────────
  const validation = validateForEInvoice(
    { invoice, settings },
    format === "XRECHNUNG" // B2G requires Leitweg-ID
  );

  if (!validation.valid) {
    const errorMessages = validation.errors
      .filter((e) => e.severity === "error")
      .map((e) => `${e.bt ? `[${e.bt}] ` : ""}${e.message}`)
      .join("\n");

    return NextResponse.json(
      {
        error: "E-Rechnung konnte nicht generiert werden.",
        details: errorMessages,
        validationErrors: validation.errors,
      },
      { status: 422 }
    );
  }

  try {
    // ── Generate XRechnung (XML only, B2G) ─────────────────────────────────────
    if (format === "XRECHNUNG") {
      const { xml } = await generateEInvoice({ invoice, settings }, undefined, "XRECHNUNG");

      // Archive XML in DB for GoBD compliance (only when invoice is finalized)
      if (invoice.status !== "DRAFT" && !invoice.eInvoiceXml) {
        await db.invoice.update({
          where: { id },
          data: { eInvoiceXml: xml },
        });
      }

      return new NextResponse(xml, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${invoice.number}_xrechnung.xml"`,
        },
      });
    }

    // ── Generate ZUGFeRD hybrid PDF ────────────────────────────────────────────
    // 1. Render the visual PDF (unchanged from existing PDF route)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfBuffer = await renderToBuffer(
      React.createElement(InvoicePDF, { invoice, settings }) as any
    );

    // 2. Generate ZUGFeRD XML + embed into PDF
    const { xml, pdf } = await generateEInvoice(
      { invoice, settings },
      pdfBuffer,
      "ZUGFERD"
    );

    if (!pdf) {
      throw new Error("PDF embedding failed unexpectedly.");
    }

    // 3. Archive XML in DB for GoBD compliance (only when invoice is finalized)
    if (invoice.status !== "DRAFT" && !invoice.eInvoiceXml) {
      await db.invoice.update({
        where: { id },
        data: { eInvoiceXml: xml },
      });
    }

    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoice.number}_zugferd.pdf"`,
        // Signal to clients that this is a ZUGFeRD document
        "X-E-Invoice-Format": "ZUGFeRD-2.x-EN16931",
        "X-E-Invoice-Profile": "urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:en16931",
      },
    });
  } catch (err) {
    console.error("[e-invoice] Generation error:", err);
    return NextResponse.json(
      { error: "E-Rechnung konnte nicht erstellt werden. Bitte erneut versuchen." },
      { status: 500 }
    );
  }
}
