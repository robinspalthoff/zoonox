/**
 * Cleanup orphan journal entries.
 *
 * "Orphan" here = a `JournalEntry` whose sourceType is INVOICE,
 * INVOICE_PAYMENT, DOCUMENT or DOCUMENT_PAYMENT but whose `sourceId`
 * no longer exists in the corresponding table (or, for documents,
 * has been soft-deleted via the GoBD-aware delete path).
 *
 * --- Is hard-delete GoBD-compliant here? ---
 *
 * GoBD §147 AO requires the retention of **business records** for 10
 * years. The journal entries we delete here are by definition NOT
 * backed by a business record anymore — the underlying Invoice or
 * Document is gone, and never reached a properly-reversed end state
 * (otherwise it would be soft-deleted and the storno chain would
 * already net to zero in the books).
 *
 * Concretely, an orphan can only arise from:
 *   1. A `db.invoice.delete()` on a non-DRAFT, executed via raw SQL,
 *      Prisma Studio, an ill-formed migration, or a developer fixture.
 *   2. A pre-feature codebase that hard-deleted booked records before
 *      the GoBD-aware reversal flow existed.
 *
 * Neither path produces a record we have a legal duty to retain.
 * Their continued presence corrupts the live ledger (P&L, BWA, UStVA,
 * DATEV), which is itself a GoBD problem (Richtigkeit). Cleaning them
 * is the safer of the two options.
 *
 * What this script does NOT delete:
 *   • Soft-deleted documents that still have a complete REVERSED+storno
 *     chain — those ARE retention-relevant (an auditor can reconstruct
 *     what happened). They get filtered out at read time by the orphan
 *     guard but stay in the DB.
 *   • Any entry whose sourceId still resolves.
 *
 * For every cleanup we write an audit-log entry per tenant naming the
 * journal numbers and gross totals so the action stays traceable.
 *
 * Run (dry-run, default):
 *   npx tsx apps/dashboard/scripts/cleanup-orphan-journal-entries.ts
 *
 * Run (actually delete):
 *   npx tsx apps/dashboard/scripts/cleanup-orphan-journal-entries.ts --apply
 *
 * Optional: --tenant=<tenantId>
 */

import { db } from "../src/lib/db";
import type { JournalSourceType } from "@prisma/client";

type Target = {
  id: string;
  tenantId: string;
  number: number;
  date: Date;
  description: string;
  sourceType: JournalSourceType;
  sourceId: string | null;
  net: number;
};

async function findOrphans(tenantFilter: string | null): Promise<Target[]> {
  const where = tenantFilter ? { tenantId: tenantFilter } : {};

  const [entries, invoices, documents] = await Promise.all([
    db.journalEntry.findMany({
      where: {
        ...where,
        sourceType: {
          in: ["INVOICE", "INVOICE_PAYMENT", "DOCUMENT", "DOCUMENT_PAYMENT"],
        },
      },
      include: { lines: true },
      orderBy: { number: "asc" },
    }),
    db.invoice.findMany({ where, select: { id: true } }),
    db.document.findMany({ where, select: { id: true } }),
  ]);

  const liveInvoiceIds = new Set(invoices.map((i) => i.id));
  const liveDocumentIds = new Set(documents.map((d) => d.id));

  const out: Target[] = [];
  for (const e of entries) {
    if (!e.sourceId) continue;
    let isOrphan = false;
    switch (e.sourceType) {
      case "INVOICE":
      case "INVOICE_PAYMENT":
        isOrphan = !liveInvoiceIds.has(e.sourceId);
        break;
      case "DOCUMENT":
      case "DOCUMENT_PAYMENT":
        isOrphan = !liveDocumentIds.has(e.sourceId);
        break;
    }
    if (!isOrphan) continue;

    let debit = 0;
    let credit = 0;
    for (const l of e.lines) {
      debit += Number(l.debit);
      credit += Number(l.credit);
    }
    out.push({
      id: e.id,
      tenantId: e.tenantId,
      number: e.number,
      date: e.date,
      description: e.description,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      net: Math.max(debit, credit),
    });
  }
  return out;
}

function fmtCur(n: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

async function applyCleanup(targets: Target[]) {
  if (targets.length === 0) return;

  // Group by tenant so the audit log lands in the right tenant scope.
  const byTenant = new Map<string, Target[]>();
  for (const t of targets) {
    const arr = byTenant.get(t.tenantId) ?? [];
    arr.push(t);
    byTenant.set(t.tenantId, arr);
  }

  for (const [tenantId, items] of byTenant) {
    const ids = items.map((t) => t.id);
    const grossSum = items.reduce((s, t) => s + t.net, 0);

    // First reset reversedById pointers that would otherwise become
    // dangling: if one orphan reverses another, deleting both is fine,
    // but if an orphan storno points at a NON-orphan original (rare),
    // we'd leave a phantom FK. Safer to nullify the pointer for all
    // entries that referenced any of these IDs.
    await db.$transaction(async (tx) => {
      await tx.journalEntry.updateMany({
        where: { tenantId, reversedById: { in: ids } },
        data: { reversedById: null, reversedAt: null, status: "POSTED" },
      });
      // JournalLine cascades on JournalEntry delete (see schema).
      const deleted = await tx.journalEntry.deleteMany({
        where: { tenantId, id: { in: ids } },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: null,
          action: "SETTINGS_CHANGED",
          entityType: "JournalEntry",
          entityId: null,
          details: {
            kind: "orphan-journal-cleanup",
            removed: deleted.count,
            grossSumEUR: grossSum,
            journalNumbers: items.map((t) => t.number),
            note:
              "Removed journal entries whose source (Invoice/Document) " +
              "was deleted outside the GoBD-aware reversal path. See " +
              "scripts/cleanup-orphan-journal-entries.ts for rationale.",
          },
        },
      });
    });

    console.log(
      `Tenant ${tenantId}: ${items.length} Einträge entfernt (Brutto ${fmtCur(grossSum)}).`,
    );
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const tenantArg = process.argv.find((a) => a.startsWith("--tenant="));
  const tenantFilter = tenantArg ? tenantArg.slice("--tenant=".length) : null;

  const targets = await findOrphans(tenantFilter);

  if (targets.length === 0) {
    console.log("Keine verwaisten Journal-Einträge gefunden.");
    await db.$disconnect();
    return;
  }

  const total = targets.reduce((s, t) => s + t.net, 0);
  console.log(
    `\n${targets.length} verwaiste Einträge gefunden · Brutto-Wert ${fmtCur(total)}`,
  );
  console.log("─".repeat(100));
  for (const t of targets) {
    console.log(
      [
        t.date.toISOString().slice(0, 10),
        `#${String(t.number).padStart(4, "0")}`,
        t.sourceType.padEnd(17),
        `Quelle ${t.sourceId}`,
        `→ ${fmtCur(t.net)}`,
        t.description,
      ].join("  "),
    );
  }

  if (!apply) {
    console.log("\nDry-Run — nichts gelöscht. Mit --apply ausführen.");
    await db.$disconnect();
    return;
  }

  console.log("\n--apply aktiv. Lösche Einträge…");
  await applyCleanup(targets);
  console.log("Fertig.");
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
