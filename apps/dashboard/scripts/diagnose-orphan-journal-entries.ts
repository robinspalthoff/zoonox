/**
 * Diagnose orphan journal entries.
 *
 * The Invoice/Document → JournalEntry relation is intentionally a soft
 * link (sourceType + sourceId String?) — there is no FK or cascade. As a
 * result, any path that removes an Invoice/Document outside of the
 * GoBD-aware deletion flows (e.g. direct SQL, Prisma Studio, an early
 * `db.invoice.delete()` on a non-DRAFT, or test fixtures) will leave
 * journal entries pointing at IDs that no longer exist. Those orphan
 * entries are still aggregated by the BWA / EÜR / GuV reports, so they
 * inflate revenue and expenses with phantom numbers.
 *
 * This script lists every orphan grouped by tenant + sourceType, with
 * the totals each one contributes per direction (debit/credit). It does
 * NOT delete anything — that's a separate, explicit cleanup step.
 *
 * Run:
 *   npx tsx apps/dashboard/scripts/diagnose-orphan-journal-entries.ts
 *
 * Optional --tenant=<tenantId> to scope to a single workspace.
 */

import { db } from "../src/lib/db";

type Row = {
  id: string;
  tenantId: string;
  number: number;
  date: Date;
  description: string;
  sourceType: string;
  sourceId: string | null;
  status: string;
  net: number;
};

async function findOrphans(tenantFilter: string | null): Promise<{
  orphanInvoiceEntries: Row[];
  orphanInvoicePayments: Row[];
  orphanDocumentEntries: Row[];
  orphanDocumentPayments: Row[];
}> {
  const where = tenantFilter ? { tenantId: tenantFilter } : {};

  // Pull every journal entry that points at an Invoice or Document, then
  // resolve which source IDs still exist with a single batched lookup
  // per source type. Cheaper than a per-row check and works without any
  // schema relationship to lean on.
  const [entries, invoices, documents] = await Promise.all([
    db.journalEntry.findMany({
      where: {
        ...where,
        sourceType: {
          in: ["INVOICE", "INVOICE_PAYMENT", "DOCUMENT", "DOCUMENT_PAYMENT"],
        },
      },
      include: { lines: true },
      orderBy: { date: "asc" },
    }),
    db.invoice.findMany({ where, select: { id: true } }),
    db.document.findMany({ where, select: { id: true } }),
  ]);

  const liveInvoiceIds = new Set(invoices.map((i) => i.id));
  const liveDocumentIds = new Set(documents.map((d) => d.id));

  function netOf(e: (typeof entries)[number]): number {
    // Aggregate by direction — same logic the P&L uses to derive a
    // "value contribution" per entry, ignoring the per-account split.
    let debit = 0;
    let credit = 0;
    for (const l of e.lines) {
      debit += Number(l.debit);
      credit += Number(l.credit);
    }
    return Math.max(debit, credit); // gross-ish — fine for triage
  }

  function toRow(e: (typeof entries)[number]): Row {
    return {
      id: e.id,
      tenantId: e.tenantId,
      number: e.number,
      date: e.date,
      description: e.description,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      status: e.status,
      net: netOf(e),
    };
  }

  const orphanInvoiceEntries: Row[] = [];
  const orphanInvoicePayments: Row[] = [];
  const orphanDocumentEntries: Row[] = [];
  const orphanDocumentPayments: Row[] = [];

  for (const e of entries) {
    if (!e.sourceId) continue;
    switch (e.sourceType) {
      case "INVOICE":
        if (!liveInvoiceIds.has(e.sourceId)) orphanInvoiceEntries.push(toRow(e));
        break;
      case "INVOICE_PAYMENT":
        if (!liveInvoiceIds.has(e.sourceId)) orphanInvoicePayments.push(toRow(e));
        break;
      case "DOCUMENT":
        if (!liveDocumentIds.has(e.sourceId)) orphanDocumentEntries.push(toRow(e));
        break;
      case "DOCUMENT_PAYMENT":
        if (!liveDocumentIds.has(e.sourceId)) orphanDocumentPayments.push(toRow(e));
        break;
    }
  }

  return {
    orphanInvoiceEntries,
    orphanInvoicePayments,
    orphanDocumentEntries,
    orphanDocumentPayments,
  };
}

function fmtCur(n: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

function printSection(label: string, rows: Row[]) {
  if (rows.length === 0) {
    console.log(`\n${label}: keine`);
    return;
  }
  const total = rows.reduce((s, r) => s + r.net, 0);
  console.log(`\n${label}: ${rows.length} Einträge · Brutto-Wert ${fmtCur(total)}`);
  console.log("─".repeat(100));
  for (const r of rows) {
    console.log(
      [
        r.date.toISOString().slice(0, 10),
        `#${String(r.number).padStart(4, "0")}`,
        r.status.padEnd(8),
        r.sourceType.padEnd(17),
        `Quelle ${r.sourceId}`,
        `→ ${fmtCur(r.net)}`,
        r.description,
      ].join("  "),
    );
  }
}

async function main() {
  const tenantArg = process.argv.find((a) => a.startsWith("--tenant="));
  const tenantFilter = tenantArg ? tenantArg.slice("--tenant=".length) : null;

  if (tenantFilter) {
    console.log(`Scope: tenant = ${tenantFilter}`);
  } else {
    console.log("Scope: alle Tenants (Filter via --tenant=<id> möglich)");
  }

  const {
    orphanInvoiceEntries,
    orphanInvoicePayments,
    orphanDocumentEntries,
    orphanDocumentPayments,
  } = await findOrphans(tenantFilter);

  printSection("INVOICE (Forderungs-Buchungen, ohne Source)", orphanInvoiceEntries);
  printSection("INVOICE_PAYMENT (Zahlungen, ohne Source)", orphanInvoicePayments);
  printSection("DOCUMENT (Aufwands-Buchungen, ohne Source)", orphanDocumentEntries);
  printSection("DOCUMENT_PAYMENT (Zahlungen, ohne Source)", orphanDocumentPayments);

  const total =
    orphanInvoiceEntries.length +
    orphanInvoicePayments.length +
    orphanDocumentEntries.length +
    orphanDocumentPayments.length;
  console.log(`\nGesamt: ${total} verwaiste Journal-Einträge`);
  if (total > 0) {
    console.log(
      "\nNächster Schritt: nach Sichtprüfung Cleanup-Skript ausführen oder " +
        "JournalEntries via Prisma Studio gezielt entfernen.",
    );
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
