"use client";

/**
 * CsvImportDialog
 * ───────────────
 * Orchestrates the "user picked a CSV file → rows hit the database"
 * flow for a single bank account.
 *
 * Two paths through this component:
 *
 *   FAST PATH (preset present + resolvable)
 *     Decode bytes with the preset's encoding → parse → apply the
 *     preset's row slice → resolve the preset's header names → if all
 *     required fields resolve, skip the mapper, show a confirm screen
 *     with the valid-row count, and import on click. A small "Edit
 *     mapping" link lets the user override for a one-off without
 *     touching the preset.
 *
 *   MAPPER PATH (no preset, or preset broke)
 *     Render the shared ColumnMapper. On confirm, import using the
 *     live mapping and *offer* to save it as the new preset (or to
 *     update an existing one that no longer resolves). Saving is
 *     opt-in — users with mixed CSV sources (e.g. custom exports)
 *     might not want to lock in a mapping.
 *
 * The dialog accepts the file as raw bytes (ArrayBuffer) so that the
 * mapper can re-decode under a different encoding picked by the user.
 *
 * Dedup is handled inside importTransactions via externalId (see
 * contentHash in lib/csv.ts). Mapping presets have no effect on
 * dedup because the hash is computed over parsed values, not column
 * positions.
 */

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { X, AlertCircle, CheckCircle2, Pencil, Save } from "lucide-react";
import {
  parseCsv,
  parseAmount,
  parseDate,
  parseDateWithFormat,
  detectDecimalConvention,
  decodeBytes,
  numberFormatToConvention,
  contentHash,
  type DecimalConvention,
} from "@/lib/csv";
import {
  parseCsvMappingPreset,
  resolveMapping,
  type CsvMappingPreset,
} from "@/lib/csv-mapping";
import {
  importTransactions,
  updateBankAccountCsvMapping,
  autoMatchBankAccount,
  type ParsedTransaction,
  type AutoMatchResult,
} from "../actions";
import { ColumnMapper } from "./column-mapper";
import { cn } from "@/lib/utils";

interface CsvImportDialogProps {
  bankAccountId: string;
  rawBytes: ArrayBuffer;
  /**
   * The raw JSON value of BankAccount.csvMapping, as loaded from the
   * server. May be null (no preset) or malformed (in which case we
   * treat it as null and take the mapper path).
   */
  savedMapping?: unknown;
  onClose: () => void;
  onDone: () => void;
}

type Phase =
  // Fast path: preset resolves cleanly. Show preview + confirm only.
  | { kind: "preview"; preset: CsvMappingPreset }
  // Mapper path: no preset, or preset didn't resolve, or user clicked
  // "Edit mapping". Missing lists which preset fields couldn't be
  // resolved (empty on "no preset" and on explicit edit).
  | { kind: "mapper"; initialPreset: CsvMappingPreset | null; missing: string[] };

type Result =
  | { kind: "success"; imported: number; skipped: number; autoMatch?: AutoMatchResult | null }
  | { kind: "error"; msg: string };

export function CsvImportDialog({
  bankAccountId,
  rawBytes,
  savedMapping,
  onClose,
  onDone,
}: CsvImportDialogProps) {
  const t = useTranslations("bank.import");

  const parsedPreset = useMemo(() => parseCsvMappingPreset(savedMapping), [savedMapping]);

  // Initial phase: if we have a preset and it resolves, preview;
  // otherwise open the mapper. We pick phase eagerly from the preset
  // rather than lazily from the file so the user sees one screen,
  // not a flash of mapper-then-preview.
  const [phase, setPhase] = useState<Phase>(() => {
    if (!parsedPreset) return { kind: "mapper", initialPreset: null, missing: [] };

    const text = decodeBytes(rawBytes, parsedPreset.encoding ?? "utf-8");
    const allRows = parseCsv(text, parsedPreset.delimiter);
    const rows = sliceRows(allRows, parsedPreset.rowStart, parsedPreset.rowEnd);
    const header = parsedPreset.hasHeader
      ? rows[0] ?? []
      : rows[0]?.map((_, i) => `Col ${i + 1}`) ?? [];

    const { missing } = resolveMapping(parsedPreset, header);
    if (missing.length === 0) {
      return { kind: "preview", preset: parsedPreset };
    }
    // Preset is broken — fall through to mapper, pre-filled.
    return { kind: "mapper", initialPreset: parsedPreset, missing };
  });

  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<Result | null>(null);

  // Result phase (shared by both paths)
  if (result?.kind === "success") {
    return (
      <Shell onClose={onClose} title={t("title")}>
        <div className="p-8 flex flex-col items-center text-center gap-3">
          <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          <p className="text-sm">{t("importSuccess", { count: result.imported })}</p>
          {result.skipped > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("duplicatesSkipped", { count: result.skipped })}
            </p>
          )}
          {result.autoMatch && (
            <div
              className="mt-2 px-3 py-2 rounded text-xs flex items-start gap-2 max-w-sm"
              style={{
                backgroundColor: "color-mix(in oklab, var(--color-automatch) 12%, transparent)",
                color: "var(--color-automatch)",
              }}
            >
              <span>✨</span>
              <div className="text-left">
                <p className="font-medium">
                  {t("autoMatchSummary", { count: result.autoMatch.matched })}
                </p>
                {result.autoMatch.suggestions > 0 && (
                  <p className="text-muted-foreground mt-0.5">
                    {t("autoMatchSuggestions", { count: result.autoMatch.suggestions })}
                  </p>
                )}
              </div>
            </div>
          )}
          <button
            onClick={() => {
              onDone();
              onClose();
            }}
            className="mt-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
          >
            OK
          </button>
        </div>
      </Shell>
    );
  }

  // FAST PATH — preset resolves, show preview + confirm.
  if (phase.kind === "preview") {
    return (
      <Shell onClose={onClose} title={t("title")}>
        <PreviewScreen
          bankAccountId={bankAccountId}
          rawBytes={rawBytes}
          preset={phase.preset}
          isPending={isPending}
          error={result?.kind === "error" ? result.msg : null}
          onEditMapping={() =>
            setPhase({ kind: "mapper", initialPreset: phase.preset, missing: [] })
          }
          onImport={(parsed) => {
            startTransition(async () => {
              const res = await importTransactions(bankAccountId, parsed, "CSV");
              if (res.success) {
                // Best-effort auto-match after import. If it fails (e.g.
                // network blip), we still show the import success — the
                // user can re-run via the toolbar button.
                let autoMatch: AutoMatchResult | null = null;
                if (res.imported > 0) {
                  const am = await autoMatchBankAccount(bankAccountId);
                  if (am.success) autoMatch = am.result;
                }
                setResult({
                  kind: "success",
                  imported: res.imported,
                  skipped: res.skipped,
                  autoMatch,
                });
              } else {
                setResult({ kind: "error", msg: res.error });
              }
            });
          }}
          onCancel={onClose}
          t={t}
        />
      </Shell>
    );
  }

  // MAPPER PATH — ColumnMapper + import + optional preset save.
  return (
    <Shell onClose={onClose} title={t("title")} wide>
      <MapperScreen
        bankAccountId={bankAccountId}
        rawBytes={rawBytes}
        initialPreset={phase.initialPreset}
        missing={phase.missing}
        hasExistingPreset={parsedPreset !== null}
        isPending={isPending}
        error={result?.kind === "error" ? result.msg : null}
        onCancel={onClose}
        onImport={(parsed, preset, savePreset) => {
          startTransition(async () => {
            const res = await importTransactions(bankAccountId, parsed, "CSV");
            if (!res.success) {
              setResult({ kind: "error", msg: res.error });
              return;
            }
            // Best-effort preset save. We don't fail the whole import
            // if this fails — the user can retry from settings.
            if (savePreset && preset) {
              await updateBankAccountCsvMapping(bankAccountId, preset);
            }
            let autoMatch: AutoMatchResult | null = null;
            if (res.imported > 0) {
              const am = await autoMatchBankAccount(bankAccountId);
              if (am.success) autoMatch = am.result;
            }
            setResult({
              kind: "success",
              imported: res.imported,
              skipped: res.skipped,
              autoMatch,
            });
          });
        }}
        t={t}
      />
    </Shell>
  );
}

// ─── Fast-path preview screen ─────────────────────────────────────────────────

/**
 * Walk the preset's columns against the file, build the ParsedTransaction
 * list, and show a small summary with an import button. No column mapping
 * UI — that's the whole point of the fast path.
 */
function PreviewScreen({
  bankAccountId: _bankAccountId,
  rawBytes,
  preset,
  isPending,
  error,
  onEditMapping,
  onImport,
  onCancel,
  t,
}: {
  bankAccountId: string;
  rawBytes: ArrayBuffer;
  preset: CsvMappingPreset;
  isPending: boolean;
  error: string | null;
  onEditMapping: () => void;
  onImport: (parsed: ParsedTransaction[]) => void;
  onCancel: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const { parsed, validCount } = useMemo(() => {
    const parsedList = buildParsedTransactions(rawBytes, preset);
    return { parsed: parsedList, validCount: parsedList.length };
  }, [rawBytes, preset]);

  // Compact human-readable description of the amount column(s) so the
  // "saved mapping" preview doesn't lie when the user has the split
  // toggle on (preset.columns.amount would be undefined there).
  const amountLabel = preset.splitCreditDebit
    ? `${preset.columns.credit} / ${preset.columns.debit}`
    : (preset.columns.amount ?? "");

  return (
    <>
      <div className="p-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2 text-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">{t("usingSavedMapping")}</p>
            <p className="text-muted-foreground mt-0.5">
              {t("savedMappingSummary", {
                date: preset.columns.date,
                amount: amountLabel,
                purpose: preset.columns.purpose,
              })}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onEditMapping}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          <Pencil className="w-3 h-3" />
          {t("editMapping")}
        </button>
      </div>

      <div className="p-8 flex flex-col items-center text-center gap-2">
        <p className="text-3xl font-semibold">{validCount}</p>
        <p className="text-sm text-muted-foreground">{t("readyToImport")}</p>
      </div>

      {error && (
        <div className="px-4 pb-2">
          <div className="px-3 py-2 bg-destructive/10 text-destructive text-xs rounded">
            {error}
          </div>
        </div>
      )}

      <div className="p-4 border-t border-border flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 border border-input rounded-lg text-sm hover:bg-accent transition-colors"
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={() => onImport(parsed)}
          disabled={isPending || validCount === 0}
          className="px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isPending ? "…" : t("confirm")}
        </button>
      </div>
    </>
  );
}

// ─── Mapper-path screen ───────────────────────────────────────────────────────

function MapperScreen({
  bankAccountId: _bankAccountId,
  rawBytes,
  initialPreset,
  missing,
  hasExistingPreset,
  isPending,
  error,
  onCancel,
  onImport,
  t,
}: {
  bankAccountId: string;
  rawBytes: ArrayBuffer;
  initialPreset: CsvMappingPreset | null;
  missing: string[];
  hasExistingPreset: boolean;
  isPending: boolean;
  error: string | null;
  onCancel: () => void;
  onImport: (
    parsed: ParsedTransaction[],
    preset: CsvMappingPreset | null,
    savePreset: boolean,
  ) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  // Default the "save mapping" checkbox to true when the user is
  // fixing a broken preset or creating one for the first time. The
  // two situations have different copy but the same intent.
  const [savePreset, setSavePreset] = useState(true);

  return (
    <ColumnMapper rawBytes={rawBytes} initialPreset={initialPreset}>
      {({ preset, canConfirm, validPreviewCount }) => (
        <>
          {missing.length > 0 && (
            <div className="px-4 py-2 bg-amber-500/10 text-amber-700 text-xs flex items-start gap-2 border-t border-border">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">{t("presetBroken")}</p>
                <p className="mt-0.5">
                  {t("presetBrokenFields", { fields: missing.join(", ") })}
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="px-4 py-2">
              <div className="px-3 py-2 bg-destructive/10 text-destructive text-xs rounded">
                {error}
              </div>
            </div>
          )}

          <div className="p-4 border-t border-border flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={savePreset}
                onChange={(e) => setSavePreset(e.target.checked)}
                disabled={!canConfirm}
              />
              <Save className="w-3 h-3 text-muted-foreground" />
              <span>
                {hasExistingPreset ? t("updateSavedMapping") : t("saveMappingForNextTime")}
              </span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="px-3 py-2 border border-input rounded-lg text-sm hover:bg-accent transition-colors"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!preset) return;
                  const parsed = buildParsedTransactions(rawBytes, preset);
                  onImport(parsed, preset, savePreset);
                }}
                disabled={isPending || !canConfirm || validPreviewCount === 0}
                className={cn(
                  "px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors",
                )}
              >
                {isPending ? "…" : t("confirm")}
              </button>
            </div>
          </div>
        </>
      )}
    </ColumnMapper>
  );
}

// ─── Shared build step ───────────────────────────────────────────────────────

/**
 * Apply the user-chosen 1-indexed inclusive row slice. Empty/undefined
 * values mean "no clipping on that side".
 */
function sliceRows(rows: string[][], rowStart?: number, rowEnd?: number | null): string[][] {
  const startIdx = Math.max(0, (rowStart ?? 1) - 1);
  const endIdx = rowEnd === null || rowEnd === undefined ? rows.length : Math.min(rows.length, rowEnd);
  if (startIdx >= endIdx) return [];
  return rows.slice(startIdx, endIdx);
}

/**
 * Build ParsedTransactions from raw bytes and a finalized preset.
 * Shared between fast-path and mapper-path so the two can never drift.
 *
 * Honors every preset knob:
 *   - encoding   → decodeBytes
 *   - delimiter  → parseCsv
 *   - rowStart/End → sliceRows
 *   - hasHeader  → split header vs data rows
 *   - numberFormat → explicit decimal convention (vs detection)
 *   - dateFormat → explicit parser (vs heuristic)
 *   - splitCreditDebit → derive signed amount from credit/debit columns
 */
function buildParsedTransactions(
  rawBytes: ArrayBuffer,
  preset: CsvMappingPreset,
): ParsedTransaction[] {
  const text = decodeBytes(rawBytes, preset.encoding ?? "utf-8");
  const allRows = parseCsv(text, preset.delimiter);
  const rows = sliceRows(allRows, preset.rowStart, preset.rowEnd);

  const header = preset.hasHeader
    ? rows[0] ?? []
    : rows[0]?.map((_, i) => `Col ${i + 1}`) ?? [];
  const dataRows = preset.hasHeader ? rows.slice(1) : rows;
  const { indices } = resolveMapping(preset, header);

  // Decimal convention: explicit numberFormat wins over the saved
  // convention (which itself came from detection at preset-creation
  // time). Then re-detect from this file as a defensive fallback —
  // helps when the user fixed mapping on a different file shape.
  const explicit = numberFormatToConvention(preset.numberFormat);
  let convention: DecimalConvention =
    explicit !== "unknown" ? explicit : preset.decimalConvention;

  if (explicit === "unknown") {
    const probeIdx =
      indices.amount ?? indices.credit ?? indices.debit;
    if (probeIdx !== undefined) {
      const cells = dataRows.map((r) => r[probeIdx] ?? "");
      const redetected = detectDecimalConvention(cells);
      if (redetected !== "unknown") convention = redetected;
    }
  }

  const out: ParsedTransaction[] = [];
  const seen = new Set<string>();

  for (const row of dataRows) {
    const dateCell = indices.date !== undefined ? row[indices.date] ?? "" : "";
    const purposeCell = indices.purpose !== undefined ? row[indices.purpose] ?? "" : "";
    const nameCell =
      indices.counterpartName !== undefined ? row[indices.counterpartName] ?? "" : "";
    const ibanCell =
      indices.counterpartIban !== undefined ? row[indices.counterpartIban] ?? "" : "";

    const date =
      preset.dateFormat && preset.dateFormat !== "auto"
        ? parseDateWithFormat(dateCell, preset.dateFormat)
        : parseDate(dateCell);

    let amount: number;
    if (preset.splitCreditDebit) {
      const ci = indices.credit;
      const di = indices.debit;
      const credit =
        ci !== undefined ? parseAmount(row[ci] ?? "", convention) : NaN;
      const debit =
        di !== undefined ? parseAmount(row[di] ?? "", convention) : NaN;
      const c = isNaN(credit) ? 0 : Math.abs(credit);
      const d = isNaN(debit) ? 0 : Math.abs(debit);
      amount = c === 0 && d === 0 ? NaN : c - d;
    } else {
      const ai = indices.amount;
      amount = ai !== undefined ? parseAmount(row[ai] ?? "", convention) : NaN;
    }

    if (!date || isNaN(amount) || amount === 0) continue;

    const counterpartName = nameCell.trim() || null;
    const counterpartIban = ibanCell.replace(/\s/g, "").toUpperCase() || null;
    const purpose = purposeCell.trim() || null;

    const externalId = contentHash({
      date,
      amount,
      counterpartIban,
      counterpartName,
      purpose,
    });
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    out.push({
      date,
      valueDate: null,
      amount,
      counterpartName,
      counterpartIban,
      purpose,
      externalId,
    });
  }

  return out;
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function Shell({
  onClose,
  title,
  wide,
  children,
}: {
  onClose: () => void;
  title: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          "bg-card border border-border rounded-lg w-full max-h-[90vh] flex flex-col",
          wide ? "max-w-4xl" : "max-w-xl",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-sm">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
