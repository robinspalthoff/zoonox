"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Info, X, FileText, ReceiptText, BookOpen } from "lucide-react";
import type { SourceItem } from "@/lib/reports/source-item";

function fmtCurrency(n: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
}

function fmtDate(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));
}

export function BreakdownRow({
  label,
  net,
  vat,
  vatLabel,
  sources,
  locale,
  negative,
}: {
  label: string;
  net: number;
  vat: number;
  /** Optional override for the third column. Used by the tax-free section
   *  to show a UStVA Kennzahl (e.g., "KZ 41") instead of a VAT amount. */
  vatLabel?: string;
  sources: SourceItem[];
  locale: string;
  negative?: boolean;
}) {
  const t = useTranslations("taxes.vatReturn");
  const [open, setOpen] = useState(false);
  const prefix = negative ? "−" : "";

  const sorted = [...sources].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
      <tr>
        <td className="px-4 py-2 text-foreground">
          <span className="inline-flex items-center gap-2">
            {label}
            {sources.length > 0 && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center justify-center w-5 h-5 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                aria-label={t("sources.open")}
                title={t("sources.open")}
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            )}
          </span>
        </td>
        <td className="px-4 py-2 text-right text-foreground tabular-nums">
          {prefix}
          {fmtCurrency(net, locale)}
        </td>
        <td className="px-4 py-2 text-right text-foreground tabular-nums">
          {vatLabel !== undefined ? (
            <span className="text-muted-foreground">{vatLabel}</span>
          ) : (
            <>
              {prefix}
              {fmtCurrency(vat, locale)}
            </>
          )}
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={3} className="p-0">
            <SourcesPopup
              label={label}
              sources={sorted}
              locale={locale}
              negative={negative}
              onClose={() => setOpen(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Belegliste zu einem aggregierten Wert.
 *
 * Wird auch von der ELSTER-Formularansicht genutzt (kz-row.tsx), damit der
 * Drill-down in beiden Ansichten identisch aussieht und sich identisch
 * verhält.
 */
export function SourcesPopup({
  label,
  sources,
  locale,
  negative,
  onClose,
}: {
  label: string;
  sources: SourceItem[];
  locale: string;
  negative?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("taxes.vatReturn");
  const prefix = negative ? "−" : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] bg-card border border-border rounded-lg shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t("sources.title")}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            aria-label={t("sources.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto divide-y divide-border">
          {sources.map((s) => {
            const Icon =
              s.kind === "invoice" ? FileText : s.kind === "document" ? ReceiptText : BookOpen;
            return (
              <Link
                key={`${s.kind}-${s.id}`}
                href={s.href as never}
                className="flex items-center gap-3 px-5 py-3 hover:bg-accent transition-colors"
              >
                <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary shrink-0">
                  <Icon className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground truncate">{s.label}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {fmtDate(s.date, locale)}
                    {s.secondary ? ` · ${s.secondary}` : ""}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm text-foreground tabular-nums">
                    {prefix}
                    {fmtCurrency(s.net, locale)}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {t("breakdown.vat")}: {prefix}
                    {fmtCurrency(s.vat, locale)}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
