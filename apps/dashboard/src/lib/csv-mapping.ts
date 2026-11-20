/**
 * CSV Mapping Preset
 * ───────────────────
 * Per-account, persisted configuration that tells the CSV importer which
 * columns in the user's bank export correspond to which transaction fields.
 *
 * Why we store this
 *   Banks export statements with stable column layouts. A user who
 *   re-imports from Sparkasse/DKB/N26/... each month should not re-map
 *   the same five columns every single time. Saving the preset on the
 *   BankAccount turns the wizard into a one-time action.
 *
 * Why we store by HEADER NAME, not column index
 *   Indices are fragile: banks occasionally reorder columns, add
 *   optional ones (e.g. "Mandatsreferenz"), or swap "Soll" / "Haben"
 *   ordering. An index-based preset would silently misalign data —
 *   the user would find themselves with dates parsed as amounts and
 *   no clear diagnostic. Header-based lookup degrades gracefully:
 *   if a header is missing at import time, we fall through to the
 *   full mapping UI instead of writing garbage into the database.
 *
 * Why versioning
 *   The mapping is stored as a JSON blob. Versioning lets us evolve
 *   the shape without migrations — a future v2 reader can detect
 *   v1 presets and either migrate them in place or ignore them and
 *   ask the user to re-map.
 */

import type { DecimalConvention, DateFormat, NumberFormat, TextEncoding } from "./csv";

export type CsvMappingDelimiter = "," | ";" | "\t" | "|";

/**
 * The stable, human-visible fields the importer understands. Must stay
 * in sync with `TargetField` in csv-import-dialog.tsx (minus "ignore",
 * which is implicit — any header not mentioned here is ignored).
 *
 * `amount` is used when a single signed column carries the value;
 * `credit` + `debit` are used when the bank exports the sign as two
 * separate columns (Gutschrift / Belastung). Exactly one of these two
 * shapes is active per preset, controlled by `splitCreditDebit`.
 */
export type CsvMappingField =
  | "date"
  | "amount"
  | "credit"
  | "debit"
  | "purpose"
  | "counterpartName"
  | "counterpartIban";

export interface CsvMappingPreset {
  version: 1;
  delimiter: CsvMappingDelimiter;
  hasHeader: boolean;
  /**
   * Mapping from target field → column header name (verbatim as it
   * appears in the CSV).
   *
   * - When `splitCreditDebit` is false (default): `date`, `amount`,
   *   `purpose` are required; `counterpartName`, `counterpartIban`
   *   are optional.
   * - When `splitCreditDebit` is true: `date`, `credit`, `debit`,
   *   `purpose` are required; the same optionals apply.
   *
   * Matching at import time is case-insensitive and whitespace-
   * trimmed (see `resolveMapping`). We store verbatim to preserve the
   * user's apparent intent when shown in settings later.
   */
  columns: {
    date: string;
    amount?: string;
    credit?: string;
    debit?: string;
    purpose: string;
    counterpartName?: string;
    counterpartIban?: string;
  };
  /**
   * Decimal convention for the amount/credit/debit columns, determined
   * at preset-creation time by scanning the sample (or set explicitly
   * via `numberFormat`). Carried forward so later imports don't need
   * to re-scan.
   */
  decimalConvention: DecimalConvention;
  /**
   * Optional Importoptionen — all default sensibly when absent, so old
   * presets stay valid without migration.
   *
   * - `numberFormat`: explicit override of decimal-convention detection.
   *   "auto" (or absent) preserves the previous behaviour.
   * - `dateFormat`: explicit date parser; "auto" uses the heuristic.
   * - `encoding`: how to decode the raw bytes. Defaults to "utf-8".
   * - `rowStart` / `rowEnd`: 1-indexed inclusive slice of source lines
   *   to consider (everything before/after is dropped). Useful when the
   *   bank prepends Kontoinfos/Saldo before the actual transactions.
   * - `splitCreditDebit`: see `columns` above.
   */
  numberFormat?: NumberFormat;
  dateFormat?: DateFormat;
  encoding?: TextEncoding;
  rowStart?: number;
  rowEnd?: number | null;
  splitCreditDebit?: boolean;
}

/**
 * Fields that must be present for a preset to be valid, depending on
 * whether the user opted into the credit/debit split.
 */
export function requiredMappingFields(splitCreditDebit: boolean): CsvMappingField[] {
  return splitCreditDebit
    ? ["date", "credit", "debit", "purpose"]
    : ["date", "amount", "purpose"];
}

/** @deprecated Use `requiredMappingFields(false)` for the legacy default. */
export const REQUIRED_MAPPING_FIELDS = ["date", "amount", "purpose"] as const;

/** Normalize a header for lookup: trim + lowercase + collapse internal whitespace. */
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Parse an untyped DB value into a preset, or return null if it's
 * malformed / missing / a different version.
 *
 * We deliberately accept `unknown` rather than the Prisma JsonValue
 * type so this function can be used at trust boundaries (e.g. when
 * reading a preset that was stored before a future schema evolution).
 */
export function parseCsvMappingPreset(value: unknown): CsvMappingPreset | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  if (v.version !== 1) return null;

  const delim = v.delimiter;
  if (delim !== "," && delim !== ";" && delim !== "\t" && delim !== "|") return null;

  if (typeof v.hasHeader !== "boolean") return null;

  const cols = v.columns;
  if (!cols || typeof cols !== "object") return null;
  const c = cols as Record<string, unknown>;

  if (typeof c.date !== "string" || !c.date) return null;
  if (typeof c.purpose !== "string" || !c.purpose) return null;

  const splitCreditDebit = v.splitCreditDebit === true;

  let amount: string | undefined;
  let credit: string | undefined;
  let debit: string | undefined;
  if (splitCreditDebit) {
    if (typeof c.credit !== "string" || !c.credit) return null;
    if (typeof c.debit !== "string" || !c.debit) return null;
    credit = c.credit;
    debit = c.debit;
  } else {
    if (typeof c.amount !== "string" || !c.amount) return null;
    amount = c.amount;
  }

  const counterpartName =
    typeof c.counterpartName === "string" && c.counterpartName ? c.counterpartName : undefined;
  const counterpartIban =
    typeof c.counterpartIban === "string" && c.counterpartIban ? c.counterpartIban : undefined;

  const conv = v.decimalConvention;
  const decimalConvention: DecimalConvention =
    conv === "dot" || conv === "comma" || conv === "unknown" ? conv : "unknown";

  const numberFormat: NumberFormat | undefined =
    v.numberFormat === "auto" ||
    v.numberFormat === "1,000.00" ||
    v.numberFormat === "1.000,00" ||
    v.numberFormat === "1'000.00"
      ? (v.numberFormat as NumberFormat)
      : undefined;

  const allowedDateFormats: DateFormat[] = [
    "auto",
    "DD.MM.YYYY",
    "DD.MM.YY",
    "DD/MM/YYYY",
    "DD/MM/YY",
    "MM/DD/YYYY",
    "MM/DD/YY",
    "YYYY-MM-DD",
    "YYYY/MM/DD",
  ];
  const dateFormat: DateFormat | undefined =
    typeof v.dateFormat === "string" && (allowedDateFormats as string[]).includes(v.dateFormat)
      ? (v.dateFormat as DateFormat)
      : undefined;

  const allowedEncodings: TextEncoding[] = [
    "utf-8",
    "utf-16",
    "windows-1252",
    "iso-8859-15",
    "iso-8859-1",
    "macintosh",
  ];
  const encoding: TextEncoding | undefined =
    typeof v.encoding === "string" && (allowedEncodings as string[]).includes(v.encoding)
      ? (v.encoding as TextEncoding)
      : undefined;

  const rowStart =
    typeof v.rowStart === "number" && Number.isFinite(v.rowStart) && v.rowStart >= 1
      ? Math.floor(v.rowStart)
      : undefined;
  const rowEnd =
    v.rowEnd === null
      ? null
      : typeof v.rowEnd === "number" && Number.isFinite(v.rowEnd) && v.rowEnd >= 1
        ? Math.floor(v.rowEnd)
        : undefined;

  return {
    version: 1,
    delimiter: delim,
    hasHeader: v.hasHeader,
    columns: {
      date: c.date,
      ...(amount ? { amount } : {}),
      ...(credit ? { credit } : {}),
      ...(debit ? { debit } : {}),
      purpose: c.purpose,
      ...(counterpartName ? { counterpartName } : {}),
      ...(counterpartIban ? { counterpartIban } : {}),
    },
    decimalConvention,
    ...(numberFormat ? { numberFormat } : {}),
    ...(dateFormat ? { dateFormat } : {}),
    ...(encoding ? { encoding } : {}),
    ...(rowStart !== undefined ? { rowStart } : {}),
    ...(rowEnd !== undefined ? { rowEnd } : {}),
    ...(splitCreditDebit ? { splitCreditDebit: true } : {}),
  };
}

/**
 * Resolve a preset against an actual header row. Returns a map of
 * target-field → column index, plus a list of required fields that
 * couldn't be found.
 *
 * The caller uses `missing.length === 0` as the signal to skip the
 * mapping UI. If anything is missing, the caller falls back to the
 * full mapper and shows the user which headers no longer exist, so
 * they can re-map once and update the preset.
 */
export function resolveMapping(
  preset: CsvMappingPreset,
  header: string[],
): {
  indices: Partial<Record<CsvMappingField, number>>;
  missing: CsvMappingField[];
} {
  const normalizedHeader = header.map(normalizeHeader);
  const indices: Partial<Record<CsvMappingField, number>> = {};
  const missing: CsvMappingField[] = [];

  const findIdx = (name: string): number => {
    const target = normalizeHeader(name);
    return normalizedHeader.findIndex((h) => h === target);
  };

  const required = requiredMappingFields(preset.splitCreditDebit === true);
  for (const field of required) {
    const name = preset.columns[field];
    if (!name) {
      missing.push(field);
      continue;
    }
    const idx = findIdx(name);
    if (idx < 0) {
      missing.push(field);
    } else {
      indices[field] = idx;
    }
  }

  for (const optField of ["counterpartName", "counterpartIban"] as const) {
    const name = preset.columns[optField];
    if (!name) continue;
    const idx = findIdx(name);
    // Optional fields: silently drop if the header moved on. We don't
    // consider this a preset-invalidating change.
    if (idx >= 0) indices[optField] = idx;
  }

  return { indices, missing };
}
