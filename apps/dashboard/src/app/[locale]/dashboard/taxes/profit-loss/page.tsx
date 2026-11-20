import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import { RangeSelector } from "./range-selector";
import { GroupInfoButton } from "./group-info-button";
import { getSkrAccount, getSkrAccountLabel } from "@/lib/skr-accounts";
import { computeProfitLoss, type ProfitLossMethod } from "@/lib/reports/profit-loss";
import type { SourceItem } from "@/lib/reports/source-item";
import type { SkrType } from "@prisma/client";
import { TrendingUp, TrendingDown, Minus, ArrowUpRight, ArrowDownRight, Receipt, Download } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taxes.profitLoss");
  const { tenantId } = await requireTenant();
  const settings = await db.companySettings.findUnique({
    where: { tenantId },
    select: { profitLossMethod: true },
  });
  const isGuV = settings?.profitLossMethod === "GUV";
  return { title: isGuV ? t("pageTitleGuV") : t("pageTitle") };
}

type Method = ProfitLossMethod;

function parseSearchParams(sp: Record<string, string | string[] | undefined>) {
  const now = new Date();
  const defaultFrom = new Date(Date.UTC(now.getFullYear(), 0, 1));
  const defaultTo = new Date(Date.UTC(now.getFullYear(), 11, 31));
  const fromStr = typeof sp.from === "string" ? sp.from : defaultFrom.toISOString().slice(0, 10);
  const toStr = typeof sp.to === "string" ? sp.to : defaultTo.toISOString().slice(0, 10);
  const from = new Date(`${fromStr}T00:00:00.000Z`);
  const to = new Date(`${toStr}T23:59:59.999Z`);
  return { fromStr, toStr, from, to };
}

function fmtCurrency(n: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
}

function fmtPercent(n: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(n);
}

export default async function ProfitLossPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const { tenantId } = await requireTenant();

  const t = await getTranslations("taxes.profitLoss");
  const tAccounts = await getTranslations("skrAccounts");
  const { fromStr, toStr, from, to } = parseSearchParams(sp);

  const settings = await db.companySettings.findUnique({ where: { tenantId } });
  const skrType = (settings?.skrType ?? "SKR03") as SkrType;
  // Berechnungsart wird zentral in den Buchhaltungs-Einstellungen
  // festgelegt (Settings → Buchhaltung), nicht mehr pro Aufruf gewählt.
  const method: Method = settings?.profitLossMethod === "GUV" ? "GUV" : "EUR";

  const {
    incomeBuckets,
    expenseBuckets,
    incomeSourcesByGroup,
    expenseSourcesByGroup,
    incomeTotal,
    expenseTotal,
    result,
    margin,
    salesVat,
    inputVat,
  } = await computeProfitLoss({ tenantId, from, to, method, skrType });
  const hasData = incomeTotal !== 0 || expenseTotal !== 0;

  function accountLabel(code: string) {
    return getSkrAccountLabel(code, skrType, (k) => tAccounts(k as never));
  }

  // Group expense buckets by SKR group for the breakdown table.
  type Row = { code: string; label: string; value: number };
  type Group = {
    key: string;
    label: string;
    rows: Row[];
    total: number;
    sources: SourceItem[];
  };

  function buildGroups(
    buckets: Map<string, number>,
    sourcesByGroup: Map<string, SourceItem[]>,
  ): Group[] {
    const map = new Map<string, Group>();
    for (const [code, value] of buckets) {
      const account = getSkrAccount(code, skrType);
      const groupKey = account?.group ?? "other";
      const groupLabel = tAccounts(`groups.${groupKey}`);
      let g = map.get(groupKey);
      if (!g) {
        g = {
          key: groupKey,
          label: groupLabel,
          rows: [],
          total: 0,
          sources: sourcesByGroup.get(groupKey) ?? [],
        };
        map.set(groupKey, g);
      }
      g.rows.push({ code, label: accountLabel(code), value });
      g.total += value;
    }
    for (const g of map.values()) g.rows.sort((a, b) => b.value - a.value);
    return [...map.values()].sort((a, b) => b.total - a.total);
  }

  const incomeGroups = buildGroups(incomeBuckets, incomeSourcesByGroup);
  const expenseGroups = buildGroups(expenseBuckets, expenseSourcesByGroup);

  // ── Result presentation ────────────────────────────────────────────────────
  const resultState: "profit" | "loss" | "neutral" =
    result > 0.005 ? "profit" : result < -0.005 ? "loss" : "neutral";

  const resultTheme =
    resultState === "profit"
      ? {
          container:
            "bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border-emerald-500/30",
          label: "text-emerald-700 dark:text-emerald-400",
          value: "text-emerald-700 dark:text-emerald-400",
          iconWrap: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
          Icon: TrendingUp,
        }
      : resultState === "loss"
      ? {
          container:
            "bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent border-rose-500/30",
          label: "text-rose-700 dark:text-rose-400",
          value: "text-rose-700 dark:text-rose-400",
          iconWrap: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
          Icon: TrendingDown,
        }
      : {
          container: "bg-card border-border",
          label: "text-muted-foreground",
          value: "text-foreground",
          iconWrap: "bg-muted text-muted-foreground",
          Icon: Minus,
        };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {method === "GUV" ? t("titleGuV") : t("title")}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-1 text-xs rounded-full border border-border bg-muted text-muted-foreground">
            {method === "EUR" ? t("methodEURShort") : t("methodGuVShort")}
          </span>
          <a
            href={`/api/taxes/profit-loss/export?method=${method}&from=${fromStr}&to=${toStr}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted/60 text-foreground transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            {t("exportPdf")}
          </a>
        </div>
      </div>

      <RangeSelector fromStr={fromStr} toStr={toStr} />

      {/* Hero: result + supporting stats ---------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div
          className={`lg:col-span-2 relative rounded-xl border p-6 overflow-hidden ${resultTheme.container}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className={`text-xs font-medium uppercase tracking-wide ${resultTheme.label}`}>
                {resultState === "loss" ? t("summary.loss") : t("summary.result")}
              </div>
              <div className={`mt-2 text-4xl font-semibold tabular-nums ${resultTheme.value}`}>
                {fmtCurrency(result, locale)}
              </div>
              {incomeTotal > 0 && (
                <div className="mt-3 text-xs text-muted-foreground">
                  {t("summary.margin")}:{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {fmtPercent(margin, locale)}
                  </span>
                </div>
              )}
            </div>
            <div
              className={`inline-flex items-center justify-center w-12 h-12 rounded-full shrink-0 ${resultTheme.iconWrap}`}
            >
              <resultTheme.Icon className="w-6 h-6" />
            </div>
          </div>
        </div>

        <div className="grid grid-rows-2 gap-4">
          <MiniStat
            label={t("summary.income")}
            value={fmtCurrency(incomeTotal, locale)}
            Icon={ArrowUpRight}
            tone="emerald"
          />
          <MiniStat
            label={t("summary.expense")}
            value={fmtCurrency(expenseTotal, locale)}
            Icon={ArrowDownRight}
            tone="rose"
          />
        </div>
      </div>

      {/* VAT context (only relevant for accrual / non-Kleinunternehmer) --- */}
      {(Math.abs(salesVat) > 0.005 || Math.abs(inputVat) > 0.005) && (
        <Link
          href={"/dashboard/taxes/vat-return" as never}
          className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/60 transition-colors group"
        >
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary">
            <Receipt className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground">{t("vatContext.title")}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {t("vatContext.hint")}
            </div>
          </div>
          <div className="flex gap-4 text-xs tabular-nums">
            <div className="text-right">
              <div className="text-muted-foreground">{t("vatContext.sales")}</div>
              <div className="text-foreground font-medium">{fmtCurrency(salesVat, locale)}</div>
            </div>
            <div className="text-right">
              <div className="text-muted-foreground">{t("vatContext.input")}</div>
              <div className="text-foreground font-medium">{fmtCurrency(inputVat, locale)}</div>
            </div>
            <div className="text-right">
              <div className="text-muted-foreground">{t("vatContext.payable")}</div>
              <div className="text-foreground font-semibold">
                {fmtCurrency(salesVat - inputVat, locale)}
              </div>
            </div>
          </div>
        </Link>
      )}

      {!hasData ? (
        <EmptyState message={t("breakdown.noData")} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <BreakdownCard
            title={t("breakdown.incomeTitle")}
            total={incomeTotal}
            groups={incomeGroups}
            locale={locale}
            tone="emerald"
            empty={t("breakdown.noData")}
          />
          <BreakdownCard
            title={t("breakdown.expenseTitle")}
            total={expenseTotal}
            groups={expenseGroups}
            locale={locale}
            tone="rose"
            empty={t("breakdown.noData")}
          />
        </div>
      )}
    </div>
  );
}

// ── Mini stat card ───────────────────────────────────────────────────────────

function MiniStat({
  label,
  value,
  Icon,
  tone,
}: {
  label: string;
  value: string;
  Icon: React.ComponentType<{ className?: string }>;
  tone: "emerald" | "rose";
}) {
  const styles =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10"
      : "text-rose-700 dark:text-rose-400 bg-rose-500/10";
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
      <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${styles}`}>
        <Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-base font-semibold text-foreground tabular-nums truncate">
          {value}
        </div>
      </div>
    </div>
  );
}

// ── Breakdown card with grouping + share bars ────────────────────────────────

function BreakdownCard({
  title,
  total,
  groups,
  locale,
  tone,
  empty,
}: {
  title: string;
  total: number;
  groups: Array<{
    key: string;
    label: string;
    rows: Array<{ code: string; label: string; value: number }>;
    total: number;
    sources: SourceItem[];
  }>;
  locale: string;
  tone: "emerald" | "rose";
  empty: string;
}) {
  const barColor =
    tone === "emerald"
      ? "bg-emerald-500/70 dark:bg-emerald-400/70"
      : "bg-rose-500/70 dark:bg-rose-400/70";
  const absTotal = Math.abs(total) || 1;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <div className="text-sm font-semibold text-foreground tabular-nums">
          {new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(total)}
        </div>
      </div>
      {groups.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="divide-y divide-border">
          {groups.map((g) => {
            const groupShare = Math.abs(g.total) / absTotal;
            return (
              <div key={g.key} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    <span>{g.label}</span>
                    <GroupInfoButton
                      groupLabel={g.label}
                      sources={g.sources}
                      locale={locale}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {new Intl.NumberFormat(locale, {
                        style: "percent",
                        maximumFractionDigits: 0,
                      }).format(groupShare)}
                    </span>
                    <span className="text-xs font-semibold text-foreground tabular-nums">
                      {new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(
                        g.total,
                      )}
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {g.rows.map((r) => {
                    const share = Math.abs(r.value) / absTotal;
                    return (
                      <div key={r.code} className="group">
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="text-foreground truncate">{r.label}</span>
                          <span className="text-foreground tabular-nums shrink-0">
                            {new Intl.NumberFormat(locale, {
                              style: "currency",
                              currency: "EUR",
                            }).format(r.value)}
                          </span>
                        </div>
                        <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full ${barColor}`}
                            style={{ width: `${Math.min(100, share * 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
