/**
 * Shared period helpers for the dashboard.
 *
 * The Dashboard exposes a period selector ("this month / last 30 days /
 * this year / ..."); both the server (queries) and the client (chart
 * bucketing, label formatting) need to agree on what range each token
 * resolves to. Centralising the resolver here is the only sane way to
 * keep them in lockstep.
 *
 * Date ranges are returned as `[start, end)` (start-inclusive,
 * end-exclusive). End is "now + 1 minute" for "this-*" periods so the
 * "today" data is always included, regardless of clock skew between
 * server and DB.
 */

export type Period =
  | "this-month"
  | "last-month"
  | "last-30d"
  | "last-3m"
  | "last-6m"
  | "last-12m"
  | "this-year"
  | "last-year";

export const PERIODS: Period[] = [
  "this-month",
  "last-month",
  "last-30d",
  "last-3m",
  "last-6m",
  "last-12m",
  "this-year",
  "last-year",
];

export const DEFAULT_PERIOD: Period = "this-month";

export function isValidPeriod(value: string | null | undefined): value is Period {
  return value != null && (PERIODS as string[]).includes(value);
}

export interface PeriodRange {
  start: Date;
  end: Date;
  /** Number of full days in the range (used to pick chart bucketing). */
  durationDays: number;
}

export function periodRange(period: Period, now: Date = new Date()): PeriodRange {
  const y = now.getFullYear();
  const m = now.getMonth();

  // `endOfToday` lands at tomorrow 00:00 so all of today's rows are
  // included by `< endOfToday`. Cheaper than chasing the time-of-day.
  const endOfToday = new Date(y, m, now.getDate() + 1);

  switch (period) {
    case "this-month":
      return { start: new Date(y, m, 1), end: endOfToday, durationDays: now.getDate() };
    case "last-month": {
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 1);
      return { start, end, durationDays: daysBetween(start, end) };
    }
    case "last-30d": {
      const start = new Date(y, m, now.getDate() - 30);
      return { start, end: endOfToday, durationDays: 30 };
    }
    case "last-3m": {
      const start = new Date(y, m - 3, now.getDate());
      return { start, end: endOfToday, durationDays: daysBetween(start, endOfToday) };
    }
    case "last-6m": {
      const start = new Date(y, m - 6, now.getDate());
      return { start, end: endOfToday, durationDays: daysBetween(start, endOfToday) };
    }
    case "last-12m": {
      const start = new Date(y - 1, m, now.getDate());
      return { start, end: endOfToday, durationDays: daysBetween(start, endOfToday) };
    }
    case "this-year":
      return { start: new Date(y, 0, 1), end: endOfToday, durationDays: dayOfYear(now) };
    case "last-year": {
      const start = new Date(y - 1, 0, 1);
      const end = new Date(y, 0, 1);
      return { start, end, durationDays: daysBetween(start, end) };
    }
  }
}

/**
 * Bucketing strategy for the Ertrag/Aufwand chart. Returns granularity
 * + the number of buckets so the data loader can pre-aggregate at the
 * right resolution. We pick:
 *   ≤ 31 days  → daily        (up to 31 points)
 *   ≤ 92 days  → weekly       (~ 13 points)
 *   > 92 days  → monthly      (≤ 12 points)
 */
export type BucketGranularity = "day" | "week" | "month";

export function pickBucketing(range: PeriodRange): BucketGranularity {
  if (range.durationDays <= 31) return "day";
  if (range.durationDays <= 92) return "week";
  return "month";
}

/**
 * Build bucket boundaries for the chart x-axis. Each entry is the
 * `start` of its bucket; the bucket spans up to (but not including)
 * the next entry's start (or the period's `end` for the last one).
 */
export function buildBuckets(range: PeriodRange, granularity: BucketGranularity): Date[] {
  const buckets: Date[] = [];
  if (granularity === "day") {
    const cursor = new Date(range.start);
    while (cursor < range.end) {
      buckets.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  } else if (granularity === "week") {
    const cursor = new Date(range.start);
    // Snap to ISO week start (Monday). The first bucket may be partial
    // but that's fine — the user picked the range, not us.
    while (cursor < range.end) {
      buckets.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
  } else {
    const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
    while (cursor < range.end) {
      buckets.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  return buckets;
}

/**
 * Place a date into its bucket index, or return -1 if it falls outside
 * the buckets array. Linear scan is fine — bucket counts are ≤ 31.
 */
export function bucketIndex(buckets: Date[], date: Date, end: Date): number {
  if (date < buckets[0] || date >= end) return -1;
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (date >= buckets[i]) return i;
  }
  return -1;
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / 86_400_000);
}
