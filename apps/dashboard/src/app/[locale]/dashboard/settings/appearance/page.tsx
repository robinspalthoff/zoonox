import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppearanceSettings } from "../appearance-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("appearancePage.title") };
}

export default async function SettingsAppearancePage() {
  const t = await getTranslations("settings");

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("appearancePage.title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("appearancePage.subtitle")}</p>
      </div>
      <AppearanceSettings />
    </>
  );
}
