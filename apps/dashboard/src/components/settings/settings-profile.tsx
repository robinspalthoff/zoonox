"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { User } from "lucide-react";

export function SettingsProfile() {
  const { data: session } = useSession();
  const t = useTranslations("settings.profile");

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
        <User className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
      </div>
      <div className="px-5 py-4 space-y-4">
        <div className="grid grid-cols-[100px_1fr] items-center gap-4">
          <span className="text-sm text-muted-foreground">{t("name")}</span>
          <span className="text-sm text-foreground">{session?.user?.name ?? "–"}</span>
        </div>
        <div className="grid grid-cols-[100px_1fr] items-center gap-4">
          <span className="text-sm text-muted-foreground">{t("email")}</span>
          <span className="text-sm text-foreground">{session?.user?.email ?? "–"}</span>
        </div>
      </div>
    </div>
  );
}
