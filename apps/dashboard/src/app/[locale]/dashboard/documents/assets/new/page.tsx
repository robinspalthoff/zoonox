import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ArrowLeft } from "lucide-react";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { AssetForm, type AssetFormInitial } from "./asset-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("assets.form");
  return { title: t("title") };
}

interface PageProps {
  searchParams: Promise<{ document?: string }>;
}

export default async function NewAssetPage({ searchParams }: PageProps) {
  const { tenantId } = await requireTenant();
  const t = await getTranslations("assets");
  const sp = await searchParams;

  const settings = await db.companySettings.findUnique({
    where: { tenantId },
    select: { skrType: true, taxMode: true },
  });
  const skrType = settings?.skrType ?? "SKR03";
  const taxMode = settings?.taxMode ?? "STANDARD";

  let initial: AssetFormInitial = { skrType, taxMode };

  if (sp.document) {
    const doc = await db.document.findFirst({
      where: { id: sp.document, tenantId, deletedAt: null },
      select: {
        id: true,
        fileName: true,
        recognizedAmount: true,
        recognizedDate: true,
        recognizedSupplier: true,
        vatRate: true,
        status: true,
        fixedAsset: { select: { id: true } },
      },
    });
    // Nicht am Status festmachen: die OCR setzt ebenfalls DONE, obwohl der
    // Beleg noch ungebucht ist. Maßgeblich ist der Journal-Eintrag.
    const bookedCount = doc
      ? await db.journalEntry.count({
          where: { tenantId, sourceType: "DOCUMENT", sourceId: doc.id },
        })
      : 0;
    if (doc && !doc.fixedAsset && bookedCount === 0) {
      initial = {
        skrType,
        taxMode,
        documentId: doc.id,
        documentLabel: doc.recognizedSupplier ?? doc.fileName,
        defaultName: doc.recognizedSupplier ?? doc.fileName,
        defaultAcquisitionDate: doc.recognizedDate?.toISOString() ?? null,
        defaultAcquisitionCost: doc.recognizedAmount?.toString() ?? null,
        defaultVatRate: doc.vatRate?.toString() ?? "19",
      };
    }
  }

  return (
    <div className="p-6">
      <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <Link
          href="/dashboard/documents/assets"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("title")}
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">{t("form.title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("form.subtitle")}</p>
      </div>

      <AssetForm initial={initial} />
      </div>
    </div>
  );
}
