"use server";

import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import type { FixedAssetCategory, FixedAssetMethod } from "@prisma/client";
import {
  createAsset,
  postAcquisition,
  postPeriod,
  disposeAsset,
  deleteAssetIfPlanned,
} from "@/lib/fixed-assets";

type ActionResult<T = undefined> =
  | ({ success: true } & (T extends undefined ? unknown : { data: T }))
  | { success: false; error: string };

// ─── Create asset (manual entry or from document) ──────────────────────────

export interface CreateAssetFormInput {
  name: string;
  description?: string | null;
  category: FixedAssetCategory;
  method: FixedAssetMethod;
  acquisitionDate: string; // ISO date
  acquisitionCost: number;
  vatRate: number;
  usefulLifeMonths: number;
  scrapValue?: number;
  documentId?: string | null;
  skrAssetAccount?: string;
  skrDepreciationAccount?: string;
}

export async function createAssetAction(
  input: CreateAssetFormInput,
): Promise<ActionResult<{ id: string }>> {
  const t = await requireTenant();

  if (!input.name?.trim()) return { success: false, error: "Name is required." };
  if (!(input.acquisitionCost > 0)) return { success: false, error: "Cost must be > 0." };
  if (!(input.usefulLifeMonths > 0)) return { success: false, error: "Useful life is required." };

  // If linked to a document: enforce that the document is not finalized.
  if (input.documentId) {
    const doc = await db.document.findFirst({
      where: { id: input.documentId, tenantId: t.tenantId, deletedAt: null },
      select: { status: true, fixedAsset: { select: { id: true } } },
    });
    if (!doc) return { success: false, error: "Document not found." };
    if (doc.fixedAsset) return { success: false, error: "Document already linked to an asset." };
    // Gebucht heißt: es gibt einen Journal-Eintrag. Der Status allein taugt
    // nicht — die OCR setzt am Ende ebenfalls DONE, obwohl der Beleg noch
    // ungebucht ist. Siehe lib/documents/delete.ts, gleiche Prüfung.
    const bookedCount = await db.journalEntry.count({
      where: { tenantId: t.tenantId, sourceType: "DOCUMENT", sourceId: input.documentId },
    });
    if (bookedCount > 0) {
      return { success: false, error: "Document is finalized." };
    }
  }

  try {
    const { asset } = await createAsset({
      tenantId: t.tenantId,
      createdById: t.userId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      category: input.category,
      method: input.method,
      acquisitionDate: new Date(input.acquisitionDate),
      acquisitionCost: input.acquisitionCost,
      vatRate: input.vatRate,
      usefulLifeMonths: input.usefulLifeMonths,
      scrapValue: input.scrapValue,
      documentId: input.documentId ?? null,
      skrAssetAccount: input.skrAssetAccount,
      skrDepreciationAccount: input.skrDepreciationAccount,
    });

    // Post the acquisition immediately — this is what activates the asset's
    // counterpart in the journal. The depreciation tick will pick it up on the
    // next monthly run (or via "post now" button).
    await postAcquisition(t.tenantId, asset.id, t.userId);

    revalidatePath("/dashboard/documents/assets");
    if (input.documentId) revalidatePath(`/dashboard/documents/${input.documentId}`);
    return { success: true, data: { id: asset.id } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Failed to create asset." };
  }
}

// ─── Post all due periods up to current month (UI "catch up" button) ───────
//
// Loops every unposted FixedAssetDepreciation row whose period (year, month)
// is ≤ now and calls postPeriod on it. Each month still becomes its own
// JournalEntry with the correct economic posting date (last day of month) —
// GoBD-conform, mirrors how DATEV/SevDesk handle Nachträge.

export async function postAllDueAction(
  assetId: string,
): Promise<ActionResult<{ posted: number }>> {
  const t = await requireTenant();
  const asset = await db.fixedAsset.findFirst({
    where: { id: assetId, tenantId: t.tenantId },
    select: { id: true },
  });
  if (!asset) return { success: false, error: "Asset not found." };

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  const due = await db.fixedAssetDepreciation.findMany({
    where: {
      assetId,
      postedAt: null,
      OR: [
        { periodYear: { lt: currentYear } },
        { periodYear: currentYear, periodMonth: { lte: currentMonth } },
      ],
    },
    orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }],
    select: { periodYear: true, periodMonth: true },
  });

  let posted = 0;
  for (const p of due) {
    try {
      const r = await postPeriod(t.tenantId, assetId, p.periodYear, p.periodMonth, t.userId);
      if (!r.skipped) posted++;
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Failed to post period.",
      };
    }
  }

  revalidatePath("/dashboard/documents/assets");
  revalidatePath(`/dashboard/documents/assets/${assetId}`);
  return { success: true, data: { posted } };
}

// ─── Post a single period on demand (UI "post now" button) ─────────────────

export async function postPeriodAction(
  assetId: string,
  periodYear: number,
  periodMonth: number,
): Promise<ActionResult> {
  const t = await requireTenant();
  const owns = await db.fixedAsset.findFirst({
    where: { id: assetId, tenantId: t.tenantId },
    select: { id: true },
  });
  if (!owns) return { success: false, error: "Asset not found." };

  try {
    await postPeriod(t.tenantId, assetId, periodYear, periodMonth, t.userId);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Failed to post period." };
  }

  revalidatePath("/dashboard/documents/assets");
  revalidatePath(`/dashboard/documents/assets/${assetId}`);
  return { success: true };
}

// ─── Dispose asset ──────────────────────────────────────────────────────────

export async function disposeAssetAction(
  assetId: string,
  disposalDate: string,
  disposalProceeds: number,
  reason: string | null,
): Promise<ActionResult> {
  const t = await requireTenant();
  const owns = await db.fixedAsset.findFirst({
    where: { id: assetId, tenantId: t.tenantId },
    select: { id: true },
  });
  if (!owns) return { success: false, error: "Asset not found." };

  try {
    await disposeAsset({
      tenantId: t.tenantId,
      assetId,
      disposalDate: new Date(disposalDate),
      disposalProceeds,
      reason,
      createdById: t.userId,
    });
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Failed to dispose." };
  }

  revalidatePath("/dashboard/documents/assets");
  revalidatePath(`/dashboard/documents/assets/${assetId}`);
  return { success: true };
}

// ─── Attach an existing document as the asset's source receipt ─────────────
//
// Used by the detail page "Beleg verknüpfen" / upload flow: the client first
// uploads the file via /api/documents/upload (which creates a Document row
// and kicks off OCR) and then calls this action with the resulting documentId.
//
// Constraints:
//   - the asset must belong to the caller's tenant
//   - the document must belong to the same tenant and not yet be linked to any
//     other asset (1:1 relation guarded at DB level via @@unique(documentId))
//   - asset must not be DISPOSED — adding a receipt to a disposed asset is
//     semantic nonsense.
//
// Note: we deliberately do not change the asset's acquisition values from the
// receipt's OCR fields. The asset's stamped numbers stay authoritative — the
// receipt is supporting documentation (Belegnachweis), nothing more.
export async function attachDocumentToAssetAction(
  assetId: string,
  documentId: string,
): Promise<ActionResult> {
  const t = await requireTenant();

  const [asset, doc] = await Promise.all([
    db.fixedAsset.findFirst({
      where: { id: assetId, tenantId: t.tenantId },
      select: { id: true, status: true, documentId: true },
    }),
    db.document.findFirst({
      where: { id: documentId, tenantId: t.tenantId, deletedAt: null },
      select: { id: true, fixedAsset: { select: { id: true } } },
    }),
  ]);
  if (!asset) return { success: false, error: "Asset not found." };
  if (!doc) return { success: false, error: "Document not found." };
  if (asset.status === "DISPOSED")
    return { success: false, error: "Asset is disposed." };
  if (doc.fixedAsset && doc.fixedAsset.id !== assetId)
    return { success: false, error: "Document already linked to another asset." };

  await db.fixedAsset.update({
    where: { id: assetId },
    data: { documentId },
  });

  revalidatePath("/dashboard/documents/assets");
  revalidatePath(`/dashboard/documents/assets/${assetId}`);
  revalidatePath(`/dashboard/documents/${documentId}`);
  return { success: true };
}

// ─── Detach the linked document (e.g. after wrong upload) ───────────────────
export async function detachDocumentFromAssetAction(
  assetId: string,
): Promise<ActionResult> {
  const t = await requireTenant();
  const owns = await db.fixedAsset.findFirst({
    where: { id: assetId, tenantId: t.tenantId },
    select: { id: true },
  });
  if (!owns) return { success: false, error: "Asset not found." };

  await db.fixedAsset.update({
    where: { id: assetId },
    data: { documentId: null },
  });

  revalidatePath("/dashboard/documents/assets");
  revalidatePath(`/dashboard/documents/assets/${assetId}`);
  return { success: true };
}

// ─── Delete asset (only while PLANNED) ──────────────────────────────────────

export async function deleteAssetAction(assetId: string): Promise<ActionResult> {
  const t = await requireTenant();
  const r = await deleteAssetIfPlanned(t.tenantId, assetId);
  if (!r.ok) {
    return {
      success: false,
      error: r.reason === "not_deletable"
        ? "Asset already has postings — disposal required instead."
        : "Asset not found.",
    };
  }
  revalidatePath("/dashboard/documents/assets");
  return { success: true };
}
