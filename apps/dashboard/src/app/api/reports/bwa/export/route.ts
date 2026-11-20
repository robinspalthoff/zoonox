import { NextRequest, NextResponse } from "next/server";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { getTranslations } from "next-intl/server";
import type { SkrType } from "@prisma/client";

import { requireTenantOrThrow } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { computeBwa } from "@/lib/reports/bwa";
import type { ProfitLossMethod } from "@/lib/reports/profit-loss";
import { BwaPDF } from "@/components/pdf/bwa-pdf";

export async function GET(req: NextRequest) {
  let t;
  try {
    t = await requireTenantOrThrow();
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const now = new Date();
  const yearRaw = sp.get("year");
  const yearParsed = yearRaw ? parseInt(yearRaw, 10) : NaN;
  // Mirror the page-side clamp so a hand-crafted URL can't blow up
  // the month iteration.
  const year =
    Number.isFinite(yearParsed) && yearParsed >= 2000 && yearParsed <= now.getFullYear() + 5
      ? yearParsed
      : now.getFullYear();
  const method: ProfitLossMethod = sp.get("method") === "GUV" ? "GUV" : "EUR";
  const compare = sp.get("compare") !== "0";

  const settings = await db.companySettings.findUnique({
    where: { tenantId: t.tenantId },
  });
  const skrType = (settings?.skrType ?? "SKR03") as SkrType;

  const result = await computeBwa({
    tenantId: t.tenantId,
    year,
    method,
    skrType,
    includePrior: compare,
  });

  // Resolve all PDF-bound strings server-side so the PDF component
  // stays a pure renderer (no `useTranslations` inside @react-pdf,
  // which doesn't run inside React context).
  const tBwa = await getTranslations("reports.bwa");
  const tRows = await getTranslations("reports.bwa.rows");
  const tMonths = await getTranslations("reports.bwa.table.months");
  const tControls = await getTranslations("reports.bwa.controls");
  const tPdf = await getTranslations("reports.bwa.pdf");
  const tTable = await getTranslations("reports.bwa.table");
  const tVat = await getTranslations("reports.bwa.vat");

  const rowLabels: Record<string, string> = {};
  for (const key of [
    "umsatzerloese",
    "gesamtleistung",
    "wareneinsatz",
    "rohertrag",
    "personalkosten",
    "raumkosten",
    "versicherungen",
    "kfz_kosten",
    "werbe_reisekosten",
    "vertriebskosten",
    "abschreibungen",
    "sonstige_kosten",
    "gesamtkosten",
    "betriebsergebnis",
  ]) {
    rowLabels[key] = tRows(key);
  }

  const generatedAt = new Date();
  const buffer = await renderToBuffer(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(BwaPDF, {
      settings,
      result,
      generatedAt,
      i18n: {
        monthLabels: Array.from({ length: 12 }, (_, i) => tMonths(String(i + 1))),
        rowLabels,
        methodLabel: method === "EUR" ? tControls("methodEUR") : tControls("methodGuV"),
        kicker: tPdf("kicker"),
        title: tPdf("title"),
        periodLabel: tPdf("period"),
        createdAtLabel: tPdf("createdAt"),
        methodMetaLabel: tPdf("method"),
        yearTotalLabel: tTable("yearTotal", { year }),
        priorYearTotalLabel: tTable("yearTotalPrior", { year: year - 1 }),
        yearChangeLabel: tTable("yearChange"),
        categoryLabel: tTable("category"),
        vatTitle: tVat("title"),
        vatSales: tVat("salesVat"),
        vatInput: tVat("inputVat"),
        vatBalance: tVat("balance"),
        disclaimer: tBwa("disclaimer"),
        signaturePlace: tPdf("signaturePlace"),
        signatureLine: tPdf("signatureLine"),
        preparedBy: (date: string) => tPdf("preparedBy", { date }),
      },
    }) as any,
  );

  const stamp = generatedAt.toISOString().slice(0, 10);
  const filename = `${stamp}_BWA_${year}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition":
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
