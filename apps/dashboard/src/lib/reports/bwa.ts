// Aggregation logic for the monthly BWA (Betriebswirtschaftliche
// Auswertung). Wraps `computeProfitLoss` over the 12 months of a year
// and maps the SKR account groups to standardized BWA categories. By
// reusing the P/L aggregator we get GUV / EÜR semantics for free and
// stay automatically consistent with the EÜR/GuV report.
//
// Performance note: a yearly BWA with prior-year comparison fires 24
// monthly aggregations. That's 24 × O(month-of-journal-lines), which
// is fine for a backoffice report. If this ever lands on a hot path
// we can switch to a single optimized query — but the simplicity gain
// of "no duplicated booking logic" is worth the extra DB round-trips.

import { getSkrAccount } from "@/lib/skr-accounts";
import { computeProfitLoss, type ProfitLossMethod } from "./profit-loss";
import type { SkrType } from "@prisma/client";

export type BwaCategoryKey =
  | "umsatzerloese"
  | "wareneinsatz"
  | "personalkosten"
  | "raumkosten"
  | "versicherungen"
  | "kfz_kosten"
  | "werbe_reisekosten"
  | "vertriebskosten"
  | "abschreibungen"
  | "sonstige_kosten";

/**
 * BWA row taxonomy — order matches the standard DATEV BWA Form 01
 * (kurzfristige Erfolgsrechnung). `subtotal` rows are derived from
 * the data rows and aren't stored in the matrix.
 */
export type BwaRowKind = "revenue" | "expense" | "subtotal" | "result";

export type BwaRow = {
  key: BwaCategoryKey | "gesamtleistung" | "rohertrag" | "gesamtkosten" | "betriebsergebnis";
  i18nLabelKey: string; // looked up under "reports.bwa.rows.*"
  kind: BwaRowKind;
};

/**
 * Order matches DATEV BWA Form 01 (kurzfristige Erfolgsrechnung).
 * Categories without a direct SKR-group mapping in our chart are
 * intentionally left out (e.g. Bestandsveränderungen, aktivierte
 * Eigenleistungen, neutraler Bereich). They can be added later when
 * the chart of accounts gets richer.
 */
export const BWA_SCHEMA: BwaRow[] = [
  { key: "umsatzerloese",     i18nLabelKey: "rows.umsatzerloese",     kind: "revenue" },
  { key: "gesamtleistung",    i18nLabelKey: "rows.gesamtleistung",    kind: "subtotal" },
  { key: "wareneinsatz",      i18nLabelKey: "rows.wareneinsatz",      kind: "expense" },
  { key: "rohertrag",         i18nLabelKey: "rows.rohertrag",         kind: "subtotal" },
  { key: "personalkosten",    i18nLabelKey: "rows.personalkosten",    kind: "expense" },
  { key: "raumkosten",        i18nLabelKey: "rows.raumkosten",        kind: "expense" },
  { key: "versicherungen",    i18nLabelKey: "rows.versicherungen",    kind: "expense" },
  { key: "kfz_kosten",        i18nLabelKey: "rows.kfz_kosten",        kind: "expense" },
  { key: "werbe_reisekosten", i18nLabelKey: "rows.werbe_reisekosten", kind: "expense" },
  { key: "vertriebskosten",   i18nLabelKey: "rows.vertriebskosten",   kind: "expense" },
  { key: "abschreibungen",    i18nLabelKey: "rows.abschreibungen",    kind: "expense" },
  { key: "sonstige_kosten",   i18nLabelKey: "rows.sonstige_kosten",   kind: "expense" },
  { key: "gesamtkosten",      i18nLabelKey: "rows.gesamtkosten",      kind: "subtotal" },
  { key: "betriebsergebnis",  i18nLabelKey: "rows.betriebsergebnis",  kind: "result" },
];

/**
 * Maps SKR group identifiers (see data/skr03.json / skr04.json) to
 * the BWA category they roll up into. Groups that aren't part of a
 * BWA P/L view (`assets`, `taxes` — VAT/income tax aren't P&L lines)
 * are intentionally absent and silently dropped during aggregation.
 */
const GROUP_TO_BWA: Record<string, BwaCategoryKey> = {
  revenue: "umsatzerloese",
  purchasing: "wareneinsatz",
  personnel: "personalkosten",
  premises: "raumkosten",
  insurance: "versicherungen",
  vehicle: "kfz_kosten",
  marketing: "werbe_reisekosten",
  distribution: "vertriebskosten",
  depreciation: "abschreibungen",
  other: "sonstige_kosten",
};

export type BwaYearMatrix = {
  year: number;
  // For each base category: a 12-element vector. Index 0 = Jan, 11 = Dec.
  // Values are signed nets in EUR (positive for both revenue and expense —
  // sign is implicit in the BWA layout).
  byCategory: Record<BwaCategoryKey, number[]>;
};

export type BwaInput = {
  tenantId: string;
  year: number;
  method: ProfitLossMethod;
  skrType: SkrType;
  /** Set false to skip the prior-year sweep when the UI doesn't need it. */
  includePrior?: boolean;
};

export type BwaResult = {
  method: ProfitLossMethod;
  year: number;
  current: BwaYearMatrix;
  prior: BwaYearMatrix | null;
  /** Sales VAT collected and input VAT paid for the full current year. */
  salesVatYear: number;
  inputVatYear: number;
};

// ── Aggregation ────────────────────────────────────────────────────────────

function emptyMatrix(year: number): BwaYearMatrix {
  const byCategory = {} as Record<BwaCategoryKey, number[]>;
  for (const cat of Object.values(GROUP_TO_BWA)) {
    byCategory[cat] = Array(12).fill(0);
  }
  return { year, byCategory };
}

async function computeYear(
  tenantId: string,
  year: number,
  method: ProfitLossMethod,
  skrType: SkrType,
): Promise<{ matrix: BwaYearMatrix; salesVat: number; inputVat: number }> {
  const matrix = emptyMatrix(year);
  let salesVat = 0;
  let inputVat = 0;

  for (let m = 0; m < 12; m++) {
    const from = new Date(Date.UTC(year, m, 1, 0, 0, 0, 0));
    // Last day of the month in UTC: day 0 of the next month wraps back.
    const to = new Date(Date.UTC(year, m + 1, 0, 23, 59, 59, 999));
    const pl = await computeProfitLoss({ tenantId, from, to, method, skrType });

    function bucket(buckets: Map<string, number>) {
      for (const [code, value] of buckets) {
        const groupKey = getSkrAccount(code, skrType)?.group ?? "other";
        const bwa = GROUP_TO_BWA[groupKey];
        if (!bwa) continue;
        matrix.byCategory[bwa][m] += value;
      }
    }
    bucket(pl.incomeBuckets);
    bucket(pl.expenseBuckets);

    salesVat += pl.salesVat;
    inputVat += pl.inputVat;
  }

  return { matrix, salesVat, inputVat };
}

export async function computeBwa(input: BwaInput): Promise<BwaResult> {
  const { tenantId, year, method, skrType, includePrior = true } = input;
  const current = await computeYear(tenantId, year, method, skrType);
  const prior = includePrior
    ? await computeYear(tenantId, year - 1, method, skrType)
    : null;

  return {
    method,
    year,
    current: current.matrix,
    prior: prior ? prior.matrix : null,
    salesVatYear: current.salesVat,
    inputVatYear: current.inputVat,
  };
}

// ── Derived row computation ────────────────────────────────────────────────

/**
 * Returns the monthly + yearly amounts for a given BWA row (including
 * subtotals and the final result). Centralised here so the UI table
 * and the PDF render the exact same numbers.
 */
export function getRowMonthly(matrix: BwaYearMatrix, key: BwaRow["key"]): number[] {
  switch (key) {
    case "gesamtleistung":
      // Strict DATEV form 01: Gesamtleistung = Umsatzerlöse + Bestands-
      // veränderungen + aktivierte Eigenleistungen. Without those two
      // (we don't track inventory or capitalized own work yet) it
      // collapses to Umsatzerlöse — same semantics, different label.
      return [...matrix.byCategory.umsatzerloese];
    case "rohertrag":
      // Gesamtleistung − Material-/Wareneinsatz
      return matrix.byCategory.umsatzerloese.map(
        (v, i) => v - matrix.byCategory.wareneinsatz[i],
      );
    case "gesamtkosten":
      return sumMonthly([
        matrix.byCategory.personalkosten,
        matrix.byCategory.raumkosten,
        matrix.byCategory.versicherungen,
        matrix.byCategory.kfz_kosten,
        matrix.byCategory.werbe_reisekosten,
        matrix.byCategory.vertriebskosten,
        matrix.byCategory.abschreibungen,
        matrix.byCategory.sonstige_kosten,
      ]);
    case "betriebsergebnis": {
      const rohertrag = getRowMonthly(matrix, "rohertrag");
      const kosten = getRowMonthly(matrix, "gesamtkosten");
      return rohertrag.map((v, i) => v - kosten[i]);
    }
    default:
      return matrix.byCategory[key as BwaCategoryKey];
  }
}

export function sumYear(monthly: number[]): number {
  return monthly.reduce((s, v) => s + v, 0);
}

function sumMonthly(vectors: number[][]): number[] {
  const out = Array(12).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < 12; i++) out[i] += v[i];
  }
  return out;
}
