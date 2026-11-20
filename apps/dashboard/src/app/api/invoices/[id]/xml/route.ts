/**
 * GET /api/invoices/[id]/xml
 *
 * Returns the raw factur-x.xml (ZUGFeRD CII) for a given invoice.
 * Shortcut for downloading just the XML without the PDF wrapper.
 *
 * Also used for:
 *  - KOSIT validator integration (send to Validator API)
 *  - Peppol network transmission (attach to AS4 message)
 *  - Manual audit / spot-check
 *
 * Auth: Required (session cookie)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantOrThrow } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import {
  generateZugferdXml,
  validateForEInvoice,
} from "@/lib/e-invoice";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
        creditNoteFor: { select: { number: true, issueDate: true } },
      },
    }),
    db.companySettings.findUnique({ where: { tenantId: t.tenantId } }),
  ]);

  if (!invoice) {
    return new NextResponse("Rechnung nicht gefunden.", { status: 404 });
  }

  if (!settings) {
    return new NextResponse("Unternehmenseinstellungen fehlen.", { status: 422 });
  }

  // If we have a previously archived XML (GoBD), serve that — it is the original
  if (invoice.eInvoiceXml) {
    return new NextResponse(invoice.eInvoiceXml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${invoice.number}_factur-x.xml"`,
        "X-Archive-Source": "db",
      },
    });
  }

  // Otherwise generate on-the-fly (for DRAFT invoices or first access)
  const validation = validateForEInvoice({ invoice, settings });
  if (!validation.valid) {
    const details = validation.errors
      .filter((e) => e.severity === "error")
      .map((e) => e.message)
      .join("; ");
    return NextResponse.json(
      { error: "Validierung fehlgeschlagen", details },
      { status: 422 }
    );
  }

  const xml = generateZugferdXml({ invoice, settings });

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${invoice.number}_factur-x.xml"`,
      "X-Archive-Source": "generated",
    },
  });
}
