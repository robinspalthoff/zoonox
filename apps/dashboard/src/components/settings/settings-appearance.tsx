"use client";

import { useTranslations } from "next-intl";
import { useTheme } from "@/components/theme-provider";
import { Sun, Moon, Palette } from "lucide-react";
import { cn } from "@/lib/utils";

export function SettingsAppearance() {
  const t = useTranslations("settings.appearance");
  const { theme, setTheme } = useTheme();

  const options = [
    { value: "dark" as const, label: t("dark"), icon: Moon },
    { value: "light" as const, label: t("light"), icon: Sun },
  ];

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
        <Palette className="w-4 h-4 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t("description")}</p>
        </div>
      </div>
      <div className="px-5 py-4">
        <div className="flex gap-2">
          {options.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border transition-colors",
                theme === value
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "text-muted-foreground border-border hover:text-foreground hover:bg-accent"
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
