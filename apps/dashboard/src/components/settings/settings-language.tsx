"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";

const LOCALES = ["de", "en"] as const;

export function SettingsLanguage() {
  const t = useTranslations("settings.language");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function switchLocale(next: string) {
    router.replace(pathname, { locale: next });
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
        <Languages className="w-4 h-4 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t("description")}</p>
        </div>
      </div>
      <div className="px-5 py-4">
        <div className="flex gap-2">
          {LOCALES.map((lang) => (
            <button
              key={lang}
              onClick={() => switchLocale(lang)}
              className={cn(
                "flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors",
                locale === lang
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "text-muted-foreground border-border hover:text-foreground hover:bg-accent"
              )}
            >
              {t(lang)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
