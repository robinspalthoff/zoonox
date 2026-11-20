"use client";

import { useMemo, useState, useTransition, useEffect, useRef, useLayoutEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import {
  FileText, Download, MoreHorizontal, Copy, Trash2, Search,
  CircleCheckBig, CircleX, FileSignature, Receipt,
  ArrowUp, ArrowDown, ArrowUpDown, X,
} from "lucide-react";
import type { QuoteStatus } from "@prisma/client";
import { QUOTE_STATUS_CLASSES, isQuoteEffectivelyExpired } from "@/lib/quotes/status";
import { formatCurrency } from "@/lib/format";
import { deleteQuote, updateQuoteStatus, convertQuoteToOrderConfirmation } from "./actions";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";

type TabFilter = "all" | "draft" | "sent" | "accepted" | "rejected" | "expired";

export interface QuoteRow {
  id: string;
  number: string;
  status: QuoteStatus;
  issueDate: string;
  validUntil: string | null;
  total: number;
  clientName: string;
  clientEmail: string | null;
  convertedAt: string | null;
}

function matchesTab(q: QuoteRow, tab: TabFilter): boolean {
  switch (tab) {
    case "all":      return true;
    case "draft":    return q.status === "DRAFT";
    case "sent":     return q.status === "SENT" && !isQuoteEffectivelyExpired(q.status, q.validUntil);
    case "accepted": return q.status === "ACCEPTED";
    case "rejected": return q.status === "REJECTED";
    case "expired":  return isQuoteEffectivelyExpired(q.status, q.validUntil);
  }
}

type SortKey = "number" | "client" | "issueDate" | "validUntil" | "total";
type SortDir = "asc" | "desc";

export function QuotesView({ quotes }: { quotes: QuoteRow[] }) {
  const t = useTranslations("quotes");
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<QuoteRow | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; msg: string } | null>(null);
  // Sort state — default to issueDate desc (matches the previous "newest
  // first" ordering from the server). Clicking the same column toggles
  // direction; clicking another column resets to desc on date/total
  // (the "useful" defaults for those) and asc on string columns.
  const [sortKey, setSortKey] = useState<SortKey>("issueDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Date-range filter — narrows by issueDate.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "number" || key === "client" ? "asc" : "desc");
    }
  }

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setSearchQuery("");
  }
  const hasFilters = !!(dateFrom || dateTo || searchQuery);

  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(h);
  }, [toast]);

  const tabCounts = useMemo(() => ({
    all:      quotes.length,
    draft:    quotes.filter((q) => matchesTab(q, "draft")).length,
    sent:     quotes.filter((q) => matchesTab(q, "sent")).length,
    accepted: quotes.filter((q) => matchesTab(q, "accepted")).length,
    rejected: quotes.filter((q) => matchesTab(q, "rejected")).length,
    expired:  quotes.filter((q) => matchesTab(q, "expired")).length,
  }), [quotes]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    // Date filters interpret the input as local midnight, and inclusive
    // on both ends ("to" extends to end-of-day so a single-day filter
    // matches rows issued at any time during that day).
    const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toTime = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null;

    const rows = quotes.filter((row) => {
      if (!matchesTab(row, activeTab)) return false;
      if (fromTime !== null && new Date(row.issueDate).getTime() < fromTime) return false;
      if (toTime !== null && new Date(row.issueDate).getTime() > toTime) return false;
      if (!q) return true;
      return row.number.toLowerCase().includes(q) || row.clientName.toLowerCase().includes(q);
    });

    // Apply sort. Returning a new array because Array.prototype.sort
    // mutates — and `quotes` is the prop, we never want to touch that.
    const dir = sortDir === "asc" ? 1 : -1;
    const sorted = [...rows].sort((a, b) => {
      switch (sortKey) {
        case "number":     return a.number.localeCompare(b.number) * dir;
        case "client":     return a.clientName.localeCompare(b.clientName) * dir;
        case "issueDate":  return (new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime()) * dir;
        case "validUntil": {
          // Nulls sort last regardless of direction — "no validUntil"
          // is always less informative than any date.
          const av = a.validUntil ? new Date(a.validUntil).getTime() : null;
          const bv = b.validUntil ? new Date(b.validUntil).getTime() : null;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return (av - bv) * dir;
        }
        case "total":      return (a.total - b.total) * dir;
      }
    });
    return sorted;
  }, [quotes, activeTab, searchQuery, dateFrom, dateTo, sortKey, sortDir]);

  const {
    page, setPage, pageSize, setPageSize, total, totalPages, paged,
  } = usePagination(filtered);

  const tabs: { key: TabFilter; labelKey: string }[] = [
    { key: "all",      labelKey: "tabs.all" },
    { key: "draft",    labelKey: "tabs.draft" },
    { key: "sent",     labelKey: "tabs.sent" },
    { key: "accepted", labelKey: "tabs.accepted" },
    { key: "rejected", labelKey: "tabs.rejected" },
    { key: "expired",  labelKey: "tabs.expired" },
  ];

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map(({ key, labelKey }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}>
              {t(labelKey)}
              <span className={`text-xs tabular-nums px-1.5 py-0.5 rounded-full ${
                activeTab === key ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
              }`}>{tabCounts[key]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date range — narrows the visible rows by issueDate. */}
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            title={t("filters.from")}
            className="px-2.5 py-1.5 text-sm bg-muted/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            title={t("filters.to")}
            className="px-2.5 py-1.5 text-sm bg-muted/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40"
          />
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              title={t("filters.reset")}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              {t("filters.reset")}
            </button>
          )}
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("search.placeholder")}
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-muted/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40" />
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-visible">
        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.status")}</th>
                <SortableHeader label={t("table.validUntil")} sortKey="validUntil" current={sortKey} dir={sortDir} onClick={() => toggleSort("validUntil")} />
                <SortableHeader label={t("table.number")}      sortKey="number"     current={sortKey} dir={sortDir} onClick={() => toggleSort("number")} />
                <SortableHeader label={t("table.client")}      sortKey="client"     current={sortKey} dir={sortDir} onClick={() => toggleSort("client")} />
                <SortableHeader label={t("table.issueDate")}   sortKey="issueDate"  current={sortKey} dir={sortDir} onClick={() => toggleSort("issueDate")} />
                <SortableHeader label={t("table.total")}       sortKey="total"      current={sortKey} dir={sortDir} onClick={() => toggleSort("total")} align="right" />
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  {t("empty")}
                </td></tr>
              ) : paged.map((q) => {
                const displayStatus: QuoteStatus = isQuoteEffectivelyExpired(q.status, q.validUntil) ? "EXPIRED" : q.status;
                const isClosed = q.status === "REJECTED" || displayStatus === "EXPIRED";
                return (
                  <tr key={q.id}
                    onClick={(e) => {
                      const el = e.target as HTMLElement;
                      if (el.closest("button, a")) return;
                      router.push(`/dashboard/quotes/${q.id}`);
                    }}
                    className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer ${
                      isClosed ? "opacity-70" : ""
                    }`}>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${QUOTE_STATUS_CLASSES[displayStatus]}`}>
                        {t(`status.${displayStatus}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {q.validUntil ? (
                        <span className={isClosed ? "line-through text-muted-foreground" : "text-muted-foreground"}>
                          {new Date(q.validUntil).toLocaleDateString("de-DE")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link href={`/dashboard/quotes/${q.id}`} className="font-medium text-foreground hover:underline">
                          {q.number}
                        </Link>
                        {q.convertedAt && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-500 leading-none">
                            {t("convertedBadge")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground">{q.clientName}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(q.issueDate).toLocaleDateString("de-DE")}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground tabular-nums">
                      {formatCurrency(q.total)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <a href={`/api/quotes/${q.id}/pdf`} target="_blank" rel="noopener"
                          title={t("downloadPdf")}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        <QuickActionsMenu quote={q} onDeleteRequest={() => setDeleteTarget(q)}
                          onActionDone={(ok, msg) => setToast({ kind: ok ? "success" : "error", msg })}
                          onRefresh={() => router.refresh()}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      {deleteTarget && (
        <DeleteModal quote={deleteTarget} onClose={() => setDeleteTarget(null)}
          onDone={() => { setDeleteTarget(null); router.refresh(); }} />
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-2 rounded-lg text-sm shadow-lg ${
          toast.kind === "success"
            ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30"
            : "bg-destructive/10 text-destructive border border-destructive/30"
        }`}>{toast.msg}</div>
      )}
    </>
  );
}

function QuickActionsMenu({
  quote, onDeleteRequest, onActionDone, onRefresh,
}: {
  quote: QuoteRow;
  onDeleteRequest: () => void;
  onActionDone: (ok: boolean, msg: string) => void;
  onRefresh: () => void;
}) {
  const t = useTranslations("quotes");
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const router = useRouter();

  const MENU_WIDTH = 256;
  const MENU_GAP = 4;

  const updatePosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    let left = rect.right - MENU_WIDTH;
    if (left < 8) left = 8;
    if (left + MENU_WIDTH > viewportW - 8) left = viewportW - MENU_WIDTH - 8;
    let top = rect.bottom + MENU_GAP;
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    if (menuHeight > 0 && top + menuHeight > viewportH - 8) {
      top = rect.top - MENU_GAP - menuHeight;
      if (top < 8) top = 8;
    }
    setMenuPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) { setMenuPos(null); return; }
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handler = () => updatePosition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const canDelete = !quote.convertedAt;
  const canAccept = quote.status === "SENT" || quote.status === "DRAFT";
  const canReject = quote.status === "SENT" || quote.status === "DRAFT";
  const canConvertToOC = !quote.convertedAt && quote.status !== "REJECTED";
  const canConvertToInvoice = !quote.convertedAt && quote.status !== "REJECTED";

  function markAccepted() {
    setOpen(false);
    startTransition(async () => {
      const res = await updateQuoteStatus(quote.id, "ACCEPTED");
      if (res.success) { onActionDone(true, t("status.ACCEPTED")); onRefresh(); }
      else onActionDone(false, res.error ?? "Fehler");
    });
  }
  function markRejected() {
    setOpen(false);
    startTransition(async () => {
      const res = await updateQuoteStatus(quote.id, "REJECTED");
      if (res.success) { onActionDone(true, t("status.REJECTED")); onRefresh(); }
      else onActionDone(false, res.error ?? "Fehler");
    });
  }
  function convertToOC() {
    setOpen(false);
    startTransition(async () => {
      const res = await convertQuoteToOrderConfirmation(quote.id);
      if (res.success) router.push(`/dashboard/order-confirmations/${res.id}`);
      else onActionDone(false, res.error ?? "Fehler");
    });
  }
  function convertToInvoice() {
    setOpen(false);
    router.push(`/dashboard/invoices/new?fromQuote=${quote.id}`);
  }

  return (
    <div className="relative inline-block">
      <button ref={buttonRef} type="button" onClick={() => setOpen((v) => !v)} disabled={isPending}
        title={t("quickActions.title")}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50">
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            top: menuPos?.top ?? 0,
            left: menuPos?.left ?? 0,
            width: MENU_WIDTH,
            visibility: menuPos ? "visible" : "hidden",
          }}
          className="z-50 bg-card border border-border rounded-lg shadow-xl py-1 text-sm"
        >
          {canAccept && (
            <MenuItem onClick={markAccepted} icon={<CircleCheckBig className="w-3.5 h-3.5" />}>
              {t("actions.markAsAccepted")}
            </MenuItem>
          )}
          {canReject && (
            <MenuItem onClick={markRejected} icon={<CircleX className="w-3.5 h-3.5" />}>
              {t("actions.markAsRejected")}
            </MenuItem>
          )}
          {canConvertToOC && (
            <MenuItem onClick={convertToOC} icon={<FileSignature className="w-3.5 h-3.5" />}>
              {t("actions.createOrderConfirmation")}
            </MenuItem>
          )}
          {canConvertToInvoice && (
            <MenuItem onClick={convertToInvoice} icon={<Receipt className="w-3.5 h-3.5" />}>
              {t("actions.createInvoice")}
            </MenuItem>
          )}
          <MenuLink href={`/dashboard/quotes/new?template=${quote.id}`} icon={<Copy className="w-3.5 h-3.5" />}
            onClose={() => setOpen(false)}>
            Als Vorlage verwenden
          </MenuLink>
          {canDelete && (
            <>
              <div className="my-1 border-t border-border" />
              <MenuItem onClick={() => { setOpen(false); onDeleteRequest(); }} icon={<Trash2 className="w-3.5 h-3.5" />} danger>
                {t("actions.delete")}
              </MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Clickable column header with an icon indicating sort state. The icon
 * uses three states so the user can tell at a glance which column drives
 * the order and which way (asc/desc), plus subtle muted "sortable, but
 * not active" affordance on the rest.
 */
function SortableHeader({
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
    <th className={`px-4 py-3 font-medium text-muted-foreground ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${isActive ? "text-foreground" : ""}`}
      >
        {label}
        {isActive ? (
          dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

function MenuItem({ children, onClick, icon, danger = false }: {
  children: React.ReactNode; onClick: () => void; icon: React.ReactNode; danger?: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted transition-colors ${danger ? "text-destructive" : "text-foreground"}`}>
      {icon}<span>{children}</span>
    </button>
  );
}

function MenuLink({ href, children, icon, onClose }: {
  href: string; children: React.ReactNode; icon: React.ReactNode; onClose: () => void;
}) {
  return (
    <Link href={href} onClick={onClose}
      className="w-full flex items-center gap-2 px-3 py-2 text-left text-foreground hover:bg-muted transition-colors">
      {icon}<span>{children}</span>
    </Link>
  );
}

function DeleteModal({ quote, onClose, onDone }: { quote: QuoteRow; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("quotes");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await deleteQuote(quote.id);
      if (res.success) onDone(); else setError(res.error ?? "Error");
    });
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-red-400" />
          </div>
          <h2 className="text-base font-semibold text-foreground">{t("deleteConfirm.title")}</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-2">{t("deleteConfirm.message")}</p>
        <p className="text-xs text-muted-foreground mb-4 font-mono">{quote.number}</p>
        {error && <p className="text-xs text-destructive mb-3">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-foreground hover:bg-accent transition-colors disabled:opacity-50">
            {t("deleteConfirm.cancel")}
          </button>
          <button onClick={confirm} disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50">
            <Trash2 className="w-4 h-4" />
            {isPending ? "…" : t("deleteConfirm.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
