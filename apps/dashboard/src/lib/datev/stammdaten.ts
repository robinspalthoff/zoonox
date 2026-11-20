// DATEV Stammdaten (Konten-Beschriftungen) CSV generator.
//
// Format: EXTF Version 700, Datenkategorie 16 (Kontenbeschriftungen),
// Formatname "Kontenbeschriftungen", Formatversion 5.
//
// Emits one row per used SKR account with its German label, so the
// recipient's DATEV system shows readable names alongside numeric accounts.

import {
  csvText,
  csvInt,
  csvRow,
  fmtYYYYMMDD,
  fmtTimestamp17,
  encodeWin1252,
} from "./format";
import type { BuchungsstapelOptions } from "./buchungsstapel";

export type AccountLabel = {
  code: string;
  name: string;
  language?: string; // ISO 639-1, default "de"
};

const COLUMN_HEADERS_FMT5 = [
  "Konto",
  "Kontenbeschriftung",
  "Sprach-ID",
  "KontenbeschriftungLang",
];

function buildHeader(opts: BuchungsstapelOptions): string {
  const generated = opts.generatedAt ?? new Date();
  const cells = [
    csvText("EXTF"),
    csvInt(700),
    csvInt(16),
    csvText("Kontenbeschriftungen"),
    csvInt(5),
    csvInt(fmtTimestamp17(generated)),
    "",
    csvText("RE"),
    csvText(opts.exportedBy ?? "zoonox", 25),
    "",
    csvInt(opts.consultantNumber),
    csvInt(opts.clientNumber),
    csvInt(fmtYYYYMMDD(opts.fiscalYearStart)),
    csvInt(opts.accountLength),
    "", // Datum von (n/a for Stammdaten)
    "", // Datum bis (n/a)
    csvText("Kontenbeschriftungen", 30),
    "",
    csvInt(1),
    csvInt(0),
    csvInt(0),
    csvText("EUR"),
    "", "", "", "", "", "", "", "", "",
  ];
  return csvRow(cells);
}

export function buildStammdatenCsv(
  accounts: AccountLabel[],
  opts: BuchungsstapelOptions,
): Buffer {
  const parts: string[] = [];
  parts.push(buildHeader(opts));
  parts.push(csvRow(COLUMN_HEADERS_FMT5.map((c) => csvText(c))));
  for (const a of accounts) {
    parts.push(
      csvRow([
        csvInt(a.code),
        csvText(a.name, 40),
        csvText(a.language ?? "de"),
        csvText(a.name, 80),
      ]),
    );
  }
  return encodeWin1252(parts.join(""));
}
