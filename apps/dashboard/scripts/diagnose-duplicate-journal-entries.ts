/**
 * Diagnose duplicate journal entries.
 *
 * A second class of journal pathology that's invisible to the
 * orphan-only diagnostic: a LIVE invoice or document carries MULTIPLE
 * POSTED journal entries for the same (sourceType, sourceId) pair.
 *
 * Cause: `recordInvoiceIssued` / `recordInvoicePaid` (and their
 * document counterparts) are not idempotent. The callers
 * (updateInvoiceStatus, sendInvoiceEmail, bank-match action) each
 * apply their own guard ("only on first finalization"), but those
 * guards rely on status/finalizedAt being honest. If the row was
 * mutated outside the GoBD flow (raw SQL, Prisma Studio, an early
 * bug), the guard fails open and a second posting lands.
 *
 * Symptom in reports: revenue / expense for the affected source
 * multiplies by the number of duplicate postings. This is what
 * produced the user's "RE-2026-001 shows 15.000 € instead of
 * 3.000 €" — five POSTED INVOICE entries for the same invoice ID,
 * each carrying the full 3.000 € revenue line, scaled in EUR mode
 * by ratio but summing back to 5× in the source-merge view.
 *
 * Output: groups every live source that has > 1 POSTED entry of the
 * same sourceType, lists those entries, and computes the multiplier.
 *
 * Run:
 *   npx tsx apps/dashboard/scripts/diagnose-duplicate-journal-entries.ts
 *   npx tsx apps/dashboard/scripts/diagnose-duplicate-journal-entries.ts --tenant=<id>
 */

import { db } from "../src/lib/db";

type EntryRow = {
  id: string;
  number: number;
  date: Date;
  status: string;
  reversedById: string | null;
  description: string;
  net: number;
};

type Group = {
  tenantId: string;
  sourceType: string;
  sourceId: string;
  sourceLabel: string;
  posted: EntryRow[];
  reversed: EntryRow[];
  netSum: number;
};

async function findDuplicates(tenantFilter: string | null): Promise<Group[]> {
  const where = tenantFilter ? { tenantId: tenantFilter } : {};

  const [entries, invoices, documents] = await Promise.all([
    db.journalEntry.findMany({
      where: {
        ...where,
        sourceType: {
          in: ["INVOICE", "INVOICE_PAYMENT", "DOCUMENT", "DOCUMENT_PAYMENT"],
        },
        sourceId: { not: null },
      },
      include: { lines: true, reverses: { select: { id: true } } },
      orderBy: { number: "asc" },
    }),
    db.invoice.findMany({
      where,
      select: { id: true, number: true, type: true, total: true },
    }),
    db.document.findMany({
      where,
      select: {
        id: true,
        documentNumber: true,
        recognizedSupplier: true,
        fileName: true,
        recognizedAmount: true,
        deletedAt: true,
      },
    }),
  ]);

  const liveInvoices = new Map(invoices.map((i) => [i.id, i]));
  const liveDocuments = new Map(documents.map((d) => [d.id, d]));

  // Group by (tenantId, sourceType, sourceId). We only care about
  // groups where (a) the source is live AND (b) there's >1 entry of
  // the same sourceType in POSTED state. A single POSTED + N REVERSED
  // is the healthy reversal pattern — leave it alone.
  const grouped = new Map<string, Group>();

  for (const e of entries) {
    if (!e.sourceId) continue;
    let label: string;
    switch (e.sourceType) {
      case "INVOICE":
      case "INVOICE_PAYMENT": {
        const inv = liveInvoices.get(e.sourceId);
        if (!inv) continue; // orphan — handled elsewhere
        label = `${inv.number} (${inv.type})${inv.total ? ` · ${inv.total} €` : ""}`;
        break;
      }
      case "DOCUMENT":
      case "DOCUMENT_PAYMENT": {
        const doc = liveDocuments.get(e.sourceId);
        if (!doc || doc.deletedAt) continue;
        label =
          doc.documentNumber ||
          doc.recognizedSupplier ||
          doc.fileName ||
          e.sourceId;
        if (doc.recognizedAmount) label += ` · ${doc.recognizedAmount} €`;
        break;
      }
      default:
        continue;
    }

    const key = `${e.tenantId}::${e.sourceType}::${e.sourceId}`;
    let g = grouped.get(key);
    if (!g) {
      g = {
        tenantId: e.tenantId,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        sourceLabel: label,
        posted: [],
        reversed: [],
        netSum: 0,
      };
      grouped.set(key, g);
    }

    let debit = 0;
    let credit = 0;
    for (const l of e.lines) {
      debit += Number(l.debit);
      credit += Number(l.credit);
    }
    const row: EntryRow = {
      id: e.id,
      number: e.number,
      date: e.date,
      status: e.status,
      reversedById: e.reversedById,
      description: e.description,
      net: Math.max(debit, credit),
    };
    // "Active" = POSTED, not itself a storno (reverses empty), and not
    // reversed by a later storno. Storno entries are POSTED in status
    // by design — without filtering them out, balanced storno chains
    // look like duplicates and the cleanup script would chase its own
    // tail, creating storno-of-storno entries on every run.
    const isStorno = e.reverses.length > 0;
    const isActive = e.status === "POSTED" && !isStorno && e.reversedById === null;
    if (isActive) {
      g.posted.push(row);
      g.netSum += row.net;
    } else {
      g.reversed.push(row);
    }
  }

  // Keep only groups with more than 1 ACTIVE POSTED entry — those are the
  // real duplicates. Balanced reversal chains end up with exactly 1 active
  // posting and any number of REVERSED + storno pairs.
  return [...grouped.values()].filter((g) => g.posted.length > 1);
}

function fmtCur(n: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

async function main() {
  const tenantArg = process.argv.find((a) => a.startsWith("--tenant="));
  const tenantFilter = tenantArg ? tenantArg.slice("--tenant=".length) : null;

  if (tenantFilter) {
    console.log(`Scope: tenant = ${tenantFilter}`);
  } else {
    console.log("Scope: alle Tenants (Filter via --tenant=<id> möglich)");
  }

  const groups = await findDuplicates(tenantFilter);

  if (groups.length === 0) {
    console.log("\nKeine Mehrfach-Buchungen gefunden.");
    await db.$disconnect();
    return;
  }

  console.log(
    `\n${groups.length} Quellen mit Mehrfach-Buchungen (POSTED) gefunden.\n` +
      "Erwartet ist genau EINE POSTED-Buchung pro Quelle (zzgl. ggf. " +
      "REVERSED-Originale aus Storno-Ketten).\n",
  );

  for (const g of groups) {
    const multiplier = g.posted.length;
    console.log("─".repeat(100));
    console.log(
      `[${g.sourceType}] ${g.sourceLabel}  ·  Quelle ${g.sourceId}\n` +
        `  ${multiplier} POSTED-Buchungen, Brutto-Summe ${fmtCur(g.netSum)} ` +
        `(×${multiplier} statt 1)`,
    );
    for (const r of g.posted) {
      console.log(
        `    POSTED   #${String(r.number).padStart(4, "0")}  ${r.date
          .toISOString()
          .slice(0, 10)}  ${fmtCur(r.net).padStart(12)}  ${r.description}`,
      );
    }
    for (const r of g.reversed) {
      console.log(
        `    REVERSED #${String(r.number).padStart(4, "0")}  ${r.date
          .toISOString()
          .slice(0, 10)}  ${fmtCur(r.net).padStart(12)}  ${r.description}`,
      );
    }
  }

  console.log("\n" + "─".repeat(100));
  console.log(
    "\nNächster Schritt: scripts/cleanup-duplicate-journal-entries.ts " +
      "(stornt die Extras GoBD-konform und lässt eine POSTED-Buchung pro Quelle stehen).",
  );

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
