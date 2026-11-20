"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Info } from "lucide-react";
import type { SourceItem } from "@/lib/reports/source-item";
import { SourcesPopup } from "../breakdown-row";

/**
 * Eine Formularzeile.
 *
 * Layout bewusst wie im amtlichen Vordruck: Zeilennummer, Kennzahl,
 * Bezeichnung, Betrag. Wer die Ansicht neben Mein ELSTER legt, findet jedes
 * Feld an derselben Stelle.
 *
 * Der Kopierknopf gibt den Wert in dem Format aus, das ELSTER erwartet:
 * Bemessungsgrundlagen ohne Nachkommastellen, Steuerbeträge mit zwei — und
 * mit Komma als Dezimaltrennzeichen, damit das Einfügen ohne Nacharbeit
 * funktioniert.
 */
export function KzRow({
  zeile,
  kz,
  label,
  hint,
  value,
  rounding,
  kind,
  notFilled,
  emphasis,
  sources,
  locale,
  copyable = true,
}: {
  zeile: number;
  kz: string | null;
  label: string;
  hint?: string;
  value: number;
  rounding: "euro" | "cent";
  kind: string;
  notFilled: boolean;
  emphasis?: boolean;
  sources: SourceItem[];
  locale: string;
  /** Rechenzeilen trägt niemand ein — dort ist der Kopierknopf nur Rauschen. */
  copyable?: boolean;
}) {
  const t = useTranslations("taxes.vatReturn.elster");
  const [copied, setCopied] = useState(false);
  const [showSources, setShowSources] = useState(false);

  const isEmpty = !notFilled && Math.abs(value) < 0.005;

  const display = notFilled
    ? "—"
    : rounding === "euro"
      ? new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(value)
      : new Intl.NumberFormat("de-DE", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(value);

  // Für die Zwischenablage ohne Tausenderpunkte — ELSTER nimmt den rohen Wert.
  const clipboard =
    rounding === "euro" ? String(Math.round(value)) : value.toFixed(2).replace(".", ",");

  async function copy() {
    try {
      await navigator.clipboard.writeText(clipboard);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Zwischenablage nicht verfügbar (z.B. ohne HTTPS) — der Wert steht
      // daneben und lässt sich von Hand übertragen.
    }
  }

  return (
    <div
      className={`grid grid-cols-[3rem_3rem_1fr_auto_2.5rem] items-center gap-3 px-4 py-2.5 border-b border-border/60 last:border-0 ${
        emphasis ? "bg-muted/40 font-medium" : ""
      } ${isEmpty ? "opacity-55" : ""}`}
    >
      <span className="text-xs text-muted-foreground tabular-nums">{zeile}</span>
      <span
        className={`text-xs tabular-nums font-medium ${
          kz ? "text-foreground" : "text-muted-foreground/60"
        }`}
      >
        {kz ?? "—"}
      </span>
      <span className="text-sm text-foreground leading-snug" title={hint}>
        {label}
        {/* Drill-down auf die Belege, die diesen Wert ergeben — dieselbe
            Komponente wie in der Übersicht, damit sich beide gleich anfühlen. */}
        {sources.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSources(true)}
            className="ml-2 inline-flex items-center justify-center w-5 h-5 align-middle rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            aria-label={`${t("sourcesTitle")} — ${kz ?? zeile}`}
            title={t("sourcesTitle")}
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        )}
        {kind === "computed" && (
          <span className="ml-2 text-xs text-muted-foreground">({t("computed")})</span>
        )}
        {notFilled && (
          <span className="ml-2 text-xs text-muted-foreground">({t("notFilled")})</span>
        )}
      </span>
      <span className="text-sm tabular-nums text-right text-foreground">{display}</span>
      {notFilled || !copyable ? (
        <span />
      ) : (
        <button
          type="button"
          onClick={copy}
          title={t("copy")}
          aria-label={`${t("copy")} ${kz ?? zeile}`}
          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {copied ? (
            <Check className="w-4 h-4 text-emerald-600" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
      )}

      {showSources && (
        <SourcesPopup
          label={`${t("kz")} ${kz ?? "—"} · ${label}`}
          sources={[...sources].sort((a, b) => a.date.localeCompare(b.date))}
          locale={locale}
          onClose={() => setShowSources(false)}
        />
      )}
    </div>
  );
}
