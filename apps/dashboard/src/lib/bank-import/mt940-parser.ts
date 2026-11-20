/**
 * MT940 (SWIFT) bank statement parser.
 * Parses tag-based format: :20:, :25:, :60F:, :61:, :86:, :62F:
 */

import type { ParsedTransaction } from "./types";

/** Parse MT940 date: YYMMDD → YYYY-MM-DD */
function parseMt940Date(str: string): string | null {
  const m = str.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const fullYear = year >= 80 ? 1900 + year : 2000 + year;
  return `${fullYear}-${m[2]}-${m[3]}`;
}

/** Parse MT940 amount: "1234,56" → 1234.56 */
function parseMt940Amount(str: string): number {
  return parseFloat(str.replace(",", "."));
}

export function parseMt940(content: string): {
  transactions: ParsedTransaction[];
  errors: string[];
} {
  const transactions: ParsedTransaction[] = [];
  const errors: string[] = [];

  // Normalize line endings and join continuation lines
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  let currentTx: Partial<ParsedTransaction> | null = null;
  let purposeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Tag :61: — Transaction line
    // Format: :61:YYMMDD[YYMMDD]C/DAmount...
    const tag61 = line.match(
      /^:61:(\d{6})(\d{4})?([CD]R?)\D?([\d,]+)/
    );
    if (tag61) {
      // Save previous transaction
      if (currentTx?.date && currentTx.amount !== undefined) {
        currentTx.purpose = purposeLines.join(" ").trim() || null;
        transactions.push(currentTx as ParsedTransaction);
      }

      const date = parseMt940Date(tag61[1]);
      const valueDate = tag61[2] ? parseMt940Date(tag61[1].slice(0, 2) + tag61[2]) : null;
      const isCredit = tag61[3].startsWith("C");
      const amount = parseMt940Amount(tag61[4]);

      currentTx = {
        date: date || "",
        valueDate,
        amount: isCredit ? amount : -amount,
        externalId: `mt940-${date}-${i}-${amount}`,
      };
      purposeLines = [];
      continue;
    }

    // Tag :86: — Transaction details (multi-line)
    if (line.startsWith(":86:")) {
      const detail = line.slice(4);
      purposeLines.push(detail);

      // Parse structured :86: fields (?20-?29 = Verwendungszweck, ?32/?33 = Name)
      const allText = detail;
      const nameMatch = allText.match(/\?32([^?]*)/);
      const nameMatch2 = allText.match(/\?33([^?]*)/);

      if (currentTx) {
        if (nameMatch) {
          currentTx.counterpartName = (
            (nameMatch[1] || "") + (nameMatch2 ? " " + nameMatch2[1] : "")
          ).trim() || null;
        }

        // Extract IBAN from ?31
        const ibanMatch = allText.match(/\?31([A-Z]{2}\d{2}[A-Z0-9]+)/);
        if (ibanMatch) {
          currentTx.counterpartIban = ibanMatch[1];
        }

        // Extract purpose from ?20-?29
        const purposeParts: string[] = [];
        for (let n = 20; n <= 29; n++) {
          const re = new RegExp(`\\?${n}([^?]*)`);
          const pm = allText.match(re);
          if (pm) purposeParts.push(pm[1]);
        }
        if (purposeParts.length > 0) {
          purposeLines = [purposeParts.join(" ")];
        }
      }
      continue;
    }

    // Continuation of :86: (line doesn't start with :XX:)
    if (currentTx && !line.startsWith(":") && line.trim()) {
      purposeLines.push(line.trim());
    }

    // Tag :62F: — Closing balance (end of statement)
    if (line.startsWith(":62F:") || line.startsWith(":62M:")) {
      // Save last transaction
      if (currentTx?.date && currentTx.amount !== undefined) {
        currentTx.purpose = purposeLines.join(" ").trim() || null;
        transactions.push(currentTx as ParsedTransaction);
        currentTx = null;
        purposeLines = [];
      }
    }
  }

  // Save any remaining transaction
  if (currentTx?.date && currentTx.amount !== undefined) {
    currentTx.purpose = purposeLines.join(" ").trim() || null;
    transactions.push(currentTx as ParsedTransaction);
  }

  if (transactions.length === 0) {
    errors.push("No transactions found in MT940 file.");
  }

  return { transactions, errors };
}
