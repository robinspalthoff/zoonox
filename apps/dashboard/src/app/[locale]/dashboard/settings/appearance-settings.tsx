"use client";

import { useTranslations } from "next-intl";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { LanguageSwitcher } from "@/components/layout/language-switcher";

export function AppearanceSettings() {
  const t = useTranslations("settings");

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-base font-semibold text-foreground mb-1">{t("language.title")}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t("language.description")}</p>
        <LanguageSwitcher />
      </div>
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-base font-semibold text-foreground mb-1">{t("appearance.title")}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t("appearance.description")}</p>
        <ThemeToggle />
      </div>
    </div>
  );
}
