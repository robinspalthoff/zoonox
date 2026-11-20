"use client";

import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { useTransition } from "react";

const SELECT =
  "px-3 py-2 bg-muted border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors";
const LABEL = "block text-xs font-medium text-muted-foreground mb-1";

export function PeriodSelector({
  period,
  year,
  month,
  quarter,
}: {
  period: "monthly" | "quarterly";
  year: number;
  month: number;
  quarter: number;
}) {
  const t = useTranslations("taxes.vatReturn");
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  function update(next: Partial<{ period: string; year: number; month: number; quarter: number }>) {
    const params = new URLSearchParams();
    const merged = { period, year, month, quarter, ...next };
    params.set("period", String(merged.period));
    params.set("year", String(merged.year));
    if (merged.period === "monthly") params.set("month", String(merged.month));
    else params.set("quarter", String(merged.quarter));
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}` as never);
    });
  }

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-wrap items-end gap-4">
      <div>
        <label className={LABEL}>{t("period")}</label>
        <select
          className={SELECT}
          value={period}
          onChange={(e) => update({ period: e.target.value })}
        >
          <option value="monthly">{t("periodMonthly")}</option>
          <option value="quarterly">{t("periodQuarterly")}</option>
        </select>
      </div>

      <div>
        <label className={LABEL}>{t("year")}</label>
        <select
          className={SELECT}
          value={year}
          onChange={(e) => update({ year: Number(e.target.value) })}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {period === "monthly" ? (
        <div>
          <label className={LABEL}>{t("month")}</label>
          <select
            className={SELECT}
            value={month}
            onChange={(e) => update({ month: Number(e.target.value) })}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {t(`months.${m}` as never)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div>
          <label className={LABEL}>{t("quarter")}</label>
          <select
            className={SELECT}
            value={quarter}
            onChange={(e) => update({ quarter: Number(e.target.value) })}
          >
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                {t("quarterLabel", { quarter: q })}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
