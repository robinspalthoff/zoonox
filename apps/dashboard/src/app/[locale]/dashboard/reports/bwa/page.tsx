import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { SkrType } from "@prisma/client";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import {
  BWA_SCHEMA,
  computeBwa,
  getRowMonthly,
  sumYear,
  type BwaRow,
  type BwaYearMatrix,
} from "@/lib/reports/bwa";
import type { ProfitLossMethod } from "@/lib/reports/profit-loss";
import { BwaControls } from "./bwa-controls";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports.bwa");
  return { title: t("pageTitle") };
}

function parseSearchParams(sp: Record<string, string | string[] | undefined>) {
  const now = new Date();
  const yearRaw = typeof sp.year === "string" ? parseInt(sp.year, 10) : NaN;
  // Clamp to a sane window so a bookmarked URL with year=99 doesn't blow up
  // the date construction with negative or absurd month indices.
  const year =
    Number.isFinite(yearRaw) && yearRaw >= 2000 && yearRaw <= now.getFullYear() + 5
      ? yearRaw
      : now.getFullYear();
  const method: ProfitLossMethod = sp.method === "GUV" ? "GUV" : "EUR";
  const compare = sp.compare !== "0";
  return { year, method, compare };
}

function fmt(n: number, locale: string) {
  if (Math.abs(n) < 0.005) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtPct(n: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(n);
}

export default async function BwaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const { tenantId } = await requireTenant();

  const t = await getTranslations("reports.bwa");
  const tRows = await getTranslations("reports.bwa.rows");
  const tMonths = await getTranslations("reports.bwa.table.months");

  const { year, method, compare } = parseSearchParams(sp);

  const settings = await db.companySettings.findUnique({ where: { tenantId } });
  const skrType = (settings?.skrType ?? "SKR03") as SkrType;

  const bwa = await computeBwa({
    tenantId,
    year,
    method,
    skrType,
    includePrior: compare,
  });

  // ── Derived totals for the hero strip ─────────────────────────────────────
  const revenueYear = sumYear(getRowMonthly(bwa.current, "umsatzerloese"));
  const grossProfitYear = sumYear(getRowMonthly(bwa.current, "rohertrag"));
  const opResultYear = sumYear(getRowMonthly(bwa.current, "betriebsergebnis"));
  const margin = revenueYear > 0 ? opResultYear / revenueYear : 0;

  const priorRevenueYear = bwa.prior
    ? sumYear(getRowMonthly(bwa.prior, "umsatzerloese"))
    : null;
  const priorOpYear = bwa.prior
    ? sumYear(getRowMonthly(bwa.prior, "betriebsergebnis"))
    : null;

  function deltaPct(now: number, prior: number | null): number | null {
    if (prior === null || Math.abs(prior) < 0.005) return null;
    return (now - prior) / Math.abs(prior);
  }

  const revenueDelta = deltaPct(revenueYear, priorRevenueYear);
  const opDelta = deltaPct(opResultYear, priorOpYear);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
      </div>

      <BwaControls year={year} method={method} compare={compare} />

      {/* ── Hero summary ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SummaryCard
          label={t("summary.revenue")}
          value={fmt(revenueYear, locale)}
          delta={revenueDelta}
          deltaLabel={t("summary.vsPrior")}
          locale={locale}
        />
        <SummaryCard
          label={t("summary.grossProfit")}
          value={fmt(grossProfitYear, locale)}
          sub={
            revenueYear > 0
              ? `${t("summary.margin")}: ${fmtPct(grossProfitYear / revenueYear, locale)}`
              : undefined
          }
          locale={locale}
        />
        <SummaryCard
          label={t("summary.operatingResult")}
          value={fmt(opResultYear, locale)}
          delta={opDelta}
          deltaLabel={t("summary.vsPrior")}
          accent={opResultYear >= 0 ? "positive" : "negative"}
          sub={
            revenueYear > 0
              ? `${t("summary.margin")}: ${fmtPct(margin, locale)}`
              : undefined
          }
          locale={locale}
        />
      </div>

      {/* ── BWA table ───────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground sticky left-0 bg-muted/50 z-10">
                  {t("table.category")}
                </th>
                {Array.from({ length: 12 }, (_, i) => (
                  <th
                    key={i}
                    className="text-right px-2 py-2.5 font-medium text-muted-foreground tabular-nums whitespace-nowrap"
                  >
                    {tMonths(String(i + 1))}
                  </th>
                ))}
                <th className="text-right px-3 py-2.5 font-semibold text-foreground tabular-nums whitespace-nowrap border-l border-border">
                  {t("table.yearTotal", { year })}
                </th>
                {compare && bwa.prior && (
                  <>
                    <th className="text-right px-3 py-2.5 font-medium text-muted-foreground tabular-nums whitespace-nowrap">
                      {t("table.yearTotalPrior", { year: year - 1 })}
                    </th>
                    <th className="text-right px-3 py-2.5 font-medium text-muted-foreground tabular-nums whitespace-nowrap">
                      {t("table.yearChange")}
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {BWA_SCHEMA.map((row) => (
                <BwaTableRow
                  key={row.key}
                  row={row}
                  matrix={bwa.current}
                  priorMatrix={compare ? bwa.prior : null}
                  label={tRows(row.i18nLabelKey.replace(/^rows\./, ""))}
                  locale={locale}
                  year={year}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── VAT context ─────────────────────────────────────────────────── */}
      {(Math.abs(bwa.salesVatYear) > 0.005 || Math.abs(bwa.inputVatYear) > 0.005) && (
        <div className="bg-card border border-border rounded-xl p-5 max-w-2xl">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {t("vat.title")}
          </h2>
          <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">{t("vat.salesVat")}</dt>
            <dd className="text-right font-medium tabular-nums">
              {fmt(bwa.salesVatYear, locale)}
            </dd>
            <dt className="text-muted-foreground">{t("vat.inputVat")}</dt>
            <dd className="text-right font-medium tabular-nums">
              {fmt(bwa.inputVatYear, locale)}
            </dd>
            <dt className="font-semibold border-t border-border pt-2 mt-1">
              {t("vat.balance")}
            </dt>
            <dd className="text-right font-semibold tabular-nums border-t border-border pt-2 mt-1">
              {fmt(bwa.salesVatYear - bwa.inputVatYear, locale)}
            </dd>
          </dl>
        </div>
      )}

      <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">
        {t("disclaimer")}
      </p>
    </div>
  );
}

// ── Helper components ───────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  delta,
  deltaLabel,
  accent,
  locale,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  deltaLabel?: string;
  accent?: "positive" | "negative";
  locale: string;
}) {
  const accentClass =
    accent === "positive"
      ? "text-emerald-600"
      : accent === "negative"
      ? "text-destructive"
      : "text-foreground";

  let deltaNode: React.ReactNode = null;
  if (typeof delta === "number") {
    const Icon = delta > 0.0005 ? TrendingUp : delta < -0.0005 ? TrendingDown : Minus;
    const color =
      delta > 0.0005
        ? "text-emerald-600"
        : delta < -0.0005
        ? "text-destructive"
        : "text-muted-foreground";
    deltaNode = (
      <div className={`inline-flex items-center gap-1 text-xs ${color} mt-2`}>
        <Icon className="w-3.5 h-3.5" />
        <span className="tabular-nums">
          {new Intl.NumberFormat(locale, {
            style: "percent",
            maximumFractionDigits: 1,
            signDisplay: "exceptZero",
          }).format(delta)}
        </span>
        {deltaLabel && <span className="text-muted-foreground">· {deltaLabel}</span>}
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums mt-2 ${accentClass}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      {deltaNode}
    </div>
  );
}

function BwaTableRow({
  row,
  matrix,
  priorMatrix,
  label,
  locale,
  year,
}: {
  row: BwaRow;
  matrix: BwaYearMatrix;
  priorMatrix: BwaYearMatrix | null;
  label: string;
  locale: string;
  year: number;
}) {
  const monthly = getRowMonthly(matrix, row.key);
  const yearTotal = sumYear(monthly);
  const priorTotal = priorMatrix ? sumYear(getRowMonthly(priorMatrix, row.key)) : null;
  const delta = priorTotal !== null ? yearTotal - priorTotal : null;

  // Subtotal + result rows render with a slightly heavier weight and a top
  // border so they pop out of the dense table layout.
  const isSubtotal = row.kind === "subtotal";
  const isResult = row.kind === "result";
  const rowClass = isResult
    ? "bg-primary/5 border-t-2 border-primary/20 font-semibold"
    : isSubtotal
    ? "bg-muted/30 font-semibold border-t border-border"
    : "border-t border-border/60";
  const labelClass = isResult
    ? "text-primary"
    : isSubtotal
    ? "text-foreground"
    : "text-foreground";
  void year; // present in case future code wants it for the row's aria-label

  return (
    <tr className={rowClass}>
      <td className={`px-4 py-2 sticky left-0 bg-inherit z-10 ${labelClass}`}>
        {label}
      </td>
      {monthly.map((v, i) => (
        <td key={i} className="text-right px-2 py-2 tabular-nums text-muted-foreground">
          {fmt(v, locale)}
        </td>
      ))}
      <td className="text-right px-3 py-2 tabular-nums border-l border-border text-foreground">
        {fmt(yearTotal, locale)}
      </td>
      {priorMatrix && (
        <>
          <td className="text-right px-3 py-2 tabular-nums text-muted-foreground">
            {priorTotal !== null ? fmt(priorTotal, locale) : "—"}
          </td>
          <td className="text-right px-3 py-2 tabular-nums">
            {delta !== null ? <DeltaCell value={delta} locale={locale} /> : "—"}
          </td>
        </>
      )}
    </tr>
  );
}

function DeltaCell({ value, locale }: { value: number; locale: string }) {
  if (Math.abs(value) < 0.005) return <span className="text-muted-foreground">—</span>;
  const positive = value > 0;
  return (
    <span className={positive ? "text-emerald-600" : "text-destructive"}>
      {new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
        signDisplay: "exceptZero",
      }).format(value)}
    </span>
  );
}
