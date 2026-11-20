"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { TrendingDown, ArrowDownLeft, ArrowUpRight, Wallet, ArrowRight, LineChart } from "lucide-react";
import { formatCurrency } from "@/lib/format";

export interface CashflowData {
  hasData: boolean;
  currentBalance: number;
  history: { date: string; balance: number }[];
  forecast: { date: string; balance: number }[];
  milestones: { day: number; balance: number }[];
  cushion: number;
  cushionDate: string;
  upcomingExpenseTotal: number;
  upcomingExpenseCount: number;
  recurring: { supplierName: string; amount: number; nextDate: string; intervalDays: number }[];
  openInvoiceTotal: number;
  openInvoiceCount: number;
}

// Combined chart geometry — one continuous x-axis from history start
// (day −30) through forecast end (day +90). "Heute" (day 0) is where the
// solid Ist-line hands off to the dashed Prognose-line.
const W = 900;
const H = 200;
const PAD_X = 40;
const PAD_T = 16;
const PAD_B = 24;
const innerW = W - PAD_X * 2;
const innerH = H - PAD_T - PAD_B;

interface ChartPoint {
  /** Day offset from today (negative = past). */
  off: number;
  date: Date;
  balance: number;
}

export function CashflowWidget({ data, locale }: { data: CashflowData; locale: string }) {
  const t = useTranslations("dashboard.cashflow");
  const [hoverOff, setHoverOff] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const histPoints: ChartPoint[] = useMemo(
    () =>
      data.history.map((p, i) => ({
        off: i - (data.history.length - 1),
        date: new Date(p.date),
        balance: p.balance,
      })),
    [data.history],
  );
  const fcPoints: ChartPoint[] = useMemo(
    () => data.forecast.map((p, i) => ({ off: i, date: new Date(p.date), balance: p.balance })),
    [data.forecast],
  );

  const dayMin = histPoints.length ? histPoints[0].off : 0;
  const dayMax = fcPoints.length ? fcPoints[fcPoints.length - 1].off : 90;

  const allBalances = [...histPoints, ...fcPoints].map((p) => p.balance);
  // Anchor the scale to 0 so a dip below zero is visually obvious.
  const rawMin = Math.min(0, ...allBalances);
  const rawMax = Math.max(0, ...allBalances);
  const span = rawMax - rawMin || 1;
  const yMin = rawMin - span * 0.08;
  const yMax = rawMax + span * 0.08;

  const xFor = (off: number) => PAD_X + ((off - dayMin) / (dayMax - dayMin || 1)) * innerW;
  const yFor = (v: number) => PAD_T + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  function linePath(pts: ChartPoint[]): string {
    if (pts.length === 0) return "";
    return pts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.off).toFixed(2)} ${yFor(p.balance).toFixed(2)}`)
      .join(" ");
  }

  function areaPath(pts: ChartPoint[]): string {
    if (pts.length === 0) return "";
    const baseY = yFor(Math.max(yMin, 0));
    const line = linePath(pts);
    return `${line} L ${xFor(pts[pts.length - 1].off).toFixed(2)} ${baseY.toFixed(2)} L ${xFor(pts[0].off).toFixed(2)} ${baseY.toFixed(2)} Z`;
  }

  const todayX = xFor(0);
  const zeroY = yFor(0);
  const showZeroLine = rawMin < 0;

  // ─── Hover ────────────────────────────────────────────────────────────
  const allPoints = useMemo(() => [...histPoints, ...fcPoints], [histPoints, fcPoints]);
  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = (e.clientX - rect.left) * (W / rect.width);
    const off = dayMin + ((svgX - PAD_X) / innerW) * (dayMax - dayMin);
    // Snap to the nearest existing point.
    let best: ChartPoint | null = null;
    let bestDist = Infinity;
    for (const p of allPoints) {
      const d = Math.abs(p.off - off);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    setHoverOff(best ? best.off : null);
  }

  const hoverPoint =
    hoverOff === null ? null : allPoints.find((p) => p.off === hoverOff) ?? null;

  function fmtDate(d: Date): string {
    return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  }

  // ─── Empty state ────────────────────────────────────────────────────────
  if (!data.hasData) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5 motion-safe:animate-[fadeUp_.45s_.2s_cubic-bezier(.22,1,.36,1)_both]">
        <WidgetHeader t={t} />
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
          <Link
            href="/dashboard/bank"
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
          >
            {t("emptyCta")}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </section>
    );
  }

  const cushionNegative = data.cushion < 0;

  return (
    <section className="rounded-2xl border border-border bg-card p-5 motion-safe:animate-[fadeUp_.45s_.2s_cubic-bezier(.22,1,.36,1)_both]">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <WidgetHeader t={t} />
        <div className="text-right">
          <p className="text-[10px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
            {t("currentBalance")}
          </p>
          <p className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
            {formatCurrency(data.currentBalance)}
          </p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs mb-2">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <svg width="20" height="6" aria-hidden>
            <line x1="0" y1="3" x2="20" y2="3" stroke="var(--color-primary)" strokeWidth="2" />
          </svg>
          {t("legendActual")}
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <svg width="20" height="6" aria-hidden>
            <line x1="0" y1="3" x2="20" y2="3" stroke="var(--color-primary)" strokeWidth="2" strokeDasharray="3 3" />
          </svg>
          {t("legendForecast")}
        </span>
      </div>

      {/* ─── Chart ─────────────────────────────────────────────────────── */}
      <div ref={wrapperRef} className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto select-none"
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverOff(null)}
        >
          <defs>
            <linearGradient id="cf-grad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Horizontal gridlines + y labels */}
          {[0, 0.5, 1].map((p) => {
            const v = yMin + (yMax - yMin) * p;
            const y = yFor(v);
            return (
              <g key={p}>
                <line x1={PAD_X} x2={W - PAD_X} y1={y} y2={y} stroke="var(--color-border)" strokeDasharray="2 4" opacity={0.5} />
                <text x={PAD_X - 6} y={y + 3} textAnchor="end" fontSize="10" fill="var(--color-muted-foreground)">
                  {Math.round(v).toLocaleString(locale)}
                </text>
              </g>
            );
          })}

          {/* Zero reference line (only when balance dips negative) */}
          {showZeroLine && (
            <line x1={PAD_X} x2={W - PAD_X} y1={zeroY} y2={zeroY} stroke="var(--color-destructive)" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
          )}

          {/* Area under the combined line */}
          <path d={areaPath([...histPoints, ...fcPoints])} fill="url(#cf-grad)" />

          {/* "Heute"-Divider */}
          <line x1={todayX} x2={todayX} y1={PAD_T} y2={PAD_T + innerH} stroke="var(--color-foreground)" strokeOpacity={0.15} strokeWidth={1} />
          <text x={todayX} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--color-muted-foreground)">
            {t("today")}
          </text>

          {/* Historical (solid) */}
          <path d={linePath(histPoints)} fill="none" stroke="var(--color-primary)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {/* Forecast (dashed) */}
          <path d={linePath(fcPoints)} fill="none" stroke="var(--color-primary)" strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />

          {/* Milestone markers at 30 / 60 / 90 days */}
          {data.milestones.map((m) => {
            const x = xFor(m.day);
            const y = yFor(m.balance);
            return (
              <g key={m.day}>
                <circle cx={x} cy={y} r={3} fill="var(--color-card)" stroke="var(--color-primary)" strokeWidth={1.5} />
                <text x={x} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--color-muted-foreground)">
                  {t("dayLabel", { day: m.day })}
                </text>
              </g>
            );
          })}

          {/* Hover scrubber */}
          {hoverPoint && (
            <g>
              <line x1={xFor(hoverPoint.off)} x2={xFor(hoverPoint.off)} y1={PAD_T} y2={PAD_T + innerH} stroke="var(--color-foreground)" strokeOpacity={0.25} strokeWidth={1} />
              <circle cx={xFor(hoverPoint.off)} cy={yFor(hoverPoint.balance)} r={4} fill="var(--color-primary)" />
            </g>
          )}
        </svg>

        {hoverPoint && (
          <div
            className="pointer-events-none absolute top-2 rounded-lg border border-border bg-card/95 backdrop-blur px-3 py-2 text-xs shadow-lg"
            style={{ left: `${(xFor(hoverPoint.off) / W) * 100}%`, transform: "translateX(-50%)" }}
          >
            <p className="font-medium text-foreground mb-1 whitespace-nowrap">
              {fmtDate(hoverPoint.date)}
              {hoverPoint.off > 0 && (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">{t("forecastTag")}</span>
              )}
            </p>
            <p className="font-mono tabular-nums text-foreground">{formatCurrency(hoverPoint.balance)}</p>
          </div>
        )}
      </div>

      {/* ─── Drei Zeilen ──────────────────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryRow
          icon={<ArrowDownLeft className="w-4 h-4 text-destructive" />}
          label={t("nextExpenses")}
          value={formatCurrency(data.upcomingExpenseTotal)}
          hint={
            data.recurring.length > 0
              ? t("nextExpenseHint", { name: data.recurring[0].supplierName, date: fmtDate(new Date(data.recurring[0].nextDate)) })
              : t("nextExpenseNone")
          }
        />
        <SummaryRow
          icon={<ArrowUpRight className="w-4 h-4 text-success" />}
          label={t("openInvoices")}
          value={formatCurrency(data.openInvoiceTotal)}
          hint={t("openInvoiceHint", { count: data.openInvoiceCount })}
        />
        <SummaryRow
          icon={cushionNegative ? <TrendingDown className="w-4 h-4 text-destructive" /> : <Wallet className="w-4 h-4 text-primary" />}
          label={t("cushion")}
          value={formatCurrency(data.cushion)}
          valueTone={cushionNegative ? "negative" : "default"}
          hint={t("cushionHint", { date: fmtDate(new Date(data.cushionDate)) })}
        />
      </div>
    </section>
  );
}

function WidgetHeader({ t }: { t: (k: string) => string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
        <LineChart className="w-4 h-4 text-primary" />
      </div>
      <div>
        <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
        <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
      </div>
    </div>
  );
}

function SummaryRow({
  icon,
  label,
  value,
  hint,
  valueTone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  valueTone?: "default" | "negative";
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-3.5">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      </div>
      <p
        className={`text-lg font-semibold tracking-tight tabular-nums ${
          valueTone === "negative" ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{hint}</p>
    </div>
  );
}
