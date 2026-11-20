"use client";

import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { useTransition } from "react";

const INPUT =
  "px-3 py-2 bg-muted border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors";
const LABEL = "block text-xs font-medium text-muted-foreground mb-1";

// Die Berechnungsart (EÜR/GuV) wird zentral in den Buchhaltungs-
// Einstellungen festgelegt — dieser Selektor steuert nur noch den Zeitraum.
export function RangeSelector({
  fromStr,
  toStr,
}: {
  fromStr: string;
  toStr: string;
}) {
  const t = useTranslations("taxes.profitLoss");
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  function update(next: Partial<{ from: string; to: string }>) {
    const merged = { from: fromStr, to: toStr, ...next };
    const params = new URLSearchParams();
    params.set("from", merged.from);
    params.set("to", merged.to);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}` as never);
    });
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-wrap items-end gap-4">
      <div>
        <label className={LABEL}>{t("from")}</label>
        <input
          type="date"
          className={INPUT}
          value={fromStr}
          onChange={(e) => update({ from: e.target.value })}
        />
      </div>
      <div>
        <label className={LABEL}>{t("to")}</label>
        <input
          type="date"
          className={INPUT}
          value={toStr}
          onChange={(e) => update({ to: e.target.value })}
        />
      </div>
    </div>
  );
}
