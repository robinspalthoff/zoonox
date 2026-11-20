import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Plus, ArrowLeft } from "lucide-react";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { AssetsList, type AssetRow } from "./assets-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("assets");
  return { title: t("pageTitle") };
}

export default async function AssetsPage() {
  const { tenantId } = await requireTenant();
  const t = await getTranslations("assets");

  const assets = await db.fixedAsset.findMany({
    where: { tenantId },
    orderBy: [{ status: "asc" }, { acquisitionDate: "desc" }],
    select: {
      id: true,
      assetNumber: true,
      name: true,
      category: true,
      method: true,
      status: true,
      acquisitionDate: true,
      acquisitionCost: true,
      bookValue: true,
      monthlyAmount: true,
      totalDepreciated: true,
      lastError: true,
    },
  });

  // Aggregate "due" depreciation count per asset in one round-trip. "Due" =
  // period (year, month) is ≤ current and postedAt IS NULL. The list page
  // uses this to surface a "X Monate ausstehend" badge so users notice
  // catch-up work before they have to dig into the detail page.
  const now = new Date();
  const ny = now.getUTCFullYear();
  const nm = now.getUTCMonth() + 1;
  const dueGroups = await db.fixedAssetDepreciation.groupBy({
    by: ["assetId"],
    where: {
      tenantId,
      postedAt: null,
      OR: [
        { periodYear: { lt: ny } },
        { periodYear: ny, periodMonth: { lte: nm } },
      ],
    },
    _count: { _all: true },
  });
  const dueByAsset = new Map(dueGroups.map((g) => [g.assetId, g._count._all]));

  const rows: AssetRow[] = assets.map((a) => ({
    id: a.id,
    assetNumber: a.assetNumber,
    name: a.name,
    category: a.category,
    method: a.method,
    status: a.status,
    acquisitionDate: a.acquisitionDate.toISOString(),
    acquisitionCost: a.acquisitionCost.toString(),
    bookValue: a.bookValue.toString(),
    monthlyAmount: a.monthlyAmount.toString(),
    totalDepreciated: a.totalDepreciated.toString(),
    hasError: !!a.lastError,
    dueCount: dueByAsset.get(a.id) ?? 0,
  }));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <Link
            href="/dashboard/documents"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t("backToDocuments")}
          </Link>
          <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
        </div>
        <Link
          href="/dashboard/documents/assets/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t("new")}
        </Link>
      </div>

      <AssetsList rows={rows} />
    </div>
  );
}
