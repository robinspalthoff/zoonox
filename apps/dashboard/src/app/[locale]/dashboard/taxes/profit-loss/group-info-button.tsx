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

// Info-button placed next to a group header in the P/L breakdown card.
// On click, opens a centered modal listing every invoice/document/journal
// entry that contributed to that group's total. Mirrors the visual language
// of the VAT return's BreakdownRow popup so the two screens feel related.
export function GroupInfoButton({
  groupLabel,
  sources,
  locale,
}: {
  groupLabel: string;
  sources: SourceItem[];
  locale: string;
}) {
  const t = useTranslations("taxes.profitLoss");
  const [open, setOpen] = useState(false);

  if (sources.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        aria-label={t("sources.open")}
        title={t("sources.open")}
      >
        <Info className="w-3.5 h-3.5" />
      </button>

      {open && (
        <SourcesPopup
          label={groupLabel}
          sources={sources}
          locale={locale}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function SourcesPopup({
  label,
  sources,
  locale,
  onClose,
}: {
  label: string;
  sources: SourceItem[];
  locale: string;
  onClose: () => void;
}) {
  const t = useTranslations("taxes.profitLoss");
  const sorted = [...sources].sort((a, b) => a.date.localeCompare(b.date));

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
          {sorted.map((s) => {
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
                    {fmtCurrency(s.net, locale)}
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