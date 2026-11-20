// Aggregation der Buchungen zu Formularwerten + die Rechenzeilen des Vordrucks.
//
// Bewusst pur: rein in Zahlen, raus in Zahlen. Die Datenbankabfrage liegt in
// `query.ts`, damit diese Logik ohne DB testbar bleibt.
//
// Zwei Dinge, die hier den Unterschied machen:
//
// 1. Wir rechnen die Steuer so, wie ELSTER sie rechnet — aus der auf volle
//    Euro gerundeten Bemessungsgrundlage, nicht als Summe der je Beleg
//    gerundeten Steuerbeträge. Beides weicht um Cent voneinander ab. Wer
//    unsere Zahl neben die ELSTER-Zahl legt, soll dieselbe sehen.
// 2. Die Abweichung wird nicht versteckt, sondern als `roundingDelta`
//    ausgewiesen.

import type { UstvaField, UstvaForm, UstvaSection } from "./types";
import { targetFor, isPendingClarification, PENDING_CLARIFICATION } from "./mapping";

/**
 * Kaufmännische Rundung auf volle Euro, symmetrisch um null.
 *
 * `Math.round` rundet -0,5 auf -0 (also Richtung plus unendlich); bei
 * Entgeltminderungen und Gutschriften sind negative Bemessungsgrundlagen aber
 * normal. Deshalb wird über den Betrag gerundet und das Vorzeichen wieder
 * angehängt.
 *
 * Wird für rein nachrichtliche Bemessungsgrundlagen verwendet, die keine
 * Steuer auslösen. Wo Steuer entsteht, greift `roundEuroInFavour`.
 */
export function roundEuro(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

/**
 * Rundung auf volle Euro zugunsten des Steuerpflichtigen.
 *
 * Bei Beträgen, aus denen ELSTER Steuer errechnet, wird abgerundet — jeder
 * angefangene Euro weniger Bemessungsgrundlage bedeutet weniger Steuer. Das
 * gilt in beide Richtungen: bei einem negativen Saldo (Gutschriftenüberhang)
 * führt Abrunden Richtung minus unendlich zu einem größeren Guthaben, also
 * ebenfalls zugunsten des Steuerpflichtigen.
 *
 * `Math.floor` leistet genau das, weil es immer Richtung minus unendlich
 * rundet — anders als eine betragsbasierte Rundung.
 */
export function roundEuroInFavour(n: number): number {
  return Math.floor(n);
}

/** Kaufmännische Rundung auf Cent, ebenfalls symmetrisch um null. */
export function roundCent(n: number): number {
  return (Math.sign(n) * Math.round(Math.abs(n) * 100)) / 100;
}

/** Eine vorsteuer-/umsatzsteuerbehaftete Buchungszeile, auf das Nötige reduziert. */
export type UstvaSourceLine<S = unknown> = {
  vatCode: string;
  /** Nettobetrag, vorzeichenbehaftet (Erlös bzw. Aufwand positiv). */
  net: number;
  /** Steuerbetrag, vorzeichenbehaftet. */
  vat: number;
  /** Beliebige Nutzlast für den Drill-down in der Ansicht. */
  source?: S;
};

export type UstvaRow<S = unknown> = {
  field: UstvaField;
  /** Wert, wie er in ELSTER einzutragen ist (bereits gerundet). */
  value: number;
  /** Summe aus den Buchungen vor der Formularrundung. */
  rawValue: number;
  /** Belege, die in diesen Wert eingeflossen sind. */
  sources: S[];
  /** True, wenn das Feld bewusst nicht befüllt wird (Ankreuzfelder). */
  notFilled: boolean;
};

export type UstvaSectionResult<S = unknown> = {
  section: Pick<UstvaSection, "id" | "title" | "elster">;
  rows: UstvaRow<S>[];
};

export type UstvaUnmapped<S = unknown> = {
  vatCode: string;
  net: number;
  vat: number;
  sources: S[];
  /** Erläuterung, falls der Schlüssel bekannt, aber fachlich ungeklärt ist. */
  reason: string | null;
};

export type UstvaResult<S = unknown> = {
  form: UstvaForm;
  sections: UstvaSectionResult<S>[];
  /** Schnellzugriff Kennzahl → Zeile. */
  byKz: Map<string, UstvaRow<S>>;
  /** Zeile 37 — Umsatzsteuer. */
  totalVat: number;
  /** Zeile 45 — verbleibender Betrag nach Vorsteuerabzug. */
  remainder: number;
  /** Zeile 48 — Vorauszahlung/Überschuss. */
  advancePayment: number;
  /** Kz 83, Zeile 50 — verbleibende Vorauszahlung bzw. Überschuss. */
  payable: number;
  /**
   * Differenz zwischen der von ELSTER aus gerundeten Bemessungsgrundlagen
   * berechneten Umsatzsteuer und der Summe der je Beleg gebuchten Steuer.
   * Ein paar Cent sind normal; ein größerer Betrag deutet auf einen Fehler
   * in den Buchungen hin.
   */
  roundingDelta: number;
  /** Steuerschlüssel ohne Zuordnung — werden in der Ansicht ausgewiesen. */
  unmapped: UstvaUnmapped<S>[];
  /** True, wenn überhaupt Buchungen im Zeitraum lagen. */
  hasData: boolean;
};

type Bucket<S> = { amount: number; sources: S[] };

function add<S>(m: Map<string, Bucket<S>>, kz: string, amount: number, source?: S): void {
  const b = m.get(kz) ?? { amount: 0, sources: [] };
  b.amount += amount;
  if (source !== undefined) b.sources.push(source);
  m.set(kz, b);
}

export function computeUstva<S = unknown>(
  form: UstvaForm,
  lines: UstvaSourceLine<S>[],
): UstvaResult<S> {
  const bmg = new Map<string, Bucket<S>>();
  const tax = new Map<string, Bucket<S>>();
  const inputTax = new Map<string, Bucket<S>>();
  const unmappedBuckets = new Map<string, UstvaUnmapped<S>>();

  /** Gebuchte Umsatzsteuer aus den Sätzen, die ELSTER selbst rechnet. */
  let bookedRateVat = 0;

  for (const line of lines) {
    const target = targetFor(line.vatCode);
    if (!target) {
      const u = unmappedBuckets.get(line.vatCode) ?? {
        vatCode: line.vatCode,
        net: 0,
        vat: 0,
        sources: [] as S[],
        reason: isPendingClarification(line.vatCode)
          ? PENDING_CLARIFICATION[line.vatCode]
          : null,
      };
      u.net += line.net;
      u.vat += line.vat;
      if (line.source !== undefined) u.sources.push(line.source);
      unmappedBuckets.set(line.vatCode, u);
      continue;
    }

    if (target.bmgKz) add(bmg, target.bmgKz, line.net, line.source);
    if (target.taxKz) add(tax, target.taxKz, line.vat, line.source);
    if (target.inputTaxKz) add(inputTax, target.inputTaxKz, line.vat, line.source);

    // Steuer, die ELSTER selbst aus der Bemessungsgrundlage errechnet:
    // hier merken wir uns den gebuchten Wert für den Rundungsabgleich.
    if (target.bmgKz && !target.taxKz && !target.inputTaxKz) bookedRateVat += line.vat;
  }

  // ── Feldwerte bilden ──────────────────────────────────────────────────────
  const byKz = new Map<string, UstvaRow<S>>();
  const rowsByZeile = new Map<number, UstvaRow<S>[]>();

  const buildRow = (field: UstvaField): UstvaRow<S> => {
    if (field.kind === "flag") {
      return { field, value: 0, rawValue: 0, sources: [], notFilled: true };
    }
    if (field.kind === "computed") {
      // Rechenzeilen werden unten nachgetragen, sobald alle Felder stehen.
      return { field, value: 0, rawValue: 0, sources: [], notFilled: false };
    }
    const src =
      field.kind === "bmg" ? bmg : field.kind === "input_tax" ? inputTax : tax;
    const bucket = field.kz ? src.get(field.kz) : undefined;
    const rawValue = bucket?.amount ?? 0;
    // Bemessungsgrundlagen, aus denen Steuer entsteht, werden zugunsten des
    // Steuerpflichtigen abgerundet. Rein nachrichtliche Werte (steuerfreie
    // Umsätze, Kz 45, Abschnitt I) lösen keine Steuer aus — dort ist die
    // genauere kaufmännische Rundung richtig.
    const generatesTax = field.kind === "bmg" && (field.rate !== undefined || !!field.taxKz);
    const value =
      field.rounding === "euro"
        ? generatesTax
          ? roundEuroInFavour(rawValue)
          : roundEuro(rawValue)
        : roundCent(rawValue);
    return { field, value, rawValue, sources: bucket?.sources ?? [], notFilled: false };
  };

  const sections: UstvaSectionResult<S>[] = form.sections.map((section) => ({
    section: { id: section.id, title: section.title, elster: section.elster },
    rows: section.fields.map((field) => {
      const row = buildRow(field);
      if (field.kz) byKz.set(field.kz, row);
      const list = rowsByZeile.get(field.zeile) ?? [];
      list.push(row);
      rowsByZeile.set(field.zeile, list);
      return row;
    }),
  }));

  const allRows = sections.flatMap((s) => s.rows);

  /** Steuer, die auf eine Zeile entfällt — eingetragen oder von ELSTER gerechnet. */
  const taxOfRow = (row: UstvaRow<S>): number => {
    const f = row.field;
    if (f.memoOnly) return 0;
    if (f.kind === "tax") return row.value;
    // Bemessungsgrundlage mit festem Satz: ELSTER rechnet aus dem gerundeten Wert.
    if (f.kind === "bmg" && f.rate !== undefined) return roundCent((row.value * f.rate) / 100);
    return 0;
  };

  const inZeilen = (row: UstvaRow<S>, from: number, to: number) =>
    row.field.zeile >= from && row.field.zeile <= to;

  // Zeile 37 — Umsatzsteuer (Summe der Zeilen 13 bis 18 und 25 bis 32)
  const totalVat = roundCent(
    allRows
      .filter((r) => inZeilen(r, 13, 18) || inZeilen(r, 25, 32))
      .reduce((sum, r) => sum + taxOfRow(r), 0),
  );

  // Zeile 45 — verbleibender Betrag (Zeile 37 abzüglich der Zeilen 38 bis 44)
  const deductible = roundCent(
    allRows
      .filter((r) => inZeilen(r, 38, 44) && r.field.kind === "input_tax" && !r.field.memoOnly)
      .reduce((sum, r) => sum + r.value, 0),
  );
  const remainder = roundCent(totalVat - deductible);

  // Zeile 48 — Vorauszahlung/Überschuss (Summe der Zeilen 45 bis 47)
  const otherTax = roundCent(
    allRows
      .filter((r) => inZeilen(r, 46, 47) && r.field.kind === "tax")
      .reduce((sum, r) => sum + r.value, 0),
  );
  const advancePayment = roundCent(remainder + otherTax);

  // Zeile 50 / Kz 83 — nach Abzug der Sondervorauszahlung (Kz 39)
  const specialAdvance = byKz.get("39")?.value ?? 0;
  const payable = roundCent(advancePayment - specialAdvance);

  // Rechenzeilen nachtragen.
  const setComputed = (zeile: number, value: number) => {
    for (const row of rowsByZeile.get(zeile) ?? []) {
      if (row.field.kind === "computed") {
        row.value = value;
        row.rawValue = value;
      }
    }
  };
  setComputed(37, totalVat);
  setComputed(45, remainder);
  setComputed(48, advancePayment);
  setComputed(50, payable);

  // ── Rundungsabgleich ──────────────────────────────────────────────────────
  // ELSTER rechnet aus gerundeten Bemessungsgrundlagen, die Buchhaltung
  // summiert je Beleg gerundete Steuerbeträge. Die Differenz gehört
  // ausgewiesen, nicht wegdiskutiert.
  const elsterRateVat = roundCent(
    allRows
      .filter((r) => r.field.kind === "bmg" && r.field.rate !== undefined && !r.field.memoOnly)
      .reduce((sum, r) => sum + roundCent((r.value * (r.field.rate ?? 0)) / 100), 0),
  );
  const roundingDelta = roundCent(elsterRateVat - roundCent(bookedRateVat));

  const unmapped = [...unmappedBuckets.values()];
  const hasData = lines.length > 0;

  return {
    form,
    sections,
    byKz,
    totalVat,
    remainder,
    advancePayment,
    payable,
    roundingDelta,
    unmapped,
    hasData,
  };
}
