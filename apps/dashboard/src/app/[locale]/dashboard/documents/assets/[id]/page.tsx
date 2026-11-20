import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { ArrowLeft } from "lucide-react";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { AssetDetail, type AssetDetailData } from "./asset-detail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("assets");
  return { title: t("title") };
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AssetDetailPage({ params }: PageProps) {
  const { tenantId } = await requireTenant();
  const { id } = await params;
  const t = await getTranslations("assets");

  const asset = await db.fixedAsset.findFirst({
    where: { id, tenantId },
    include: {
      document: { select: { id: true, fileName: true } },
      depreciations: {
        orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }],
      },
    },
  });
  if (!asset) notFound();

  const data: AssetDetailData = {
    id: asset.id,
    assetNumber: asset.assetNumber,
    name: asset.name,
    description: asset.description,
    category: asset.category,
    method: asset.method,
    status: asset.status,
    acquisitionDate: asset.acquisitionDate.toISOString(),
    acquisitionCost: asset.acquisitionCost.toString(),
    netAmount: asset.netAmount.toString(),
    vatAmount: asset.vatAmount.toString(),
    vatRate: asset.vatRate?.toString() ?? null,
    usefulLifeMonths: asset.usefulLifeMonths,
    depreciationStart: asset.depreciationStart.toISOString(),
    monthlyAmount: asset.monthlyAmount.toString(),
    scrapValue: asset.scrapValue.toString(),
    bookValue: asset.bookValue.toString(),
    totalDepreciated: asset.totalDepreciated.toString(),
    skrAssetAccount: asset.skrAssetAccount,
    skrDepreciationAccount: asset.skrDepreciationAccount,
    disposalDate: asset.disposalDate?.toISOString() ?? null,
    disposalProceeds: asset.disposalProceeds?.toString() ?? null,
    disposalReason: asset.disposalReason,
    lastError: asset.lastError,
    document: asset.document
      ? { id: asset.document.id, fileName: asset.document.fileName }
      : null,
    depreciations: asset.depreciations.map((d) => ({
      id: d.id,
      periodYear: d.periodYear,
      periodMonth: d.periodMonth,
      amount: d.amount.toString(),
      bookValueBefore: d.bookValueBefore.toString(),
      bookValueAfter: d.bookValueAfter.toString(),
      postedAt: d.postedAt?.toISOString() ?? null,
    })),
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link
          href="/dashboard/documents/assets"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("title")}
        </Link>
      </div>
      <AssetDetail data={data} />
    </div>
  );
}
