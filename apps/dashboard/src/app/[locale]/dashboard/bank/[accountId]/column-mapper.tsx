"use client";

/**
 * ColumnMapper
 * ────────────
 * Stand-alone, reusable UI for mapping raw CSV columns to transaction
 * fields. Used in two places:
 *
 *   1. The account-creation wizard: the user uploads a sample CSV, we
 *      derive a preset and save it on the BankAccount.
 *   2. The import dialog: when an account has no preset, or the saved
 *      preset no longer resolves against the current file's header,
 *      we fall back to this UI.
 *
 * The component is "dumb" — it takes raw bytes, emits a preset when the
 * user confirms. The caller decides what to do with the preset (save
 * it, run an import with it, both).
 *
 * Importoptionen panel
 *   A collapsible top panel exposes encoding, number format, date
 *   format, row slice (von/bis) and a Gutschrift/Belastung toggle.
 *   These are all persisted in the preset, so the user maps a bank
 *   once and the same settings apply automatically on re-imports.
 *
 * Design rules
 *   - No DB calls; no server actions. Parent drives persistence.
 *   - Preset is validated client-side before emission, but the server
 *     revalidates too via parseCsvMappingPreset.
 *   - Required fields (date, amount OR credit+debit, purpose) are
 *     enforced in the UI: the "Confirm" button is disabled until
 *     all required ones are mapped.
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2, Settings2, ChevronDown, ChevronUp } from "lucide-react";
import {
  parseCsv,
  detectDelimiter,
  parseAmount,
  parseDate,
  parseDateWithFormat,
  detectDecimalConvention,
  decodeBytes,
  numberFormatToConvention,
  type DecimalConvention,
  type NumberFormat,
  type DateFormat,
  type TextEncoding,
} from "@/lib/csv";
import type {
  CsvMappingDelimiter,
  CsvMappingField,
  CsvMappingPreset,
} from "@/lib/csv-mapping";
import { cn } from "@/lib/utils";

// Everything the user can assign a column to. "ignore" is the default;
// any column not touched stays ignored.
type TargetField = "ignore" | CsvMappingField;

/**
 * Ordered list of the app's target fields as they should appear in the
 * field-first picker UI. Required fields lead so the eye lands on them
 * first; optional metadata fields trail. The set differs by split mode:
 * with split on, `amount` is replaced by `credit` + `debit`.
 */
function FIELDS_FOR_PICKER(splitCreditDebit: boolean): CsvMappingField[] {
  if (splitCreditDebit) {
    return ["date", "credit", "debit", "counterpartName", "counterpartIban", "purpose"];
  }
  return ["date", "amount", "counterpartName", "counterpartIban", "purpose"];
}


const DATE_FORMAT_OPTIONS: DateFormat[] = [
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

const NUMBER_FORMAT_OPTIONS: NumberFormat[] = [
  "auto",
  "1.000,00",
  "1,000.00",
  "1'000.00",
];

const ENCODING_OPTIONS: { value: TextEncoding; label: string }[] = [
  { value: "utf-8", label: "Unicode (UTF-8)" },
  { value: "utf-16", label: "Unicode (UTF-16)" },
  { value: "windows-1252", label: "Windows-1252" },
  { value: "iso-8859-15", label: "ISO-8859-15" },
  { value: "iso-8859-1", label: "ISO-8859-1" },
  { value: "macintosh", label: "Macintosh" },
];

interface ColumnMapperProps {
  rawBytes: ArrayBuffer;
  /**
   * Pre-fill from an existing preset. Used when the saved preset is
   * broken (header moved) — we show the user what was there before so
   * they can fix it rather than re-do everything.
   */
  initialPreset?: CsvMappingPreset | null;
  /**
   * Rendered at the bottom of the mapper (cancel + submit buttons are
   * the caller's responsibility — that way the wizard can show
   * "Next / Skip" while the import dialog shows "Cancel / Import").
   *
   * `preset` is null while required fields are missing.
   */
  children: (args: {
    preset: CsvMappingPreset | null;
    canConfirm: boolean;
    validPreviewCount: number;
  }) => React.ReactNode;
}

export function ColumnMapper({ rawBytes, initialPreset, children }: ColumnMapperProps) {
  const t = useTranslations("bank.import");

  // ─── Importoptionen state ──────────────────────────────────────────────
  const [encoding, setEncoding] = useState<TextEncoding>(
    () => initialPreset?.encoding ?? "utf-8",
  );

  // Decode bytes → text. Memoized on (bytes, encoding) so flipping
  // encoding in the panel re-renders the preview immediately.
  const rawText = useMemo(() => decodeBytes(rawBytes, encoding), [rawBytes, encoding]);

  const [numberFormat, setNumberFormat] = useState<NumberFormat>(
    () => initialPreset?.numberFormat ?? "auto",
  );
  const [dateFormat, setDateFormat] = useState<DateFormat>(
    () => initialPreset?.dateFormat ?? "auto",
  );
  // 1-indexed inclusive row range. `rowStart` defaults to 1 (don't drop
  // anything); `rowEnd` of null = "until the end of file".
  const [rowStart, setRowStart] = useState<number>(() => initialPreset?.rowStart ?? 1);
  const [rowEnd, setRowEnd] = useState<number | null>(
    () => initialPreset?.rowEnd ?? null,
  );
  const [splitCreditDebit, setSplitCreditDebit] = useState<boolean>(
    () => initialPreset?.splitCreditDebit === true,
  );

  const [delimiter, setDelimiter] = useState<CsvMappingDelimiter>(
    () =>
      (initialPreset?.delimiter as CsvMappingDelimiter) ??
      (detectDelimiter(rawText) as CsvMappingDelimiter),
  );
  const [hasHeader, setHasHeader] = useState(initialPreset?.hasHeader ?? true);

  const [showOptions, setShowOptions] = useState(false);

  // ─── Derived data ──────────────────────────────────────────────────────
  const allRows = useMemo(() => parseCsv(rawText, delimiter), [rawText, delimiter]);

  // Slice rows by user-chosen range. `rowStart=4` drops lines 1..3 and
  // makes line 4 the new "first" row — i.e. the new header if hasHeader
  // is on. `rowEnd=null` means open-ended.
  const rows = useMemo(() => {
    const startIdx = Math.max(0, (rowStart || 1) - 1);
    const endIdx = rowEnd === null || rowEnd === undefined ? allRows.length : Math.min(allRows.length, rowEnd);
    if (startIdx >= endIdx) return [];
    return allRows.slice(startIdx, endIdx);
  }, [allRows, rowStart, rowEnd]);

  const effectiveColumns = rows[0]?.length ?? 0;

  const headerRow = hasHeader
    ? rows[0] ?? []
    : rows[0]?.map((_, i) => `Col ${i + 1}`) ?? [];
  const dataRows = hasHeader ? rows.slice(1) : rows;

  // Initial mapping: from preset if resolvable, otherwise from
  // autoMap. We intentionally don't try to "merge" — preset wins
  // fully if present, to make the behaviour predictable.
  const [mapping, setMapping] = useState<Record<number, TargetField>>(() =>
    initialPreset
      ? mappingFromPreset(initialPreset, headerRow)
      : autoMap(headerRow, dataRows, splitCreditDebit),
  );

  /**
   * Field-first picker: the user picks which CSV column belongs to a
   * given target field (rather than the other way around). Passing
   * `colIdx = null` clears the field. Every target field is single-
   * column, so we drop any previous assignment of `field` before re-
   * binding to the new column index — this also handles the case where
   * the chosen column was previously assigned to a different field
   * (the new assignment simply overwrites the slot).
   */
  function pickColumnForField(field: CsvMappingField, colIdx: number | null) {
    setMapping((prev) => {
      const next: Record<number, TargetField> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (v === field) continue;
        next[Number(k)] = v;
      }
      if (colIdx !== null) {
        next[colIdx] = field;
      }
      return next;
    });
  }

  // When the user toggles the credit/debit split, the previously-assigned
  // "amount" column doesn't make sense any more (and vice versa). Clear
  // affected fields so the required-chip panel reflects reality and the
  // user is nudged to remap.
  function handleSplitToggle(next: boolean) {
    setSplitCreditDebit(next);
    setMapping((prev) => {
      const cleaned: Record<number, TargetField> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (next && v === "amount") continue;
        if (!next && (v === "credit" || v === "debit")) continue;
        cleaned[Number(k)] = v;
      }
      return cleaned;
    });
  }

  const REQUIRED_FIELDS: CsvMappingField[] = splitCreditDebit
    ? ["date", "credit", "debit", "purpose"]
    : ["date", "amount", "purpose"];

  const columnsByField = useMemo(() => {
    const by: Record<TargetField, number[]> = {
      ignore: [],
      date: [],
      amount: [],
      credit: [],
      debit: [],
      counterpartName: [],
      counterpartIban: [],
      purpose: [],
    };
    for (const [idxStr, field] of Object.entries(mapping)) {
      by[field].push(Number(idxStr));
    }
    return by;
  }, [mapping]);

  const missingRequired = REQUIRED_FIELDS.filter((f) => columnsByField[f].length === 0);
  const canConfirm = missingRequired.length === 0;

  // When the user picked an explicit number format, that wins; otherwise
  // we detect per amount-flavoured column from the data.
  const columnConventions = useMemo<Record<number, DecimalConvention>>(() => {
    const result: Record<number, DecimalConvention> = {};
    const explicit = numberFormatToConvention(numberFormat);
    const targets = [...columnsByField.amount, ...columnsByField.credit, ...columnsByField.debit];
    for (const idx of targets) {
      if (explicit !== "unknown") {
        result[idx] = explicit;
      } else {
        const cells = dataRows.map((r) => r[idx] ?? "");
        result[idx] = detectDecimalConvention(cells);
      }
    }
    return result;
  }, [columnsByField.amount, columnsByField.credit, columnsByField.debit, dataRows, numberFormat]);

  // Per-row date parser respecting the user's explicit format choice.
  function parseDateCell(cell: string): string | null {
    return dateFormat === "auto" ? parseDate(cell) : parseDateWithFormat(cell, dateFormat);
  }

  // Compute the effective amount for a row given the current mapping &
  // conventions. Returns NaN when the row can't be interpreted; 0 is a
  // valid "explicitly zero" value that the caller should filter out.
  function rowAmount(row: string[]): number {
    if (splitCreditDebit) {
      const ci = columnsByField.credit[0];
      const di = columnsByField.debit[0];
      const credit =
        ci !== undefined ? parseAmount(row[ci] ?? "", columnConventions[ci] ?? "unknown") : NaN;
      const debit =
        di !== undefined ? parseAmount(row[di] ?? "", columnConventions[di] ?? "unknown") : NaN;
      const c = isNaN(credit) ? 0 : Math.abs(credit);
      const d = isNaN(debit) ? 0 : Math.abs(debit);
      // Both empty → not a real row. Only-debit → outflow. Only-credit → inflow.
      if (c === 0 && d === 0) return NaN;
      return c - d;
    }
    const ai = columnsByField.amount[0];
    if (ai === undefined) return NaN;
    return parseAmount(row[ai] ?? "", columnConventions[ai] ?? "unknown");
  }

  // Preview uses the same parser the real import will use, so what
  // the user sees as "valid rows" is exactly what we'd persist.
  const validPreviewCount = useMemo(() => {
    let count = 0;
    const limit = Math.min(dataRows.length, 50);
    for (let i = 0; i < limit; i++) {
      const row = dataRows[i];
      let date: string | null = null;
      for (const [idxStr, field] of Object.entries(mapping)) {
        const idx = Number(idxStr);
        const cell = row[idx] ?? "";
        if (field === "date") date = parseDateCell(cell);
      }
      const amount = rowAmount(row);
      if (date && !isNaN(amount) && amount !== 0) count++;
    }
    return count;
  }, [dataRows, mapping, columnConventions, dateFormat, splitCreditDebit, columnsByField]);

  // Compose the preset the caller will receive. Null until required
  // fields are all mapped.
  const preset: CsvMappingPreset | null = useMemo(() => {
    if (!canConfirm) return null;

    const dateIdx = columnsByField.date[0];
    const purposeIdx = columnsByField.purpose[0];
    const nameIdx = columnsByField.counterpartName[0];
    const ibanIdx = columnsByField.counterpartIban[0];

    // Resolve header name for each index; when hasHeader is false
    // we synthesised `Col N` labels, which is fine to store — the
    // resolver will look for the literal "Col N" on re-import.
    const col = (idx: number) => headerRow[idx] ?? `Col ${idx + 1}`;

    let amountField: Pick<CsvMappingPreset["columns"], "amount" | "credit" | "debit"> = {};
    let chosenConvention: DecimalConvention;
    if (splitCreditDebit) {
      const creditIdx = columnsByField.credit[0];
      const debitIdx = columnsByField.debit[0];
      amountField = { credit: col(creditIdx), debit: col(debitIdx) };
      chosenConvention =
        columnConventions[creditIdx] ?? columnConventions[debitIdx] ?? "unknown";
    } else {
      const amountIdx = columnsByField.amount[0];
      amountField = { amount: col(amountIdx) };
      chosenConvention = columnConventions[amountIdx] ?? "unknown";
    }

    return {
      version: 1,
      delimiter,
      hasHeader,
      columns: {
        date: col(dateIdx),
        ...amountField,
        purpose: col(purposeIdx),
        ...(nameIdx !== undefined ? { counterpartName: col(nameIdx) } : {}),
        ...(ibanIdx !== undefined ? { counterpartIban: col(ibanIdx) } : {}),
      },
      decimalConvention: chosenConvention,
      ...(numberFormat !== "auto" ? { numberFormat } : {}),
      ...(dateFormat !== "auto" ? { dateFormat } : {}),
      ...(encoding !== "utf-8" ? { encoding } : {}),
      ...(rowStart && rowStart > 1 ? { rowStart } : {}),
      ...(rowEnd !== null && rowEnd !== undefined ? { rowEnd } : {}),
      ...(splitCreditDebit ? { splitCreditDebit: true } : {}),
    };
  }, [
    canConfirm,
    columnsByField,
    columnConventions,
    delimiter,
    hasHeader,
    headerRow,
    numberFormat,
    dateFormat,
    encoding,
    rowStart,
    rowEnd,
    splitCreditDebit,
  ]);

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <>
      {/* Header bar: Importoptionen toggle */}
      <div className="p-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground">
          {t("optionsHint")}
        </p>
        <button
          type="button"
          onClick={() => setShowOptions((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-input hover:bg-accent transition-colors",
            showOptions && "bg-accent",
          )}
        >
          <Settings2 className="w-3.5 h-3.5" />
          {t("importOptions")}
          {showOptions ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {showOptions && (
        <ImportOptionsPanel
          hasHeader={hasHeader}
          onHasHeaderChange={setHasHeader}
          splitCreditDebit={splitCreditDebit}
          onSplitChange={handleSplitToggle}
          numberFormat={numberFormat}
          onNumberFormatChange={setNumberFormat}
          rowStart={rowStart}
          rowEnd={rowEnd}
          onRowStartChange={setRowStart}
          onRowEndChange={setRowEnd}
          encoding={encoding}
          onEncodingChange={setEncoding}
          dateFormat={dateFormat}
          onDateFormatChange={setDateFormat}
          delimiter={delimiter}
          onDelimiterChange={(next) => {
            setDelimiter(next);
            // Reset mapping when delimiter changes — previous column
            // indices no longer refer to the same data.
            const newRows = parseCsv(rawText, next);
            const newHeader = hasHeader ? newRows[0] ?? [] : [];
            const newDataRows = hasHeader ? newRows.slice(1) : newRows;
            setMapping(autoMap(newHeader, newDataRows, splitCreditDebit));
          }}
          t={t}
        />
      )}

      <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border flex items-center justify-between">
        <span>{t("detected", { cols: effectiveColumns, rows: dataRows.length })}</span>
      </div>

      {effectiveColumns < 2 && (
        <div className="px-4 py-2 bg-amber-500/10 text-amber-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {t("onlyOneColumn")}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {/*
          Field-first mapping: each app target field is its own column-
          like card with a dropdown listing the CSV headers. This mirrors
          the SevDesk UX and keeps the user's attention on the small,
          fixed set of fields the importer actually understands.
        */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {FIELDS_FOR_PICKER(splitCreditDebit).map((field) => {
            const required = (REQUIRED_FIELDS as CsvMappingField[]).includes(field);
            const currentColIdx = columnsByField[field][0];
            const mapped = currentColIdx !== undefined;
            return (
              <div key={field} className="flex flex-col items-center text-center">
                <div className="flex items-center gap-1 text-xs font-medium min-h-[2.5rem]">
                  <span>{t(`field_${field}`)}</span>
                  {required && <span className="text-destructive">*</span>}
                </div>
                {/*
                  Connector stack: a thin vertical line that grows out of
                  the label, then the status indicator centred on its own
                  row, then a matching line down to the select. Keeping
                  the icon on its own flex row means it can never visually
                  collide with the dropdown's border like it did before.
                */}
                <div
                  className={cn(
                    "h-2 w-px mt-1",
                    mapped ? "bg-emerald-500" : "bg-border",
                  )}
                  aria-hidden
                />
                <div className="flex items-center justify-center h-5 my-0.5">
                  {mapped ? (
                    <CheckCircle2
                      className="w-4 h-4 text-emerald-500"
                      aria-hidden
                    />
                  ) : (
                    <div
                      className="w-1.5 h-1.5 rounded-full bg-border"
                      aria-hidden
                    />
                  )}
                </div>
                <div
                  className={cn(
                    "h-2 w-px mb-1",
                    mapped ? "bg-emerald-500" : "bg-border",
                  )}
                  aria-hidden
                />
                <select
                  value={currentColIdx ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    pickColumnForField(field, v === "" ? null : Number(v));
                  }}
                  className={cn(
                    "px-2 py-1.5 bg-background border rounded text-xs w-full",
                    mapped && required
                      ? "border-emerald-500/50"
                      : !mapped && required
                        ? "border-destructive/50"
                        : "border-input",
                  )}
                >
                  <option value="">— {t("noneSelected")} —</option>
                  {headerRow.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Col ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        {/* Read-only preview of the first few data rows. Mapped columns
            are emphasised so the user can sanity-check their choices. */}
        <div className="mt-5">
          <p className="text-xs text-muted-foreground mb-2">{t("previewTitle")}</p>
          <div className="border border-border rounded-lg overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  {headerRow.map((h, i) => {
                    const mappedField = mapping[i];
                    const isMapped = mappedField && mappedField !== "ignore";
                    return (
                      <th
                        key={i}
                        className={cn(
                          "px-2 py-1.5 text-left border-b border-border align-top font-medium truncate max-w-[160px]",
                          isMapped ? "text-foreground" : "text-muted-foreground/70",
                        )}
                      >
                        <div className="truncate">{h || `Col ${i + 1}`}</div>
                        {isMapped && (
                          <div className="mt-0.5 text-[10px] font-normal text-emerald-700">
                            → {t(`field_${mappedField}`)}
                          </div>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {dataRows.slice(0, 5).map((row, ri) => (
                  <tr key={ri} className="border-b border-border last:border-0">
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={cn(
                          "px-2 py-1 truncate max-w-[160px]",
                          mapping[ci] && mapping[ci] !== "ignore"
                            ? "text-foreground"
                            : "text-muted-foreground/60",
                        )}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            {t("previewValid", { count: validPreviewCount })}
          </div>
        </div>
      </div>

      {children({ preset, canConfirm, validPreviewCount })}
    </>
  );
}

// ─── Importoptionen panel ─────────────────────────────────────────────────────

/**
 * Modeled after the SevDesk import options panel: a single bar of
 * dropdowns + a toggle for the credit/debit split. Kept inside this
 * file so the parent doesn't have to thread a dozen props for what is
 * effectively one cohesive bit of UI.
 */
function ImportOptionsPanel(props: {
  hasHeader: boolean;
  onHasHeaderChange: (next: boolean) => void;
  splitCreditDebit: boolean;
  onSplitChange: (next: boolean) => void;
  numberFormat: NumberFormat;
  onNumberFormatChange: (next: NumberFormat) => void;
  rowStart: number;
  rowEnd: number | null;
  onRowStartChange: (next: number) => void;
  onRowEndChange: (next: number | null) => void;
  encoding: TextEncoding;
  onEncodingChange: (next: TextEncoding) => void;
  dateFormat: DateFormat;
  onDateFormatChange: (next: DateFormat) => void;
  delimiter: CsvMappingDelimiter;
  onDelimiterChange: (next: CsvMappingDelimiter) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const { t } = props;
  return (
    <div className="bg-muted/30 border-b border-border p-4 grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-3">
      {/* Row 1: header toggle + number format + row range */}
      <ToggleRow
        label={t("firstRowHeader")}
        checked={props.hasHeader}
        onChange={props.onHasHeaderChange}
      />
      <Field label={t("numberFormat")}>
        <select
          value={props.numberFormat}
          onChange={(e) => props.onNumberFormatChange(e.target.value as NumberFormat)}
          className="px-2 py-1.5 bg-background border border-input rounded text-sm w-full"
        >
          {NUMBER_FORMAT_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f === "auto" ? t("autoDetect") : f}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("rowRange")}>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={props.rowStart}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              props.onRowStartChange(Number.isFinite(v) && v >= 1 ? v : 1);
            }}
            className="px-2 py-1.5 bg-background border border-input rounded text-sm w-20"
            aria-label={t("rowFrom")}
          />
          <input
            type="number"
            min={1}
            placeholder={t("rowTo")}
            value={props.rowEnd ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                props.onRowEndChange(null);
                return;
              }
              const v = parseInt(raw, 10);
              props.onRowEndChange(Number.isFinite(v) && v >= 1 ? v : null);
            }}
            className="px-2 py-1.5 bg-background border border-input rounded text-sm w-20"
            aria-label={t("rowTo")}
          />
        </div>
      </Field>

      {/* Row 2: split toggle + date format + encoding */}
      <ToggleRow
        label={t("splitCreditDebit")}
        checked={props.splitCreditDebit}
        onChange={props.onSplitChange}
      />
      <Field label={t("dateFormat")}>
        <select
          value={props.dateFormat}
          onChange={(e) => props.onDateFormatChange(e.target.value as DateFormat)}
          className="px-2 py-1.5 bg-background border border-input rounded text-sm w-full"
        >
          {DATE_FORMAT_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f === "auto" ? t("autoDetect") : f}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("encoding")}>
        <select
          value={props.encoding}
          onChange={(e) => props.onEncodingChange(e.target.value as TextEncoding)}
          className="px-2 py-1.5 bg-background border border-input rounded text-sm w-full"
        >
          {ENCODING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      {/* Row 3: delimiter spans full width on small screens */}
      <Field label={t("delimiter")}>
        <select
          value={props.delimiter}
          onChange={(e) => props.onDelimiterChange(e.target.value as CsvMappingDelimiter)}
          className="px-2 py-1.5 bg-background border border-input rounded text-sm w-full"
        >
          <option value=",">, {t("comma")}</option>
          <option value=";">; {t("semicolon")}</option>
          <option value={"\t"}>↹ {t("tab")}</option>
          <option value="|">| {t("pipe")}</option>
        </select>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs self-end pb-1.5 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-primary" : "bg-input",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-background transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
      <span>{label}</span>
    </label>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a column-index → target-field mapping from a preset, resolving
 * each header name against the actual first row. Missing headers fall
 * through (their field is left unassigned, and the user will see the
 * required-field chip go red for it).
 *
 * NOTE: This is the UI-layer resolver. The canonical resolver used by
 * the import dialog when SKIPPING the mapper is `resolveMapping` in
 * lib/csv-mapping.ts. Both agree on the normalization rule (trim +
 * lower + collapse whitespace).
 */
function mappingFromPreset(
  preset: CsvMappingPreset,
  header: string[],
): Record<number, TargetField> {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const normalized = header.map(normalize);
  const out: Record<number, TargetField> = {};

  const bind = (field: TargetField, name: string | undefined) => {
    if (!name) return;
    const idx = normalized.findIndex((h) => h === normalize(name));
    if (idx >= 0) out[idx] = field;
  };

  bind("date", preset.columns.date);
  bind("amount", preset.columns.amount);
  bind("credit", preset.columns.credit);
  bind("debit", preset.columns.debit);
  bind("purpose", preset.columns.purpose);
  bind("counterpartName", preset.columns.counterpartName);
  bind("counterpartIban", preset.columns.counterpartIban);

  return out;
}

/**
 * Heuristic auto-mapping from header names + data shape. Kept here
 * (rather than in lib/) because it's purely a UI convenience: the
 * server never runs this, and we want to iterate on the regexes
 * without touching the shared library.
 */
function autoMap(
  header: string[],
  dataRows: string[][],
  splitCreditDebit: boolean,
): Record<number, TargetField> {
  const out: Record<number, TargetField> = {};

  function looksNumericRatio(colIdx: number): { ratio: number; checked: number } {
    let looksNumeric = 0;
    let checked = 0;
    for (const row of dataRows) {
      if (checked >= 10) break;
      const cell = (row[colIdx] ?? "").trim();
      if (!cell) continue;
      checked++;
      if (/[0-9]/.test(cell) && /[-+,.0-9() ]/.test(cell)) looksNumeric++;
    }
    return { ratio: checked === 0 ? 0 : looksNumeric / checked, checked };
  }

  function scoreAmount(colIdx: number): number {
    const h = (header[colIdx] ?? "").toLowerCase().trim();
    if (/saldo|balance|kontostand/.test(h)) return -1;
    let s = 0;
    if (/(^|[^a-z])betrag([^a-z]|$)/.test(h)) s += 10;
    if (/(^|[^a-z])amount([^a-z]|$)/.test(h)) s += 10;
    if (/(^|[^a-z])umsatz([^a-z]|$)/.test(h)) s += 8;
    if (/(^|[^a-z])(soll|debit|haben|credit)([^a-z]|$)/.test(h)) s += 6;
    if (/eur|€/.test(h)) s += 1;
    if (s === 0) return -1;

    const { ratio, checked } = looksNumericRatio(colIdx);
    if (checked === 0 || ratio < 0.5) return -1;
    return s + Math.round(ratio * 10);
  }

  function scoreCredit(colIdx: number): number {
    const h = (header[colIdx] ?? "").toLowerCase().trim();
    let s = 0;
    if (/(^|[^a-z])(haben|credit|gutschrift|eingang|einzahlung)([^a-z]|$)/.test(h)) s += 10;
    if (s === 0) return -1;
    const { ratio, checked } = looksNumericRatio(colIdx);
    if (checked === 0 || ratio < 0.3) return -1;
    return s + Math.round(ratio * 5);
  }
  function scoreDebit(colIdx: number): number {
    const h = (header[colIdx] ?? "").toLowerCase().trim();
    let s = 0;
    if (/(^|[^a-z])(soll|debit|belastung|ausgang|auszahlung)([^a-z]|$)/.test(h)) s += 10;
    if (s === 0) return -1;
    const { ratio, checked } = looksNumericRatio(colIdx);
    if (checked === 0 || ratio < 0.3) return -1;
    return s + Math.round(ratio * 5);
  }

  function scoreDate(colIdx: number): number {
    const h = (header[colIdx] ?? "").toLowerCase().trim();
    let s = 0;
    if (/(^|[^a-z])buchungstag([^a-z]|$)/.test(h)) s += 10;
    else if (/(^|[^a-z])buchung([^a-z]|$)/.test(h)) s += 8;
    else if (/(^|[^a-z])(datum|date|booking)([^a-z]|$)/.test(h)) s += 7;
    else if (/(^|[^a-z])(valuta|wertstellung)([^a-z]|$)/.test(h)) s += 3;
    return s > 0 ? s : -1;
  }
  function scoreCounterpartName(colIdx: number): number {
    const h = (header[colIdx] ?? "").toLowerCase().trim();
    if (/(^|[^a-z])(empfänger|empfaenger|auftraggeber|payee|begünstigter|beguenstigter)([^a-z]|$)/.test(h)) return 10;
    if (/(^|[^a-z])(counterpart|zahler|gegenkonto)([^a-z]|$)/.test(h)) return 8;
    if (/(^|[^a-z])name([^a-z]|$)/.test(h)) return 5;
    return -1;
  }
  function scoreIban(colIdx: number): number {
    const h = (header[colIdx] ?? "").toLowerCase().trim();
    if (/(^|[^a-z])iban([^a-z]|$)/.test(h)) return 10;
    if (/kontonummer|konto.?nr/.test(h)) return 5;
    return -1;
  }
  function scorePurpose(colIdx: number): number {
    const h = (header[colIdx] ?? "").toLowerCase().trim();
    if (/(^|[^a-z])(verwendungszweck|zweck|purpose|reference|beschreibung)([^a-z]|$)/.test(h)) return 10;
    return -1;
  }

  const scorers: { field: TargetField; score: (i: number) => number }[] = splitCreditDebit
    ? [
        { field: "date", score: scoreDate },
        { field: "credit", score: scoreCredit },
        { field: "debit", score: scoreDebit },
        { field: "counterpartName", score: scoreCounterpartName },
        { field: "counterpartIban", score: scoreIban },
        { field: "purpose", score: scorePurpose },
      ]
    : [
        { field: "date", score: scoreDate },
        { field: "amount", score: scoreAmount },
        { field: "counterpartName", score: scoreCounterpartName },
        { field: "counterpartIban", score: scoreIban },
        { field: "purpose", score: scorePurpose },
      ];

  for (const { field, score } of scorers) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < header.length; i++) {
      if (out[i] !== undefined) continue;
      const s = score(i);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) out[bestIdx] = field;
  }

  return out;
}
