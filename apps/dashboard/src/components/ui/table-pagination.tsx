"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const DEFAULT_PAGE_SIZES = [25, 50, 100, 200] as const;
export type PageSize = (typeof DEFAULT_PAGE_SIZES)[number];

/**
 * Client-side pagination over an already-filtered/sorted array. Resets
 * back to page 1 whenever the underlying total changes — otherwise the
 * user can land on an empty page after typing a search query.
 */
export function usePagination<T>(rows: T[], initialPageSize: PageSize = 25) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(initialPageSize);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize]);

  return {
    page,
    setPage,
    pageSize,
    setPageSize: (s: PageSize) => {
      setPageSize(s);
      setPage(1);
    },
    total,
    totalPages,
    paged,
  };
}

export function TablePagination({
  page,
  totalPages,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  pageSize: PageSize;
  total: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: PageSize) => void;
}) {
  const t = useTranslations("common.pagination");
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-border text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <label htmlFor="page-size" className="whitespace-nowrap">
          {t("rowsPerPage")}
        </label>
        <select
          id="page-size"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
          className="px-2 py-1 bg-background border border-input rounded text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {DEFAULT_PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="whitespace-nowrap tabular-nums">
          {t("range", { from, to, total })}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          aria-label={t("prev")}
          className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="px-2 tabular-nums">
          {t("pageOf", { page, totalPages })}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          aria-label={t("next")}
          className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
