// Phase-2 Belegbilder collector.
//
// Walks the documents that fall into the export period, reads each file
// from the storage adapter, and yields entries to drop into the export
// ZIP under "Belege/". A "Belegliste.csv" provides Belegnummer →
// filename → linked Buchung mapping so the StB can match attachments to
// posted entries.

import path from "node:path";
import type { Document, Invoice } from "@prisma/client";
import {
  csvText,
  csvNum,
  csvRow,
  encodeWin1252,
} from "./format";
import { storage } from "@/lib/storage";

export type BelegFile = {
  filename: string; // path inside ZIP, e.g. "Belege/RE-2025-001.pdf"
  data: Buffer;
};

export type DocumentForBeleg = Pick<
  Document,
  | "id"
  | "fileName"
  | "fileType"
  | "storagePath"
  | "documentNumber"
  | "recognizedDocNumber"
  | "category"
  | "createdAt"
> & {
  recognizedAmount?: unknown; // Decimal — accept as-is
  recognizedDate?: Date | null;
};

export type InvoiceForBeleg = Pick<
  Invoice,
  "id" | "number" | "issueDate" | "total" | "type"
>;

const SAFE_FN = /[^A-Za-z0-9._-]/g;

function safeName(stem: string, ext: string): string {
  const cleaned = stem.replace(SAFE_FN, "_").slice(0, 80) || "beleg";
  return `${cleaned}${ext}`;
}

function extOf(filename: string, fallbackMime?: string): string {
  const e = path.extname(filename).toLowerCase();
  if (e) return e;
  if (fallbackMime?.includes("pdf")) return ".pdf";
  if (fallbackMime?.includes("png")) return ".png";
  if (fallbackMime?.includes("jpeg") || fallbackMime?.includes("jpg")) return ".jpg";
  return ".bin";
}

async function readFromStorage(storagePath: string): Promise<Buffer | null> {
  return storage.get(storagePath);
}

export type CollectedBelege = {
  files: BelegFile[];
  beleglisteCsv: Buffer;
  missing: number; // count of documents whose files could not be read
};

export async function collectDocumentBelege(
  documents: DocumentForBeleg[],
): Promise<CollectedBelege> {
  const files: BelegFile[] = [];
  const rows: string[] = [];
  rows.push(
    csvRow(
      ["Belegnummer", "Datum", "Betrag", "Kategorie", "Datei", "Original"].map((c) =>
        csvText(c),
      ),
    ),
  );

  let missing = 0;
  const used = new Set<string>();

  for (const doc of documents) {
    const data = await readFromStorage(doc.storagePath);
    if (!data) {
      missing++;
      continue;
    }
    const stem =
      doc.documentNumber || doc.recognizedDocNumber || doc.id.slice(0, 12);
    let name = safeName(stem, extOf(doc.fileName, doc.fileType));
    let dedup = 1;
    while (used.has(name)) {
      const ext = path.extname(name);
      const base = name.slice(0, -ext.length);
      name = `${base}_${dedup++}${ext}`;
    }
    used.add(name);
    files.push({ filename: `Belege/${name}`, data });

    const date = doc.recognizedDate ?? doc.createdAt;
    const amount = doc.recognizedAmount != null ? Number(doc.recognizedAmount) : 0;
    rows.push(
      csvRow([
        csvText(stem, 36),
        csvText(formatDDMMYYYY(date), 10),
        csvNum(amount),
        csvText(String(doc.category), 30),
        csvText(name, 80),
        csvText(doc.fileName, 120),
      ]),
    );
  }

  return {
    files,
    beleglisteCsv: encodeWin1252(rows.join("")),
    missing,
  };
}

export type InvoicePdfProvider = (invoiceId: string) => Promise<Buffer | null>;

export async function collectInvoiceBelege(
  invoices: InvoiceForBeleg[],
  pdfProvider: InvoicePdfProvider,
): Promise<CollectedBelege> {
  const files: BelegFile[] = [];
  const rows: string[] = [];
  rows.push(
    csvRow(
      ["Belegnummer", "Datum", "Betrag", "Typ", "Datei"].map((c) => csvText(c)),
    ),
  );
  let missing = 0;
  const used = new Set<string>();

  for (const inv of invoices) {
    const pdf = await pdfProvider(inv.id);
    if (!pdf) {
      missing++;
      continue;
    }
    let name = safeName(inv.number, ".pdf");
    let dedup = 1;
    while (used.has(name)) {
      name = `${inv.number.replace(SAFE_FN, "_")}_${dedup++}.pdf`;
    }
    used.add(name);
    files.push({ filename: `Belege/${name}`, data: pdf });

    rows.push(
      csvRow([
        csvText(inv.number, 36),
        csvText(formatDDMMYYYY(inv.issueDate), 10),
        csvNum(Number(inv.total)),
        csvText(inv.type === "CREDIT_NOTE" ? "Gutschrift" : "Rechnung", 20),
        csvText(name, 80),
      ]),
    );
  }

  return {
    files,
    beleglisteCsv: encodeWin1252(rows.join("")),
    missing,
  };
}

function formatDDMMYYYY(d: Date): string {
  const day = d.getDate().toString().padStart(2, "0");
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  return `${day}.${m}.${d.getFullYear()}`;
}
