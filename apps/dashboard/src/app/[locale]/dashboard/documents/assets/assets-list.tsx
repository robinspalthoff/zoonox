"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Boxes, AlertCircle, Clock, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import type {
  FixedAssetCategory,
  FixedAssetMethod,
  FixedAssetStatus,
} from "@prisma/client";
import { formatCurrency, fmtDateShort } from "@/lib/format";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";

export interface AssetRow {
  id: string;
  assetNumber: string;
  name: string;
  category: FixedAssetCategory;
  method: FixedAssetMethod;
  status: FixedAssetStatus;
  acquisitionDate: string;
  acquisitionCost: string;
  bookValue: string;
  monthlyAmount: string;
  totalDepreciated: string;
  hasError: boolean;
  /** Number of past-or-current periods whose AfA is not yet posted. */
  dueCount: number;
}

const STATUS_STYLES: Record<FixedAssetStatus, string> = {
  // PLANNED rendert visuell als "active" — siehe Kommentar bei TAB_FILTER.
  PLANNED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  ACTIVE: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  FULLY_DEPRECIATED: "bg-muted text-muted-foreground border-border",
  DISPOSED: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
};

/** PLANNED ist ein technischer Zwischenstatus — UI-seitig als ACTIVE labeln. */
function displayStatusKey(s: FixedAssetStatus): string {
  return s === "PLANNED" ? "active" : s.toLowerCase();
}

type TabKey = "all" | "active" | "fully" | "disposed";
type SortKey =
  | "assetNumber"
  | "name"
  | "category"
  | "acquisitionDate"
  | "acquisitionCost"
  | "monthlyAmount"
  | "bookValue";
type SortDir = "asc" | "desc";

// "active" includes the technical PLANNED state — from the user's POV both
// mean "in service, depreciating". PLANNED only exists between asset creation
// and the first successful depreciation posting (worst case ~1 month), so
// exposing it as its own tab would just confuse users.
const TAB_FILTER: Record<TabKey, (r: AssetRow) => boolean> = {
  all: () => true,
  active: (r) => r.status === "ACTIVE" || r.status === "PLANNED",
  fully: (r) => r.status === "FULLY_DEPRECIATED",
  disposed: (r) => r.status === "DISPOSED",
};

export function AssetsList({ rows }: { rows: AssetRow[] }) {
  const t = useTranslations("assets");
  const [tab, setTab] = useState<TabKey>("all");
  const [sortKey, setSortKey] = useState<SortKey>("acquisitionDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(
        key === "name" || key === "assetNumber" || key === "category" ? "asc" : "desc",
      );
    }
  }

  const counts = useMemo(
    () => ({
      all: rows.length,
      active: rows.filter(TAB_FILTER.active).length,
      fully: rows.filter(TAB_FILTER.fully).length,
      disposed: rows.filter(TAB_FILTER.disposed).length,
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const tabbed = rows.filter(TAB_FILTER[tab]);
    const dir = sortDir === "asc" ? 1 : -1;
    const num = (s: string) => parseFloat(s) || 0;
    return [...tabbed].sort((a, b) => {
      switch (sortKey) {
        case "assetNumber":      return a.assetNumber.localeCompare(b.assetNumber, undefined, { numeric: true }) * dir;
        case "name":             return (a.name || "").localeCompare(b.name || "") * dir;
        case "category":         return a.category.localeCompare(b.category) * dir;
        case "acquisitionDate":  return (new Date(a.acquisitionDate).getTime() - new Date(b.acquisitionDate).getTime()) * dir;
        case "acquisitionCost":  return (num(a.acquisitionCost) - num(b.acquisitionCost)) * dir;
        case "monthlyAmount":    return (num(a.monthlyAmount) - num(b.monthlyAmount)) * dir;
        case "bookValue":        return (num(a.bookValue) - num(b.bookValue)) * dir;
      }
    });
  }, [rows, tab, sortKey, sortDir]);

  const {
    page, setPage, pageSize, setPageSize, total, totalPages, paged,
  } = usePagination(filtered);

  if (rows.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center">
        <div className="inline-flex w-12 h-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-4">
          <Boxes className="w-5 h-5" />
        </div>
        <h2 className="text-base font-medium text-foreground">{t("empty.title")}</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{t("empty.subtitle")}</p>
        <Link
          href="/dashboard/documents/assets/new"
          className="inline-flex items-center gap-2 mt-6 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {t("empty.cta")}
        </Link>
      </div>
    );
  }

  const TABS: TabKey[] = ["all", "active", "fully", "disposed"];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border">
        {TABS.map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === k
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`tabs.${k}`)}{" "}
            <span className="ml-1 text-xs text-muted-foreground tabular-nums">
              {counts[k]}
            </span>
          </button>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <AssetSortableTh label={t("table.assetNumber")}     sortKey="assetNumber"     current={sortKey} dir={sortDir} onClick={() => toggleSort("assetNumber")} />
              <AssetSortableTh label={t("table.name")}            sortKey="name"            current={sortKey} dir={sortDir} onClick={() => toggleSort("name")} />
              <AssetSortableTh label={t("table.category")}        sortKey="category"        current={sortKey} dir={sortDir} onClick={() => toggleSort("category")} />
              <AssetSortableTh label={t("table.acquisitionDate")} sortKey="acquisitionDate" current={sortKey} dir={sortDir} onClick={() => toggleSort("acquisitionDate")} />
              <AssetSortableTh label={t("table.acquisitionCost")} sortKey="acquisitionCost" current={sortKey} dir={sortDir} onClick={() => toggleSort("acquisitionCost")} align="right" />
              <AssetSortableTh label={t("table.monthlyAmount")}   sortKey="monthlyAmount"   current={sortKey} dir={sortDir} onClick={() => toggleSort("monthlyAmount")} align="right" />
              <AssetSortableTh label={t("table.bookValue")}       sortKey="bookValue"       current={sortKey} dir={sortDir} onClick={() => toggleSort("bookValue")} align="right" />
              <th className="px-4 py-2.5 font-medium">{t("table.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paged.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {r.assetNumber}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/documents/assets/${r.id}`}
                    className="font-medium text-foreground hover:text-primary transition-colors inline-flex items-center gap-2"
                  >
                    {r.name || t("table.untitled")}
                    {r.hasError && (
                      <span className="text-destructive" title={t("table.lastError")}>
                        <AlertCircle className="w-3.5 h-3.5" />
                      </span>
                    )}
                    {r.dueCount > 0 && r.status !== "DISPOSED" && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30"
                        title={t("table.dueTooltip", { count: r.dueCount })}
                      >
                        <Clock className="w-2.5 h-2.5" />
                        {r.dueCount}
                      </span>
                    )}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {t(`category.${r.category.toLowerCase()}`)}
                </td>
                <td className="px-4 py-3 text-muted-foreground tabular-nums">
                  {fmtDateShort(r.acquisitionDate)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCurrency(r.acquisitionCost)}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                  {formatCurrency(r.monthlyAmount)}
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  {formatCurrency(r.bookValue)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border ${STATUS_STYLES[r.status]}`}
                  >
                    {t(`status.${displayStatusKey(r.status)}`)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <TablePagination
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
    </div>
  );
}

function AssetSortableTh({
  label, sortKey, current, dir, onClick, align = "left",
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: () => void;
  align?: "left" | "right";
}) {
  const isActive = current === sortKey;
  return (
    <th className={`px-4 py-2.5 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button type="button" onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${isActive ? "text-foreground" : ""}`}>
        {label}
        {isActive
          ? (dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
          : <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </button>
    </th>
  );
}
