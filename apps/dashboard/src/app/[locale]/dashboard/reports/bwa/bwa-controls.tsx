"use client";

import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";

/**
 * Controls bar for the BWA: year picker, method toggle, prior-year
 * comparison checkbox, and PDF export button.
 *
 * URL state is the source of truth — that way reloads keep the same
 * view, the PDF download link can re-use the params directly, and we
 * don't need a separate client store. The export button is a plain
 * `<a>` because the PDF route streams the response as
 * `attachment`, which Next's `<Link>` can't handle gracefully.
 */
export function BwaControls({
  year,
  method,
  compare,
}: {
  year: number;
  method: "EUR" | "GUV";
  compare: boolean;
}) {
  const t = useTranslations("reports.bwa.controls");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // Five-year window ending at next year so a user opening the BWA in
  // late December can already file the upcoming year's report once it
  // ticks over.
  const now = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => now + 1 - i);

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(sp.toString());
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const exportHref = `/api/reports/bwa/export?year=${year}&method=${method}&compare=${compare ? "1" : "0"}`;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="bwa-year" className="text-xs font-medium text-muted-foreground">
          {t("year")}
        </label>
        <select
          id="bwa-year"
          value={year}
          onChange={(e) => setParam("year", e.target.value)}
          className="px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="bwa-method" className="text-xs font-medium text-muted-foreground">
          {t("method")}
        </label>
        <select
          id="bwa-method"
          value={method}
          onChange={(e) => setParam("method", e.target.value)}
          className="px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="EUR">{t("methodEUR")}</option>
          <option value="GUV">{t("methodGuV")}</option>
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm h-[38px] px-3 border border-input rounded-lg cursor-pointer hover:bg-accent transition-colors">
        <input
          type="checkbox"
          checked={compare}
          onChange={(e) => setParam("compare", e.target.checked ? "1" : "0")}
          className="cursor-pointer"
        />
        <span>{t("compare")}</span>
      </label>

      <a
        href={exportHref}
        className="ml-auto inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors h-[38px]"
      >
        <Download className="w-4 h-4" />
        {t("download")}
      </a>
    </div>
  );
}
