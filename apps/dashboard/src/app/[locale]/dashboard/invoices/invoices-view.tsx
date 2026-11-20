"use client";

import { useMemo, useState, useTransition, useEffect, useRef, useLayoutEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import {
  FileText, Download, MoreHorizontal, Mail, CircleCheckBig,
  FileX2, Copy, Trash2, Search, Repeat, MessageCircle,
  ArrowUp, ArrowDown, ArrowUpDown,
} from "lucide-react";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import type { InvoiceStatus } from "@prisma/client";
import { INVOICE_STATUS_CLASSES } from "@/lib/invoice-status";
import { formatCurrency } from "@/lib/format";
import { deleteDraftInvoice, sendInvoiceEmail } from "./actions";

type TabFilter = "all" | "open" | "overdue" | "draft" | "paid";

export interface InvoiceRow {
  id: string;
  number: string;
  status: InvoiceStatus;
  type: "INVOICE" | "CREDIT_NOTE" | "CORRECTION";
  issueDate: string; // ISO
  dueDate: string | null;
  total: number;
  clientName: string;
  clientEmail: string | null;
  /** Non-null when this invoice was auto-generated from a recurring schedule. */
  recurringInvoiceId: string | null;
  openCommentCount: number;
}

function isOverdue(inv: InvoiceRow): boolean {
  if (inv.status === "OVERDUE") return true;
  if (inv.status !== "SENT") return false;
  if (!inv.dueDate) return false;
  return new Date(inv.dueDate).getTime() < Date.now();
}

function matchesTab(inv: InvoiceRow, tab: TabFilter): boolean {
  switch (tab) {
    case "all":     return true;
    case "draft":   return inv.status === "DRAFT";
    case "paid":    return inv.status === "PAID";
    case "overdue": return isOverdue(inv);
    case "open":    return inv.status === "SENT" && !isOverdue(inv);
  }
}

type SortKey = "number" | "client" | "issueDate" | "dueDate" | "total";
type SortDir = "asc" | "desc";

export function InvoicesView({
  invoices,
  canWrite = true,
}: {
  invoices: InvoiceRow[];
  /** Steuerberater dürfen nur PDF herunterladen und Entwürfe löschen,
   *  sonst keine Status-Änderungen. */
  canWrite?: boolean;
}) {
  const t = useTranslations("invoices");
  const tComments = useTranslations("comments");
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<InvoiceRow | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; msg: string } | null>(null);
  // Default: neueste Belegdatum-Sortierung — entspricht der bisherigen
  // Server-Reihenfolge, damit die initiale Ansicht stabil bleibt.
  const [sortKey, setSortKey] = useState<SortKey>("issueDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "number" || key === "client" ? "asc" : "desc");
    }
  }

  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(h);
  }, [toast]);

  const tabCounts = useMemo(() => ({
    all:     invoices.length,
    open:    invoices.filter((i) => matchesTab(i, "open")).length,
    overdue: invoices.filter((i) => matchesTab(i, "overdue")).length,
    draft:   invoices.filter((i) => matchesTab(i, "draft")).length,
    paid:    invoices.filter((i) => matchesTab(i, "paid")).length,
  }), [invoices]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const rows = invoices.filter((inv) => {
      if (!matchesTab(inv, activeTab)) return false;
      if (!q) return true;
      return inv.number.toLowerCase().includes(q) || inv.clientName.toLowerCase().includes(q);
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case "number": return a.number.localeCompare(b.number) * dir;
        case "client": return a.clientName.localeCompare(b.clientName) * dir;
        case "issueDate":
          return (new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime()) * dir;
        case "dueDate": {
          // Rechnungen ohne Fälligkeitsdatum (Drafts/Gutschriften) immer
          // ans Ende, unabhängig von der Sortierrichtung.
          const av = a.dueDate ? new Date(a.dueDate).getTime() : null;
          const bv = b.dueDate ? new Date(b.dueDate).getTime() : null;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return (av - bv) * dir;
        }
        case "total": return (a.total - b.total) * dir;
      }
    });
  }, [invoices, activeTab, searchQuery, sortKey, sortDir]);

  const {
    page, setPage, pageSize, setPageSize, total, totalPages, paged,
  } = usePagination(filtered);

  const tabs: { key: TabFilter; labelKey: string }[] = [
    { key: "all",     labelKey: "tabs.all" },
    { key: "open",    labelKey: "tabs.open" },
    { key: "overdue", labelKey: "tabs.overdue" },
    { key: "draft",   labelKey: "tabs.draft" },
    { key: "paid",    labelKey: "tabs.paid" },
  ];

  return (
    <>
      {/* Tabs + Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map(({ key, labelKey }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === key
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {t(labelKey)}
              <span className={`text-xs tabular-nums px-1.5 py-0.5 rounded-full ${
                activeTab === key ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
              }`}>
                {tabCounts[key]}
              </span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-muted/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40"
          />
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-visible">
        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.status")}</th>
                <SortableHeader label={t("table.dueDate")}   sortKey="dueDate"   current={sortKey} dir={sortDir} onClick={() => toggleSort("dueDate")} />
                <SortableHeader label={t("table.number")}    sortKey="number"    current={sortKey} dir={sortDir} onClick={() => toggleSort("number")} />
                <SortableHeader label={t("table.client")}    sortKey="client"    current={sortKey} dir={sortDir} onClick={() => toggleSort("client")} />
                <SortableHeader label={t("table.issueDate")} sortKey="issueDate" current={sortKey} dir={sortDir} onClick={() => toggleSort("issueDate")} />
                <SortableHeader label={t("table.total")}     sortKey="total"     current={sortKey} dir={sortDir} onClick={() => toggleSort("total")} align="right" />
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  {t("empty")}
                </td></tr>
              ) : paged.map((inv) => {
                // A SENT invoice past its due date is *effectively* OVERDUE
                // even when the DB record hasn't been flipped yet (the status
                // transition is driven by a scheduled job). Render the visual
                // state so the user sees reality, not the stale flag.
                const displayStatus: InvoiceStatus = isOverdue(inv) ? "OVERDUE" : inv.status;
                const isClosed = inv.status === "PAID" || inv.status === "CANCELLED";
                const isCancelled = inv.status === "CANCELLED";
                return (
                <tr
                  key={inv.id}
                  onClick={(e) => {
                    // Skip navigation if the click originated on an interactive
                    // child (action button, status link, inner <a>). Otherwise
                    // the row itself is a shortcut to the detail page.
                    const el = e.target as HTMLElement;
                    if (el.closest("button, a")) return;
                    router.push(`/dashboard/invoices/${inv.id}`);
                  }}
                  className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer ${
                    isCancelled ? "opacity-60" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${INVOICE_STATUS_CLASSES[displayStatus]}`}>
                      {t(`status.${displayStatus}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {inv.dueDate ? (
                      <span className={isClosed ? "line-through text-muted-foreground" : "text-muted-foreground"}>
                        {new Date(inv.dueDate).toLocaleDateString("de-DE")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link href={`/dashboard/invoices/${inv.id}`} className="font-medium text-foreground hover:underline">
                        {inv.number}
                      </Link>
                      {inv.type === "CREDIT_NOTE" && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-500/10 text-violet-400 leading-none">
                          {t("creditNoteType")}
                        </span>
                      )}
                      {inv.type === "CORRECTION" && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 leading-none">
                          {t("correctionType")}
                        </span>
                      )}
                      {inv.recurringInvoiceId && (
                        // Auto-generated from a recurring schedule — icon-only,
                        // links straight to the template. Tooltip on hover.
                        <Link
                          href={`/dashboard/invoices/recurring/${inv.recurringInvoiceId}`}
                          onClick={(e) => e.stopPropagation()}
                          title={t("recurringBadge")}
                          aria-label={t("recurringBadge")}
                          className="inline-flex items-center justify-center w-5 h-5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                        >
                          <Repeat className="w-3 h-3" />
                        </Link>
                      )}
                      {inv.openCommentCount > 0 && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold"
                          title={tComments("openBadge", { count: inv.openCommentCount })}
                        >
                          <MessageCircle className="w-3 h-3" />
                          {inv.openCommentCount}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-foreground">{inv.clientName}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(inv.issueDate).toLocaleDateString("de-DE")}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-foreground tabular-nums">
                    {formatCurrency(inv.total)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <a href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noopener"
                        title={t("downloadPdf")}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        <Download className="w-3.5 h-3.5" />
                      </a>
                      <QuickActionsMenu
                        invoice={inv}
                        canWrite={canWrite}
                        onDeleteRequest={() => setDeleteTarget(inv)}
                        onResendDone={(ok, msg) =>
                          setToast({ kind: ok ? "success" : "error", msg })
                        }
                        onResendRefresh={() => router.refresh()}
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
        <DeleteDraftModal
          invoice={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDone={() => {
            setDeleteTarget(null);
            router.refresh();
          }}
        />
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-2 rounded-lg text-sm shadow-lg ${
          toast.kind === "success"
            ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30"
            : "bg-destructive/10 text-destructive border border-destructive/30"
        }`}>
          {toast.msg}
        </div>
      )}
    </>
  );
}

// ─── Quick actions dropdown ──────────────────────────────────────────────────

function QuickActionsMenu({
  invoice,
  canWrite,
  onDeleteRequest,
  onResendDone,
  onResendRefresh,
}: {
  invoice: InvoiceRow;
  canWrite: boolean;
  onDeleteRequest: () => void;
  onResendDone: (ok: boolean, msg: string) => void;
  onResendRefresh: () => void;
}) {
  const t = useTranslations("invoices");
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const MENU_WIDTH = 256; // w-64
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

  // Berater sehen nur Aktionen, die keine Rechnungsstellung implizieren:
  // Entwürfe löschen + PDF-Download (außerhalb des Menüs). Alles andere
  // (Versand, Zahlung markieren, Stornorechnung, Template kopieren) ist
  // Mandanten-Job.
  const canResend = canWrite && (invoice.status === "SENT" || invoice.status === "OVERDUE") && !!invoice.clientEmail;
  const canMarkPaid = canWrite && (invoice.status === "SENT" || invoice.status === "OVERDUE");
  const canCreditNote = canWrite && (invoice.status === "SENT" || invoice.status === "PAID");
  const canUseAsTemplate = canWrite;
  const canDelete = invoice.status === "DRAFT";

  function handleResend() {
    setOpen(false);
    startTransition(async () => {
      const res = await sendInvoiceEmail(invoice.id, null);
      if (res.success) {
        onResendDone(true, t("quickActions.resendSuccess"));
        onResendRefresh();
      } else {
        onResendDone(false, res.error ?? t("quickActions.resendError"));
      }
    });
  }

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        title={t("quickActions.title")}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
      >
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
          {canResend && (
            <MenuItem onClick={handleResend} icon={<Mail className="w-3.5 h-3.5" />}>
              {t("quickActions.resendEmail")}
            </MenuItem>
          )}
          {canMarkPaid && (
            <MenuLink
              href={`/dashboard/invoices/${invoice.id}?pay=1`}
              icon={<CircleCheckBig className="w-3.5 h-3.5" />}
              onClose={() => setOpen(false)}
            >
              {t("quickActions.markAsPaid")}
            </MenuLink>
          )}
          {canCreditNote && (
            <MenuLink
              href={`/dashboard/invoices/${invoice.id}?cn=1`}
              icon={<FileX2 className="w-3.5 h-3.5" />}
              onClose={() => setOpen(false)}
            >
              {t("quickActions.createCreditNote")}
            </MenuLink>
          )}
          {canUseAsTemplate && (
            <MenuLink
              href={`/dashboard/invoices/new?template=${invoice.id}`}
              icon={<Copy className="w-3.5 h-3.5" />}
              onClose={() => setOpen(false)}
            >
              {t("quickActions.useAsTemplate")}
            </MenuLink>
          )}
          {canDelete && (
            <>
              <div className="my-1 border-t border-border" />
              <MenuItem
                onClick={() => {
                  setOpen(false);
                  onDeleteRequest();
                }}
                icon={<Trash2 className="w-3.5 h-3.5" />}
                danger
              >
                {t("quickActions.delete")}
              </MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children, onClick, icon, danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  icon: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted transition-colors ${
        danger ? "text-destructive" : "text-foreground"
      }`}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function MenuLink({
  href, children, icon, onClose,
}: {
  href: string;
  children: React.ReactNode;
  icon: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className="w-full flex items-center gap-2 px-3 py-2 text-left text-foreground hover:bg-muted transition-colors"
    >
      {icon}
      <span>{children}</span>
    </Link>
  );
}

// ─── Sortable header cell ────────────────────────────────────────────────────

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

// ─── Delete draft modal ──────────────────────────────────────────────────────

function DeleteDraftModal({
  invoice, onClose, onDone,
}: {
  invoice: InvoiceRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("invoices");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await deleteDraftInvoice(invoice.id);
      if (res.success) onDone();
      else setError(res.error ?? "Error");
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
          <h2 className="text-base font-semibold text-foreground">{t("deleteDraft.title")}</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-2">{t("deleteDraft.message")}</p>
        <p className="text-xs text-muted-foreground mb-4 font-mono">{invoice.number}</p>
        {error && <p className="text-xs text-destructive mb-3">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-foreground hover:bg-accent transition-colors disabled:opacity-50">
            {t("cancelConfirmAbort")}
          </button>
          <button onClick={confirm} disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50">
            <Trash2 className="w-4 h-4" />
            {isPending ? "…" : t("deleteDraft.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
