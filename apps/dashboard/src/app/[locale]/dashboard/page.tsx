import type { Metadata } from "next";
import { Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { isCompanyComplete, type ChecklistData } from "@/lib/onboarding";
import {
  buildCashflowForecast,
  HISTORY_DAYS,
  type ExpenseDocInput,
  type OpenInvoiceInput,
} from "@/lib/cashflow/forecast";
import { DashboardView } from "./dashboard-view";

// Revenue recognises PAID invoices. A credit note only offsets revenue that
// was actually booked — i.e. only when its original invoice is itself PAID.
// A Stornorechnung that cancels an *unpaid* invoice therefore nets to zero:
// its original is CANCELLED (never PAID), so the credit note is excluded and
// the storno stays completely revenue-neutral.
const REVENUE_RECOGNIZED: Prisma.InvoiceWhereInput = {
  status: "PAID",
  OR: [
    // Regular invoices — but only when no finalised correction has
    // superseded them. The correction below carries the corrected full
    // total, so counting both would double-recognise the revenue.
    {
      type: "INVOICE",
      creditNotes: {
        none: {
          type: "CORRECTION",
          status: { in: ["SENT", "OVERDUE", "PAID"] },
        },
      },
    },
    { type: "CREDIT_NOTE", creditNoteFor: { is: { status: "PAID" } } },
    // A correction supersedes its original: it ships with the full corrected
    // line items and total, so when PAID it stands in for the original's
    // revenue contribution.
    { type: "CORRECTION" },
  ],
};
import {
  type Period,
  DEFAULT_PERIOD,
  isValidPeriod,
  periodRange,
  pickBucketing,
  buildBuckets,
  bucketIndex,
} from "@/lib/period";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { locale } = await params;
  const { period: periodParam } = await searchParams;
  const t = await requireTenant();
  const tenantId = t.tenantId;

  // Resolve the period from the URL; unknown / missing → default.
  // Server is the single source of truth for "what period are we
  // showing", so the client picker just navigates with ?period=…
  // and React re-renders the data layer.
  const period: Period = isValidPeriod(periodParam) ? periodParam : DEFAULT_PERIOD;
  const now = new Date();
  const range = periodRange(period, now);
  const granularity = pickBucketing(range);
  const buckets = buildBuckets(range, granularity);

  // Previous-period window of equal length, immediately before `range.start`.
  // Used for "vs. previous period" deltas on the period-aware KPI cards.
  const prevSpan = range.end.getTime() - range.start.getTime();
  const prevStart = new Date(range.start.getTime() - prevSpan);
  const prevEnd = range.start;

  const [
    // Snapshot counts (period-independent — they describe *current* state)
    openCount,
    overdueCount,
    draftCount,
    sentReceivables,
    overdueReceivables,
    // Period-aware revenue & expense (current + previous period)
    revenuePeriodAgg,
    revenuePrevAgg,
    expensePeriodDocs,
    expensePrevAgg,
    // Chart series sources (current period only)
    chartInvoices,
    chartExpenses,
    // Bank-tx status counts → Buchhaltungsscore
    txStatusCounts,
    // Activity-feed sources unchanged
    recentInvoices,
    auditEntries,
    // Onboarding setup-checklist completion sources
    companySettingsRow,
    contactCount,
    invoiceTotalCount,
    documentCount,
  ] = await Promise.all([
    db.invoice.count({ where: { tenantId, status: { in: ["DRAFT", "SENT"] } } }),
    db.invoice.count({ where: { tenantId, status: "OVERDUE" } }),
    db.invoice.count({ where: { tenantId, status: "DRAFT" } }),
    db.invoice.aggregate({
      where: { tenantId, status: "SENT" },
      _sum: { total: true },
      _count: true,
    }),
    db.invoice.aggregate({
      where: { tenantId, status: "OVERDUE" },
      _sum: { total: true },
      _count: true,
    }),
    db.invoice.aggregate({
      where: { tenantId, ...REVENUE_RECOGNIZED, issueDate: { gte: range.start, lt: range.end } },
      _sum: { total: true },
    }),
    db.invoice.aggregate({
      where: { tenantId, ...REVENUE_RECOGNIZED, issueDate: { gte: prevStart, lt: prevEnd } },
      _sum: { total: true },
    }),
    // Expenses: documents flagged as EXPENSE, bucketed by their
    // recognised document date (the date that matters for booking).
    // Docs with no recognised date are excluded — they need user
    // attention before they can be classified into a period anyway.
    db.document.findMany({
      where: {
        tenantId,
        deletedAt: null,
        documentType: "EXPENSE",
        recognizedDate: { gte: range.start, lt: range.end },
      },
      select: { recognizedDate: true, recognizedAmount: true },
    }),
    db.document.aggregate({
      where: {
        tenantId,
        deletedAt: null,
        documentType: "EXPENSE",
        recognizedDate: { gte: prevStart, lt: prevEnd },
      },
      _sum: { recognizedAmount: true },
    }),
    db.invoice.findMany({
      where: { tenantId, ...REVENUE_RECOGNIZED, issueDate: { gte: range.start, lt: range.end } },
      select: { issueDate: true, total: true },
    }),
    db.document.findMany({
      where: {
        tenantId,
        deletedAt: null,
        documentType: "EXPENSE",
        recognizedDate: { gte: range.start, lt: range.end },
      },
      select: { recognizedDate: true, recognizedAmount: true },
    }),
    db.bankTransaction.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { _all: true },
    }),
    db.invoice.findMany({
      where: { tenantId },
      take: 8,
      orderBy: { createdAt: "desc" },
      include: { contact: { select: { name: true } } },
    }),
    db.auditLog.findMany({
      where: {
        tenantId,
        action: {
          in: [
            "INVOICE_CREATED",
            "INVOICE_SENT",
            "INVOICE_PAID",
            "INVOICE_CANCELLED",
            "CLIENT_CREATED",
            "CONTACT_CREATED",
            "DOCUMENT_PAID",
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    }),
    db.companySettings.findUnique({
      where: { tenantId },
      select: { name: true, address: true, zip: true, city: true, taxId: true, vatId: true },
    }),
    db.contact.count({ where: { tenantId } }),
    db.invoice.count({ where: { tenantId } }),
    db.document.count({ where: { tenantId, deletedAt: null } }),
  ]);

  // Verknüpfte Steuerberater fürs Dashboard-Karten-Mirror. Klein gehalten
  // (nur die Felder, die die Karte rendert) — der Rest lebt unter /taxes.
  const linkedAccountantsRaw = await db.tenantUser.findMany({
    where: { tenantId, role: "ACCOUNTANT" },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, mustChangePassword: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const linkedAccountants = linkedAccountantsRaw.map((m) => ({
    id: m.user.id,
    name: [m.user.firstName, m.user.lastName].filter(Boolean).join(" ") || null,
    email: m.user.email,
    pending: m.user.mustChangePassword,
  }));

  // ─── Onboarding checklist (data-driven completion) ────────────────────
  const checklist: ChecklistData = {
    companyComplete: isCompanyComplete(companySettingsRow),
    hasContact: contactCount > 0,
    hasInvoice: invoiceTotalCount > 0,
    hasDocument: documentCount > 0,
  };

  // ─── Derive KPIs ──────────────────────────────────────────────────────
  const revenuePeriod = Number(revenuePeriodAgg._sum.total ?? 0);
  const revenuePrev = Number(revenuePrevAgg._sum.total ?? 0);
  const expensePeriod = expensePeriodDocs.reduce(
    (s, d) => s + Number(d.recognizedAmount ?? 0),
    0,
  );
  const expensePrev = Number(expensePrevAgg._sum.recognizedAmount ?? 0);
  const profitPeriod = revenuePeriod - expensePeriod;
  const profitPrev = revenuePrev - expensePrev;

  // Percentage delta vs previous period. Returns null when the previous
  // value is 0 — "infinite growth" isn't a useful chart label, and the
  // UI prefers "—" to a misleading "+999%".
  const revenueDelta = revenuePrev > 0 ? ((revenuePeriod - revenuePrev) / revenuePrev) * 100 : null;
  const profitDelta =
    profitPrev !== 0 ? ((profitPeriod - profitPrev) / Math.abs(profitPrev)) * 100 : null;

  // ─── Chart series (filled-area Ertrag/Aufwand) ────────────────────────
  const incomeByBucket = new Array(buckets.length).fill(0) as number[];
  const expenseByBucket = new Array(buckets.length).fill(0) as number[];
  for (const inv of chartInvoices) {
    const i = bucketIndex(buckets, new Date(inv.issueDate), range.end);
    if (i >= 0) incomeByBucket[i] += Number(inv.total);
  }
  for (const doc of chartExpenses) {
    if (!doc.recognizedDate) continue;
    const i = bucketIndex(buckets, new Date(doc.recognizedDate), range.end);
    if (i >= 0) expenseByBucket[i] += Number(doc.recognizedAmount ?? 0);
  }

  // ─── Buchhaltungsscore ───────────────────────────────────────────────
  let txMatched = 0;
  let txIgnored = 0;
  let txTotal = 0;
  for (const row of txStatusCounts) {
    const n = row._count._all;
    txTotal += n;
    if (row.status === "MATCHED") txMatched += n;
    if (row.status === "IGNORED") txIgnored += n;
  }
  // n=0 → perfect score (nothing to do). Otherwise round to integer.
  const accountingScore = txTotal === 0 ? 100 : Math.round(((txMatched + txIgnored) / txTotal) * 100);

  const userMeta = await db.user.findUnique({ where: { id: t.userId }, select: { firstName: true } });
  const firstName = userMeta?.firstName ?? null;

  // ─── Quote KPIs (period-independent snapshot) ────────────────────────
  // Three numbers that the user wants to see at a glance:
  //   • offene Angebote — SENT, not yet expired, not converted
  //   • Akzeptanzquote (letzte 30 Tage) — % of resolved quotes (ACCEPTED
  //     vs REJECTED/EXPIRED) issued in the last 30 days
  //   • bald ablaufend — SENT with validUntil within next 7 days
  // Computed in parallel to the existing dashboard queries; cheap because
  // every filter hits indexes (tenantId+status / issueDate).
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 86400000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

  const [
    quotesOpenAgg,
    quotesExpiringSoon,
    quotesResolvedLast30,
  ] = await Promise.all([
    db.quote.aggregate({
      where: {
        tenantId,
        status: "SENT",
        convertedAt: null,
        OR: [{ validUntil: null }, { validUntil: { gte: now } }],
      },
      _sum: { total: true },
      _count: true,
    }),
    db.quote.count({
      where: {
        tenantId,
        status: "SENT",
        convertedAt: null,
        validUntil: { gte: now, lte: sevenDaysFromNow },
      },
    }),
    db.quote.groupBy({
      by: ["status"],
      where: {
        tenantId,
        issueDate: { gte: thirtyDaysAgo },
        status: { in: ["ACCEPTED", "REJECTED", "EXPIRED"] },
      },
      _count: { _all: true },
    }),
  ]);

  const resolvedCount = quotesResolvedLast30.reduce((s, r) => s + r._count._all, 0);
  const acceptedCount = quotesResolvedLast30.find((r) => r.status === "ACCEPTED")?._count._all ?? 0;
  // Null when there's nothing to compute a rate from — UI shows a placeholder.
  const acceptanceRate30d = resolvedCount > 0 ? Math.round((acceptedCount / resolvedCount) * 100) : null;

  // ─── Cash-Flow-Prognose ──────────────────────────────────────────────
  // Drei Quellen für den regelbasierten Forecast: aktueller Kontostand
  // (Opening-Balance + alle nicht-ignorierten Buchungen), die jüngsten
  // Transaktionen für die Ist-Linie, offene Forderungen als bekannte
  // Eingänge, und Ausgabenbelege der letzten 90 Tage für die
  // Wiederkehr-Erkennung. Alles parallel; die Berechnung selbst ist rein.
  const cashflowHistoryStart = new Date(now.getTime() - HISTORY_DAYS * 86400000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);

  const [
    bankAccounts,
    bankTxSumAgg,
    recentBankTx,
    openInvoicesRaw,
    expenseDocsRaw,
  ] = await Promise.all([
    db.bankAccount.findMany({
      where: { tenantId, isActive: true },
      select: { openingBalance: true },
    }),
    db.bankTransaction.aggregate({
      where: { tenantId, status: { not: "IGNORED" } },
      _sum: { amount: true },
    }),
    db.bankTransaction.findMany({
      where: { tenantId, status: { not: "IGNORED" }, date: { gte: cashflowHistoryStart } },
      select: { date: true, amount: true },
    }),
    db.invoice.findMany({
      where: {
        tenantId,
        status: { in: ["SENT", "OVERDUE"] },
        type: { in: ["INVOICE", "CORRECTION"] },
      },
      select: { total: true, dueDate: true, status: true },
    }),
    db.document.findMany({
      where: {
        tenantId,
        deletedAt: null,
        documentType: "EXPENSE",
        recognizedDate: { gte: ninetyDaysAgo },
        recognizedAmount: { not: null },
      },
      select: {
        recognizedDate: true,
        recognizedAmount: true,
        recognizedSupplier: true,
        contactId: true,
        contact: { select: { name: true } },
      },
    }),
  ]);

  const openingBalanceSum = bankAccounts.reduce((s, a) => s + Number(a.openingBalance), 0);
  const currentBalance = openingBalanceSum + Number(bankTxSumAgg._sum.amount ?? 0);

  const openInvoiceInputs: OpenInvoiceInput[] = openInvoicesRaw.map((inv) => ({
    total: Number(inv.total),
    dueDate: inv.dueDate,
    overdue: inv.status === "OVERDUE",
  }));

  const expenseDocInputs: ExpenseDocInput[] = expenseDocsRaw
    .filter((d) => d.recognizedDate != null)
    .map((d) => ({
      date: d.recognizedDate as Date,
      amount: Number(d.recognizedAmount ?? 0),
      // contactId ist der stabilste Lieferantenschlüssel; OCR-Freitext nur
      // als Fallback, normalisiert, damit "Stadtwerke " und "stadtwerke"
      // dieselbe Gruppe bilden.
      supplierKey: d.contactId ?? (d.recognizedSupplier ?? "").trim().toLowerCase() ?? "",
      supplierName: d.contact?.name ?? d.recognizedSupplier ?? "—",
    }))
    .filter((d) => d.supplierKey !== "");

  const cashflow = buildCashflowForecast({
    currentBalance,
    recentTx: recentBankTx.map((t) => ({ date: t.date, amount: Number(t.amount) })),
    openInvoices: openInvoiceInputs,
    expenseDocs: expenseDocInputs,
    hasAccounts: bankAccounts.length > 0,
    now,
  });

  return (
    <DashboardView
      locale={locale}
      firstName={firstName}
      period={period}
      checklist={checklist}
      kpis={{
        openCount,
        overdueCount,
        draftCount,
        revenuePeriod,
        revenueDelta,
        expensePeriod,
        profitPeriod,
        profitDelta,
      }}
      receivables={{
        openCount: sentReceivables._count,
        openTotal: Number(sentReceivables._sum.total ?? 0),
        overdueCount: overdueReceivables._count,
        overdueTotal: Number(overdueReceivables._sum.total ?? 0),
      }}
      quoteKpis={{
        openCount: quotesOpenAgg._count,
        openTotal: Number(quotesOpenAgg._sum.total ?? 0),
        expiringSoonCount: quotesExpiringSoon,
        acceptanceRate30d,
      }}
      accountingScore={{
        score: accountingScore,
        total: txTotal,
        unmatched: txTotal - txMatched - txIgnored,
      }}
      chart={{
        granularity,
        buckets: buckets.map((b) => b.toISOString()),
        income: incomeByBucket,
        expense: expenseByBucket,
      }}
      cashflow={cashflow}
      linkedAccountants={linkedAccountants}
      showOnboarding={t.tenantRole !== "ACCOUNTANT"}
      recentInvoices={recentInvoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        clientName: inv.contact.name,
        status: inv.status,
        total: Number(inv.total),
        issueDate: inv.issueDate.toISOString(),
      }))}
      activity={auditEntries.map((e) => ({
        id: e.id,
        action: e.action,
        entityType: e.entityType,
        createdAt: e.createdAt.toISOString(),
        user: e.user
          ? {
              firstName: e.user.firstName,
              lastName: e.user.lastName,
              email: e.user.email,
            }
          : null,
      }))}
    />
  );
}
