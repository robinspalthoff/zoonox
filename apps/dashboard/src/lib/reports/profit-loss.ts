// Shared aggregation logic for the profit/loss report.
// Used by both the dashboard page and the PDF export route so the UI and the
// downloadable document can never disagree.

import { db } from "@/lib/db";
import { classifyAccount } from "@/lib/journal/accounts";
import { isOrphanSource, loadLiveSourceIds } from "@/lib/journal/orphan-guard";
import { getSkrAccount } from "@/lib/skr-accounts";
import type { SkrType } from "@prisma/client";
import type { SourceItem } from "./source-item";

export type ProfitLossMethod = "EUR" | "GUV";

export type ProfitLossInput = {
  tenantId: string;
  from: Date;
  to: Date;
  method: ProfitLossMethod;
  skrType: SkrType;
};

export type ProfitLossResult = {
  method: ProfitLossMethod;
  from: Date;
  to: Date;
  incomeBuckets: Map<string, number>;
  expenseBuckets: Map<string, number>;
  // Sources per SKR group — keys are the same group identifiers used by
  // skrAccounts.groups.* (e.g. "raumkosten", "fahrzeugkosten"). Each list
  // is the set of underlying invoices / documents / journal entries that
  // contributed to that group's total in this period.
  incomeSourcesByGroup: Map<string, SourceItem[]>;
  expenseSourcesByGroup: Map<string, SourceItem[]>;
  incomeTotal: number;
  expenseTotal: number;
  result: number;
  margin: number;
  salesVat: number;
  inputVat: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function groupKeyOf(accountCode: string, skrType: SkrType): string {
  return getSkrAccount(accountCode, skrType)?.group ?? "other";
}

function pushSource(
  map: Map<string, SourceItem[]>,
  groupKey: string,
  item: SourceItem,
) {
  const arr = map.get(groupKey);
  if (arr) arr.push(item);
  else map.set(groupKey, [item]);
}

// Merge multiple postings against the same source (e.g. several expense
// accounts on one document) into a single SourceItem per (kind, id, group).
// Without this, opening the popup on "Raumkosten" for an invoice that hits
// both rent (4210) and ancillary costs (4230) would list the same invoice
// twice. We dedupe by (kind, id, group) and sum net/vat.
function mergeSourcesPerGroup(
  raw: Map<string, SourceItem[]>,
): Map<string, SourceItem[]> {
  const out = new Map<string, SourceItem[]>();
  for (const [groupKey, items] of raw) {
    const byKey = new Map<string, SourceItem>();
    for (const it of items) {
      const k = `${it.kind}:${it.id}`;
      const existing = byKey.get(k);
      if (existing) {
        existing.net += it.net;
        existing.vat += it.vat;
      } else {
        // shallow copy so we don't mutate caller-owned objects
        byKey.set(k, { ...it });
      }
    }
    out.set(groupKey, [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date)));
  }
  return out;
}

// ── Main aggregator ────────────────────────────────────────────────────────

export async function computeProfitLoss(input: ProfitLossInput): Promise<ProfitLossResult> {
  const { tenantId, from, to, method, skrType } = input;

  const sourceTypes =
    method === "EUR"
      ? (["INVOICE_PAYMENT", "DOCUMENT_PAYMENT"] as const)
      : (["INVOICE", "DOCUMENT"] as const);

  // Orphan guard: skip journal lines whose source has been wiped from
  // the DB. Centralised in `lib/journal/orphan-guard` so P&L, BWA,
  // UStVA and DATEV export apply the exact same rule. See that module
  // for the GoBD reasoning.
  const liveSources = await loadLiveSourceIds(tenantId);

  // Note: we now always include the entry metadata, because we need it to
  // build SourceItem entries for the popup. The previous version only
  // selected accountCode/debit/credit; the extra columns are cheap.
  const lines = await db.journalLine.findMany({
    where: {
      entry: {
        tenantId,
        date: { gte: from, lte: to },
        sourceType: { in: [...sourceTypes] },
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
  });

  const incomeBuckets = new Map<string, number>();
  const expenseBuckets = new Map<string, number>();
  // Raw, per-line — we collapse duplicates at the end.
  const incomeSourcesRaw = new Map<string, SourceItem[]>();
  const expenseSourcesRaw = new Map<string, SourceItem[]>();

  // Resolve labels for invoices/documents up-front so each SourceItem can
  // present a friendly name. Done after the loop so we know which IDs we
  // actually touched (avoids loading anything we don't need).
  const touchedInvoiceIds = new Set<string>();
  const touchedDocumentIds = new Set<string>();

  if (method === "GUV") {
    // ── Accrual basis: one journal line == one signed contribution. ─────
    for (const l of lines) {
      const e = l.entry;
      // Defensive: skip journal lines whose source has been wiped from
      // the DB (orphan guard — see top of function).
      if (isOrphanSource(liveSources, e.sourceType, e.sourceId)) continue;
      const cls = classifyAccount(l.accountCode, skrType);
      if (cls === "REVENUE") {
        const net = Number(l.credit) - Number(l.debit);
        if (Math.abs(net) < 0.005) continue;
        incomeBuckets.set(l.accountCode, (incomeBuckets.get(l.accountCode) ?? 0) + net);
        const groupKey = groupKeyOf(l.accountCode, skrType);
        pushSource(incomeSourcesRaw, groupKey, makeStubSource(e, net));
        if (e.sourceType === "INVOICE" && e.sourceId) touchedInvoiceIds.add(e.sourceId);
        if (e.sourceType === "DOCUMENT" && e.sourceId) touchedDocumentIds.add(e.sourceId);
      } else if (cls === "EXPENSE") {
        const net = Number(l.debit) - Number(l.credit);
        if (Math.abs(net) < 0.005) continue;
        expenseBuckets.set(l.accountCode, (expenseBuckets.get(l.accountCode) ?? 0) + net);
        const groupKey = groupKeyOf(l.accountCode, skrType);
        pushSource(expenseSourcesRaw, groupKey, makeStubSource(e, net));
        if (e.sourceType === "INVOICE" && e.sourceId) touchedInvoiceIds.add(e.sourceId);
        if (e.sourceType === "DOCUMENT" && e.sourceId) touchedDocumentIds.add(e.sourceId);
      }
    }
  } else {
    // ── Cash basis (EÜR): paid amounts decomposed against original bookings.
    // Same algorithm as before, but additionally we now record sources per
    // group, scaled by the same `ratio` we use for the bucket totals so the
    // popup numbers match the headline figures.
    const payLines = await db.journalLine.findMany({
      where: {
        entry: {
          tenantId,
          date: { gte: from, lte: to },
          sourceType: { in: ["INVOICE_PAYMENT", "DOCUMENT_PAYMENT"] },
        },
      },
      include: { entry: { select: { sourceType: true, sourceId: true } } },
    });

    const paidGross = new Map<string, number>();
    for (const l of payLines) {
      const cls = classifyAccount(l.accountCode, skrType);
      if (cls !== "BANK") continue;
      const sourceId = l.entry.sourceId;
      if (!sourceId) continue;
      // Orphan guard — see top of function. Drop payment lines whose
      // invoice/document no longer exists so they don't drag phantom
      // bookings into the cash-basis decomposition.
      if (isOrphanSource(liveSources, l.entry.sourceType, sourceId)) continue;
      const key = `${l.entry.sourceType}:${sourceId}`;
      const signed =
        l.entry.sourceType === "INVOICE_PAYMENT"
          ? Number(l.debit) - Number(l.credit)
          : Number(l.credit) - Number(l.debit);
      paidGross.set(key, (paidGross.get(key) ?? 0) + signed);
    }

    const sourceKeys = [...paidGross.keys()];
    const invoiceIds = sourceKeys
      .filter((k) => k.startsWith("INVOICE_PAYMENT:"))
      .map((k) => k.slice("INVOICE_PAYMENT:".length));
    const documentIds = sourceKeys
      .filter((k) => k.startsWith("DOCUMENT_PAYMENT:"))
      .map((k) => k.slice("DOCUMENT_PAYMENT:".length));

    async function loadBookings(sourceType: "INVOICE" | "DOCUMENT", ids: string[]) {
      if (!ids.length) return [];
      return db.journalEntry.findMany({
        where: { tenantId, sourceType, sourceId: { in: ids } },
        include: { lines: true },
      });
    }
    const [invoiceBookings, documentBookings] = await Promise.all([
      loadBookings("INVOICE", invoiceIds),
      loadBookings("DOCUMENT", documentIds),
    ]);

    function decompose(
      entries: typeof invoiceBookings,
      paymentKeyPrefix: "INVOICE_PAYMENT" | "DOCUMENT_PAYMENT",
      into: Map<string, number>,
      sourcesInto: Map<string, SourceItem[]>,
      direction: "income" | "expense",
    ) {
      const entriesBySource = new Map<string, typeof entries>();
      for (const e of entries) {
        if (!e.sourceId) continue;
        const arr = entriesBySource.get(e.sourceId) ?? [];
        arr.push(e);
        entriesBySource.set(e.sourceId, arr);
      }
      for (const [sourceId, group] of entriesBySource) {
        const key = `${paymentKeyPrefix}:${sourceId}`;
        const paidGrossAbs = Math.abs(paidGross.get(key) ?? 0);
        if (paidGrossAbs < 0.005) continue;

        let bookedNet = 0;
        let bookedGross = 0;
        const perAccount: Array<{ code: string; net: number }> = [];
        // We need a reference entry to attach the source to (date, number,
        // sourceType, sourceId). Any entry from the group works — they all
        // share the same source — so just pick the first.
        const refEntry = group[0];
        for (const entry of group) {
          for (const l of entry.lines) {
            const cls = classifyAccount(l.accountCode, skrType);
            if (direction === "income" && cls === "REVENUE") {
              const n = Number(l.credit) - Number(l.debit);
              if (n !== 0) {
                bookedNet += n;
                perAccount.push({ code: l.accountCode, net: n });
              }
            } else if (direction === "expense" && cls === "EXPENSE") {
              const n = Number(l.debit) - Number(l.credit);
              if (n !== 0) {
                bookedNet += n;
                perAccount.push({ code: l.accountCode, net: n });
              }
            } else if (direction === "income" && cls === "RECEIVABLE") {
              bookedGross += Number(l.debit) - Number(l.credit);
            } else if (direction === "expense" && cls === "PAYABLE") {
              bookedGross += Number(l.credit) - Number(l.debit);
            }
          }
        }
        if (perAccount.length === 0 || bookedNet === 0) continue;
        if (Math.abs(bookedGross) < 0.005) bookedGross = bookedNet;
        const ratio = paidGrossAbs / Math.abs(bookedGross);

        // Track for label hydration below.
        if (refEntry.sourceType === "INVOICE" && refEntry.sourceId) {
          touchedInvoiceIds.add(refEntry.sourceId);
        } else if (refEntry.sourceType === "DOCUMENT" && refEntry.sourceId) {
          touchedDocumentIds.add(refEntry.sourceId);
        }

        for (const a of perAccount) {
          const scaledNet = a.net * ratio;
          into.set(a.code, (into.get(a.code) ?? 0) + scaledNet);
          const groupKey = groupKeyOf(a.code, skrType);
          pushSource(sourcesInto, groupKey, makeStubSource(refEntry, scaledNet));
        }
      }
    }

    decompose(invoiceBookings, "INVOICE_PAYMENT", incomeBuckets, incomeSourcesRaw, "income");
    decompose(documentBookings, "DOCUMENT_PAYMENT", expenseBuckets, expenseSourcesRaw, "expense");
  }

  // ── Hydrate friendly labels ─────────────────────────────────────────────
  const [invoicesMap, documentsMap] = await Promise.all([
    touchedInvoiceIds.size
      ? db.invoice
          .findMany({
            where: { tenantId, id: { in: [...touchedInvoiceIds] } },
            select: { id: true, number: true, contact: { select: { name: true } } },
          })
          .then((rs) => new Map(rs.map((r) => [r.id, r])))
      : Promise.resolve(new Map()),
    touchedDocumentIds.size
      ? db.document
          .findMany({
            where: { tenantId, id: { in: [...touchedDocumentIds] } },
            select: {
              id: true,
              documentNumber: true,
              recognizedSupplier: true,
              fileName: true,
            },
          })
          .then((rs) => new Map(rs.map((r) => [r.id, r])))
      : Promise.resolve(new Map()),
  ]);

  function hydrate(map: Map<string, SourceItem[]>) {
    for (const items of map.values()) {
      for (const it of items) {
        if (it.kind === "invoice") {
          const inv = invoicesMap.get(it.id);
          if (inv) {
            it.label = inv.number ?? it.label;
            it.secondary = inv.contact?.name ?? null;
          }
        } else if (it.kind === "document") {
          const doc = documentsMap.get(it.id);
          if (doc) {
            it.label =
              doc.documentNumber || doc.recognizedSupplier || doc.fileName || it.label;
            it.secondary = doc.documentNumber ? doc.recognizedSupplier ?? null : null;
          }
        }
      }
    }
  }
  hydrate(incomeSourcesRaw);
  hydrate(expenseSourcesRaw);

  const incomeSourcesByGroup = mergeSourcesPerGroup(incomeSourcesRaw);
  const expenseSourcesByGroup = mergeSourcesPerGroup(expenseSourcesRaw);

  // VAT saldo (supplementary context) — derived from the booking journal
  // regardless of method, since USt becomes due on invoicing (§13 UStG).
  const vatLines = await db.journalLine.findMany({
    where: {
      vatCode: { not: null },
      entry: {
        tenantId,
        date: { gte: from, lte: to },
        sourceType: { in: ["INVOICE", "DOCUMENT"] },
      },
    },
    // Pull entry source info too so the orphan guard can apply here
    // — otherwise the VAT block would still surface phantom Vorsteuer
    // from deleted documents even after the buckets are clean.
    select: {
      vatCode: true,
      debit: true,
      credit: true,
      entry: { select: { sourceType: true, sourceId: true } },
    },
  });
  let salesVat = 0;
  let inputVat = 0;
  for (const l of vatLines) {
    if (!l.vatCode) continue;
    if (isOrphanSource(liveSources, l.entry.sourceType, l.entry.sourceId)) continue;
    if (l.vatCode.startsWith("USt")) salesVat += Number(l.credit) - Number(l.debit);
    else if (l.vatCode.startsWith("VSt")) inputVat += Number(l.debit) - Number(l.credit);
  }

  const incomeTotal = [...incomeBuckets.values()].reduce((s, v) => s + v, 0);
  const expenseTotal = [...expenseBuckets.values()].reduce((s, v) => s + v, 0);
  const result = incomeTotal - expenseTotal;
  const margin = incomeTotal > 0 ? result / incomeTotal : 0;

  return {
    method,
    from,
    to,
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
  };
}

// ── Stub builder ────────────────────────────────────────────────────────────

type EntryRef = {
  id: string;
  number: number;
  date: Date;
  description: string;
  sourceType: string;
  sourceId: string | null;
};

// Builds a SourceItem from a journal entry reference. Labels are stub values;
// the caller hydrates invoice/document specifics in a second pass to keep DB
// access batched. `vat` is left at 0 here — the P/L view doesn't display VAT
// per source line (that's the UStVA's job), and pulling tax data per item
// would mean re-walking every entry.
function makeStubSource(e: EntryRef, net: number): SourceItem {
  if (e.sourceType === "INVOICE" && e.sourceId) {
    return {
      kind: "invoice",
      id: e.sourceId,
      label: e.description,
      secondary: null,
      date: e.date.toISOString(),
      net,
      vat: 0,
      href: `/dashboard/invoices/${e.sourceId}`,
    };
  }
  if (e.sourceType === "DOCUMENT" && e.sourceId) {
    return {
      kind: "document",
      id: e.sourceId,
      label: e.description,
      secondary: null,
      date: e.date.toISOString(),
      net,
      vat: 0,
      href: `/dashboard/documents/${e.sourceId}`,
    };
  }
  return {
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