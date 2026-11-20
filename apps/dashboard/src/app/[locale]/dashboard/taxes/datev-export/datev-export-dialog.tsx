"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { X, Download, AlertCircle, Loader2, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Phase =
  | { kind: "form" }
  | { kind: "submitting" }
  | { kind: "done"; entries: number; documents: number; invoices: number; bank: number; missing: number }
  | { kind: "error"; msg: string };

type Props = {
  defaultFiscalYearStart: string; // YYYY-MM-DD
  defaultDateFrom: string;
  defaultDateTo: string;
  onClose: () => void;
};

export function DatevExportDialog({
  defaultFiscalYearStart,
  defaultDateFrom,
  defaultDateTo,
  onClose,
}: Props) {
  const t = useTranslations("taxes.taxAdvisor.datevDialog");

  const [consultantNumber, setConsultantNumber] = useState("0");
  const [clientNumber, setClientNumber] = useState("0");
  const [fiscalYearStart, setFiscalYearStart] = useState(defaultFiscalYearStart);
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [includeIncoming, setIncludeIncoming] = useState(true);
  const [includeInvoices, setIncludeInvoices] = useState(true);
  const [includeBank, setIncludeBank] = useState(true);
  const [includeBelegbilder, setIncludeBelegbilder] = useState(true);
  const [locked, setLocked] = useState(false);
  const [includeReversed, setIncludeReversed] = useState(false);

  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  async function submit() {
    setPhase({ kind: "submitting" });
    try {
      const res = await fetch("/api/taxes/datev/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consultantNumber: Number(consultantNumber || 0),
          clientNumber: Number(clientNumber || 0),
          fiscalYearStart,
          dateFrom,
          dateTo,
          locked,
          includeBelegbilder,
          includeDocuments: includeIncoming,
          includeInvoices,
          includeBank,
          includeReversed,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: res.statusText }));
        setPhase({ kind: "error", msg: errBody.error ?? `HTTP ${res.status}` });
        return;
      }

      const entries = Number(res.headers.get("X-Datev-Entries") ?? 0);
      const documents = Number(res.headers.get("X-Datev-Documents") ?? 0);
      const invoices = Number(res.headers.get("X-Datev-Invoices") ?? 0);
      const bank = Number(res.headers.get("X-Datev-Bank") ?? 0);
      const missing = Number(res.headers.get("X-Datev-Missing") ?? 0);

      const blob = await res.blob();
      const fname =
        res.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] ?? "datev-export.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setPhase({ kind: "done", entries, documents, invoices, bank, missing });
    } catch (e) {
      setPhase({ kind: "error", msg: e instanceof Error ? e.message : "Unbekannter Fehler" });
    }
  }

  const canSubmit =
    fiscalYearStart !== "" && dateFrom !== "" && dateTo !== "";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg w-full max-w-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-sm">{t("title")}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {phase.kind === "done" ? (
          <div className="p-6 flex flex-col items-center text-center gap-3">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            <p className="text-sm font-medium">{t("doneTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {t("doneStats", {
                entries: phase.entries,
                documents: phase.documents,
                invoices: phase.invoices,
                bank: phase.bank,
              })}
            </p>
            {phase.missing > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t("doneMissing", { count: phase.missing })}
              </p>
            )}
            <button
              onClick={onClose}
              className="mt-3 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
            >
              {t("close")}
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-y-auto p-5 space-y-5 text-sm">
              <Section title={t("sectionGeneral")}>
                <Field
                  label={t("consultantNumber")}
                  required
                  tooltip={t("numbersTooltip")}
                >
                  <input
                    type="number"
                    value={consultantNumber}
                    onChange={(e) => setConsultantNumber(e.target.value)}
                    min={0}
                    max={9999999}
                    className={inputCls}
                  />
                </Field>
                <Field
                  label={t("clientNumber")}
                  required
                  tooltip={t("numbersTooltip")}
                >
                  <input
                    type="number"
                    value={clientNumber}
                    onChange={(e) => setClientNumber(e.target.value)}
                    min={0}
                    max={99999}
                    className={inputCls}
                  />
                </Field>
                <Field label={t("fiscalYearStart")}>
                  <input
                    type="date"
                    value={fiscalYearStart}
                    onChange={(e) => setFiscalYearStart(e.target.value)}
                    className={inputCls}
                  />
                </Field>
              </Section>

              <Section title={t("sectionPeriod")}>
                <Field label={t("dateFrom")}>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label={t("dateTo")}>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className={inputCls}
                  />
                </Field>
              </Section>

              <Section title={t("sectionDocuments")}>
                <Toggle
                  checked={includeInvoices}
                  onChange={setIncludeInvoices}
                  label={t("includeInvoices")}
                />
                <Toggle
                  checked={includeIncoming}
                  onChange={setIncludeIncoming}
                  label={t("includeIncoming")}
                />
                <Toggle
                  checked={includeBank}
                  onChange={setIncludeBank}
                  label={t("includeBank")}
                  hint={t("includeBankHint")}
                />
              </Section>

              <Section title={t("sectionData")}>
                <Toggle checked disabled label={t("includeBookings")} />
                <Toggle
                  checked={includeBelegbilder}
                  onChange={setIncludeBelegbilder}
                  label={t("includeBelegbilder")}
                  hint={t("belegbilderHint")}
                />
              </Section>

              <Section title={t("sectionAdvanced")}>
                <Toggle
                  checked={locked}
                  onChange={setLocked}
                  label={t("locked")}
                  hint={t("lockedHint")}
                />
                <Toggle
                  checked={includeReversed}
                  onChange={setIncludeReversed}
                  label={t("includeReversed")}
                  hint={t("includeReversedHint")}
                />
              </Section>

              {phase.kind === "error" && (
                <div className="flex items-start gap-2 p-3 bg-destructive/10 text-destructive rounded text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>{phase.msg}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
              <button
                onClick={onClose}
                disabled={phase.kind === "submitting"}
                className="px-4 py-2 text-sm rounded-lg hover:bg-accent disabled:opacity-50"
              >
                {t("cancel")}
              </button>
              <button
                onClick={submit}
                disabled={!canSubmit || phase.kind === "submitting"}
                className={cn(
                  "px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg inline-flex items-center gap-2",
                  "hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                {phase.kind === "submitting" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {t("submit")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const inputCls =
  "w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  required,
  tooltip,
  children,
}: {
  label: string;
  required?: boolean;
  tooltip?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
        {label}
        {required && <span className="text-destructive">*</span>}
        {tooltip && (
          <span
            className="relative inline-flex group"
            // Wrapper is span so the surrounding <label> still triggers the input.
          >
            <Info
              className="w-3.5 h-3.5 text-muted-foreground/60 hover:text-muted-foreground cursor-help"
              aria-label={tooltip}
            />
            <span
              role="tooltip"
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-10 w-60 rounded-md bg-popover text-popover-foreground border border-border px-2.5 py-1.5 text-xs leading-snug shadow-md opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
            >
              {tooltip}
            </span>
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-2.5 col-span-1 sm:col-span-2 p-2 rounded cursor-pointer hover:bg-accent/40",
        disabled && "cursor-not-allowed opacity-70",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="mt-0.5 accent-primary"
      />
      <span className="flex flex-col">
        <span className="text-sm">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}
