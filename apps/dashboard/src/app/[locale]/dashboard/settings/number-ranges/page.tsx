import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";
import type { NumberRangeType } from "@prisma/client";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import {
  NUMBER_RANGE_DEFAULTS,
  NUMBER_RANGE_TYPES,
} from "@/lib/number-ranges";
import { NumberRangesForm, type RangeData } from "./number-ranges-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.numberRanges");
  return { title: t("pageTitle") };
}

export default async function SettingsNumberRangesPage() {
  const { tenantId, role, tenantRole } = await requireTenant();
  const canEdit =
    ["SUPER_ADMIN", "ADMIN"].includes(role) ||
    ["OWNER", "ADMIN"].includes(tenantRole);

  const t = await getTranslations("settings.numberRanges");
  const tSettings = await getTranslations("settings");

  const header = (
    <div>
      <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
      <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
    </div>
  );

  if (!canEdit) {
    return (
      <>
        {header}
        <div className="flex items-center gap-3 bg-card border border-border rounded-xl p-6 text-sm text-muted-foreground">
          <ShieldAlert className="w-5 h-5 shrink-0 text-muted-foreground" />
          {tSettings("noPermission")}
        </div>
      </>
    );
  }

  const rows = await db.numberRange.findMany({ where: { tenantId } });
  const byType = new Map(rows.map((r) => [r.type, r]));

  // Inline the legacy `prefix` field into the visible format string so the
  // user only edits a single `format` going forward — and so old rows seeded
  // with `{PREFIX}-{YYYY}-{NUMBER}` show as `RE-{YYYY}-{NUMBER}`.
  const initial: RangeData[] = NUMBER_RANGE_TYPES.map((type: NumberRangeType) => {
    const row = byType.get(type);
    const def = NUMBER_RANGE_DEFAULTS[type];
    const rawFormat = row?.format ?? def.format;
    const prefix = row?.prefix ?? def.prefix;
    const format = rawFormat.replaceAll("{PREFIX}", prefix);
    return {
      type,
      format,
      nextNumber: row?.nextNumber ?? def.nextNumber,
      minDigits: row?.minDigits ?? def.minDigits,
    };
  });

  return (
    <>
      {header}
      <NumberRangesForm initial={initial} />
    </>
  );
}
