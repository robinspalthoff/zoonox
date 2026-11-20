// DATEV export orchestrator. Produces a single ZIP buffer containing:
//
//   buchungsstapel.csv      — DATEV EXTF Format 21 v12 (Buchungssätze)
//   kontenbeschriftungen.csv — DATEV EXTF Format 16 v5 (Stammdaten)
//   Belege/<…>.pdf|jpg|...   — original document files (optional)
//   Belegliste.csv           — Belegnummer ↔ filename ↔ Buchung mapping
//   README.txt               — short note describing contents + period
//
// Reads from the GoBD-konforme JournalEntry/JournalLine ledger; never
// touches Invoice/Document totals directly.

import JSZip from "jszip";
import { db } from "@/lib/db";
import { getTranslations } from "next-intl/server";
import {
  buildBuchungsstapelCsv,
  type BuchungsstapelOptions,
  type EntryWithLines,
} from "./buchungsstapel";
import { buildStammdatenCsv, type AccountLabel } from "./stammdaten";
import {
  collectDocumentBelege,
  collectInvoiceBelege,
  type DocumentForBeleg,
  type InvoiceForBeleg,
  type InvoicePdfProvider,
} from "./belege";
import { buildBankListeCsv, type BankTxForExport } from "./bank";
import { getSkrAccount } from "@/lib/skr-accounts";
import { isOrphanSource, loadLiveSourceIds } from "@/lib/journal/orphan-guard";
import { encodeWin1252 } from "./format";
import type { SkrType } from "@prisma/client";

export type DatevExportInput = {
  tenantId: string;
  consultantNumber: number;
  clientNumber: number;
  fiscalYearStart: Date;
  dateFrom: Date;
  dateTo: Date;
  accountLength: 4 | 5 | 6 | 7 | 8;
  description?: string;
  exportedBy?: string;
  locked: boolean;
  // Phase-2 toggles
  includeBelegbilder: boolean;
  includeDocuments: boolean;
  includeInvoices: boolean;
  // Flat Kontoauszug-CSV of all bank movements in the period.
  includeBank: boolean;
  // Source filter
  includeReversed: boolean;
  // SKR for Stammdaten label lookup
  skrType: SkrType;
};

export type DatevExportResult = {
  zip: Buffer;
  filename: string;
  stats: {
    entries: number;
    accounts: number;
    documents: number;
    invoices: number;
    bankTransactions: number;
    missingFiles: number;
  };
};

async function loadEntries(
  input: DatevExportInput,
): Promise<EntryWithLines[]> {
  const entriesRaw = await db.journalEntry.findMany({
    where: {
      tenantId: input.tenantId,
      date: { gte: input.dateFrom, lte: input.dateTo },
      ...(input.includeReversed ? {} : { status: "POSTED" }),
    },
    include: { lines: { orderBy: { position: "asc" } } },
    orderBy: [{ date: "asc" }, { number: "asc" }],
  });

  // Defensive orphan filter — see lib/journal/orphan-guard. A DATEV
  // export carrying phantom invoice/document bookings would be flagged
  // by the Steuerberater immediately, so we drop them here too. Manual
  // / bank / asset entries (no Beleg sourceId) pass through unchanged.
  const liveSources = await loadLiveSourceIds(input.tenantId);
  const entries = entriesRaw.filter(
    (e) => !isOrphanSource(liveSources, e.sourceType, e.sourceId),
  );

  // Resolve sourceNumber per entry (Invoice.number / Document.documentNumber)
  // in one round-trip per source type.
  const invoiceIds = entries
    .filter((e) => e.sourceType === "INVOICE" && e.sourceId)
    .map((e) => e.sourceId!) as string[];
  const docIds = entries
    .filter((e) => e.sourceType === "DOCUMENT" && e.sourceId)
    .map((e) => e.sourceId!) as string[];

  const [invoices, documents] = await Promise.all([
    invoiceIds.length
      ? db.invoice.findMany({
          where: { tenantId: input.tenantId, id: { in: invoiceIds } },
          select: { id: true, number: true },
        })
      : Promise.resolve([]),
    docIds.length
      ? db.document.findMany({
          where: { tenantId: input.tenantId, id: { in: docIds } },
          select: {
            id: true,
            documentNumber: true,
            recognizedDocNumber: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const invMap = new Map(invoices.map((i) => [i.id, i.number]));
  const docMap = new Map(
    documents.map((d) => [
      d.id,
      d.documentNumber || d.recognizedDocNumber || null,
    ]),
  );

  return entries.map((e) => {
    const sourceNumber =
      e.sourceType === "INVOICE" && e.sourceId ? invMap.get(e.sourceId) ?? null
      : e.sourceType === "DOCUMENT" && e.sourceId ? docMap.get(e.sourceId) ?? null
      : null;
    return { ...e, sourceNumber };
  });
}

async function loadAccountLabels(
  entries: EntryWithLines[],
  skrType: SkrType,
): Promise<AccountLabel[]> {
  const t = await getTranslations({ locale: "de", namespace: "skrAccounts" });
  const codes = new Set<string>();
  for (const e of entries) for (const l of e.lines) codes.add(l.accountCode);

  return [...codes]
    .sort()
    .map((code) => {
      const entry = getSkrAccount(code, skrType);
      let name = code;
      if (entry) {
        try {
          name = t(`accounts.${skrType}.${code}`);
        } catch {
          name = code;
        }
      }
      return { code, name, language: "de" };
    });
}

export async function buildDatevExport(
  input: DatevExportInput,
  invoicePdfProvider?: InvoicePdfProvider,
): Promise<DatevExportResult> {
  const opts: BuchungsstapelOptions = {
    consultantNumber: input.consultantNumber,
    clientNumber: input.clientNumber,
    fiscalYearStart: input.fiscalYearStart,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    accountLength: input.accountLength,
    description: input.description,
    exportedBy: input.exportedBy,
    locked: input.locked,
  };

  const entries = await loadEntries(input);
  const buchungsstapelCsv = buildBuchungsstapelCsv(entries, opts);
  const accountLabels = await loadAccountLabels(entries, input.skrType);
  const stammdatenCsv = buildStammdatenCsv(accountLabels, opts);

  let belegStats = { documents: 0, invoices: 0, missing: 0 };
  const belegFiles: { filename: string; data: Buffer }[] = [];
  let documentBeleglisteCsv: Buffer | null = null;
  let invoiceBeleglisteCsv: Buffer | null = null;

  if (input.includeBelegbilder) {
    if (input.includeDocuments) {
      const documents = (await db.document.findMany({
        where: {
          tenantId: input.tenantId,
          deletedAt: null,
          // Match the export period against the Belegdatum (recognizedDate),
          // mirroring how the booking in the Buchungsstapel is dated. The
          // upload timestamp (createdAt) is only a fallback for documents
          // that never got a recognized date — otherwise a receipt booked
          // into the period but uploaded later would be silently dropped
          // from Belege/ while its booking is present in the stapel.
          OR: [
            { recognizedDate: { gte: input.dateFrom, lte: input.dateTo } },
            {
              recognizedDate: null,
              createdAt: { gte: input.dateFrom, lte: input.dateTo },
            },
          ],
        },
        select: {
          id: true,
          fileName: true,
          fileType: true,
          storagePath: true,
          documentNumber: true,
          recognizedDocNumber: true,
          recognizedAmount: true,
          recognizedDate: true,
          category: true,
          createdAt: true,
        },
      })) as unknown as DocumentForBeleg[];

      const collected = await collectDocumentBelege(documents);
      belegFiles.push(...collected.files);
      documentBeleglisteCsv = collected.beleglisteCsv;
      belegStats.documents = collected.files.length;
      belegStats.missing += collected.missing;
    }

    if (input.includeInvoices && invoicePdfProvider) {
      const invoices = (await db.invoice.findMany({
        where: {
          tenantId: input.tenantId,
          issueDate: { gte: input.dateFrom, lte: input.dateTo },
        },
        select: { id: true, number: true, issueDate: true, total: true, type: true },
      })) as InvoiceForBeleg[];

      const collected = await collectInvoiceBelege(invoices, invoicePdfProvider);
      belegFiles.push(...collected.files);
      invoiceBeleglisteCsv = collected.beleglisteCsv;
      belegStats.invoices = collected.files.length;
      belegStats.missing += collected.missing;
    }
  }

  // ── Bank movements (flat Kontoauszug CSV) ──
  let bankListeCsv: Buffer | null = null;
  let bankCount = 0;
  if (input.includeBank) {
    const txs = await db.bankTransaction.findMany({
      where: {
        tenantId: input.tenantId,
        date: { gte: input.dateFrom, lte: input.dateTo },
      },
      select: {
        date: true,
        valueDate: true,
        amount: true,
        currency: true,
        counterpartName: true,
        counterpartIban: true,
        purpose: true,
        category: true,
        status: true,
        isPrivate: true,
        invoiceId: true,
        documentId: true,
      },
      orderBy: [{ date: "asc" }],
    });

    // Resolve linked Rechnungs-/Belegnummern in one round-trip each.
    const invoiceIds = txs.map((t) => t.invoiceId).filter(Boolean) as string[];
    const documentIds = txs.map((t) => t.documentId).filter(Boolean) as string[];
    const [invoices, documents] = await Promise.all([
      invoiceIds.length
        ? db.invoice.findMany({
            where: { tenantId: input.tenantId, id: { in: invoiceIds } },
            select: { id: true, number: true },
          })
        : Promise.resolve([]),
      documentIds.length
        ? db.document.findMany({
            where: { tenantId: input.tenantId, id: { in: documentIds } },
            select: { id: true, documentNumber: true, recognizedDocNumber: true },
          })
        : Promise.resolve([]),
    ]);
    const invNumber = new Map(invoices.map((i) => [i.id, i.number]));
    const docNumber = new Map(
      documents.map((d) => [d.id, d.documentNumber || d.recognizedDocNumber || null]),
    );

    const rows: BankTxForExport[] = txs.map((tx) => ({
      ...tx,
      reference:
        (tx.invoiceId ? invNumber.get(tx.invoiceId) : null) ??
        (tx.documentId ? docNumber.get(tx.documentId) : null) ??
        null,
    }));
    bankListeCsv = buildBankListeCsv(rows);
    bankCount = rows.length;
  }

  // ── Pack ZIP ──
  const zip = new JSZip();
  zip.file("buchungsstapel.csv", buchungsstapelCsv);
  zip.file("kontenbeschriftungen.csv", stammdatenCsv);
  for (const f of belegFiles) zip.file(f.filename, f.data);
  if (documentBeleglisteCsv) {
    zip.file("Belegliste-Belege.csv", documentBeleglisteCsv);
  }
  if (invoiceBeleglisteCsv) {
    zip.file("Belegliste-Rechnungen.csv", invoiceBeleglisteCsv);
  }
  if (bankListeCsv) {
    zip.file("Belegliste-Bank.csv", bankListeCsv);
  }

  zip.file("README.txt", encodeWin1252(buildReadme(input, entries.length, belegStats, bankCount)));

  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const periodTag =
    input.dateFrom.toISOString().slice(0, 10).replace(/-/g, "") +
    "-" +
    input.dateTo.toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `DATEV-Export_${input.consultantNumber}_${input.clientNumber}_${periodTag}.zip`;

  return {
    zip: zipBuffer,
    filename,
    stats: {
      entries: entries.length,
      accounts: accountLabels.length,
      documents: belegStats.documents,
      invoices: belegStats.invoices,
      bankTransactions: bankCount,
      missingFiles: belegStats.missing,
    },
  };
}

function buildReadme(
  input: DatevExportInput,
  entryCount: number,
  beleg: { documents: number; invoices: number; missing: number },
  bankCount: number,
): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const lines = [
    "DATEV-Export aus Zoonox",
    "================================================",
    "",
    `Beraternummer:        ${input.consultantNumber}`,
    `Mandantennummer:      ${input.clientNumber}`,
    `Wirtschaftsjahresbeginn: ${fmt(input.fiscalYearStart)}`,
    `Zeitraum:             ${fmt(input.dateFrom)} – ${fmt(input.dateTo)}`,
    `Sachkontenlänge:      ${input.accountLength}`,
    `Festschreibung:       ${input.locked ? "ja" : "nein"}`,
    `Kontenrahmen:         ${input.skrType}`,
    "",
    "Inhalt:",
    `  buchungsstapel.csv          (${entryCount} Buchungen)`,
    `  kontenbeschriftungen.csv`,
  ];
  if (input.includeBelegbilder) {
    if (input.includeDocuments) lines.push(`  Belege/ + Belegliste-Belege.csv (${beleg.documents} Eingangsbelege)`);
    if (input.includeInvoices) lines.push(`  Belege/ + Belegliste-Rechnungen.csv (${beleg.invoices} Ausgangsrechnungen)`);
  }
  if (input.includeBank) {
    lines.push(`  Belegliste-Bank.csv          (${bankCount} Bankumsätze)`);
  }
  if (input.includeBelegbilder && beleg.missing > 0) {
    lines.push("");
    lines.push(`HINWEIS: ${beleg.missing} Belegdatei(en) konnten nicht gelesen werden.`);
  }
  lines.push("");
  lines.push("Import in DATEV Kanzlei-Rechnungswesen:");
  lines.push("  Bestand → Daten holen → Datev-Format → ZIP/CSV auswählen.");
  lines.push("");
  lines.push(`Generiert am ${new Date().toISOString()}`);
  return lines.join("\r\n");
}
