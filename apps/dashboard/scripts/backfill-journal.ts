// One-off backfill: run the posting-rules over every finalized invoice and
// every booked/paid expense document, so the journal is historically
// complete.
//
// Usage:
//   npx tsx scripts/backfill-journal.ts            # dry run — prints plan
//   npx tsx scripts/backfill-journal.ts --apply    # actually post
//
// Idempotent: for each source record, existing journal entries are first
// reversed (GoBD-konform via Storno) and then re-posted from the current
// record state. Safe to re-run.

import { PrismaClient } from "@prisma/client";
import {
  buildInvoiceIssuedEntry,
  buildInvoicePaymentEntry,
  buildDocumentBookedEntry,
  buildDocumentPaymentEntry,
} from "../src/lib/journal/posting-rules";
import { postEntry, reverseEntriesForSource } from "../src/lib/journal/post";
import type { PostingContext } from "../src/lib/journal/types";

const db = new PrismaClient();

const APPLY = process.argv.includes("--apply");

async function loadContext(): Promise<PostingContext> {
  const s = await db.companySettings.findFirst();
  if (!s) throw new Error("No company settings found");
  return {
    tenantId: s.tenantId,
    skrType: s.skrType ?? "SKR03",
    accountingMode: s.accountingMode ?? "DOUBLE_ENTRY",
    taxMode: s.taxMode ?? "STANDARD",
  };
}

async function backfillInvoices(ctx: PostingContext) {
  // Every non-draft invoice should appear in the journal, regardless of
  // whether `finalizedAt` was ever set (older invoices predate the GoBD
  // immutability migration). CANCELLED invoices get their issue-entry posted
  // AND immediately stornoed so the journal reflects the cancelled state.
  const invoices = await db.invoice.findMany({
    where: {
      status: { in: ["SENT", "PAID", "OVERDUE", "CANCELLED"] },
    },
    include: { lineItems: true },
    orderBy: { issueDate: "asc" },
  });

  console.log(`[invoices] ${invoices.length} non-draft invoices found`);
  let posted = 0;
  let paid = 0;
  let cancelled = 0;

  for (const inv of invoices) {
    const issuedDraft = buildInvoiceIssuedEntry(inv, ctx);
    if (!issuedDraft) continue;

    if (APPLY) {
      // Clear any prior entries for a clean idempotent re-run.
      await reverseEntriesForSource("INVOICE", inv.id, ctx, null, "Backfill");
      await reverseEntriesForSource("INVOICE_PAYMENT", inv.id, ctx, null, "Backfill");
      await postEntry(issuedDraft, ctx, null);
    }
    posted += 1;

    if (inv.status === "PAID" && inv.paidAt && inv.paymentMethod) {
      const payDraft = buildInvoicePaymentEntry(inv, inv.paidAt, inv.paymentMethod, ctx);
      if (payDraft && APPLY) await postEntry(payDraft, ctx, null);
      if (payDraft) paid += 1;
    }

    // CANCELLED: mirror the live flow by immediately reversing the issue
    // entry we just posted so the effective balance is zero.
    if (inv.status === "CANCELLED") {
      if (APPLY) {
        await reverseEntriesForSource("INVOICE", inv.id, ctx, null, "Rechnung storniert");
      }
      cancelled += 1;
    }
  }

  console.log(
    `[invoices] ${posted} issued entries, ${paid} payment entries, ${cancelled} cancelled (stornoed)`,
  );
}

async function backfillDocuments(ctx: PostingContext) {
  const docs = await db.document.findMany({
    where: {
      documentType: "EXPENSE",
      status: { in: ["DONE", "PAID"] },
    },
    include: { lineItems: true, payment: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`[documents] ${docs.length} booked expense documents found`);
  let booked = 0;
  let paid = 0;

  for (const doc of docs) {
    const bookDraft = buildDocumentBookedEntry(doc, ctx);
    if (!bookDraft) continue;

    if (APPLY) {
      await reverseEntriesForSource("DOCUMENT", doc.id, ctx, null, "Backfill");
      await reverseEntriesForSource("DOCUMENT_PAYMENT", doc.id, ctx, null, "Backfill");
      await postEntry(bookDraft, ctx, null);
    }
    booked += 1;

    if (doc.payment) {
      const payDraft = buildDocumentPaymentEntry(
        doc,
        doc.payment.paidAt,
        doc.payment.method,
        ctx,
      );
      if (payDraft && APPLY) await postEntry(payDraft, ctx, null);
      if (payDraft) paid += 1;
    }
  }

  console.log(`[documents] ${booked} booked entries, ${paid} payment entries`);
}

async function main() {
  console.log(APPLY ? "=== APPLY MODE ===" : "=== DRY RUN (use --apply to write) ===");
  const ctx = await loadContext();
  console.log("context:", ctx);

  await backfillInvoices(ctx);
  await backfillDocuments(ctx);

  console.log("done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
