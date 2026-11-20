import { db } from "@/lib/db";
import type { Prisma, JournalEntry, JournalEntryStatus } from "@prisma/client";
import type { EntryDraft, PostingContext } from "./types";
import { round2 } from "./types";

type Tx = Prisma.TransactionClient;

// ── Validation ──────────────────────────────────────────────────────────────

function validate(draft: EntryDraft, ctx: PostingContext): string | null {
  if (draft.lines.length === 0) return "Entry has no lines.";

  for (const l of draft.lines) {
    if (l.debit < 0 || l.credit < 0) return "Debit and credit must be non-negative.";
    if (l.debit > 0 && l.credit > 0) return "A line cannot have both debit and credit.";
  }

  if (ctx.accountingMode === "DOUBLE_ENTRY") {
    const debit = draft.lines.reduce((s, l) => s + l.debit, 0);
    const credit = draft.lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(round2(debit) - round2(credit)) > 0.01) {
      return `Double-entry not balanced: debit=${debit.toFixed(2)} credit=${credit.toFixed(2)}`;
    }
  }
  return null;
}

// ── Sequence ────────────────────────────────────────────────────────────────

async function nextNumber(tx: Tx, tenantId: string): Promise<number> {
  const seq = await tx.journalSequence.upsert({
    where: { tenantId },
    create: { tenantId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return seq.lastNumber;
}

// ── Core posting ────────────────────────────────────────────────────────────

export async function postEntry(
  draft: EntryDraft,
  ctx: PostingContext,
  createdById: string | null,
  tx?: Tx,
): Promise<JournalEntry> {
  const err = validate(draft, ctx);
  if (err) throw new Error(`Journal post failed: ${err}`);

  const run = async (t: Tx) => {
    const number = await nextNumber(t, ctx.tenantId);
    return t.journalEntry.create({
      data: {
        tenantId: ctx.tenantId,
        number,
        date: draft.date,
        description: draft.description,
        sourceType: draft.sourceType,
        sourceId: draft.sourceId,
        createdById,
        lines: {
          create: draft.lines.map((l, i) => ({
            position: i,
            accountCode: l.accountCode,
            debit: round2(l.debit),
            credit: round2(l.credit),
            vatCode: l.vatCode ?? null,
            vatAmount: l.vatAmount != null ? round2(l.vatAmount) : null,
            description: l.description ?? null,
          })),
        },
      },
    });
  };

  return tx ? run(tx) : db.$transaction(run);
}

// ── Reversal ────────────────────────────────────────────────────────────────
//
// GoBD-konform: nie löschen, sondern Storno-Entry mit gespiegelten Lines
// schreiben und Original als REVERSED markieren.
export async function reverseEntriesForSource(
  sourceType: EntryDraft["sourceType"],
  sourceId: string,
  ctx: PostingContext,
  createdById: string | null,
  reason: string,
): Promise<number> {
  const originals = await db.journalEntry.findMany({
    where: {
      tenantId: ctx.tenantId,
      sourceType,
      sourceId,
      status: "POSTED" satisfies JournalEntryStatus,
    },
    include: { lines: true },
  });

  if (originals.length === 0) return 0;

  await db.$transaction(async (t) => {
    for (const orig of originals) {
      const reversal = await postEntry(
        {
          date: new Date(),
          description: `Storno #${orig.number}: ${reason}`,
          sourceType: orig.sourceType,
          sourceId: orig.sourceId,
          lines: orig.lines.map((l) => ({
            accountCode: l.accountCode,
            // Swap debit and credit
            debit: Number(l.credit),
            credit: Number(l.debit),
            vatCode: l.vatCode,
            vatAmount: l.vatAmount != null ? -Number(l.vatAmount) : null,
            description: l.description,
          })),
        },
        ctx,
        createdById,
        t,
      );

      await t.journalEntry.update({
        where: { id: orig.id },
        data: {
          status: "REVERSED",
          reversedById: reversal.id,
          reversedAt: new Date(),
        },
      });
    }
  });

  return originals.length;
}

// ── Shadow-mode wrapper: never let journal failures break parent action ─────

export async function safelyPost(
  draft: EntryDraft | null,
  ctx: PostingContext,
  createdById: string | null,
): Promise<void> {
  if (!draft) return;
  try {
    await postEntry(draft, ctx, createdById);
  } catch (err) {
    console.error("[journal] shadow-post failed:", err, { draft });
  }
}

export async function safelyReverse(
  sourceType: EntryDraft["sourceType"],
  sourceId: string,
  ctx: PostingContext,
  createdById: string | null,
  reason: string,
): Promise<void> {
  try {
    await reverseEntriesForSource(sourceType, sourceId, ctx, createdById, reason);
  } catch (err) {
    console.error("[journal] shadow-reverse failed:", err, { sourceType, sourceId });
  }
}
