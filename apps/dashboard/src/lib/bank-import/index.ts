/**
 * Bank import orchestration — detects file format and delegates to the
 * appropriate parser. CSV is handled by the user-mapped UI in the dashboard
 * (`csv-import-dialog.tsx` + `lib/csv.ts`), so this entry point only routes
 * non-CSV binary-ish formats (MT940, CAMT.053).
 */

import type { ParseResult } from "./types";
import { parseMt940 } from "./mt940-parser";
import { parseCamt053 } from "./camt053-parser";

export type { ParsedTransaction, ParseResult } from "./types";

/** Detect format from file content and parse transactions. */
export function parseImportFile(
  content: string,
  fileName?: string,
): ParseResult {
  const trimmed = content.trim();

  // CAMT.053 — XML with camt.053 namespace or <BkToCstmrStmt>
  if (
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<Document") ||
    trimmed.includes("camt.053") ||
    trimmed.includes("<BkToCstmrStmt")
  ) {
    const { transactions, errors } = parseCamt053(content);
    return { transactions, format: "camt053", errors };
  }

  // MT940 — starts with :20: tag or contains :60F: (opening balance)
  if (trimmed.includes(":20:") && (trimmed.includes(":61:") || trimmed.includes(":60F:"))) {
    const { transactions, errors } = parseMt940(content);
    return { transactions, format: "mt940", errors };
  }

  // Fallback: file extension
  const ext = fileName?.split(".").pop()?.toLowerCase();
  if (ext === "sta" || ext === "mt940") {
    const { transactions, errors } = parseMt940(content);
    return { transactions, format: "mt940", errors };
  }

  return {
    transactions: [],
    format: "csv",
    errors: [
      "CSV import is handled by the dashboard upload dialog. Use the UI to import CSV files.",
    ],
  };
}
