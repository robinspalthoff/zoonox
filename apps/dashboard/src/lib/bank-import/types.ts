/** Shared types for bank transaction import parsing. */

export interface ParsedTransaction {
  date: string;            // ISO date string (YYYY-MM-DD)
  valueDate?: string | null;
  amount: number;          // Signed: positive = income, negative = expense
  counterpartName?: string | null;
  counterpartIban?: string | null;
  purpose?: string | null;
  externalId?: string | null;  // For duplicate detection on reimport
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  format: "csv" | "mt940" | "camt053";
  errors: string[];
}
