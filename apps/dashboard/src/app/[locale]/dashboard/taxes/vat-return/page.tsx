import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import {
  Info,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpRight,
  ArrowDownRight,
  FileText,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { PeriodSelector } from "./period-selector";
import { BreakdownRow } from "./breakdown-row";
import { regulationTagFromCode, type RegulationTag } from "@/lib/journal/accounts";
import { isOrphanSource, loadLiveSourceIds } from "@/lib/journal/orphan-guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taxes.vatReturn");
  return { title: t("pageTitle") };
}

type Period = "monthly" | "quarterly";

export type SourceItem = {
  kind: "invoice" | "document" | "journal";
  id: string;
  label: string;
  secondary: string | null;
  date: string;
  net: number;
  vat: number;
  href: string;
};

function parseSearchParams(sp: Record<string, string | string[] | undefined>) {
  const now = new Date();
  const period: Period = sp.period === "monthly" ? "monthly" : "quarterly";
  const year = Number(sp.year) || now.getFullYear();
  const month = Math.min(12, Math.max(1, Number(sp.month) || now.getMonth() + 1));
  const quarter = Math.min(4, Math.max(1, Number(sp.quarter) || Math.floor(now.getMonth() / 3) + 1));
  return { period, year, month, quarter };
}

function periodRange(period: Period, year: number, month: number, quarter: number) {
  if (period === "monthly") {
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));
    return { from, to };
  }
  const startMonth = (quarter - 1) * 3;
  const from = new Date(Date.UTC(year, startMonth, 1));
  const to = new Date(Date.UTC(year, startMonth + 3, 1));
  return { from, to };
}

function fmtCurrency(n: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
}

// Parse vat codes:
//   "USt19" → { direction: "sales", rate: 19, tag: null }
//   "VSt7"  → { direction: "input", rate: 7,  tag: null }
//   "USt0:IG" / "USt0:13b" / … → { direction: "sales", rate: 0, tag: "IG" | "13b" | … }
function parseVatCode(code: string): {
  direction: "sales" | "input";
  rate: number;
  tag: RegulationTag | null;
} | null {
  const tag = regulationTagFromCode(code);
  if (tag) return { direction: "sales", rate: 0, tag };
  const m = code.match(/^(USt|VSt)(\d+)?$/);
  if (!m) return null;
  return {
    direction: m[1] === "USt" ? "sales" : "input",
    rate: m[2] ? Number(m[2]) : 0,
    tag: null,
  };
}

export default async function VatReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const { tenantId } = await requireTenant();

  const t = await getTranslations("taxes.vatReturn");
  const { period, year, month, quarter } = parseSearchParams(sp);
  const { from, to } = periodRange(period, year, month, quarter);

  const settings = await db.companySettings.findUnique({ where: { tenantId } });
  const isSmallBusiness = settings?.taxMode === "SMALL_BUSINESS";

  // Defensive orphan guard — same rule as P&L/BWA so UStVA never adds
  // VAT from a journal entry whose Beleg has been removed from the DB.
  const liveSources = await loadLiveSourceIds(tenantId);

  // ── Read directly from the journal ──────────────────────────────────────────
  // Every finalized invoice / booked document writes balanced journal entries
  // with vatCode-tagged lines (USt{rate} / VSt{rate}). Aggregating here means
  // a single source of truth: no chance of invoice & journal drifting apart.
  const vatLinesRaw = await db.journalLine.findMany({
    where: {
      // Maßgeblich ist der Steuerschlüssel, nicht die Herkunft der Buchung —
      // gleiche Regel wie in lib/taxes/ustva/query.ts, damit Übersicht und
      // Formularansicht nie auseinanderlaufen.
      vatCode: { not: null },
      entry: {
        tenantId,
        date: { gte: from, lt: to },
      },
    },
    include: {
      entry: {
        select: {
          id: true,
          number: true,
          date: true,
          description: true,
          sourceType: true,
          sourceId: true,
        },
      },
    },
    orderBy: { entry: { date: "asc" } },
  });

  // Drop orphans up front so every downstream loop and ID-collection
  // sees the same filtered set.
  const vatLines = vatLinesRaw.filter(
    (l) => !isOrphanSource(liveSources, l.entry.sourceType, l.entry.sourceId),
  );

  // Pre-fetch display labels for the referenced source records. We want the
  // info-popup to show a friendly "invoice number / supplier" rather than
  // a raw journal reference.
  const invoiceIds = [...new Set(vatLines
    .filter((l) => l.entry.sourceType === "INVOICE" && l.entry.sourceId)
    .map((l) => l.entry.sourceId!))];
  const documentIds = [...new Set(vatLines
    .filter((l) => l.entry.sourceType === "DOCUMENT" && l.entry.sourceId)
    .map((l) => l.entry.sourceId!))];

  const [invoicesMap, documentsMap] = await Promise.all([
    invoiceIds.length
      ? db.invoice.findMany({
          where: { tenantId, id: { in: invoiceIds } },
          select: { id: true, number: true, contact: { select: { name: true } } },
        }).then((rs) => new Map(rs.map((r) => [r.id, r])))
      : Promise.resolve(new Map()),
    documentIds.length
      ? db.document.findMany({
          where: { tenantId, id: { in: documentIds } },
          select: {
            id: true,
            documentNumber: true,
            recognizedSupplier: true,
            fileName: true,
          },
        }).then((rs) => new Map(rs.map((r) => [r.id, r])))
      : Promise.resolve(new Map()),
  ]);

  type Bucket = { net: number; vat: number; sources: SourceItem[] };
  const salesByRate: Record<number, Bucket> = {};
  const inputByRate: Record<number, Bucket> = {};
  // Tax-free / special-regime turnover (IG-Lieferung, §13b, Export, …)
  // tracked separately — these have rate=0 and report into their own
  // UStVA Kennzahl. Keyed by the regulation tag from `USt0:<TAG>`.
  const taxFreeByTag: Partial<Record<RegulationTag, Bucket>> = {};

  // Each vat-tagged journal line carries both the VAT amount (vatAmount) and
  // the net via the companion revenue/expense line in the same entry. Simpler
  // to derive net from the vat line: debit/credit of the vat line IS the vat
  // amount, and net = entry_total_in_direction - vat. To avoid loading the
  // whole entry, use vatAmount and look up the counter-net by reusing the
  // rate: net = vat * 100 / rate  (rate>0).
  //
  // For rate=0 we historically skipped — but tagged lines (`USt0:<TAG>`)
  // are the revenue line itself for special regulations, so debit/credit
  // on the line IS the net amount.
  for (const l of vatLines) {
    if (!l.vatCode) continue;
    const meta = parseVatCode(l.vatCode);
    if (!meta) continue;

    // ── Tagged 0% line (steuerfreie / besondere Umsätze) ─────────────────
    if (meta.tag) {
      const net = Number(l.credit) - Number(l.debit); // revenue: normally Haben
      if (Math.abs(net) < 0.005) continue;
      const bucket = (taxFreeByTag[meta.tag] ??= { net: 0, vat: 0, sources: [] });
      bucket.net += net;

      const e = l.entry;
      let source: SourceItem;
      if (e.sourceType === "INVOICE" && e.sourceId) {
        const inv = invoicesMap.get(e.sourceId);
        source = {
          kind: "invoice",
          id: e.sourceId,
          label: inv?.number ?? e.description,
          secondary: inv?.contact?.name ?? null,
          date: e.date.toISOString(),
          net,
          vat: 0,
          href: `/dashboard/invoices/${e.sourceId}`,
        };
      } else {
        source = {
          kind: "journal",
          id: e.id,
          label: `#${e.number} · ${e.description}`,
          secondary: null,
          date: e.date.toISOString(),
          net,
          vat: 0,
          href: `/dashboard/taxes/journal/${e.id}`,
        };
      }
      bucket.sources.push(source);
      continue;
    }

    // ── Standard-rated line (USt19/USt7/VSt19/VSt7) ──────────────────────
    if (meta.rate === 0) continue;

    const vatAmount = Number(l.vatAmount ?? 0) || Number(l.debit) - Number(l.credit);
    const signedVat =
      meta.direction === "sales"
        ? Number(l.credit) - Number(l.debit) // USt: normally Haben
        : Number(l.debit) - Number(l.credit); // VSt: normally Soll
    const vat = signedVat || vatAmount;
    if (Math.abs(vat) < 0.005) continue;
    const net = (vat * 100) / meta.rate;

    const bucketMap = meta.direction === "sales" ? salesByRate : inputByRate;
    const bucket = (bucketMap[meta.rate] ??= { net: 0, vat: 0, sources: [] });
    bucket.net += net;
    bucket.vat += vat;

    const e = l.entry;
    let source: SourceItem;
    if (e.sourceType === "INVOICE" && e.sourceId) {
      const inv = invoicesMap.get(e.sourceId);
      source = {
        kind: "invoice",
        id: e.sourceId,
        label: inv?.number ?? e.description,
        secondary: inv?.contact?.name ?? null,
        date: e.date.toISOString(),
        net,
        vat,
        href: `/dashboard/invoices/${e.sourceId}`,
      };
    } else if (e.sourceType === "DOCUMENT" && e.sourceId) {
      const doc = documentsMap.get(e.sourceId);
      source = {
        kind: "document",
        id: e.sourceId,
        label: doc?.documentNumber || doc?.recognizedSupplier || doc?.fileName || e.description,
        secondary: doc?.documentNumber ? doc?.recognizedSupplier ?? null : null,
        date: e.date.toISOString(),
        net,
        vat,
        href: `/dashboard/documents/${e.sourceId}`,
      };
    } else {
      source = {
        kind: "journal",
        id: e.id,
        label: `#${e.number} · ${e.description}`,
        secondary: null,
        date: e.date.toISOString(),
        net,
        vat,
        href: `/dashboard/taxes/journal/${e.id}`,
      };
    }
    bucket.sources.push(source);
  }

  const totalSalesVat = Object.values(salesByRate).reduce((s, b) => s + b.vat, 0);
  const totalInputVat = Object.values(inputByRate).reduce((s, b) => s + b.vat, 0);
  const payable = totalSalesVat - totalInputVat;

  const taxFreeEntries = Object.entries(taxFreeByTag) as [RegulationTag, Bucket][];
  const totalTaxFreeNet = taxFreeEntries.reduce((s, [, b]) => s + b.net, 0);

  const hasData =
    Object.keys(salesByRate).length > 0 ||
    Object.keys(inputByRate).length > 0 ||
    taxFreeEntries.length > 0;

  // Display ordering for the steuerfreie Umsätze section — mirrors UStVA
  // Kennzahlen ordering (41, 21/60, 43, 45) so accountants can map by eye.
  const TAG_ORDER: RegulationTag[] = ["IG", "NDS", "18b", "13b", "EXP", "TE4", "OSS"];
  const sortedTaxFree = taxFreeEntries.sort(
    ([a], [b]) => TAG_ORDER.indexOf(a) - TAG_ORDER.indexOf(b),
  );

  // ── Result presentation ────────────────────────────────────────────────────
  // Mirrors the EÜR hero treatment: positive payable = Zahllast (rose),
  // negative payable = Erstattung (emerald), near-zero = neutral.
  const payableState: "payable" | "refund" | "neutral" =
    payable > 0.005 ? "payable" : payable < -0.005 ? "refund" : "neutral";

  const payableTheme =
    payableState === "payable"
      ? {
          container:
            "bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent border-rose-500/30",
          label: "text-rose-700 dark:text-rose-400",
          value: "text-rose-700 dark:text-rose-400",
          iconWrap: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
          Icon: TrendingDown,
        }
      : payableState === "refund"
      ? {
          container:
            "bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border-emerald-500/30",
          label: "text-emerald-700 dark:text-emerald-400",
          value: "text-emerald-700 dark:text-emerald-400",
          iconWrap: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
          Icon: TrendingUp,
        }
      : {
          container: "bg-card border-border",
          label: "text-muted-foreground",
          value: "text-foreground",
          iconWrap: "bg-muted text-muted-foreground",
          Icon: Minus,
        };

  // The hero shows the absolute amount; sign is conveyed by label + colour.
  // Refunds are stored as negative `payable`; users read "Erstattung 123,45 €"
  // not "Erstattung -123,45 €".
  const heroValue = Math.abs(payable);
  const heroLabel =
    payableState === "refund"
      ? t("summary.refund")
      : payableState === "payable"
      ? t("summary.payable")
      : t("summary.balanced");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-1 text-xs rounded-full border border-border bg-muted text-muted-foreground">
            {period === "monthly" ? t("periodMonthly") : t("periodQuarterly")}
          </span>
          {!isSmallBusiness && (
            <Link
              href={{
                pathname: "/dashboard/taxes/vat-return/elster",
                query: { period, year, ...(period === "monthly" ? { month } : { quarter }) },
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-border bg-card text-foreground hover:bg-muted transition-colors"
            >
              <FileText className="w-4 h-4" />
              {t("elster.openForm")}
            </Link>
          )}
        </div>
      </div>

      {isSmallBusiness && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex gap-3">
          <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-foreground">
            <p className="font-medium">{t("smallBusinessTitle")}</p>
            <p className="text-muted-foreground mt-1">{t("smallBusinessHint")}</p>
          </div>
        </div>
      )}

      <PeriodSelector period={period} year={year} month={month} quarter={quarter} />

      {/* Hero: payable/refund + supporting stats ------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div
          className={`lg:col-span-2 relative rounded-xl border p-6 overflow-hidden ${payableTheme.container}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className={`text-xs font-medium uppercase tracking-wide ${payableTheme.label}`}>
                {heroLabel}
              </div>
              <div className={`mt-2 text-4xl font-semibold tabular-nums ${payableTheme.value}`}>
                {fmtCurrency(heroValue, locale)}
              </div>
              {hasData && payableState !== "neutral" && (
                <div className="mt-3 text-xs text-muted-foreground">
                  {payableState === "refund"
                    ? t("summary.refundHint")
                    : t("summary.payableHint")}
                </div>
              )}
            </div>
            <div
              className={`inline-flex items-center justify-center w-12 h-12 rounded-full shrink-0 ${payableTheme.iconWrap}`}
            >
              <payableTheme.Icon className="w-6 h-6" />
            </div>
          </div>
        </div>

        <div className="grid grid-rows-2 gap-4">
          <MiniStat
            label={t("summary.salesTax")}
            value={fmtCurrency(totalSalesVat, locale)}
            Icon={ArrowUpRight}
            tone="emerald"
          />
          <MiniStat
            label={t("summary.inputTax")}
            value={fmtCurrency(totalInputVat, locale)}
            Icon={ArrowDownRight}
            tone="rose"
          />
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">{t("breakdown.title")}</h3>
        </div>
        {!hasData ? (
          <div className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">{t("breakdown.rate")}</th>
                <th className="px-4 py-2 font-medium text-right">{t("breakdown.net")}</th>
                <th className="px-4 py-2 font-medium text-right">{t("breakdown.vat")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Object.entries(salesByRate)
                .sort(([a], [b]) => Number(b) - Number(a))
                .map(([rate, b]) => (
                  <BreakdownRow
                    key={`s-${rate}`}
                    label={
                      rate === "19"
                        ? t("breakdown.salesStandard")
                        : rate === "7"
                        ? t("breakdown.salesReduced")
                        : `${rate} %`
                    }
                    net={b.net}
                    vat={b.vat}
                    sources={b.sources}
                    locale={locale}
                  />
                ))}
              {Object.entries(inputByRate)
                .sort(([a], [b]) => Number(b) - Number(a))
                .map(([rate, b]) => (
                  <BreakdownRow
                    key={`i-${rate}`}
                    label={
                      rate === "19"
                        ? t("breakdown.inputStandard")
                        : rate === "7"
                        ? t("breakdown.inputReduced")
                        : `${rate} %`
                    }
                    net={b.net}
                    vat={b.vat}
                    sources={b.sources}
                    locale={locale}
                    negative
                  />
                ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Tax-free / special-regime turnover — IG-Lieferung, §13b, Export, … */}
      {sortedTaxFree.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t("taxFree.title")}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("taxFree.subtitle")}
              </p>
            </div>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {fmtCurrency(totalTaxFreeNet, locale)}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">{t("taxFree.category")}</th>
                <th className="px-4 py-2 font-medium text-right">{t("breakdown.net")}</th>
                <th className="px-4 py-2 font-medium text-right">{t("taxFree.kennzahl")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedTaxFree.map(([tag, b]) => (
                <BreakdownRow
                  key={`f-${tag}`}
                  label={t(`taxFree.tags.${tag}`)}
                  net={b.net}
                  vat={0}
                  vatLabel={t(`taxFree.kennzahlen.${tag}`)}
                  sources={b.sources}
                  locale={locale}
                />
              ))}
            </tbody>
          </table>
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
