// DATEV bank-movement listing.
//
// Bank transactions don't all become double-entry bookings: per the
// posting architecture, only `isPrivate` movements get their own journal
// entry, while business movements hit the books indirectly via the
// invoice/document payment they're matched to. As a result the
// Buchungsstapel never shows the bank account's raw movements.
//
// This builder emits a flat "Belegliste-Bank.csv" so the Steuerberater
// gets the full Kontoauszug for the period — matched, unmatched, and
// ignored alike — alongside a pointer to the linked Beleg where one
// exists. It is informational (no Soll/Haben), mirroring the Belegliste.

import type { BankTransaction } from "@prisma/client";
import { csvText, csvNum, csvRow, encodeWin1252 } from "./format";

export type BankTxForExport = Pick<
  BankTransaction,
  | "date"
  | "valueDate"
  | "amount"
  | "currency"
  | "counterpartName"
  | "counterpartIban"
  | "purpose"
  | "category"
  | "status"
  | "isPrivate"
> & {
  // Resolved Rechnungs-/Belegnummer of the matched source, if any.
  reference?: string | null;
};

function statusLabel(status: BankTransaction["status"]): string {
  switch (status) {
    case "MATCHED":
      return "zugeordnet";
    case "IGNORED":
      return "ignoriert";
    default:
      return "offen";
  }
}

function formatDDMMYYYY(d: Date): string {
  const day = d.getUTCDate().toString().padStart(2, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${day}.${m}.${d.getUTCFullYear()}`;
}

export function buildBankListeCsv(txs: BankTxForExport[]): Buffer {
  const rows: string[] = [];
  rows.push(
    csvRow(
      [
        "Buchungsdatum",
        "Wertstellung",
        "Betrag",
        "Währung",
        "Gegenpartei",
        "IBAN",
        "Verwendungszweck",
        "Kategorie",
        "Status",
        "Privat",
        "Verknüpfung",
      ].map((c) => csvText(c)),
    ),
  );

  for (const tx of txs) {
    rows.push(
      csvRow([
        csvText(formatDDMMYYYY(tx.date), 10),
        csvText(tx.valueDate ? formatDDMMYYYY(tx.valueDate) : "", 10),
        csvNum(Number(tx.amount)),
        csvText(tx.currency, 3),
        csvText(tx.counterpartName, 80),
        csvText(tx.counterpartIban, 34),
        csvText(tx.purpose, 140),
        csvText(tx.category, 40),
        csvText(statusLabel(tx.status), 12),
        csvText(tx.isPrivate ? "ja" : "nein", 4),
        csvText(tx.reference ?? "", 40),
      ]),
    );
  }

  return encodeWin1252(rows.join(""));
}
