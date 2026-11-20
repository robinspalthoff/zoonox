/**
 * Cleanup duplicate journal entries — GoBD-konform via Storno.
 *
 * Unlike `cleanup-orphan-journal-entries.ts`, here the underlying
 * Invoice / Document IS still live in the DB. The journal must
 * preserve its audit trail (§147 AO), so we don't hard-delete: we
 * issue proper storno entries for the extras (just like the regular
 * reversal path) and leave the FIRST POSTED entry per source as the
 * canonical booking.
 *
 * What the script does, per duplicate group (live source with >1
 * POSTED journal entries of the same sourceType):
 *
 *   1. Sort by `number` ascending. Keep entry #1 as canonical.
 *   2. For entries #2..N, write a mirror storno via the same code
 *      path the regular delete flow uses (`reverseEntriesForSource`
 *      semantics, but applied per-entry).
 *   3. Audit-log the operation so the cleanup itself is auditable.
 *
 * Net effect on P&L / BWA / UStVA: the duplicates and their storni
 * cancel out, leaving the single canonical posting. Identical to what
 * the regular GoBD reversal would have produced if it had been issued
 * at the time the duplicate appeared.
 *
 * Run:
 *   npx tsx apps/dashboard/scripts/cleanup-duplicate-journal-entries.ts
 *   npx tsx apps/dashboard/scripts/cleanup-duplicate-journal-entries.ts --apply
 *   npx tsx apps/dashboard/scripts/cleanup-duplicate-journal-entries.ts --apply --tenant=<id>
 */

import { db } from "../src/lib/db";
import type {
  JournalEntry,
  JournalLine,
  JournalSourceType,
} from "@prisma/client";

type DupGroup = {
  tenantId: string;
  sourceType: JournalSourceType;
  sourceId: string;
  sourceLabel: string;
  postedEntries: (JournalEntry & { lines: JournalLine[] })[];
};

async function findDuplicates(tenantFilter: string | null): Promise<DupGroup[]> {
  const where = tenantFilter ? { tenantId: tenantFilter } : {};

  const [entries, invoices, documents] = await Promise.all([
    db.journalEntry.findMany({
      where: {
        ...where,
        status: "POSTED",
        // Filter out storno entries (reverses non-empty). They are POSTED
        // by design but exist to neutralise an original — never treat
        // them as duplicate candidates, otherwise the script loops.
        reverses: { none: {} },
        // Defensive: filter out anything that's been reversed too.
        reversedById: null,
        sourceType: {
          in: ["INVOICE", "INVOICE_PAYMENT", "DOCUMENT", "DOCUMENT_PAYMENT"],
        },
        sourceId: { not: null },
      },
      include: { lines: { orderBy: { position: "asc" } } },
      orderBy: { number: "asc" },
    }),
    db.invoice.findMany({ where, select: { id: true, number: true } }),
    db.document.findMany({
      where,
      select: { id: true, documentNumber: true, fileName: true, deletedAt: true },
    }),
  ]);

  const liveInvoices = new Map(invoices.map((i) => [i.id, i]));
  const liveDocuments = new Map(documents.map((d) => [d.id, d]));

  const grouped = new Map<string, DupGroup>();
  for (const e of entries) {
    if (!e.sourceId) continue;
    let label = e.sourceId;
    switch (e.sourceType) {
      case "INVOICE":
      case "INVOICE_PAYMENT": {
        const inv = liveInvoices.get(e.sourceId);
        if (!inv) continue;
        label = inv.number;
        break;
      }
      case "DOCUMENT":
      case "DOCUMENT_PAYMENT": {
        const doc = liveDocuments.get(e.sourceId);
        if (!doc || doc.deletedAt) continue;
        label = doc.documentNumber || doc.fileName || e.sourceId;
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
        postedEntries: [],
      };
      grouped.set(key, g);
    }
    g.postedEntries.push(e);
  }

  return [...grouped.values()].filter((g) => g.postedEntries.length > 1);
}

async function nextJournalNumber(tenantId: string): Promise<number> {
  const seq = await db.journalSequence.upsert({
    where: { tenantId },
    create: { tenantId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return seq.lastNumber;
}

/**
 * Mirror-storno per duplicate entry. Mirrors the logic of
 * `reverseEntriesForSource` in lib/journal/post.ts, but inlined here
 * so this script doesn't depend on a dynamic import of the runtime
 * journal module. Same shape, same outcome.
 */
async function stornoDuplicate(
  orig: JournalEntry & { lines: JournalLine[] },
): Promise<void> {
  await db.$transaction(async (tx) => {
    const number = await tx.journalSequence
      .upsert({
        where: { tenantId: orig.tenantId },
        create: { tenantId: orig.tenantId, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      })
      .then((s) => s.lastNumber);

    const reversal = await tx.journalEntry.create({
      data: {
        tenantId: orig.tenantId,
        number,
        date: new Date(),
        description: `Storno #${orig.number}: Duplikat (Cleanup)`,
        sourceType: orig.sourceType,
        sourceId: orig.sourceId,
        createdById: null,
        lines: {
          create: orig.lines.map((l, i) => ({
            position: i,
            accountCode: l.accountCode,
            // Swap debit and credit — mirror booking.
            debit: Number(l.credit),
            credit: Number(l.debit),
            vatCode: l.vatCode,
            vatAmount: l.vatAmount != null ? -Number(l.vatAmount) : null,
            description: l.description,
          })),
        },
      },
    });

    await tx.journalEntry.update({
      where: { id: orig.id },
      data: {
        status: "REVERSED",
        reversedById: reversal.id,
        reversedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: orig.tenantId,
        userId: null,
        action: "SETTINGS_CHANGED",
        entityType: "JournalEntry",
        entityId: orig.id,
        details: {
          kind: "duplicate-journal-storno",
          original: {
            id: orig.id,
            number: orig.number,
            sourceType: orig.sourceType,
            sourceId: orig.sourceId,
          },
          storno: { id: reversal.id, number: reversal.number },
          note:
            "Storno einer doppelten POSTED-Buchung. Quelle existiert weiter; " +
            "Originalbuchung bleibt mit status=REVERSED erhalten.",
        },
      },
    });
  });
  void nextJournalNumber; // kept for clarity / future refactor
}

function fmtCur(n: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

function netOf(e: JournalEntry & { lines: JournalLine[] }): number {
  let debit = 0;
  let credit = 0;
  for (const l of e.lines) {
    debit += Number(l.debit);
    credit += Number(l.credit);
  }
  return Math.max(debit, credit);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const tenantArg = process.argv.find((a) => a.startsWith("--tenant="));
  const tenantFilter = tenantArg ? tenantArg.slice("--tenant=".length) : null;

  const groups = await findDuplicates(tenantFilter);
  if (groups.length === 0) {
    console.log("Keine Mehrfach-Buchungen gefunden.");
    await db.$disconnect();
    return;
  }

  let totalStorni = 0;
  let totalAmount = 0;

  for (const g of groups) {
    const sorted = [...g.postedEntries].sort((a, b) => a.number - b.number);
    const canonical = sorted[0];
    const dupes = sorted.slice(1);
    totalStorni += dupes.length;
    totalAmount += dupes.reduce((s, e) => s + netOf(e), 0);

    console.log("─".repeat(100));
    console.log(`[${g.sourceType}] ${g.sourceLabel}  ·  Quelle ${g.sourceId}`);
    console.log(
      `  → Behalte #${canonical.number} (${fmtCur(netOf(canonical))})`,
    );
    for (const d of dupes) {
      console.log(
        `  → Storno   #${String(d.number).padStart(4, "0")}  ${fmtCur(
          netOf(d),
        )}  ${d.description}`,
      );
    }
  }

  console.log("\n" + "─".repeat(100));
  console.log(
    `${totalStorni} Duplikate über ${groups.length} Quellen · Brutto ${fmtCur(totalAmount)}`,
  );

  if (!apply) {
    console.log("\nDry-Run — nichts geschrieben. Mit --apply ausführen.");
    await db.$disconnect();
    return;
  }

  console.log("\n--apply aktiv. Storniere Duplikate…");
  for (const g of groups) {
    const sorted = [...g.postedEntries].sort((a, b) => a.number - b.number);
    const dupes = sorted.slice(1);
    for (const d of dupes) {
      await stornoDuplicate(d);
    }
  }
  console.log("Fertig.");
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
