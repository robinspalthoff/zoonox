// DATEV Buchungsstapel CSV generator.
//
// Format: EXTF Version 700, Datenkategorie 21 (Buchungsstapel),
// Formatname "Buchungsstapel", Formatversion 12.
//
// Reads from the GoBD-konforme JournalEntry/JournalLine ledger and emits
// one DATEV "Buchungssatz" per (Soll-line × Haben-line) pair. For our
// typical entries (1 Soll + N Haben, or N Soll + 1 Haben — e.g. invoice
// posting "Forderung an Erlöse + USt") this produces N records sharing
// the same Belegfeld 1 (Belegnummer), which is exactly what DATEV expects.

import type { JournalEntry, JournalLine } from "@prisma/client";
import {
  csvText,
  csvNum,
  csvInt,
  csvRow,
  fmtYYYYMMDD,
  fmtTTMM,
  fmtTimestamp17,
  encodeWin1252,
} from "./format";

export type BuchungsstapelOptions = {
  consultantNumber: number; // Beraternummer (1001-9999999)
  clientNumber: number; // Mandantennummer (1-99999)
  fiscalYearStart: Date; // Wirtschaftsjahr-Beginn
  dateFrom: Date; // Exportzeitraum-Start
  dateTo: Date; // Exportzeitraum-Ende
  accountLength: 4 | 5 | 6 | 7 | 8; // Sachkontenlänge
  description?: string; // Bezeichnung des Stapels (max 30)
  exportedBy?: string; // "Exportiert von" (max 25)
  locked?: boolean; // Festschreibung (1) oder lose (0)
  generatedAt?: Date; // override for tests
};

export type EntryWithLines = JournalEntry & {
  lines: JournalLine[];
  // Optional source-document number to use as Belegfeld 1.
  sourceNumber?: string | null;
};

// Header row (Format 12 has 116 columns) — column-name labels for row 2.
const COLUMN_HEADERS_FMT12 = [
  "Umsatz (ohne Soll/Haben-Kz)",
  "Soll/Haben-Kennzeichen",
  "WKZ Umsatz",
  "Kurs",
  "Basis-Umsatz",
  "WKZ Basis-Umsatz",
  "Konto",
  "Gegenkonto (ohne BU-Schlüssel)",
  "BU-Schlüssel",
  "Belegdatum",
  "Belegfeld 1",
  "Belegfeld 2",
  "Skonto",
  "Buchungstext",
  "Postensperre",
  "Diverse Adressnummer",
  "Geschäftspartnerbank",
  "Sachverhalt",
  "Zinssperre",
  "Beleglink",
  "Beleginfo - Art 1",
  "Beleginfo - Inhalt 1",
  "Beleginfo - Art 2",
  "Beleginfo - Inhalt 2",
  "Beleginfo - Art 3",
  "Beleginfo - Inhalt 3",
  "Beleginfo - Art 4",
  "Beleginfo - Inhalt 4",
  "Beleginfo - Art 5",
  "Beleginfo - Inhalt 5",
  "Beleginfo - Art 6",
  "Beleginfo - Inhalt 6",
  "Beleginfo - Art 7",
  "Beleginfo - Inhalt 7",
  "Beleginfo - Art 8",
  "Beleginfo - Inhalt 8",
  "KOST1 - Kostenstelle",
  "KOST2 - Kostenstelle",
  "Kost-Menge",
  "EU-Mitgliedstaat u. USt-IdNr.",
  "EU-Steuersatz",
  "Abw. Versteuerungsart",
  "Sachverhalt L+L",
  "Funktionsergänzung L+L",
  "BU 49 Hauptfunktionstyp",
  "BU 49 Hauptfunktionsnummer",
  "BU 49 Funktionsergänzung",
  "Zusatzinformation - Art 1",
  "Zusatzinformation - Inhalt 1",
  "Zusatzinformation - Art 2",
  "Zusatzinformation - Inhalt 2",
  "Zusatzinformation - Art 3",
  "Zusatzinformation - Inhalt 3",
  "Zusatzinformation - Art 4",
  "Zusatzinformation - Inhalt 4",
  "Zusatzinformation - Art 5",
  "Zusatzinformation - Inhalt 5",
  "Zusatzinformation - Art 6",
  "Zusatzinformation - Inhalt 6",
  "Zusatzinformation - Art 7",
  "Zusatzinformation - Inhalt 7",
  "Zusatzinformation - Art 8",
  "Zusatzinformation - Inhalt 8",
  "Zusatzinformation - Art 9",
  "Zusatzinformation - Inhalt 9",
  "Zusatzinformation - Art 10",
  "Zusatzinformation - Inhalt 10",
  "Zusatzinformation - Art 11",
  "Zusatzinformation - Inhalt 11",
  "Zusatzinformation - Art 12",
  "Zusatzinformation - Inhalt 12",
  "Zusatzinformation - Art 13",
  "Zusatzinformation - Inhalt 13",
  "Zusatzinformation - Art 14",
  "Zusatzinformation - Inhalt 14",
  "Zusatzinformation - Art 15",
  "Zusatzinformation - Inhalt 15",
  "Zusatzinformation - Art 16",
  "Zusatzinformation - Inhalt 16",
  "Zusatzinformation - Art 17",
  "Zusatzinformation - Inhalt 17",
  "Zusatzinformation - Art 18",
  "Zusatzinformation - Inhalt 18",
  "Zusatzinformation - Art 19",
  "Zusatzinformation - Inhalt 19",
  "Zusatzinformation - Art 20",
  "Zusatzinformation - Inhalt 20",
  "Stück",
  "Gewicht",
  "Zahlweise",
  "Forderungsart",
  "Veranlagungsjahr",
  "Zugeordnete Fälligkeit",
  "Skontotyp",
  "Auftragsnummer",
  "Buchungstyp",
  "USt-Schlüssel (Anzahlungen)",
  "EU-Mitgliedstaat (Anzahlungen)",
  "Sachverhalt L+L (Anzahlungen)",
  "EU-Steuersatz (Anzahlungen)",
  "Erlöskonto (Anzahlungen)",
  "Herkunft-Kz",
  "Buchungs GUID",
  "KOST-Datum",
  "SEPA-Mandatsreferenz",
  "Skontosperre",
  "Gesellschaftername",
  "Beteiligtennummer",
  "Identifikationsnummer",
  "Zeichnernummer",
  "Postensperre bis",
  "Bezeichnung SoBil-Sachverhalt",
  "Kennzeichen SoBil-Buchung",
  "Festschreibung",
  "Leistungsdatum",
  "Datum Zuord. Steuerperiode",
];

function buildHeaderRow(opts: BuchungsstapelOptions): string {
  const generated = opts.generatedAt ?? new Date();
  const cells = [
    csvText("EXTF"),
    csvInt(700),
    csvInt(21),
    csvText("Buchungsstapel"),
    csvInt(12),
    csvInt(fmtTimestamp17(generated)),
    "", // imported
    csvText("RE"), // Herkunft (2 chars)
    csvText(opts.exportedBy ?? "zoonox", 25),
    "", // imported by
    csvInt(opts.consultantNumber),
    csvInt(opts.clientNumber),
    csvInt(fmtYYYYMMDD(opts.fiscalYearStart)),
    csvInt(opts.accountLength),
    csvInt(fmtYYYYMMDD(opts.dateFrom)),
    csvInt(fmtYYYYMMDD(opts.dateTo)),
    csvText(opts.description ?? "Buchungsstapel", 30),
    "", // Diktatkürzel
    csvInt(1), // Buchungstyp: Finanzbuchführung
    csvInt(0), // Rechnungslegungszweck: unabhängig
    csvInt(opts.locked ? 1 : 0), // Festschreibung
    csvText("EUR"), // WKZ
    "", "", "", "", "", "", "", "", "",
  ];
  return csvRow(cells);
}

// Pad a row to the full Format-12 column count (116) with empty cells.
function padTo116(cells: string[]): string[] {
  const out = cells.slice();
  while (out.length < 116) out.push("");
  return out;
}

type Buchungssatz = {
  umsatz: number; // always positive
  sollHaben: "S" | "H";
  konto: string;
  gegenkonto: string;
  belegdatum: Date;
  belegfeld1?: string;
  buchungstext?: string;
  guid?: string;
  festschreibung: boolean;
};

function buchungssatzRow(b: Buchungssatz): string {
  const cells: string[] = [
    csvNum(b.umsatz),
    csvText(b.sollHaben),
    csvText("EUR"),
    "", // Kurs
    "", // Basis-Umsatz
    "", // WKZ Basis-Umsatz
    csvInt(b.konto),
    csvInt(b.gegenkonto),
    "", // BU-Schlüssel (we already split by VAT in journal)
    csvInt(fmtTTMM(b.belegdatum)),
    csvText(b.belegfeld1 ?? "", 36),
    "", // Belegfeld 2
    "", // Skonto
    csvText(b.buchungstext ?? "", 60),
  ];
  // Pad to position 102 (Buchungs GUID is column 103, 1-based)
  while (cells.length < 102) cells.push("");
  cells.push(csvText(b.guid ?? "", 36)); // 103: Buchungs GUID
  cells.push(""); // 104: KOST-Datum
  cells.push(""); // 105: SEPA
  cells.push(""); // 106: Skontosperre
  cells.push(""); // 107: Gesellschaftername
  cells.push(""); // 108: Beteiligtennummer
  cells.push(""); // 109: Identifikationsnummer
  cells.push(""); // 110: Zeichnernummer
  cells.push(""); // 111: Postensperre bis
  cells.push(""); // 112: Bezeichnung SoBil-Sachverhalt
  cells.push(""); // 113: Kennzeichen SoBil-Buchung
  cells.push(csvInt(b.festschreibung ? 1 : 0)); // 114: Festschreibung
  cells.push(""); // 115: Leistungsdatum
  cells.push(""); // 116: Datum Zuord. Steuerperiode
  return csvRow(padTo116(cells));
}

// Convert one JournalEntry into one or more DATEV Buchungssätze.
//
// Strategy:
// - 1 Soll-line + N Haben-lines → N Sätze (single Konto, splits Gegenkonto)
// - N Soll-lines + 1 Haben-line → N Sätze (single Gegenkonto)
// - exactly 1 line (single-entry mode)  → 1 Satz, Gegenkonto leer (StB ergänzt)
// - else (M:N) → emit each line as its own row with empty Gegenkonto
//   (rare; signals manual review needed)
export function entryToBuchungssaetze(
  entry: EntryWithLines,
  festschreibung: boolean,
): Buchungssatz[] {
  const debits = entry.lines.filter((l) => Number(l.debit) > 0);
  const credits = entry.lines.filter((l) => Number(l.credit) > 0);
  const beleg = entry.sourceNumber ?? String(entry.number);
  const text = entry.description;
  const date = entry.date;

  const mk = (
    umsatz: number,
    konto: string,
    gegenkonto: string,
    description?: string | null,
  ): Buchungssatz => ({
    umsatz: Math.abs(umsatz),
    sollHaben: "S",
    konto,
    gegenkonto,
    belegdatum: date,
    belegfeld1: beleg,
    buchungstext: description ?? text,
    guid: entry.id,
    festschreibung,
  });

  if (debits.length === 1 && credits.length >= 1) {
    return credits.map((c) =>
      mk(Number(c.credit), debits[0].accountCode, c.accountCode, c.description),
    );
  }
  if (credits.length === 1 && debits.length >= 1) {
    return debits.map((d) =>
      mk(Number(d.debit), d.accountCode, credits[0].accountCode, d.description),
    );
  }
  if (entry.lines.length === 1) {
    const l = entry.lines[0];
    const amt = Number(l.debit) + Number(l.credit);
    return [
      {
        ...mk(amt, l.accountCode, "", l.description),
        sollHaben: Number(l.debit) > 0 ? "S" : "H",
      },
    ];
  }
  // Fallback for unbalanced or M:N patterns — emit each line raw.
  return entry.lines.map((l) => {
    const amt = Number(l.debit) + Number(l.credit);
    return {
      ...mk(amt, l.accountCode, "", l.description),
      sollHaben: (Number(l.debit) > 0 ? "S" : "H") as "S" | "H",
    };
  });
}

export function buildBuchungsstapelCsv(
  entries: EntryWithLines[],
  opts: BuchungsstapelOptions,
): Buffer {
  const parts: string[] = [];
  parts.push(buildHeaderRow(opts));
  parts.push(csvRow(COLUMN_HEADERS_FMT12.map((c) => csvText(c))));

  const festschreibung = opts.locked ?? false;
  for (const entry of entries) {
    if (entry.status === "REVERSED") continue;
    for (const b of entryToBuchungssaetze(entry, festschreibung)) {
      if (b.umsatz < 0.005) continue;
      parts.push(buchungssatzRow(b));
    }
  }
  return encodeWin1252(parts.join(""));
}
