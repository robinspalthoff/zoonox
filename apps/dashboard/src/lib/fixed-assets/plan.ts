// Depreciation plan calculation.
//
// Pure functions — no DB access. Tested against § 7 Abs. 1 EStG:
//   - LINEAR: AfA-Basis = netAmount - scrapValue, gleichmäßig auf
//     usefulLifeMonths verteilt; pro rata temporis im Anschaffungs- und
//     Abgangsmonat (monatsgenau).
//   - IMMEDIATE: einmalige volle Abschreibung im Anschaffungsmonat
//     (GWG ≤ 800 € netto, § 6 Abs. 2 EStG; oder dig. WG nach BMF).
//
// Edge cases:
//   - Rundungsdifferenzen wandern in den *letzten* Monat (cent-genau).
//   - scrapValue (Erinnerungs-Euro) bleibt am Ende stehen.

import type { FixedAssetMethod } from "@prisma/client";

export interface PlanInput {
  netAmount: number;
  scrapValue: number;
  usefulLifeMonths: number;
  method: FixedAssetMethod;
  /** depreciationStart = first day of acquisition month. */
  depreciationStart: Date;
}

export interface PlanRow {
  periodYear: number;
  periodMonth: number; // 1-12
  amount: number;
  bookValueBefore: number;
  bookValueAfter: number;
}

/** First day of the month containing `d`, in UTC. */
export function firstOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeMonthlyAmount(input: PlanInput): number {
  if (input.method === "IMMEDIATE") return round2(input.netAmount - input.scrapValue);
  // LINEAR (and POOL/DEGRESSIVE fall back to LINEAR until implemented).
  if (input.usefulLifeMonths <= 0) return 0;
  const base = input.netAmount - input.scrapValue;
  return round2(base / input.usefulLifeMonths);
}

/**
 * Generate the complete depreciation schedule.
 *
 * The schedule starts at `depreciationStart` (first day of the acquisition
 * month) and runs for `usefulLifeMonths` rows for LINEAR, or exactly one row
 * for IMMEDIATE. The final row absorbs any rounding so the book value lands
 * exactly on `scrapValue`.
 */
export function generatePlan(input: PlanInput): PlanRow[] {
  if (input.method === "IMMEDIATE") {
    const amount = round2(input.netAmount - input.scrapValue);
    return [
      {
        periodYear: input.depreciationStart.getUTCFullYear(),
        periodMonth: input.depreciationStart.getUTCMonth() + 1,
        amount,
        bookValueBefore: round2(input.netAmount),
        bookValueAfter: round2(input.scrapValue),
      },
    ];
  }

  const n = input.usefulLifeMonths;
  if (n <= 0) return [];

  const monthly = computeMonthlyAmount(input);
  const rows: PlanRow[] = [];
  let book = round2(input.netAmount);

  for (let i = 0; i < n; i++) {
    const periodDate = new Date(
      Date.UTC(input.depreciationStart.getUTCFullYear(), input.depreciationStart.getUTCMonth() + i, 1),
    );
    const isLast = i === n - 1;
    // Final month absorbs rounding so we land exactly on scrapValue.
    const amount = isLast ? round2(book - input.scrapValue) : monthly;
    const bookAfter = round2(book - amount);
    rows.push({
      periodYear: periodDate.getUTCFullYear(),
      periodMonth: periodDate.getUTCMonth() + 1,
      amount,
      bookValueBefore: book,
      bookValueAfter: bookAfter,
    });
    book = bookAfter;
  }
  return rows;
}

/** Year/month tuple comparator: returns true if `a` is strictly before `b`. */
export function periodBefore(
  ay: number,
  am: number,
  by: number,
  bm: number,
): boolean {
  return ay < by || (ay === by && am < bm);
}
