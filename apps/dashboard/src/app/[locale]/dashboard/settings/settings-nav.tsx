"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { UserRound, Building2, Calculator, Hash, AtSign, Palette } from "lucide-react";
import { cn } from "@/lib/utils";

// Sekundäre Navigation der Einstellungen. „Einstellungen" selbst ist ein
// angepinnter Eintrag in der Hauptsidebar (sidebar.tsx); die einzelnen Bereiche
// werden hier auf der Settings-Seite navigiert (Standard-Pattern à la GitHub/
// Stripe). Labels kommen aus dem bestehenden „nav"-Namespace.
const ITEMS = [
  { href: "/dashboard/settings", labelKey: "settingsUser", icon: UserRound, exact: true },
  { href: "/dashboard/settings/company", labelKey: "settingsCompany", icon: Building2 },
  { href: "/dashboard/settings/accounting", labelKey: "settingsAccounting", icon: Calculator },
  { href: "/dashboard/settings/number-ranges", labelKey: "settingsNumberRanges", icon: Hash },
  { href: "/dashboard/settings/email-inbound", labelKey: "settingsEmailInbound", icon: AtSign },
  { href: "/dashboard/settings/appearance", labelKey: "settingsAppearance", icon: Palette },
] as const;

export function SettingsNav() {
  const t = useTranslations("common.nav");
  const pathname = usePathname();

  return (
    <nav
      className={cn(
        // Mobil: horizontale Scrollleiste über dem Inhalt.
        "flex gap-1 overflow-x-auto pb-1",
        // Desktop: schmale vertikale Spalte, mitscrollend angepinnt.
        "md:w-56 md:shrink-0 md:flex-col md:gap-0.5 md:overflow-visible md:pb-0 md:self-start md:sticky md:top-6",
      )}
    >
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active = "exact" in item && item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{t(item.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
