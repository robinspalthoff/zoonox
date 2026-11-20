"use client";

// Client-side tab strip used by the /dashboard/taxes layout.
// Receives the list of tabs already filtered by the server component, so the
// role-gating logic lives in the layout (server) and we keep this component
// purely presentational.

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export type TaxesTabKey = "vatReturn" | "profitLoss" | "journal" | "datevExport";

export type TaxesTabHref =
  | "/dashboard/taxes/vat-return"
  | "/dashboard/taxes/profit-loss"
  | "/dashboard/taxes/journal"
  | "/dashboard/taxes/datev-export";

export interface TaxesTabSpec {
  key: TaxesTabKey;
  href: TaxesTabHref;
  // Optional label override — used so the P&L tab can reflect the tenant's
  // configured method (EÜR vs GuV) instead of the static i18n default.
  label?: string;
}

export function TaxesTabs({ tabs }: { tabs: readonly TaxesTabSpec[] }) {
  const t = useTranslations("taxes");
  const pathname = usePathname();

  return (
    <div className="border-b border-border">
      <nav className="flex gap-4 -mb-px">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.key}
              href={tab.href}
              className={cn(
                "px-1 py-2 text-sm font-medium border-b-2 transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
              )}
            >
              {tab.label ?? t(`tabs.${tab.key}`)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
