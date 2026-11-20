"use client";

// Formularansicht.
//
// Der erste Entwurf zeigte den Vordruck 1:1 von oben nach unten. Formaltreu,
// aber an der Aufgabe vorbei: von rund 40 Feldern trägt ein typischer Mandant
// zwei ein, und dazwischen standen gleichberechtigt die Rechenzeilen 37, 45
// und 48 — die tippt niemand ein, die rechnet ELSTER selbst.
//
// Deshalb trennt die Ansicht jetzt nach dem, was der Nutzer tatsächlich tut:
//
//   1. Übertragen — die Felder, die er in Mein ELSTER eintippt.
//   2. Kontrolle  — die Werte, die ELSTER daraus errechnet. Stimmen sie
//      überein, war die Übertragung fehlerfrei.
//
// Der vollständige Vordruck bleibt einen Klick entfernt, für den Abgleich
// Zeile für Zeile.

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { SourceItem } from "@/lib/reports/source-item";
import { KzRow } from "./kz-row";

export type FormRow = {
  zeile: number;
  kz: string | null;
  label: string;
  hint?: string;
  value: number;
  rounding: "euro" | "cent";
  kind: string;
  notFilled: boolean;
  sources: SourceItem[];
};

export type FormSection = {
  id: string;
  title: string;
  elsterNumber: number;
  elsterTitle: string;
  rows: FormRow[];
};

const COLS = "grid grid-cols-[3rem_3rem_1fr_auto_2.5rem] gap-3";

function hasValue(row: FormRow): boolean {
  return !row.notFilled && Math.abs(row.value) >= 0.005;
}

/** Zeilen, die der Nutzer selbst einträgt — Rechenzeilen gehören nicht dazu. */
function isTransferable(row: FormRow): boolean {
  return row.kind !== "computed" && hasValue(row);
}

export function UstvaFormView({
  sections,
  locale,
}: {
  sections: FormSection[];
  locale: string;
}) {
  const t = useTranslations("taxes.vatReturn.elster");
  const [showFullForm, setShowFullForm] = useState(false);

  // Zu übertragende Felder, gruppiert nach dem Abschnitt in Mein ELSTER.
  // Gruppiert wird nach ELSTER-Nummer, weil die Vordruck-Abschnitte A und B
  // dort zusammen in Abschnitt 3 liegen.
  const transferGroups = useMemo(() => {
    const byNumber = new Map<number, { number: number; title: string; rows: FormRow[] }>();
    for (const s of sections) {
      const rows = s.rows.filter(isTransferable);
      if (rows.length === 0) continue;
      const g = byNumber.get(s.elsterNumber) ?? {
        number: s.elsterNumber,
        title: s.elsterTitle,
        rows: [],
      };
      g.rows.push(...rows);
      byNumber.set(s.elsterNumber, g);
    }
    return [...byNumber.values()].sort((a, b) => a.number - b.number);
  }, [sections]);

  const transferCount = transferGroups.reduce((n, g) => n + g.rows.length, 0);

  // Rechenzeilen inklusive Kz 83 — das Ergebnis zum Abgleich.
  const controlRows = useMemo(
    () => sections.flatMap((s) => s.rows.filter((r) => r.kind === "computed")),
    [sections],
  );

  return (
    <div className="space-y-4">
      {/* ── Übertragen ──────────────────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">
            {t("transferTitle", { count: transferCount })}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">{t("transferHint")}</p>
        </div>

        {transferCount === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">
            {t("transferEmpty")}
          </p>
        ) : (
          transferGroups.map((g) => (
            <div key={g.number}>
              <div className="px-4 py-2 bg-muted/30 border-b border-border/60">
                <p className="text-xs font-medium text-foreground">
                  {t("sectionLabel", { number: g.number, title: g.title })}
                </p>
              </div>
              <div className={`${COLS} px-4 py-2 border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground`}>
                <span>{t("zeile")}</span>
                <span>{t("kz")}</span>
                <span>{t("field")}</span>
                <span className="text-right">{t("amount")}</span>
                <span />
              </div>
              {g.rows.map((row, i) => (
                <KzRow
                  key={`${row.zeile}-${row.kz ?? i}`}
                  {...row}
                  emphasis={false}
                  locale={locale}
                />
              ))}
            </div>
          ))
        )}
      </section>

      {/* ── Kontrolle ───────────────────────────────────────────────────── */}
      {/* Diese Werte werden nicht eingetippt. ELSTER rechnet sie aus den
          übertragenen Feldern — sie sind die Probe aufs Exempel. */}
      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">{t("controlTitle")}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{t("controlHint")}</p>
        </div>
        {controlRows.map((row, i) => (
          <KzRow
            key={`${row.zeile}-${row.kz ?? i}`}
            {...row}
            emphasis={row.kz === "83"}
            locale={locale}
            copyable={false}
          />
        ))}
      </section>

      {/* ── Vollständiger Vordruck ──────────────────────────────────────── */}
      <div>
        <button
          type="button"
          onClick={() => setShowFullForm((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground transition-colors"
        >
          {showFullForm ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          {showFullForm ? t("hideFullForm") : t("showFullForm")}
        </button>

        {showFullForm && (
          <div className="mt-4 space-y-4">
            <p className="text-xs text-muted-foreground">{t("fullFormHint")}</p>
            {sections.map((s) => (
              <section
                key={s.id}
                className="bg-card border border-border rounded-xl overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-border bg-muted/30">
                  <h4 className="text-sm font-semibold text-foreground">
                    <span className="text-muted-foreground mr-2">{s.id}.</span>
                    {s.title}
                  </h4>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {t("sectionLabel", { number: s.elsterNumber, title: s.elsterTitle })}
                  </p>
                </div>
                <div className={`${COLS} px-4 py-2 border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground`}>
                  <span>{t("zeile")}</span>
                  <span>{t("kz")}</span>
                  <span>{t("field")}</span>
                  <span className="text-right">{t("amount")}</span>
                  <span />
                </div>
                {s.rows.map((row, i) => (
                  <KzRow
                    key={`${row.zeile}-${row.kz ?? i}`}
                    {...row}
                    emphasis={row.kind === "computed"}
                    locale={locale}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
