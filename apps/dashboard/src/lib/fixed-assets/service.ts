// Fixed-asset service layer.
//
// Single source of truth for FixedAsset lifecycle operations. UI actions
// and the worker both go through here.
//
// Responsibilities:
//   - allocate the per-tenant lückenlose Inventarnummer (FixedAssetSequence)
//   - create the asset record + persist the full FixedAssetDepreciation plan
//     (as PLANNED rows, no journal entries yet)
//   - book the acquisition into the journal (replaces the would-be expense
//     booking when an asset is linked to a Document)
//   - post depreciation for a specific period (idempotent via unique constraint)
//   - dispose the asset and post the residual write-off

import { db } from "@/lib/db";
import type {
  FixedAsset,
  FixedAssetCategory,
  FixedAssetMethod,
  Prisma,
  PaymentMethod,
} from "@prisma/client";
import { loadPostingContext } from "@/lib/journal";
import { postEntry, reverseEntriesForSource } from "@/lib/journal/post";
import { round2 } from "@/lib/journal/types";
import {
  inputVatAccount,
  inputVatCode,
  payableAccount,
  bankAccount,
  cashAccount,
} from "@/lib/journal/accounts";
import { accountsFor } from "./rules";
import { generatePlan, firstOfMonthUTC, computeMonthlyAmount } from "./plan";

type Tx = Prisma.TransactionClient;

// ── Asset-number sequence ───────────────────────────────────────────────────

async function nextAssetNumber(tx: Tx, tenantId: string, year: number): Promise<string> {
  const seq = await tx.fixedAssetSequence.upsert({
    where: { tenantId },
    create: { tenantId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return `AN-${year}-${String(seq.lastNumber).padStart(4, "0")}`;
}

// ── Create ──────────────────────────────────────────────────────────────────

export interface CreateAssetInput {
  tenantId: string;
  createdById: string | null;
  name: string;
  description?: string | null;
  category: FixedAssetCategory;
  method: FixedAssetMethod;
  acquisitionDate: Date;
  /** Gross acquisition cost (Bruttobetrag aus Beleg/Rechnung). */
  acquisitionCost: number;
  /** VAT rate in % (0/7/19). */
  vatRate: number;
  usefulLifeMonths: number;
  scrapValue?: number;
  documentId?: string | null;
  /** Override default SKR accounts (optional). */
  skrAssetAccount?: string;
  skrDepreciationAccount?: string;
}

export interface CreateAssetResult {
  asset: FixedAsset;
}

/**
 * Create a fixed asset + materialise its full depreciation schedule.
 *
 * After this call the asset is in status PLANNED until the acquisition
 * journal entry is booked via `postAcquisition`. The worker tick then
 * advances PLANNED → ACTIVE on the first successful depreciation posting.
 */
export async function createAsset(input: CreateAssetInput): Promise<CreateAssetResult> {
  const ctx = await loadPostingContext(input.tenantId);
  // Kleinunternehmer (§ 19 UStG): kein Vorsteuerabzug. Die nicht-abziehbare
  // Vorsteuer gehört nach R 9b EStR zu den Anschaffungskosten — d.h. die
  // AfA-Basis ist der *Bruttobetrag*. Der vom UI mitgegebene VAT-Satz wird
  // hier ignoriert (das Form sollte ihn ohnehin nicht zeigen, aber wir wollen
  // robust sein, falls die Action aus einem anderen Kontext aufgerufen wird).
  const isSmallBusiness = ctx.taxMode === "SMALL_BUSINESS";
  const effectiveVatRate = isSmallBusiness ? 0 : input.vatRate;
  const netAmount = isSmallBusiness
    ? round2(input.acquisitionCost)
    : round2(input.acquisitionCost / (1 + effectiveVatRate / 100));
  const vatAmount = isSmallBusiness ? 0 : round2(input.acquisitionCost - netAmount);
  const scrapValue = round2(input.scrapValue ?? 0);
  const depreciationStart = firstOfMonthUTC(input.acquisitionDate);

  const accounts = accountsFor(ctx.skrType, input.category);
  const skrAssetAccount = input.skrAssetAccount ?? accounts.asset;
  const skrDepreciationAccount =
    input.skrDepreciationAccount ??
    (input.method === "IMMEDIATE" ? accounts.immediate : accounts.depreciation);

  const monthlyAmount = computeMonthlyAmount({
    netAmount,
    scrapValue,
    usefulLifeMonths: input.usefulLifeMonths,
    method: input.method,
    depreciationStart,
  });

  const plan = generatePlan({
    netAmount,
    scrapValue,
    usefulLifeMonths: input.usefulLifeMonths,
    method: input.method,
    depreciationStart,
  });

  const asset = await db.$transaction(async (tx) => {
    const assetNumber = await nextAssetNumber(tx, input.tenantId, depreciationStart.getUTCFullYear());

    const created = await tx.fixedAsset.create({
      data: {
        tenantId: input.tenantId,
        assetNumber,
        name: input.name,
        description: input.description ?? null,
        category: input.category,
        method: input.method,
        status: "PLANNED",
        documentId: input.documentId ?? null,
        acquisitionDate: input.acquisitionDate,
        acquisitionCost: input.acquisitionCost,
        netAmount,
        vatAmount,
        vatRate: effectiveVatRate,
        usefulLifeMonths: input.usefulLifeMonths,
        depreciationStart,
        monthlyAmount,
        scrapValue,
        bookValue: netAmount,
        totalDepreciated: 0,
        skrAssetAccount,
        skrDepreciationAccount,
        createdById: input.createdById,
      },
    });

    if (plan.length > 0) {
      await tx.fixedAssetDepreciation.createMany({
        data: plan.map((row) => ({
          tenantId: input.tenantId,
          assetId: created.id,
          periodYear: row.periodYear,
          periodMonth: row.periodMonth,
          amount: row.amount,
          bookValueBefore: row.bookValueBefore,
          bookValueAfter: row.bookValueAfter,
        })),
      });
    }

    return created;
  });

  return { asset };
}

// ── Acquisition booking ─────────────────────────────────────────────────────
//
// Replaces the regular DOCUMENT expense booking. Posted as a journal entry
// of type FIXED_ASSET_ACQUISITION. For SINGLE_ENTRY accounting we skip the
// VAT/Verbindlichkeit split and just record the net activation (the cash
// payment to the supplier will be booked separately via DocumentPayment).

export async function postAcquisition(
  tenantId: string,
  assetId: string,
  createdById: string | null,
): Promise<void> {
  const ctx = await loadPostingContext(tenantId);
  const asset = await db.fixedAsset.findFirst({ where: { id: assetId, tenantId } });
  if (!asset) return;

  const net = Number(asset.netAmount);
  const vat = Number(asset.vatAmount);
  const gross = Number(asset.acquisitionCost);
  const rate = asset.vatRate ? Number(asset.vatRate) : 0;
  const allowVatDeduction = ctx.taxMode === "STANDARD" && ctx.accountingMode === "DOUBLE_ENTRY";

  // Always-on idempotency: if already posted, reverse the previous entry first
  // (handles the re-save case symmetrically with document booking).
  await reverseEntriesForSource("FIXED_ASSET_ACQUISITION", assetId, ctx, createdById, "Anlage-Neufassung");

  if (ctx.accountingMode === "DOUBLE_ENTRY") {
    const lines = [
      // Soll: Anlagekonto (netto bei VSt-Abzug, sonst brutto)
      {
        accountCode: asset.skrAssetAccount,
        debit: round2(allowVatDeduction ? net : gross),
        credit: 0,
        description: `Aktivierung ${asset.assetNumber}`,
      },
      // Soll: Vorsteuer (nur bei Regelbesteuerung)
      ...(allowVatDeduction && vat > 0
        ? [
            {
              accountCode: inputVatAccount(ctx.skrType, rate),
              debit: round2(vat),
              credit: 0,
              vatCode: inputVatCode(rate),
              vatAmount: round2(vat),
              description: `Vorsteuer ${rate}%`,
            },
          ]
        : []),
      // Haben: Verbindlichkeit (brutto)
      {
        accountCode: payableAccount(ctx.skrType),
        debit: 0,
        credit: round2(gross),
        description: `Verbindlichkeit Anlage ${asset.assetNumber}`,
      },
    ];

    await postEntry(
      {
        date: asset.acquisitionDate,
        description: `Aktivierung Anlage ${asset.assetNumber} – ${asset.name}`,
        sourceType: "FIXED_ASSET_ACQUISITION",
        sourceId: assetId,
        lines,
      },
      ctx,
      createdById,
    );
  } else {
    // SINGLE_ENTRY: cash basis — the cash outflow itself comes from DocumentPayment.
    // Record the activation as a memo entry on the asset account only so the
    // asset register report can list it. No counterpart (mode is single-line).
    await postEntry(
      {
        date: asset.acquisitionDate,
        description: `Aktivierung Anlage ${asset.assetNumber} – ${asset.name}`,
        sourceType: "FIXED_ASSET_ACQUISITION",
        sourceId: assetId,
        lines: [
          {
            accountCode: asset.skrAssetAccount,
            debit: round2(gross),
            credit: 0,
            description: `Aktivierung ${asset.assetNumber}`,
          },
        ],
      },
      ctx,
      createdById,
    );
  }
}

// ── Monthly depreciation posting ────────────────────────────────────────────
//
// Idempotent: postPeriod(asset, 2026, 5) twice produces exactly one journal
// entry because the FixedAssetDepreciation row is updated (postedAt set) only
// inside the same transaction that creates the journal entry.

export async function postPeriod(
  tenantId: string,
  assetId: string,
  periodYear: number,
  periodMonth: number,
  createdById: string | null,
): Promise<{ skipped: boolean; reason?: string }> {
  const ctx = await loadPostingContext(tenantId);

  return db.$transaction(async (tx) => {
    const row = await tx.fixedAssetDepreciation.findUnique({
      where: {
        assetId_periodYear_periodMonth: {
          assetId,
          periodYear,
          periodMonth,
        },
      },
    });
    if (!row) return { skipped: true, reason: "no_plan_row" };
    if (row.postedAt) return { skipped: true, reason: "already_posted" };

    const asset = await tx.fixedAsset.findFirst({ where: { id: assetId, tenantId } });
    if (!asset) return { skipped: true, reason: "asset_not_found" };
    if (asset.status === "DISPOSED") return { skipped: true, reason: "disposed" };

    const amount = Number(row.amount);
    if (amount <= 0) {
      // Plan row with zero amount — mark as posted to advance the cursor, no journal entry needed.
      await tx.fixedAssetDepreciation.update({
        where: { id: row.id },
        data: { postedAt: new Date() },
      });
      return { skipped: true, reason: "zero_amount" };
    }

    // Buchungsdatum: letzter Tag des Monats — wirtschaftlich der korrekte Zeitpunkt
    // einer Monats-AfA. UTC reicht hier, da Reports nur auf Y/M aggregieren.
    const postDate = new Date(Date.UTC(periodYear, periodMonth, 0));

    const lines = ctx.accountingMode === "DOUBLE_ENTRY"
      ? [
          {
            accountCode: asset.skrDepreciationAccount,
            debit: round2(amount),
            credit: 0,
            description: `AfA ${asset.assetNumber} ${String(periodMonth).padStart(2, "0")}/${periodYear}`,
          },
          {
            accountCode: asset.skrAssetAccount,
            debit: 0,
            credit: round2(amount),
            description: `Wertminderung ${asset.assetNumber}`,
          },
        ]
      : [
          // SINGLE_ENTRY: single expense line on the depreciation account.
          {
            accountCode: asset.skrDepreciationAccount,
            debit: round2(amount),
            credit: 0,
            description: `AfA ${asset.assetNumber} ${String(periodMonth).padStart(2, "0")}/${periodYear}`,
          },
        ];

    const entry = await postEntry(
      {
        date: postDate,
        description: `AfA ${asset.assetNumber} – ${asset.name} (${String(periodMonth).padStart(2, "0")}/${periodYear})`,
        sourceType: "FIXED_ASSET_DEPRECIATION",
        sourceId: assetId,
        lines,
      },
      ctx,
      createdById,
      tx,
    );

    const newBookValue = Number(row.bookValueAfter);
    const newTotal = round2(Number(asset.totalDepreciated) + amount);
    const fullyDone = newBookValue <= Number(asset.scrapValue) + 0.005;

    await tx.fixedAssetDepreciation.update({
      where: { id: row.id },
      data: {
        postedAt: new Date(),
        journalEntryId: entry.id,
      },
    });

    await tx.fixedAsset.update({
      where: { id: assetId },
      data: {
        status: fullyDone ? "FULLY_DEPRECIATED" : "ACTIVE",
        bookValue: newBookValue,
        totalDepreciated: newTotal,
        lastPostedYear: periodYear,
        lastPostedMonth: periodMonth,
      },
    });

    return { skipped: false };
  });
}

// ── Disposal ────────────────────────────────────────────────────────────────

export interface DisposeAssetInput {
  tenantId: string;
  assetId: string;
  disposalDate: Date;
  disposalProceeds: number;
  reason?: string | null;
  paymentMethod?: PaymentMethod; // for the proceeds counter-leg
  createdById: string | null;
}

/**
 * Take an asset out of service.
 *
 *  1. Cancel all unposted future depreciation rows (so the worker stops).
 *  2. Post a residual-write-off journal entry: book the remaining bookValue
 *     to the depreciation account, credit the asset account, and record any
 *     proceeds against bank/cash. Profit/loss on disposal is the difference
 *     (handled via the standard expense / "Erlöse aus Anlagenabgängen" Konto;
 *     we keep the booking simple and post net to depreciation expense — full
 *     gain/loss classification is a Phase-2 refinement).
 */
export async function disposeAsset(input: DisposeAssetInput): Promise<void> {
  const ctx = await loadPostingContext(input.tenantId);

  await db.$transaction(async (tx) => {
    const asset = await tx.fixedAsset.findFirst({
      where: { id: input.assetId, tenantId: input.tenantId },
    });
    if (!asset) throw new Error("Asset not found.");
    if (asset.status === "DISPOSED") throw new Error("Asset already disposed.");

    // Strip all unposted plan rows from disposal month onwards.
    await tx.fixedAssetDepreciation.deleteMany({
      where: {
        assetId: asset.id,
        postedAt: null,
      },
    });

    const residual = Number(asset.bookValue);
    const proceeds = round2(input.disposalProceeds);

    // Residual write-off: depreciation debit / asset account credit.
    if (residual > 0.005 && ctx.accountingMode === "DOUBLE_ENTRY") {
      await postEntry(
        {
          date: input.disposalDate,
          description: `Anlagenabgang ${asset.assetNumber} – Restbuchwert`,
          sourceType: "FIXED_ASSET_DISPOSAL",
          sourceId: asset.id,
          lines: [
            {
              accountCode: asset.skrDepreciationAccount,
              debit: round2(residual),
              credit: 0,
              description: `Restbuchwertabschreibung ${asset.assetNumber}`,
            },
            {
              accountCode: asset.skrAssetAccount,
              debit: 0,
              credit: round2(residual),
              description: `Abgang ${asset.assetNumber}`,
            },
          ],
        },
        ctx,
        input.createdById,
        tx,
      );
    }

    // Proceeds, if any: bank/cash debit / sonst. Erlöse credit.
    if (proceeds > 0.005 && ctx.accountingMode === "DOUBLE_ENTRY") {
      const cashAcct =
        input.paymentMethod === "CASH" ? cashAccount(ctx.skrType) : bankAccount(ctx.skrType);
      // 8820 (SKR03) / 4845 (SKR04) — Erlöse aus Anlagenabgängen
      const proceedsAccount = ctx.skrType === "SKR03" ? "8820" : "4845";
      await postEntry(
        {
          date: input.disposalDate,
          description: `Anlagenabgang ${asset.assetNumber} – Erlös`,
          sourceType: "FIXED_ASSET_DISPOSAL",
          sourceId: asset.id,
          lines: [
            {
              accountCode: cashAcct,
              debit: round2(proceeds),
              credit: 0,
              description: `Erlös Anlagenabgang ${asset.assetNumber}`,
            },
            {
              accountCode: proceedsAccount,
              debit: 0,
              credit: round2(proceeds),
              description: `Erlöse aus Anlagenabgängen`,
            },
          ],
        },
        ctx,
        input.createdById,
        tx,
      );
    }

    await tx.fixedAsset.update({
      where: { id: asset.id },
      data: {
        status: "DISPOSED",
        disposalDate: input.disposalDate,
        disposalProceeds: proceeds,
        disposalReason: input.reason ?? null,
        bookValue: 0,
      },
    });
  });
}

// ── Delete (only allowed while in PLANNED state) ────────────────────────────

export async function deleteAssetIfPlanned(
  tenantId: string,
  assetId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const asset = await db.fixedAsset.findFirst({
    where: { id: assetId, tenantId },
    select: { status: true },
  });
  if (!asset) return { ok: false, reason: "not_found" };
  if (asset.status !== "PLANNED") return { ok: false, reason: "not_deletable" };

  await db.fixedAsset.delete({ where: { id: assetId } });
  return { ok: true };
}
