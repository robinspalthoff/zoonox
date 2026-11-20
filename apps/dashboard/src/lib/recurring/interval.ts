// Interval arithmetic for recurring invoices.
//
// Calendar-month addition is **anchor-preserving** (so a schedule starting on
// Jan 31 produces Feb 28, Mar 31, Apr 30 — not Mar 3 from naive day-rollover).
// We use UTC throughout to dodge DST-induced off-by-one hours.

import type { RecurringInterval } from "@prisma/client";

/** Number of months an interval represents, or null for day-based intervals. */
const MONTH_COUNT: Partial<Record<RecurringInterval, number>> = {
  MONTHLY: 1,
  MONTHS_2: 2,
  QUARTERLY: 3,
  HALF_YEARLY: 6,
  YEARLY: 12,
  YEARS_2: 24,
  YEARS_3: 36,
  YEARS_4: 48,
  YEARS_5: 60,
};

/** Number of days an interval represents, or null for month-based intervals. */
const DAY_COUNT: Partial<Record<RecurringInterval, number>> = {
  DAYS_7: 7,
  DAYS_14: 14,
};

/**
 * Compute the date `n` of the interval after `from`. Anchor-preserving for
 * months: addMonthsAnchored(2026-01-31, 1) → 2026-02-28.
 */
export function addInterval(from: Date, interval: RecurringInterval): Date {
  const days = DAY_COUNT[interval];
  if (days) {
    const out = new Date(from);
    out.setUTCDate(out.getUTCDate() + days);
    return out;
  }
  const months = MONTH_COUNT[interval];
  if (!months) {
    throw new Error(`Unknown interval: ${interval}`);
  }
  return addMonthsAnchored(from, months);
}

/**
 * Add `n` months to a date, clamping the day to the target month's last day
 * if it would overflow (e.g. Jan 31 + 1 month → Feb 28/29, not Mar 3).
 */
function addMonthsAnchored(from: Date, months: number): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const d = from.getUTCDate();

  const targetMonthIndex = m + months;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;

  // Last day of the target month (day 0 of the next month).
  const lastDayOfTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDayOfTarget);

  const out = new Date(from);
  out.setUTCFullYear(targetYear, targetMonth, day);
  return out;
}

/** Order in which intervals appear in the UI dropdown. */
export const INTERVAL_ORDER: RecurringInterval[] = [
  "DAYS_7",
  "DAYS_14",
  "MONTHLY",
  "MONTHS_2",
  "QUARTERLY",
  "HALF_YEARLY",
  "YEARLY",
  "YEARS_2",
  "YEARS_3",
  "YEARS_4",
  "YEARS_5",
];

/** i18n key suffix per interval — looked up under `invoices.recurring.intervals.*`. */
export const INTERVAL_I18N_KEY: Record<RecurringInterval, string> = {
  DAYS_7: "days7",
  DAYS_14: "days14",
  MONTHLY: "monthly",
  MONTHS_2: "months2",
  QUARTERLY: "quarterly",
  HALF_YEARLY: "halfYearly",
  YEARLY: "yearly",
  YEARS_2: "years2",
  YEARS_3: "years3",
  YEARS_4: "years4",
  YEARS_5: "years5",
};

/**
 * Compute the next N scheduled run dates from a starting anchor, stopping
 * once we'd cross `endDate` (if provided). Used by the detail page to show
 * a "Nächste Termine"-style preview.
 *
 * The first element of the returned array is `start` itself — that's the
 * next dueAt the worker would pick up. Subsequent entries advance by one
 * interval each.
 */
export function nextNScheduledDates(
  start: Date,
  interval: RecurringInterval,
  count: number,
  endDate?: Date | null,
): Date[] {
  const out: Date[] = [];
  let cursor = new Date(start);
  for (let i = 0; i < count; i++) {
    if (endDate && cursor > endDate) break;
    out.push(new Date(cursor));
    cursor = addInterval(cursor, interval);
  }
  return out;
}
