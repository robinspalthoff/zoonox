/**
 * POST /api/taxes/datev/export
 *
 * Builds a DATEV-compliant export ZIP for a given period and returns it
 * as a download. Phase 1 emits the Buchungsstapel + Stammdaten CSVs.
 * Phase 2 optionally bundles Belegbilder (incoming documents and/or
 * rendered invoice PDFs) plus a Belegliste mapping file.
 *
 * The form payload is taken from the export dialog — no DATEV-related
 * settings are persisted on CompanySettings, matching SevDesk's model.
 *
 * Auth: Required.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireTenantOrThrow } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePDF } from "@/components/pdf/invoice-pdf";
import React from "react";
import { buildDatevExport, type DatevExportInput } from "@/lib/datev";
import { fullName } from "@/lib/user-name";

type Body = {
  consultantNumber: number;
  clientNumber: number;
  fiscalYearStart: string; // YYYY-MM-DD
  dateFrom: string;
  dateTo: string;
  accountLength?: 4 | 5 | 6 | 7 | 8;
  description?: string;
  locked?: boolean;
  includeBelegbilder?: boolean;
  includeDocuments?: boolean;
  includeInvoices?: boolean;
  includeBank?: boolean;
  includeReversed?: boolean;
};

function parseDate(s: string): Date | null {
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(s);
  if (!m) return null;
  const d = new Date(s + "T00:00:00.000Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOfDay(s: string): Date | null {
  const d = parseDate(s);
  if (!d) return null;
  return new Date(d.getTime() + 24 * 3600 * 1000 - 1);
}

export async function POST(req: NextRequest) {
  let t;
  try {
    t = await requireTenantOrThrow();
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const session = await auth();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Beraternr./Mandantennr. are optional in the file-export flow — the
  // recipient (Steuerberater) overrides them on import in DATEV anyway.
  // SevDesk uses 0/0 as the default placeholder; we accept 0 as well.
  const consultantNumber = Math.trunc(Number(body.consultantNumber ?? 0)) || 0;
  const clientNumber = Math.trunc(Number(body.clientNumber ?? 0)) || 0;
  if (consultantNumber < 0 || consultantNumber > 9999999) {
    return NextResponse.json(
      { error: "Beraternummer ungültig (0 oder 1001–9999999)." },
      { status: 400 },
    );
  }
  if (clientNumber < 0 || clientNumber > 99999) {
    return NextResponse.json(
      { error: "Mandantennummer ungültig (0 oder 1–99999)." },
      { status: 400 },
    );
  }

  const fiscalYearStart = parseDate(body.fiscalYearStart);
  const dateFrom = parseDate(body.dateFrom);
  const dateTo = endOfDay(body.dateTo);
  if (!fiscalYearStart || !dateFrom || !dateTo) {
    return NextResponse.json(
      { error: "Ungültiges Datumsformat (erwartet YYYY-MM-DD)." },
      { status: 400 },
    );
  }
  if (dateFrom > dateTo) {
    return NextResponse.json(
      { error: "Startdatum liegt nach dem Enddatum." },
      { status: 400 },
    );
  }

  const settings = await db.companySettings.findUnique({ where: { tenantId: t.tenantId } });
  const skrType = settings?.skrType ?? "SKR03";

  const input: DatevExportInput = {
    tenantId: t.tenantId,
    consultantNumber,
    clientNumber,
    fiscalYearStart,
    dateFrom,
    dateTo,
    // Sachkontenlänge ist DATEV-Pflichtfeld im Header; 4 ist Default für
    // SKR03/SKR04 und passt für 99 % der Mandanten. Übersteuerung nur
    // serverseitig falls je benötigt — UI exponiert das nicht.
    accountLength: body.accountLength ?? 4,
    description: body.description,
    exportedBy: fullName(session?.user as { firstName?: string | null; lastName?: string | null } | undefined) ?? session?.user?.email ?? "zoonox",
    locked: !!body.locked,
    includeBelegbilder: !!body.includeBelegbilder,
    includeDocuments: body.includeDocuments !== false,
    includeInvoices: body.includeInvoices !== false,
    includeBank: body.includeBank !== false,
    includeReversed: !!body.includeReversed,
    skrType,
  };

  const result = await buildDatevExport(input, async (invoiceId) => {
    const invoice = await db.invoice.findFirst({
      where: { id: invoiceId, tenantId: t.tenantId },
      include: {
        contact: true,
        lineItems: { orderBy: { position: "asc" } },
      },
    });
    if (!invoice) return null;
    const buf = await renderToBuffer(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(InvoicePDF, { invoice, settings }) as any,
    );
    return Buffer.from(buf);
  });

  return new NextResponse(new Uint8Array(result.zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "X-Datev-Entries": String(result.stats.entries),
      "X-Datev-Documents": String(result.stats.documents),
      "X-Datev-Invoices": String(result.stats.invoices),
      "X-Datev-Bank": String(result.stats.bankTransactions),
      "X-Datev-Missing": String(result.stats.missingFiles),
    },
  });
}
