// Buchungen eines Voranmeldungszeitraums laden und in Formularwerte übersetzen.
//
// Hier liegt die einzige Datenbankabfrage des UStVA-Moduls. Die Aggregation
// selbst steckt in compute.ts und bleibt damit ohne DB testbar.

import { db } from "@/lib/db";
import { isOrphanSource, loadLiveSourceIds } from "@/lib/journal/orphan-guard";
import { computeUstva, type UstvaResult, type UstvaSourceLine } from "./compute";
import { resolveForm, type ResolvedForm } from "./forms";
import { toNetAndVat } from "./line-mapping";
import type { SourceItem } from "@/lib/reports/source-item";

/**
 * Beleg hinter einem Formularwert — für den Drill-down in der Ansicht.
 *
 * Bewusst derselbe Typ wie in der UStVA-Übersicht und der GuV: beide Ansichten
 * teilen sich die Popup-Komponente, also müssen sie dieselbe Sprache sprechen.
 */
export type UstvaSource = SourceItem;

export type UstvaPeriod = {
  from: Date;
  /** Exklusiv. */
  to: Date;
};

export type UstvaReport = ResolvedForm & {
  result: UstvaResult<UstvaSource>;
};

export async function loadUstvaReport(
  tenantId: string,
  period: UstvaPeriod,
  year: number,
): Promise<UstvaReport> {
  const resolved = resolveForm(year);

  const [liveSources, rawLines] = await Promise.all([
    loadLiveSourceIds(tenantId),
    db.journalLine.findMany({
      where: {
        // Maßgeblich ist der Steuerschlüssel, nicht die Herkunft der Buchung.
        // Eine Buchung mit Steuerschlüssel ist ein steuerlich relevanter
        // Vorgang des Zeitraums und gehört in die Voranmeldung — unabhängig
        // davon, ob sie aus einer Rechnung, einem Beleg, dem Kassenbuch oder
        // einer Handbuchung stammt. Der Orphan-Guard unten sortiert Buchungen
        // aus, deren Beleg nicht mehr existiert.
        vatCode: { not: null },
        entry: {
          tenantId,
          date: { gte: period.from, lt: period.to },
        },
      },
      include: {
        entry: {
          select: {
            id: true,
            number: true,
            date: true,
            description: true,
            sourceType: true,
            sourceId: true,
          },
        },
      },
      orderBy: { entry: { date: "asc" } },
    }),
  ]);

  // Buchungen ohne lebenden Beleg fliegen raus — gleiche Regel wie in P&L,
  // BWA und DATEV-Export.
  const lines = rawLines.filter(
    (l) => !isOrphanSource(liveSources, l.entry.sourceType, l.entry.sourceId),
  );

  // Anzeigenamen der referenzierten Belege vorab laden, damit der Drill-down
  // Rechnungsnummer bzw. Lieferant zeigt statt einer Journal-Referenz.
  const invoiceIds = [
    ...new Set(
      lines
        .filter((l) => l.entry.sourceType === "INVOICE" && l.entry.sourceId)
        .map((l) => l.entry.sourceId as string),
    ),
  ];
  const documentIds = [
    ...new Set(
      lines
        .filter((l) => l.entry.sourceType === "DOCUMENT" && l.entry.sourceId)
        .map((l) => l.entry.sourceId as string),
    ),
  ];

  const [invoices, documents] = await Promise.all([
    invoiceIds.length
      ? db.invoice
          .findMany({
            where: { tenantId, id: { in: invoiceIds } },
            select: { id: true, number: true, contact: { select: { name: true } } },
          })
          .then((rs) => new Map(rs.map((r) => [r.id, r])))
      : Promise.resolve(new Map()),
    documentIds.length
      ? db.document
          .findMany({
            where: { tenantId, id: { in: documentIds } },
            select: {
              id: true,
              documentNumber: true,
              recognizedSupplier: true,
              fileName: true,
            },
          })
          .then((rs) => new Map(rs.map((r) => [r.id, r])))
      : Promise.resolve(new Map()),
  ]);

  const sourceLines: UstvaSourceLine<UstvaSource>[] = [];

  for (const l of lines) {
    if (!l.vatCode) continue;
    const { net, vat } = toNetAndVat(
      l.vatCode,
      Number(l.debit),
      Number(l.credit),
      Number(l.vatAmount ?? 0),
    );
    if (Math.abs(net) < 0.005 && Math.abs(vat) < 0.005) continue;

    const e = l.entry;
    let source: UstvaSource;
    if (e.sourceType === "INVOICE" && e.sourceId) {
      const inv = invoices.get(e.sourceId);
      source = {
        kind: "invoice",
        id: e.sourceId,
        label: inv?.number ?? e.description,
        secondary: inv?.contact?.name ?? null,
        date: e.date.toISOString(),
        net,
        vat,
        href: `/dashboard/invoices/${e.sourceId}`,
      };
    } else if (e.sourceType === "DOCUMENT" && e.sourceId) {
      const d = documents.get(e.sourceId);
      source = {
        kind: "document",
        id: e.sourceId,
        label: d?.documentNumber || d?.recognizedSupplier || d?.fileName || e.description,
        secondary: d?.documentNumber ? d?.recognizedSupplier ?? null : null,
        date: e.date.toISOString(),
        net,
        vat,
        href: `/dashboard/documents/${e.sourceId}`,
      };
    } else {
      source = {
        kind: "journal",
        id: e.id,
        label: `#${e.number} · ${e.description}`,
        secondary: null,
        date: e.date.toISOString(),
        net,
        vat,
        href: `/dashboard/taxes/journal/${e.id}`,
      };
    }

    sourceLines.push({ vatCode: l.vatCode, net, vat, source });
  }

  return { ...resolved, result: computeUstva(resolved.form, sourceLines) };
}
