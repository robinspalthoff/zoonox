import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { CompanyMasterDataForm } from "../company-master-data-form";
import { WorkspaceCard } from "./workspace-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("companyPage.title") };
}

export default async function SettingsCompanyPage() {
  const { tenantId, role, tenantRole } = await requireTenant();
  const canEdit =
    ["SUPER_ADMIN", "ADMIN"].includes(role) || ["OWNER", "ADMIN"].includes(tenantRole);

  const t = await getTranslations("settings");
  const settings = canEdit
    ? await db.companySettings.findUnique({ where: { tenantId } })
    : null;
  const tenant = canEdit
    ? await db.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      })
    : null;

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("companyPage.title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("companyPage.subtitle")}</p>
      </div>

      {canEdit ? (
        <>
          {tenant && <WorkspaceCard name={tenant.name} />}
          <CompanyMasterDataForm
            settings={settings ? JSON.parse(JSON.stringify(settings)) : null}
          />
        </>
      ) : (
        <div className="flex items-center gap-3 bg-card border border-border rounded-xl p-6 text-sm text-muted-foreground">
          <ShieldAlert className="w-5 h-5 shrink-0 text-muted-foreground" />
          {t("noPermission")}
        </div>
      )}
    </>
  );
}
