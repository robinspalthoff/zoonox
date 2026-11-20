"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  FileText,
  FileMinus2,
  ClipboardList,
  FileCheck,
  Truck,
  Users,
  Check,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type { NumberRangeType } from "@prisma/client";
import { derivesYearlyReset, previewNumber } from "@/lib/number-ranges";
import { saveNumberRange } from "./actions";

export interface RangeData {
  type: NumberRangeType;
  format: string;
  nextNumber: number;
  minDigits: number;
}

const ICONS: Record<NumberRangeType, typeof FileText> = {
  INVOICE: FileText,
  CREDIT_NOTE: FileMinus2,
  QUOTE: ClipboardList,
  ORDER_CONFIRMATION: FileCheck,
  DELIVERY_NOTE: Truck,
  CUSTOMER: Users,
  SUPPLIER: Users,
};

// Tight grid: type | format (flex) | next | digits | preview | save icon.
// Inputs share the row so the whole table fits without scrolling on a typical
// settings-page width.
const GRID = "grid grid-cols-[170px_1fr_88px_88px_160px_36px] items-center gap-3";

const INPUT_BASE =
  "w-full h-8 px-2.5 rounded-md border bg-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors";

export function NumberRangesForm({ initial }: { initial: RangeData[] }) {
  const t = useTranslations("settings.numberRanges");

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* One-line placeholder hint replaces the old cheat-sheet card. */}
      <div className="px-4 py-2 border-b border-border bg-muted/30 text-[11px] text-muted-foreground">
        <span className="mr-2 font-semibold uppercase tracking-[.06em]">
          {t("placeholdersLabel")}
        </span>
        {(["YYYY", "YY", "MM", "DD", "NUMBER"] as const).map((p, i) => (
          <span key={p}>
            {i > 0 && <span className="mx-1.5 opacity-40">·</span>}
            <code className="font-mono text-foreground">{`{${p}}`}</code>
          </span>
        ))}
      </div>

      {/* Column headers */}
      <div
        className={`${GRID} px-4 py-2 border-b border-border bg-muted/40 text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground`}
      >
        <div>{t("columns.type")}</div>
        <div>{t("columns.format")}</div>
        <div className="text-right">{t("columns.next")}</div>
        <div className="text-right">{t("columns.digits")}</div>
        <div className="text-right">{t("columns.preview")}</div>
        <div />
      </div>

      {/* Rows */}
      {initial.map((range) => (
        <RangeRow key={range.type} initial={range} />
      ))}
    </div>
  );
}

function RangeRow({ initial }: { initial: RangeData }) {
  const t = useTranslations("settings.numberRanges");
  const Icon = ICONS[initial.type];

  const [baseline, setBaseline] = useState<RangeData>(initial);
  const [data, setData] = useState<RangeData>(initial);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<
    { message: string; field?: "format" | "nextNumber" | "minDigits" } | null
  >(null);
  const [pending, startTransition] = useTransition();

  const dirty =
    data.format !== baseline.format ||
    data.nextNumber !== baseline.nextNumber ||
    data.minDigits !== baseline.minDigits;

  // Yearly reset is derived from the format — the user never edits it
  // directly. Customer numbers have no year placeholder, so reset stays off.
  const preview = useMemo(() => {
    try {
      return previewNumber({
        format: data.format,
        prefix: "",
        minDigits: data.minDigits,
        nextNumber: data.nextNumber,
        yearlyReset: derivesYearlyReset(data.format),
        lastYear: null,
      });
    } catch {
      return "—";
    }
  }, [data]);

  function patch<K extends keyof RangeData>(key: K, value: RangeData[K]) {
    setError(null);
    setSavedAt(null);
    setData((d) => ({ ...d, [key]: value }));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveNumberRange({
        type: data.type,
        format: data.format,
        nextNumber: data.nextNumber,
        minDigits: data.minDigits,
      });
      if (res.success) {
        setBaseline(data);
        setSavedAt(Date.now());
        setTimeout(() => setSavedAt(null), 2000);
      } else {
        setError({ message: res.error, field: res.field });
      }
    });
  }

  const formatErr = error?.field === "format";
  const nextErr = error?.field === "nextNumber";
  const digitsErr = error?.field === "minDigits";

  // What the save button looks like: hidden when row is at rest, primary
  // when dirty, destructive on error, success flash right after save.
  let saveState: "hidden" | "dirty" | "error" | "saved" = "hidden";
  if (error) saveState = "error";
  else if (savedAt) saveState = "saved";
  else if (dirty) saveState = "dirty";

  const saveBtnClass =
    saveState === "error"
      ? "bg-destructive/10 text-destructive hover:bg-destructive/15"
      : saveState === "saved"
        ? "bg-success/15 text-success"
        : "bg-primary text-primary-foreground shadow-sm shadow-primary/30 hover:bg-primary/90";

  return (
    <div
      className={`${GRID} px-4 py-2 border-b border-border last:border-b-0 hover:bg-muted/15 transition-colors`}
    >
      {/* Typ */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-3.5 w-3.5 text-primary" />
        </div>
        <span className="text-sm font-medium text-foreground truncate">
          {t(`types.${data.type}`)}
        </span>
      </div>

      {/* Format */}
      <input
        value={data.format}
        onChange={(e) => patch("format", e.target.value)}
        spellCheck={false}
        placeholder="{NUMBER}"
        title={error && formatErr ? error.message : undefined}
        className={`${INPUT_BASE} font-mono ${
          formatErr ? "border-destructive focus:border-destructive" : "border-border focus:border-primary/50"
        }`}
      />

      {/* Nächste Nummer */}
      <input
        type="number"
        min={1}
        value={data.nextNumber}
        onChange={(e) =>
          patch("nextNumber", Math.max(1, Math.floor(Number(e.target.value) || 1)))
        }
        title={error && nextErr ? error.message : undefined}
        className={`${INPUT_BASE} text-right tabular-nums ${
          nextErr ? "border-destructive focus:border-destructive" : "border-border focus:border-primary/50"
        }`}
      />

      {/* Mindestlänge */}
      <input
        type="number"
        min={1}
        max={10}
        value={data.minDigits}
        onChange={(e) =>
          patch("minDigits", Math.max(1, Math.min(10, Number(e.target.value) || 1)))
        }
        title={error && digitsErr ? error.message : undefined}
        className={`${INPUT_BASE} text-right tabular-nums ${
          digitsErr ? "border-destructive focus:border-destructive" : "border-border focus:border-primary/50"
        }`}
      />

      {/* Vorschau */}
      <div className="font-mono text-sm tabular-nums text-foreground text-right truncate">
        {preview}
      </div>

      {/* Save — only when there's something to do, say, or show. */}
      <div className="flex justify-end">
        {saveState !== "hidden" && (
          <button
            type="button"
            onClick={save}
            disabled={pending || saveState === "saved"}
            title={
              error?.message ??
              (saveState === "saved" ? t("saved") : t("save"))
            }
            aria-label={t("save")}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${saveBtnClass} disabled:opacity-60`}
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : saveState === "error" ? (
              <AlertCircle className="h-3.5 w-3.5" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
