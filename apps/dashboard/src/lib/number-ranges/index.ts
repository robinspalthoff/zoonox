/**
 * Per-tenant configurable number ranges (Nummernkreise).
 *
 * Single source of truth for any document number a tenant issues — invoices,
 * credit notes, future quotes/order-confirmations/delivery-notes, and customer
 * numbers. Format placeholders ({PREFIX}, {YYYY}, {YY}, {MM}, {DD}, {NUMBER})
 * are expanded by `formatNumber`. Counter advances run via `issueNumber`
 * inside a Prisma transaction so concurrent issues never collide; the UI uses
 * `peekNumber` (read-only) for live previews.
 */

import type { Prisma, NumberRangeType } from "@prisma/client";
import { db } from "@/lib/db";

export type { NumberRangeType };

/** Default range configuration for each document type. */
export const NUMBER_RANGE_DEFAULTS: Record<
  NumberRangeType,
  {
    format: string;
    prefix: string;
    nextNumber: number;
    minDigits: number;
    yearlyReset: boolean;
  }
> = {
  INVOICE:            { format: "{PREFIX}-{YYYY}-{NUMBER}", prefix: "RE", nextNumber: 1,    minDigits: 3, yearlyReset: true  },
  CREDIT_NOTE:        { format: "{PREFIX}-{YYYY}-{NUMBER}", prefix: "GU", nextNumber: 1,    minDigits: 3, yearlyReset: true  },
  QUOTE:              { format: "{PREFIX}-{YYYY}-{NUMBER}", prefix: "AN", nextNumber: 1,    minDigits: 3, yearlyReset: true  },
  ORDER_CONFIRMATION: { format: "{PREFIX}-{YYYY}-{NUMBER}", prefix: "AB", nextNumber: 1,    minDigits: 3, yearlyReset: true  },
  DELIVERY_NOTE:      { format: "{PREFIX}-{YYYY}-{NUMBER}", prefix: "LI", nextNumber: 1,    minDigits: 3, yearlyReset: true  },
  CUSTOMER:           { format: "{NUMBER}",                 prefix: "",   nextNumber: 10001, minDigits: 5, yearlyReset: false },
  SUPPLIER:           { format: "{NUMBER}",                 prefix: "",   nextNumber: 70001, minDigits: 5, yearlyReset: false },
};

/** Ordered list of all types — drives the settings UI grid. */
export const NUMBER_RANGE_TYPES: NumberRangeType[] = [
  "INVOICE",
  "CREDIT_NOTE",
  "QUOTE",
  "ORDER_CONFIRMATION",
  "DELIVERY_NOTE",
  "CUSTOMER",
  "SUPPLIER",
];

/** Placeholder tokens recognised by `formatNumber`. */
export const NUMBER_RANGE_PLACEHOLDERS = [
  "{YYYY}",
  "{YY}",
  "{MM}",
  "{DD}",
  "{NUMBER}",
] as const;

/** Whether a given format string should reset its counter every January. */
export function derivesYearlyReset(format: string): boolean {
  return /\{YY(?:YY)?\}/.test(format);
}

/** Minimal shape needed to render a number — used by DB rows + UI preview. */
export interface RangeRenderShape {
  format: string;
  prefix: string;
  minDigits: number;
}

/** Substitute placeholders in `range.format` with the given counter + date. */
export function formatNumber(
  range: RangeRenderShape,
  n: number,
  refDate: Date = new Date(),
): string {
  const year4 = refDate.getFullYear();
  const year2 = String(year4).slice(-2);
  const month = String(refDate.getMonth() + 1).padStart(2, "0");
  const day = String(refDate.getDate()).padStart(2, "0");
  const padded = String(n).padStart(Math.max(1, range.minDigits), "0");
  return range.format
    .replaceAll("{PREFIX}", range.prefix)
    .replaceAll("{YYYY}", String(year4))
    .replaceAll("{YY}", year2)
    .replaceAll("{MM}", month)
    .replaceAll("{DD}", day)
    .replaceAll("{NUMBER}", padded);
}

/** Effective counter for the given range + date — accounts for yearly reset. */
function effectiveCounter(
  range: {
    nextNumber: number;
    yearlyReset: boolean;
    lastYear: number | null;
  },
  refDate: Date,
): number {
  if (
    range.yearlyReset &&
    range.lastYear !== null &&
    range.lastYear !== refDate.getFullYear()
  ) {
    return 1;
  }
  return range.nextNumber;
}

/**
 * Render what the *next* issue would look like, without touching the counter.
 * Used by the settings page preview and by the invoice form to show
 * "Nächste Rechnungsnummer: …" before the user clicks save.
 */
export async function peekNumber(
  tenantId: string,
  type: NumberRangeType,
  refDate: Date = new Date(),
): Promise<string> {
  const row = await db.numberRange.findUnique({
    where: { tenantId_type: { tenantId, type } },
  });
  const cfg = row ?? {
    ...NUMBER_RANGE_DEFAULTS[type],
    lastYear: null as number | null,
  };
  const n = effectiveCounter(cfg, refDate);
  return formatNumber(cfg, n, refDate);
}

/**
 * Pure preview — for the settings UI, where the user is editing the config
 * and we have no DB row yet. Mirrors `peekNumber` but takes the config
 * directly.
 */
export function previewNumber(
  cfg: RangeRenderShape & {
    nextNumber: number;
    yearlyReset: boolean;
    lastYear?: number | null;
  },
  refDate: Date = new Date(),
): string {
  const n = effectiveCounter(
    { nextNumber: cfg.nextNumber, yearlyReset: cfg.yearlyReset, lastYear: cfg.lastYear ?? null },
    refDate,
  );
  return formatNumber(cfg, n, refDate);
}

/**
 * Atomically issue and consume the next number for `type`. Caller MUST run
 * this inside a `db.$transaction(...)` — passing the transaction client as
 * `tx` ensures the read-modify-write of `nextNumber` is serialized against
 * concurrent issues.
 *
 * Auto-seeds a default row for tenants that don't have one yet — covers
 * tenants created after the initial seed migration ran.
 */
export async function issueNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  type: NumberRangeType,
  refDate: Date = new Date(),
): Promise<string> {
  let row = await tx.numberRange.findUnique({
    where: { tenantId_type: { tenantId, type } },
  });
  if (!row) {
    row = await tx.numberRange.create({
      data: { tenantId, type, ...NUMBER_RANGE_DEFAULTS[type], lastYear: null },
    });
  }

  const year = refDate.getFullYear();
  const n = effectiveCounter(row, refDate);
  const formatted = formatNumber(row, n, refDate);

  await tx.numberRange.update({
    where: { tenantId_type: { tenantId, type } },
    data: { nextNumber: n + 1, lastYear: year },
  });

  return formatted;
}
