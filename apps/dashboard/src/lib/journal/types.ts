import type { JournalSourceType, AccountingMode, SkrType } from "@prisma/client";

export type LineDraft = {
  accountCode: string;
  debit: number;
  credit: number;
  vatCode?: string | null;
  vatAmount?: number | null;
  description?: string | null;
};

export type EntryDraft = {
  date: Date;
  description: string;
  sourceType: JournalSourceType;
  sourceId: string | null;
  lines: LineDraft[];
};

export type PostingContext = {
  tenantId: string;
  skrType: SkrType;
  accountingMode: AccountingMode;
  taxMode: "STANDARD" | "SMALL_BUSINESS";
};

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
