"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useRouter, useSearchParams } from "next/navigation";
import {
  TrendingUp, TrendingDown, Wallet, UserCheck, Mail, Check,
  Plus, Users, Upload, Sparkles, ArrowRight, Activity,
  ChevronDown, Info, AlertTriangle,
  ClipboardList, CircleCheckBig, CalendarClock,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { fullName } from "@/lib/user-name";
import type { InvoiceStatus, AuditAction } from "@prisma/client";
import { ContactFormDialog } from "@/components/contacts/contact-form-dialog";
import { PERIODS, type Period } from "@/lib/period";
import type { ChecklistData } from "@/lib/onboarding";
import { WelcomeModal } from "@/components/onboarding/welcome-modal";
import { SetupChecklist } from "@/components/onboarding/setup-checklist";
import { CashflowWidget, type CashflowData } from "./cashflow-widget";

type GreetingKey = "morning" | "afternoon" | "evening" | "night";

interface Kpis {
  openCount: number;
  overdueCount: number;
  draftCount: number;
  revenuePeriod: number;
  revenueDelta: number | null;
  expensePeriod: number;
  profitPeriod: number;
  profitDelta: number | null;
}

interface Receivables {
  openCount: number;
  openTotal: number;
  overdueCount: number;
  overdueTotal: number;
}

interface QuoteKpis {
  openCount: number;
  openTotal: number;
  expiringSoonCount: number;
  /** % accepted of all resolved quotes in the last 30 days. Null when
   *  there were no resolutions to compute a rate from. */
  acceptanceRate30d: number | null;
}

interface AccountingScore {
  score: number;
  total: number;
  unmatched: number;
}

interface ChartData {
  granularity: "day" | "week" | "month";
  buckets: string[]; // ISO date strings, start-of-bucket
  income: number[];
  expense: number[];
}

interface InvoiceRow {
  id: string;
  number: string;
  clientName: string;
  status: InvoiceStatus;
  total: number;
  issueDate: string;
}

interface ActivityEntry {
  id: string;
  action: AuditAction;
  entityType: string | null;
  createdAt: string;
  user: { firstName: string | null; lastName: string | null; email: string } | null;
}

interface LinkedAccountant {
  id: string;
  name: string | null;
  email: string;
  pending: boolean;
}

interface Props {
  locale: string;
  firstName: string | null;
  period: Period;
  checklist: ChecklistData;
  kpis: Kpis;
  receivables: Receivables;
  quoteKpis: QuoteKpis;
  accountingScore: AccountingScore;
  chart: ChartData;
  cashflow: CashflowData;
  recentInvoices: InvoiceRow[];
  activity: ActivityEntry[];
  linkedAccountants: LinkedAccountant[];
  /** Steuerberater bekommen weder Welcome-Modal noch Setup-Checklist — sie
   *  erben den Tenant inhaltlich vom Mandanten und sollen nichts anlegen. */
  showOnboarding: boolean;
}

const STATUS_STYLES: Record<InvoiceStatus, { dot: string; chip: string; label: string }> = {
  DRAFT:     { dot: "bg-muted-foreground", chip: "bg-muted text-muted-foreground", label: "DRAFT" },
  SENT:      { dot: "bg-blue-400",         chip: "bg-blue-500/10 text-blue-400",   label: "SENT" },
  PAID:      { dot: "bg-success",          chip: "bg-success/10 text-success",     label: "PAID" },
  OVERDUE:   { dot: "bg-destructive",      chip: "bg-destructive/10 text-destructive", label: "OVERDUE" },
  CANCELLED: { dot: "bg-muted-foreground", chip: "bg-muted text-muted-foreground/70 line-through", label: "CANCELLED" },
};

const FILTERS: Array<"ALL" | InvoiceStatus> = ["ALL", "DRAFT", "SENT", "PAID", "OVERDUE"];

function computeGreeting(d: Date): GreetingKey {
  const h = d.getHours();
  if (h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

// ─── Sparkline ───────────────────────────────────────────────────────────────

function Sparkline({ data, color = "currentColor" }: { data: number[]; color?: string }) {
  const W = 92, H = 28;
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((v - min) / (max - min || 1)) * (H - 2) - 1;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const last = pts.split(" ").at(-1)!.split(",").map(Number);
  return (
    <svg width={W} height={H} className="opacity-80">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2" fill={color} />
    </svg>
  );
}

// ─── KPI card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon: Icon, trend, trendTone, spark, animDelay,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  trend: React.ReactNode;
  trendTone: "up" | "down" | "neutral";
  spark: number[];
  animDelay: number;
}) {
  const sparkColor =
    trendTone === "up" ? "var(--color-success)" :
    trendTone === "down" ? "var(--color-destructive)" :
    "var(--color-primary)";
  return (
    <div
      className="group relative overflow-hidden rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20 motion-safe:animate-[fadeUp_.45s_cubic-bezier(.22,1,.36,1)_both]"
      style={{ animationDelay: `${animDelay}ms` }}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold tracking-[.08em] uppercase text-muted-foreground">{label}</p>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-muted/60">
          <Icon className="w-4 h-4 text-foreground/80" />
        </div>
      </div>
      <p className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">{value}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
          {trendTone === "up" && <TrendingUp className="w-3 h-3 text-success shrink-0" />}
          {trendTone === "down" && <TrendingDown className="w-3 h-3 text-destructive shrink-0" />}
          <span className={
            (trendTone === "up" ? "text-success" :
            trendTone === "down" ? "text-destructive" : "") + " truncate"
          }>{trend}</span>
        </div>
        <Sparkline data={spark} color={sparkColor} />
      </div>
    </div>
  );
}

// ─── Steuerberater-Karte ─────────────────────────────────────────────────────

/**
 * Spiegelt das Panel auf /dashboard/tax-advisor: zeigt verknüpfte
 * Steuerberater + Status (Aktiv / Einladung offen) und führt per Klick
 * zur vollständigen Steuerberater-Seite. Ersetzt den vorherigen reinen
 * CTA — der Mandant sieht schon im Dashboard, ob ein Berater verbunden
 * ist, ohne extra Klick.
 */
function AccountantCard({
  accountants,
}: {
  accountants: LinkedAccountant[];
}) {
  const t = useTranslations("dashboard.taxAdvisor");
  const tPanel = useTranslations("taxes.taxAdvisor.invitePanel");
  return (
    <Link
      href="/dashboard/tax-advisor"
      className="group relative overflow-hidden rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20 motion-safe:animate-[fadeUp_.45s_cubic-bezier(.22,1,.36,1)_both] flex flex-col"
      style={{ animationDelay: "240ms" }}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
          {t("label")}
        </p>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-muted/60">
          <UserCheck className="w-4 h-4 text-foreground/80" />
        </div>
      </div>

      {accountants.length === 0 ? (
        <>
          <p className="text-2xl font-semibold tracking-tight text-foreground">
            {t("title")}
          </p>
          <div className="mt-2 flex items-end justify-between gap-2">
            <p className="text-xs text-muted-foreground truncate">
              {t("description")}
            </p>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary transition-transform group-hover:translate-x-0.5">
              {t("cta")}
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </>
      ) : (
        <>
          <ul className="space-y-2 mt-1">
            {accountants.slice(0, 3).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {a.name ?? a.email}
                  </p>
                  {a.name && (
                    <p className="text-[11px] text-muted-foreground truncate">{a.email}</p>
                  )}
                </div>
                {a.pending ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px] font-medium shrink-0">
                    <Mail className="w-3 h-3" /> {tPanel("statusPending")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] font-medium shrink-0">
                    <Check className="w-3 h-3" /> {tPanel("statusActive")}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-3 flex items-center justify-end">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary transition-transform group-hover:translate-x-0.5">
              {t("cta")}
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </>
      )}
    </Link>
  );
}

// ─── Period selector ─────────────────────────────────────────────────────────

// ─── Instant tooltip ─────────────────────────────────────────────────────────

/**
 * Tiny portal-backed tooltip. The browser's native `title` attribute
 * has a ~2s delay before it shows; this surfaces the message the
 * instant the user hovers the trigger, which is what they expect for
 * inline help cues like the Info icon next to a widget title.
 *
 * Portal'd to <body> for the same reason as PeriodSelector — the
 * surrounding card uses `overflow-hidden` plus an `animate-fadeUp`
 * that leaves a permanent `transform`, both of which would otherwise
 * clip / re-anchor a `position: fixed` tooltip.
 */
function InstantTooltip({
  content,
  children,
}: {
  content: string;
  children: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  function show() {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      top: rect.bottom + 6,
      left: rect.left + rect.width / 2,
    });
    setOpen(true);
  }
  function hide() {
    setOpen(false);
  }

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        // No `cursor-help` — the user explicitly didn't want the
        // question-mark cursor. Plain pointer behaviour is fine.
        className="inline-flex items-center"
      >
        {children}
      </span>
      {mounted && open && pos
        ? createPortal(
            <div
              role="tooltip"
              className="fixed z-[70] -translate-x-1/2 max-w-[260px] px-2.5 py-1.5 rounded-md bg-card border border-border text-[11px] leading-snug text-card-foreground shadow-lg pointer-events-none"
              style={{ top: pos.top, left: pos.left }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function PeriodSelector({ period }: { period: Period }) {
  const t = useTranslations("dashboard.periods");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // The Hero's `fadeUp` keyframe ends on `transform: translateY(0)`
  // with `animation-fill-mode: both`, which leaves a permanent
  // `transform` on the section. Per CSS spec, a transformed ancestor
  // becomes the containing block for fixed-positioned descendants —
  // so a naive `position: fixed` menu would be re-anchored inside
  // the Hero and clipped by its `overflow-hidden`. The only way out
  // is to portal the menu into <body>, escaping the entire ancestor
  // chain.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Position the menu on open + on resize/scroll while open.
  useEffect(() => {
    if (!open) return;
    function align() {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    }
    align();
    window.addEventListener("resize", align);
    window.addEventListener("scroll", align, true);
    return () => {
      window.removeEventListener("resize", align);
      window.removeEventListener("scroll", align, true);
    };
  }, [open]);

  // Outside-click + Escape close. The menu lives in a portal, so we
  // can't rely on a single ref `contains()`; we tag it with a data
  // attribute and walk up from the click target instead.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (
        triggerRef.current?.contains(target) ||
        target.closest("[data-period-menu]")
      ) {
        return;
      }
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function select(p: Period) {
    setOpen(false);
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("period", p);
    router.push(`/dashboard?${sp.toString()}`);
  }

  const menu =
    open && menuPos && mounted ? (
      <div
        data-period-menu
        className="fixed z-[60] min-w-[180px] py-1 bg-card border border-border rounded-lg shadow-xl"
        style={{ top: menuPos.top, right: menuPos.right }}
      >
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => select(p)}
            className={`w-full text-left px-3 py-1.5 text-xs font-medium transition-colors ${
              p === period
                ? "text-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            {t(p)}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary backdrop-blur-sm hover:bg-primary/15 transition-colors"
      >
        {t(period)}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {mounted && menu ? createPortal(menu, document.body) : null}
    </>
  );
}

// ─── Score ring ──────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  // Larger ring than a typical sparkline so the number is legible at a
  // glance. Stroke width is intentionally bold (8px) — the ring is the
  // primary visual cue and needs to compete with the surrounding card.
  const SIZE = 96;
  const STROKE = 8;
  const R = (SIZE - STROKE) / 2;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - Math.min(100, Math.max(0, score)) / 100);
  // Color ramp keyed off the score: green ≥ 80, amber 50–79, red < 50.
  const color =
    score >= 80
      ? "var(--color-success)"
      : score >= 50
        ? "rgb(245, 158, 11)" // amber-500
        : "var(--color-destructive)";
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={R}
        fill="none"
        stroke="var(--color-muted)"
        strokeWidth={STROKE}
        opacity={0.4}
      />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={R}
        fill="none"
        stroke={color}
        strokeWidth={STROKE}
        strokeDasharray={C}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        style={{ transition: "stroke-dashoffset .6s ease-out" }}
      />
      <text
        x={SIZE / 2}
        y={SIZE / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontWeight={700}
        fill="currentColor"
        className="tabular-nums"
      >
        <tspan fontSize="22">{score}</tspan>
        <tspan fontSize="13" dx="1" fill="var(--color-muted-foreground)">%</tspan>
      </text>
    </svg>
  );
}

// ─── Area chart ──────────────────────────────────────────────────────────────

function AreaChart({
  income,
  expense,
  buckets,
  granularity,
  locale,
}: {
  income: number[];
  expense: number[];
  buckets: string[];
  granularity: "day" | "week" | "month";
  locale: string;
}) {
  const t = useTranslations("dashboard");
  // SVG drawn at a fixed viewBox; container is set to width:100% so it
  // scales fluidly without measuring layout. The aspect ratio (3:1) is
  // chosen to look good on the desktop dashboard and degrade
  // gracefully on tablets.
  const W = 900;
  const H = 240;
  const PAD_X = 32;
  const PAD_T = 16;
  const PAD_B = 28;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_T - PAD_B;

  // Hovered bucket index (for tooltip / scrubber). null = nothing hovered.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const n = buckets.length;
  const max = Math.max(1, ...income, ...expense);

  if (n === 0) {
    return (
      <div className="px-5 py-12 text-center text-sm text-muted-foreground">
        {t("chart.empty")}
      </div>
    );
  }

  const xFor = (i: number) => PAD_X + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yFor = (v: number) => PAD_T + innerH - (v / max) * innerH;

  function pathFor(values: number[]): string {
    if (values.length === 0) return "";
    if (values.length === 1) {
      const x = xFor(0);
      const y = yFor(values[0]);
      return `M ${x} ${y}`;
    }
    // Smooth quadratic-ish curve using midpoint anchors. Cheap and
    // gives the filled-area look the user asked for without dragging
    // in a chart library.
    let d = `M ${xFor(0).toFixed(2)} ${yFor(values[0]).toFixed(2)}`;
    for (let i = 1; i < values.length; i++) {
      const px = xFor(i - 1);
      const py = yFor(values[i - 1]);
      const cx = xFor(i);
      const cy = yFor(values[i]);
      const midX = (px + cx) / 2;
      d += ` Q ${midX.toFixed(2)} ${py.toFixed(2)} ${midX.toFixed(2)} ${((py + cy) / 2).toFixed(2)}`;
      d += ` Q ${midX.toFixed(2)} ${cy.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)}`;
    }
    return d;
  }

  function areaFor(values: number[]): string {
    const stroke = pathFor(values);
    if (!stroke) return "";
    const baseY = PAD_T + innerH;
    return `${stroke} L ${xFor(n - 1).toFixed(2)} ${baseY} L ${xFor(0).toFixed(2)} ${baseY} Z`;
  }

  // Format the bucket label for x-axis ticks. We only label a handful
  // of buckets (first, last, and ~every 4th) so the axis doesn't get
  // cluttered when there are 30+ days.
  function formatTick(i: number): string {
    const d = new Date(buckets[i]);
    if (granularity === "month") {
      return d.toLocaleDateString(locale, { month: "short" });
    }
    if (granularity === "week") {
      return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
    }
    return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  }
  const tickEvery = Math.max(1, Math.ceil(n / 6));

  // ─── Hover handling ──────────────────────────────────────────────────
  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!wrapperRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const xScale = W / rect.width;
    const svgX = xPx * xScale;
    if (n === 1) {
      setHoverIdx(0);
      return;
    }
    const rel = (svgX - PAD_X) / innerW;
    const idx = Math.round(rel * (n - 1));
    if (idx < 0 || idx >= n) {
      setHoverIdx(null);
      return;
    }
    setHoverIdx(idx);
  }

  const hoverX = hoverIdx !== null ? xFor(hoverIdx) : null;
  const hoverDate = hoverIdx !== null ? new Date(buckets[hoverIdx]) : null;

  return (
    <div ref={wrapperRef} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto select-none"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="grad-income" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-success)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--color-success)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="grad-expense" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-destructive)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-destructive)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines + value labels */}
        {[0, 0.5, 1].map((p) => {
          const y = PAD_T + innerH * (1 - p);
          return (
            <g key={p}>
              <line
                x1={PAD_X}
                x2={W - PAD_X}
                y1={y}
                y2={y}
                stroke="var(--color-border)"
                strokeDasharray={p === 0 ? "" : "2 4"}
                opacity={0.6}
              />
              <text
                x={PAD_X - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="10"
                fill="var(--color-muted-foreground)"
              >
                {Math.round(max * p).toLocaleString(locale)}
              </text>
            </g>
          );
        })}

        {/* Expense area first → income drawn on top */}
        <path d={areaFor(expense)} fill="url(#grad-expense)" />
        <path d={pathFor(expense)} fill="none" stroke="var(--color-destructive)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />

        <path d={areaFor(income)} fill="url(#grad-income)" />
        <path d={pathFor(income)} fill="none" stroke="var(--color-success)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />

        {/* X-axis ticks */}
        {buckets.map((_, i) =>
          i % tickEvery === 0 || i === n - 1 ? (
            <text
              key={i}
              x={xFor(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize="10"
              fill="var(--color-muted-foreground)"
            >
              {formatTick(i)}
            </text>
          ) : null,
        )}

        {/* Hover scrubber */}
        {hoverIdx !== null && hoverX !== null && (
          <g>
            <line
              x1={hoverX}
              x2={hoverX}
              y1={PAD_T}
              y2={PAD_T + innerH}
              stroke="var(--color-foreground)"
              strokeOpacity={0.25}
              strokeWidth={1}
            />
            <circle cx={hoverX} cy={yFor(income[hoverIdx])} r={4} fill="var(--color-success)" />
            <circle cx={hoverX} cy={yFor(expense[hoverIdx])} r={4} fill="var(--color-destructive)" />
          </g>
        )}
      </svg>

      {/* Tooltip overlay (HTML, positioned absolute on hover) */}
      {hoverIdx !== null && hoverDate && (
        <div
          className="pointer-events-none absolute top-2 rounded-lg border border-border bg-card/95 backdrop-blur px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${(xFor(hoverIdx) / W) * 100}%`,
            transform: "translateX(-50%)",
          }}
        >
          <p className="font-medium text-foreground mb-1 whitespace-nowrap">
            {hoverDate.toLocaleDateString(locale, {
              day: "numeric",
              month: granularity === "month" ? "long" : "short",
              year: granularity === "month" ? "numeric" : undefined,
            })}
          </p>
          <div className="flex items-center gap-1.5 text-success">
            <span className="w-2 h-2 rounded-full bg-success" />
            <span className="font-mono tabular-nums">{formatCurrency(income[hoverIdx])}</span>
          </div>
          <div className="flex items-center gap-1.5 text-destructive">
            <span className="w-2 h-2 rounded-full bg-destructive" />
            <span className="font-mono tabular-nums">{formatCurrency(expense[hoverIdx])}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DashboardView ───────────────────────────────────────────────────────────

export function DashboardView({
  locale,
  firstName,
  period,
  checklist,
  kpis,
  receivables,
  quoteKpis,
  accountingScore,
  chart,
  cashflow,
  recentInvoices,
  activity,
  linkedAccountants,
  showOnboarding,
}: Props) {
  const t = useTranslations("dashboard");
  const [filter, setFilter] = useState<"ALL" | InvoiceStatus>("ALL");
  const [greeting, setGreeting] = useState<GreetingKey | null>(null);
  const [dateStr, setDateStr] = useState<string>("");
  const [showContactDialog, setShowContactDialog] = useState(false);

  useEffect(() => {
    const now = new Date();
    setGreeting(computeGreeting(now));
    setDateStr(now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  }, [locale]);

  const filtered = useMemo(() => {
    if (filter === "ALL") return recentInvoices.slice(0, 6);
    return recentInvoices.filter((i) => i.status === filter).slice(0, 6);
  }, [filter, recentInvoices]);

  const hasOverdue = kpis.overdueCount > 0;
  const hasDrafts = kpis.draftCount > 0;

  // Sparkline data for revenue/profit cards is drawn from the chart
  // series — single source of truth. The KPI cards for snapshot
  // counts (open / overdue) intentionally pass empty arrays so the
  // sparkline renders nothing (cleaner than a flat line at zero).
  const revenueSpark = chart.income;
  const profitSpark = chart.income.map((v, i) => v - chart.expense[i]);

  // Period-aware trend copy. "—" when previous value is 0 (we can't
  // express infinite growth as a useful percentage).
  function deltaCopy(delta: number | null): { text: string; tone: "up" | "down" | "neutral" } {
    if (delta === null) return { text: t("stats.trendVsPrev"), tone: "neutral" };
    const sign = delta >= 0 ? "+" : "";
    return {
      text: `${sign}${delta.toFixed(0)}% ${t("stats.trendVsPrev")}`,
      tone: delta >= 0 ? "up" : "down",
    };
  }
  const revenueTrend = deltaCopy(kpis.revenueDelta);
  const profitTrend = deltaCopy(kpis.profitDelta);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-7">
      {/* First-run welcome (portal'd; renders only until dismissed). */}
      {showOnboarding && <WelcomeModal firstName={firstName} />}

      {/* ─── HERO ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-card via-card to-background px-8 py-9 motion-safe:animate-[fadeUp_.45s_cubic-bezier(.22,1,.36,1)_both]">
        <div
          className="pointer-events-none absolute -top-20 right-32 h-72 w-72 rounded-full"
          style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--color-primary) 28%, transparent), transparent 70%)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-16 right-64 h-40 w-40 rounded-full"
          style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--color-primary) 18%, transparent), transparent 70%)" }}
        />

        <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[.1em] uppercase text-primary">
              <Sparkles className="w-3 h-3" />
              {t("eyebrow")}
            </div>
            <h1
              className="mt-2 text-4xl md:text-5xl font-semibold tracking-tight text-foreground leading-[1.05]"
              suppressHydrationWarning
            >
              {greeting ? t(`greeting.${greeting}`) : " "}
              {firstName ? (
                <>
                  ,<br />
                  <span className="text-brand">{firstName}.</span>
                </>
              ) : (
                "."
              )}
            </h1>
            <p className="mt-3 max-w-md text-sm text-muted-foreground">
              {hasOverdue || hasDrafts ? (
                <>
                  {hasOverdue && (
                    <span className="text-destructive font-medium">
                      {t("heroSummaryOverdue", { count: kpis.overdueCount })}
                    </span>
                  )}
                  {hasOverdue && hasDrafts && <span> · </span>}
                  {hasDrafts && (
                    <span className="text-foreground/80">
                      {t("heroSummaryDraft", { count: kpis.draftCount })}
                    </span>
                  )}
                </>
              ) : (
                t("heroSummaryNone")
              )}
            </p>
          </div>

          <div className="flex flex-col items-start md:items-end gap-2 shrink-0">
            <span className="font-mono text-[11px] tracking-wider text-muted-foreground" suppressHydrationWarning>
              {dateStr || " "}
            </span>
            <PeriodSelector period={period} />
          </div>
        </div>
      </section>

      {/* ─── ONBOARDING SETUP CHECKLIST ──────────────────────────────
          Sits directly under the hero so a new user sees their next
          steps immediately. Hides itself once dismissed. */}
      {showOnboarding && <SetupChecklist data={checklist} />}

      {/* ─── STATS (3 cards) ─────────────────────────────────────────
          'Offene Rechnungen' + 'Überfällig' wurden in das Forderungen-
          Widget weiter unten konsolidiert. Drei Karten: zwei perioden-
          abhängige finanzielle Kennzahlen (Umsatz, Gewinn) plus eine
          dritte Karte als Platzhalter / CTA zum Steuerberater. */}
      <section className={`grid grid-cols-1 sm:grid-cols-2 ${showOnboarding ? "lg:grid-cols-3" : "lg:grid-cols-2"} gap-4`}>
        <StatCard
          label={t("stats.revenuePeriod")}
          value={formatCurrency(kpis.revenuePeriod)}
          icon={TrendingUp}
          trend={revenueTrend.text}
          trendTone={revenueTrend.tone}
          spark={revenueSpark}
          animDelay={80}
        />
        <StatCard
          label={t("stats.profitPeriod")}
          value={formatCurrency(kpis.profitPeriod)}
          icon={Wallet}
          trend={profitTrend.text}
          trendTone={profitTrend.tone}
          spark={profitSpark}
          animDelay={160}
        />
        {/* Berater sehen "Mein Steuerberater"-Karte nicht — er IST der
            Berater, das wäre ein Self-Referential-Link. showOnboarding
            ist false für ACCOUNTANT und passt hier als Sichtbarkeits-Flag. */}
        {showOnboarding && <AccountantCard accountants={linkedAccountants} />}
      </section>

      {/* ─── CASH-FLOW-PROGNOSE ──────────────────────────────────────
          Direkt unter den KPI-Karten — ein Feature, das Nutzer täglich
          sehen wollen, gehört ganz nach oben. Ist-Verlauf (durchgezogen)
          + 30/60/90-Tage-Projektion (gestrichelt) plus die drei Zeilen. */}
      <CashflowWidget data={cashflow} locale={locale} />

      {/* ─── WIDGETS (Forderungen + Score) ───────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Offene Forderungen — snapshot, periode-unabhängig */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 motion-safe:animate-[fadeUp_.45s_.3s_cubic-bezier(.22,1,.36,1)_both]">
          <div className="mb-4">
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
                {t("receivables.title")}
              </p>
              {/* Forderungen sind ein Live-Snapshot; sie ignorieren den
                  Period-Selector. Tooltip macht das diskret klar. */}
              <InstantTooltip content={t("receivables.periodIndependent")}>
                <Info className="w-3.5 h-3.5 text-muted-foreground/70 hover:text-foreground transition-colors" />
              </InstantTooltip>
            </div>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {formatCurrency(receivables.openTotal + receivables.overdueTotal)}
            </p>
          </div>

          {/* Stacked bar (overdue red + open yellow). When there's
              nothing to show, render the empty state line instead. */}
          {receivables.openTotal + receivables.overdueTotal > 0 ? (
            <>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden flex">
                {receivables.overdueTotal > 0 && (
                  <div
                    className="h-full bg-destructive"
                    style={{
                      width: `${
                        (receivables.overdueTotal /
                          (receivables.openTotal + receivables.overdueTotal)) *
                        100
                      }%`,
                    }}
                  />
                )}
                {receivables.openTotal > 0 && (
                  <div
                    className="h-full bg-amber-500"
                    style={{
                      width: `${
                        (receivables.openTotal /
                          (receivables.openTotal + receivables.overdueTotal)) *
                        100
                      }%`,
                    }}
                  />
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="flex items-start gap-2.5">
                  <span className="mt-1 w-2 h-2 rounded-full bg-destructive shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      {t("receivables.overdue", { count: receivables.overdueCount })}
                    </p>
                    <p className="text-sm font-medium text-foreground tabular-nums">
                      {formatCurrency(receivables.overdueTotal)}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="mt-1 w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      {t("receivables.open", { count: receivables.openCount })}
                    </p>
                    <p className="text-sm font-medium text-foreground tabular-nums">
                      {formatCurrency(receivables.openTotal)}
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("receivables.empty")}</p>
          )}
        </div>

        {/* Buchhaltungsscore */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 motion-safe:animate-[fadeUp_.45s_.4s_cubic-bezier(.22,1,.36,1)_both]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
              {t("score.title")}
            </p>
            <InstantTooltip content={t("score.tooltip")}>
              <Info className="w-3.5 h-3.5 text-muted-foreground/70 hover:text-foreground transition-colors" />
            </InstantTooltip>
          </div>
          <div className="flex items-center gap-5">
            <ScoreRing score={accountingScore.score} />
            <div className="min-w-0 flex-1">
              {accountingScore.total === 0 ? (
                <p className="text-sm text-muted-foreground">{t("score.empty")}</p>
              ) : accountingScore.unmatched > 0 ? (
                // Only call-to-action when there's actually something
                // to do. Scales gracefully — whether 3 or 3000 tx,
                // the user only sees "N offene Transaktionen".
                <Link
                  href="/dashboard/bank"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {t("score.openUnmatched", { count: accountingScore.unmatched })}
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              ) : (
                <p className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
                  <span className="w-1.5 h-1.5 rounded-full bg-success" />
                  {t("score.allDone")}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ─── ANGEBOTE-WIDGET ──────────────────────────────────────
          Three at-a-glance KPIs the user wants to see without
          opening the Angebote page: how many quotes are out there,
          how many of them are about to expire, and what share of the
          last 30 days' resolved quotes ended in acceptance.
          Period-independent — quotes have their own lifecycle that
          doesn't map cleanly onto the dashboard's revenue period. */}
      <section className="rounded-2xl border border-border bg-card p-5 motion-safe:animate-[fadeUp_.45s_.45s_cubic-bezier(.22,1,.36,1)_both]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <ClipboardList className="w-4 h-4 text-primary" />
            </div>
            <p className="text-[10px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
              {t("quotes.title")}
            </p>
          </div>
          <Link
            href="/dashboard/quotes"
            className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
          >
            {t("quotes.viewAll")}
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Offene Angebote */}
          <div className="rounded-xl border border-border/60 bg-background/40 p-4">
            <p className="text-[11px] font-medium text-muted-foreground mb-1">
              {t("quotes.open")}
            </p>
            <p className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {quoteKpis.openCount}
            </p>
            <p className="text-xs text-muted-foreground mt-1 tabular-nums">
              {formatCurrency(quoteKpis.openTotal)}
            </p>
          </div>

          {/* Akzeptanzquote (30 Tage) */}
          <div className="rounded-xl border border-border/60 bg-background/40 p-4">
            <p className="text-[11px] font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <CircleCheckBig className="w-3 h-3" />
              {t("quotes.acceptanceRate")}
            </p>
            <p className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {quoteKpis.acceptanceRate30d === null ? "—" : `${quoteKpis.acceptanceRate30d} %`}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t("quotes.last30Days")}
            </p>
          </div>

          {/* Bald ablaufend */}
          <div className="rounded-xl border border-border/60 bg-background/40 p-4">
            <p className="text-[11px] font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <CalendarClock className="w-3 h-3" />
              {t("quotes.expiringSoon")}
            </p>
            <p
              className={`text-2xl font-semibold tracking-tight tabular-nums ${
                quoteKpis.expiringSoonCount > 0 ? "text-amber-500" : "text-foreground"
              }`}
            >
              {quoteKpis.expiringSoonCount}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t("quotes.next7Days")}
            </p>
          </div>
        </div>
      </section>

      {/* ─── ERTRAG/AUFWAND CHART ────────────────────────────────── */}
      <section className="bg-card border border-border rounded-2xl overflow-hidden motion-safe:animate-[fadeUp_.45s_.5s_cubic-bezier(.22,1,.36,1)_both]">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t("chart.title")}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t("chart.subtitle")}</p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-muted-foreground">{t("chart.income")}</span>
              <span className="font-mono tabular-nums text-foreground">
                {formatCurrency(kpis.revenuePeriod)}
              </span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-destructive" />
              <span className="text-muted-foreground">{t("chart.expense")}</span>
              <span className="font-mono tabular-nums text-foreground">
                {formatCurrency(kpis.expensePeriod)}
              </span>
            </div>
          </div>
        </div>
        <div className="p-5">
          <AreaChart
            income={chart.income}
            expense={chart.expense}
            buckets={chart.buckets}
            granularity={chart.granularity}
            locale={locale}
          />
        </div>
      </section>

      {/* ─── BOTTOM GRID (existing) ──────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        {/* Invoices panel */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden motion-safe:animate-[fadeUp_.45s_.6s_cubic-bezier(.22,1,.36,1)_both]">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">{t("recentInvoices.title")}</h2>
            <Link
              href="/dashboard/invoices"
              className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/15 transition-colors"
            >
              {t("recentInvoices.viewAll")}
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="flex flex-wrap gap-1.5 px-5 py-3 border-b border-border bg-muted/40">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  filter === f
                    ? "bg-foreground text-background border-foreground"
                    : "bg-transparent text-muted-foreground border-transparent hover:border-border hover:text-foreground"
                }`}
              >
                {f === "ALL" ? t("filters.all") : t(`filters.${f}`)}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">{t("recentInvoices.empty")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((inv) => {
                const s = STATUS_STYLES[inv.status];
                return (
                  <li key={inv.id}>
                    <Link
                      href={`/dashboard/invoices/${inv.id}`}
                      className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/60 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm font-medium text-foreground truncate">{inv.number}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {inv.clientName} · {new Date(inv.issueDate).toLocaleDateString(locale, { day: "2-digit", month: "short" })}
                        </p>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${s.chip}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                        {t(`filters.${s.label}` as "filters.DRAFT")}
                      </span>
                      <span className="shrink-0 font-mono text-sm font-medium text-foreground tabular-nums tracking-tight">
                        {formatCurrency(inv.total)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Side panel */}
        <aside className="flex flex-col gap-4">
          {showOnboarding && (
          <div className="bg-card border border-border rounded-2xl p-5 motion-safe:animate-[fadeUp_.45s_.68s_cubic-bezier(.22,1,.36,1)_both]">
            <h2 className="text-sm font-semibold text-foreground mb-3">{t("quickActions.title")}</h2>
            <div className="flex flex-col gap-2">
              <Link
                href="/dashboard/invoices/new"
                className="group inline-flex items-center gap-2.5 rounded-lg bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/30 transition-all hover:-translate-y-0.5 hover:bg-primary/90"
              >
                <Plus className="w-4 h-4" />
                {t("quickActions.newInvoice")}
              </Link>
              {/*
                "Neuer Kontakt" opens the form dialog inline instead of
                navigating to /contacts. Reuses the shared ContactFormDialog
                so the create form stays in lockstep with the one on the
                contacts page.
              */}
              <button
                type="button"
                onClick={() => setShowContactDialog(true)}
                className="inline-flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-3.5 py-2.5 text-sm font-medium text-foreground transition-all hover:-translate-y-0.5 hover:bg-muted"
              >
                <Users className="w-4 h-4 text-muted-foreground" />
                {t("quickActions.newClient")}
              </button>
              <Link
                href="/dashboard/documents/new"
                className="inline-flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-3.5 py-2.5 text-sm font-medium text-foreground transition-all hover:-translate-y-0.5 hover:bg-muted"
              >
                <Upload className="w-4 h-4 text-muted-foreground" />
                {t("quickActions.uploadDocument")}
              </Link>
            </div>
          </div>
          )}

          <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card to-background p-5 motion-safe:animate-[fadeUp_.45s_.76s_cubic-bezier(.22,1,.36,1)_both]">
            <div
              className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full"
              style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--color-primary) 20%, transparent), transparent 70%)" }}
            />
            <h2 className="relative text-sm font-semibold text-foreground mb-3 inline-flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-primary" />
              {t("activity.title")}
            </h2>
            {activity.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("activity.empty")}</p>
            ) : (
              <ul className="relative divide-y divide-border/60">
                {activity.map((e) => {
                  const who = fullName(e.user) ?? e.user?.email ?? "System";
                  return (
                    <li key={e.id} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${actionDot(e.action)}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-foreground/85 leading-snug truncate">
                          <span className="text-foreground font-medium">{who}</span>{" "}
                          <span className="text-muted-foreground">{actionLabel(e.action)}</span>
                        </p>
                        <p className="font-mono text-[10px] text-muted-foreground/70 mt-0.5">
                          {timeAgo(e.createdAt, locale)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </section>

      <ContactFormDialog
        open={showContactDialog}
        onClose={() => setShowContactDialog(false)}
      />
    </div>
  );
}

function actionDot(a: AuditAction): string {
  if (a === "INVOICE_PAID" || a === "DOCUMENT_PAID") return "bg-success";
  if (a === "INVOICE_CANCELLED") return "bg-destructive";
  if (a === "INVOICE_SENT") return "bg-blue-400";
  if (a === "CLIENT_CREATED" || a === "CONTACT_CREATED") return "bg-primary";
  return "bg-muted-foreground";
}

function actionLabel(a: AuditAction): string {
  switch (a) {
    case "INVOICE_CREATED": return "created an invoice";
    case "INVOICE_SENT": return "sent an invoice";
    case "INVOICE_PAID": return "marked an invoice as paid";
    case "INVOICE_CANCELLED": return "cancelled an invoice";
    case "CLIENT_CREATED":
    case "CONTACT_CREATED": return "added a contact";
    case "DOCUMENT_PAID": return "marked a document as paid";
    default: return a.toLowerCase().replace(/_/g, " ");
  }
}

function timeAgo(iso: string, locale: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString(locale, { day: "2-digit", month: "short" });
}
