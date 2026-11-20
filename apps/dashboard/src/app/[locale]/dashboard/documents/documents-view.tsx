"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  FileText, Image, Trash2, Loader2,
  X, CheckCircle2, AlertCircle, Clock, AlertTriangle,
  Pencil, Banknote, RefreshCw, Search, Plus,
  ArrowUp, ArrowDown, ArrowUpDown, MessageCircle,
  AtSign, Smartphone,
} from "lucide-react";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { Link, useRouter } from "@/i18n/navigation";
import { formatCurrency, formatFileSize, fmtDateShort } from "@/lib/format";
import { markDocumentAsPaid, markDocumentAsUnpaid } from "./actions";
import { PaymentSidePanel } from "./[id]/payment-side-panel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocumentRow {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: "PENDING" | "PROCESSING" | "DONE" | "DRAFT" | "FAILED" | "PAID";
  source: "MANUAL" | "MOBILE" | "EMAIL";
  documentType: "INCOME" | "EXPENSE" | null;
  recognizedAmount: string | null;
  recognizedDate: string | null;
  recognizedSupplier: string | null;
  dueDate: string | null;
  // Belegwährung + EUR-Kurs (für das Payment-SidePanel, das aus der Liste
  // heraus geöffnet werden kann). Bei EUR-Belegen bleibt currency = "EUR"
  // und exchangeRate = null.
  currency: string;
  exchangeRate: string | null;
  isPaid: boolean;
  createdAt: string;
  uploadedBy: { firstName: string | null; lastName: string | null } | null;
  openCommentCount: number;
}

type TabFilter = "all" | "draft" | "open" | "overdue" | "paid";
type SortKey = "fileName" | "supplier" | "dueDate" | "amount" | "createdAt";
type SortDir = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isOverdue(doc: DocumentRow): boolean {
  if (doc.isPaid || !doc.dueDate) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(doc.dueDate); due.setHours(0, 0, 0, 0);
  return due < today;
}

function matchesTab(doc: DocumentRow, tab: TabFilter): boolean {
  switch (tab) {
    case "all": return true;
    case "draft": return doc.status === "DRAFT";
    case "paid": return doc.isPaid;
    case "overdue": return isOverdue(doc);
    case "open":
      return !doc.isPaid && doc.status !== "DRAFT" &&
             doc.status !== "PENDING" && doc.status !== "PROCESSING" &&
             doc.status !== "FAILED";
  }
}

// ─── DocumentTypeBadge ────────────────────────────────────────────────────────

function DocumentTypeBadge({ type }: { type: "INCOME" | "EXPENSE" | null }) {
  const t = useTranslations("documents");
  if (!type) return <span className="text-xs text-muted-foreground/50">—</span>;
  const isIncome = type === "INCOME";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${
      isIncome
        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
        : "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30"
    }`}>
      {t(`documentType.${type}`)}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DocumentsView({ documents: initialDocuments }: { documents: DocumentRow[] }) {
  const t = useTranslations("documents");
  const tComments = useTranslations("comments");
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentRow[]>(initialDocuments);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [unpaidConfirm, setUnpaidConfirm] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [, startTransition] = useTransition();

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "fileName" || key === "supplier" ? "asc" : "desc");
    }
  }
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  // Wenn gesetzt, ist das PaymentSidePanel für den geklickten Beleg offen.
  const [paymentTarget, setPaymentTarget] = useState<DocumentRow | null>(null);

  // ── Payment badge helper ────────────────────────────────────────────────────

  function getPaymentBadge(doc: DocumentRow): { label: string; className: string; icon: React.ReactNode } {
    if (doc.status === "PENDING" || doc.status === "PROCESSING") {
      return {
        label: t("paymentStatus.processing"),
        className: "bg-blue-500/10 text-blue-500",
        icon: <Loader2 className="w-3 h-3 animate-spin" />,
      };
    }

    if (doc.status === "FAILED") {
      return {
        label: t("status.FAILED"),
        className: "bg-destructive/10 text-destructive",
        icon: <AlertCircle className="w-3 h-3" />,
      };
    }

    if (doc.status === "DRAFT") {
      return {
        label: t("paymentStatus.draft"),
        className: "bg-muted text-muted-foreground",
        icon: <Clock className="w-3 h-3" />,
      };
    }

    if (doc.isPaid) {
      return {
        label: t("paymentStatus.paid"),
        className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        icon: <CheckCircle2 className="w-3 h-3" />,
      };
    }

    if (!doc.dueDate) {
      return {
        label: t("paymentStatus.noDueDate"),
        className: "bg-muted text-muted-foreground",
        icon: <Clock className="w-3 h-3" />,
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(doc.dueDate);
    dueDate.setHours(0, 0, 0, 0);
    const msPerDay = 1000 * 60 * 60 * 24;
    const days = Math.round((dueDate.getTime() - today.getTime()) / msPerDay);

    if (days < 0) {
      return {
        label: t("paymentStatus.overdue"),
        className: "bg-destructive/10 text-destructive",
        icon: <AlertTriangle className="w-3 h-3" />,
      };
    }

    if (days === 0) {
      return {
        label: t("paymentStatus.dueToday"),
        className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        icon: <AlertTriangle className="w-3 h-3" />,
      };
    }

    if (days <= 7) {
      return {
        label: t("paymentStatus.dueSoon"),
        className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        icon: <Clock className="w-3 h-3" />,
      };
    }

    return {
      label: t("paymentStatus.open"),
      className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      icon: <CheckCircle2 className="w-3 h-3" />,
    };
  }

  // ── Tab counts ──────────────────────────────────────────────────────────────

  const tabCounts = {
    all: documents.length,
    draft: documents.filter((d) => matchesTab(d, "draft")).length,
    open: documents.filter((d) => matchesTab(d, "open")).length,
    overdue: documents.filter((d) => matchesTab(d, "overdue")).length,
    paid: documents.filter((d) => matchesTab(d, "paid")).length,
  };

  // ── Filtered documents ──────────────────────────────────────────────────────

  const filteredDocuments = useMemo(() => {
    const rows = documents.filter((doc) => {
      if (!matchesTab(doc, activeTab)) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          doc.fileName.toLowerCase().includes(q) ||
          (doc.recognizedSupplier?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case "fileName": return a.fileName.localeCompare(b.fileName) * dir;
        case "supplier": {
          // Belege ohne erkannten Lieferanten ans Ende sortieren —
          // das sind in der Regel noch unbearbeitete Uploads.
          const av = a.recognizedSupplier?.trim() ?? "";
          const bv = b.recognizedSupplier?.trim() ?? "";
          if (!av && !bv) return 0;
          if (!av) return 1;
          if (!bv) return -1;
          return av.localeCompare(bv) * dir;
        }
        case "dueDate": {
          const av = a.dueDate ? new Date(a.dueDate).getTime() : null;
          const bv = b.dueDate ? new Date(b.dueDate).getTime() : null;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return (av - bv) * dir;
        }
        case "amount": {
          // Beträge sind als String gespeichert (Decimal-Serialisierung).
          // parseFloat ist hier ausreichend, weil die Quelle bereits
          // normalisiert wurde (siehe Document-Loader).
          const av = a.recognizedAmount ? parseFloat(a.recognizedAmount) : null;
          const bv = b.recognizedAmount ? parseFloat(b.recognizedAmount) : null;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return (av - bv) * dir;
        }
        case "createdAt":
          return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
      }
    });
  }, [documents, activeTab, searchQuery, sortKey, sortDir]);

  const {
    page, setPage, pageSize, setPageSize, total, totalPages, paged,
  } = usePagination(filteredDocuments);

  // ── Quick actions ──────────────────────────────────────────────────────────

  // Öffnet das PaymentSidePanel für den geklickten Beleg statt direkt zu
  // buchen. Der eigentliche markDocumentAsPaid-Call passiert im SidePanel-
  // Confirm (mit Bank-Transaktions-Verknüpfung, Datum, Differenzgrund etc.).
  function handleQuickPaid(e: React.MouseEvent, doc: DocumentRow) {
    e.preventDefault();
    e.stopPropagation();
    setPaymentTarget(doc);
  }

  async function handleConfirmUnpaid(e: React.MouseEvent, docId: string) {
    e.preventDefault();
    e.stopPropagation();
    setPendingAction(docId);
    setUnpaidConfirm(null);
    startTransition(async () => {
      const result = await markDocumentAsUnpaid(docId);
      if (result.success) {
        setDocuments((prev) =>
          prev.map((d) => d.id === docId ? { ...d, isPaid: false, status: "DONE" as const } : d)
        );
      }
      setPendingAction(null);
      router.refresh();
    });
  }

  // ── Delete handler ──────────────────────────────────────────────────────────

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    const res = await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      setDeleteConfirm(null);
    }
  }

  // ── Tab config ──────────────────────────────────────────────────────────────

  const tabs: { key: TabFilter; labelKey: string }[] = [
    { key: "all", labelKey: "tabs.all" },
    { key: "open", labelKey: "tabs.open" },
    { key: "overdue", labelKey: "tabs.overdue" },
    { key: "draft", labelKey: "tabs.draft" },
    { key: "paid", labelKey: "tabs.paid" },
  ];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("pageTitle")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
        </div>
        <Link
          href="/dashboard/documents/new"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" />
          {t("listCta")}
        </Link>
      </div>

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
                activeTab === key
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground"
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
            placeholder={t("filter.search")}
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-muted/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40"
          />
        </div>
      </div>

      {/* Document list */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.paymentStatus")}</th>
                <SortableHeader label={t("table.fileName")}         sortKey="fileName" current={sortKey} dir={sortDir} onClick={() => toggleSort("fileName")} />
                <SortableHeader label={t("table.supplier")}         sortKey="supplier" current={sortKey} dir={sortDir} onClick={() => toggleSort("supplier")} />
                <SortableHeader label={t("detail.fields.dueDate")}  sortKey="dueDate"  current={sortKey} dir={sortDir} onClick={() => toggleSort("dueDate")} />
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.documentType")}</th>
                <SortableHeader label={t("table.recognizedAmount")} sortKey="amount"   current={sortKey} dir={sortDir} onClick={() => toggleSort("amount")} align="right" />
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocuments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    {t("empty")}
                  </td>
                </tr>
              ) : paged.map((doc) => {
                const badge = getPaymentBadge(doc);
                const isActionPending = pendingAction === doc.id;
                const canTogglePayment = doc.status !== "DRAFT" && doc.status !== "PENDING" &&
                                         doc.status !== "PROCESSING" && doc.status !== "FAILED";
                // Rows that no longer demand attention (failed OCR) are
                // visually muted so the active queue reads first.
                const isInactive = doc.status === "FAILED";
                return (
                  <tr
                    key={doc.id}
                    onClick={(e) => {
                      const el = e.target as HTMLElement;
                      if (el.closest("button, a")) return;
                      router.push(`/dashboard/documents/${doc.id}`);
                    }}
                    className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors group cursor-pointer ${
                      isInactive ? "opacity-60" : ""
                    }`}
                  >
                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ${badge.className}`}>
                        {badge.icon}
                        {badge.label}
                      </span>
                    </td>
                    {/* File name */}
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/documents/${doc.id}`}
                        className="flex items-center gap-2 min-w-0"
                      >
                        {doc.fileType.startsWith("image/") ? (
                          <Image className="w-4 h-4 text-muted-foreground shrink-0" />
                        ) : (
                          <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="font-medium text-foreground group-hover:text-primary transition-colors truncate max-w-[200px]">
                          {doc.fileName}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(doc.fileSize)}</span>
                        {doc.source === "EMAIL" && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-medium shrink-0"
                            title={t("source.EMAIL")}
                          >
                            <AtSign className="w-3 h-3" />
                            {t("source.EMAIL")}
                          </span>
                        )}
                        {doc.source === "MOBILE" && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[11px] font-medium shrink-0"
                            title={t("source.MOBILE")}
                          >
                            <Smartphone className="w-3 h-3" />
                            {t("source.MOBILE")}
                          </span>
                        )}
                        {doc.openCommentCount > 0 && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold shrink-0"
                            title={tComments("openBadge", { count: doc.openCommentCount })}
                          >
                            <MessageCircle className="w-3 h-3" />
                            {doc.openCommentCount}
                          </span>
                        )}
                      </Link>
                    </td>
                    {/* Supplier */}
                    <td className="px-4 py-3 text-muted-foreground truncate max-w-[150px]">
                      {doc.recognizedSupplier ?? "—"}
                    </td>
                    {/* Due Date */}
                    <td className="px-4 py-3">
                      {doc.dueDate ? (
                        <span className={doc.isPaid ? "line-through text-muted-foreground" : "text-foreground"}>
                          {fmtDateShort(doc.dueDate)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    {/* Type */}
                    <td className="px-4 py-3">
                      <DocumentTypeBadge type={doc.documentType} />
                    </td>
                    {/* Amount */}
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                      {formatCurrency(doc.recognizedAmount)}
                    </td>
                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* Edit */}
                        <Link
                          href={`/dashboard/documents/${doc.id}`}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                          title={t("actions.edit")}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Link>

                        {/* Mark as paid / unpaid */}
                        {canTogglePayment && (
                          doc.isPaid ? (
                            unpaidConfirm === doc.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={(e) => handleConfirmUnpaid(e, doc.id)}
                                  disabled={isActionPending}
                                  className="px-2 py-1 text-xs font-medium text-amber-600 bg-amber-500/10 rounded hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                                >
                                  {isActionPending ? <Loader2 className="w-3 h-3 animate-spin inline" /> : t("actions.confirmUnpaid")}
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setUnpaidConfirm(null); }}
                                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setUnpaidConfirm(doc.id); }}
                                disabled={isActionPending}
                                className="p-1.5 rounded-md text-muted-foreground hover:text-amber-600 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                                title={t("actions.markAsOpen")}
                              >
                                {isActionPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                              </button>
                            )
                          ) : (
                            <button
                              onClick={(e) => handleQuickPaid(e, doc)}
                              disabled={isActionPending}
                              className="p-1.5 rounded-md text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
                              title={t("actions.markAsPaid")}
                            >
                              {isActionPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Banknote className="w-3.5 h-3.5" />}
                            </button>
                          )
                        )}

                        {/* Delete */}
                        {deleteConfirm === doc.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => handleDelete(e, doc.id)}
                              className="px-2 py-1 text-xs font-medium text-destructive bg-destructive/10 rounded hover:bg-destructive/20 transition-colors"
                            >
                              {t("confirmDelete")}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); }}
                              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteConfirm(doc.id); }}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title={t("delete")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
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

      {/* SortableHeader siehe Funktionsdefinition am Datei-Ende. */}

      {/* ── Payment-Side-Panel (geöffnet aus Quick-Action „Als bezahlt") ── */}
      {paymentTarget && (() => {
        const totalGross = parseFloat(paymentTarget.recognizedAmount ?? "0") || 0;
        const rate = paymentTarget.exchangeRate ? parseFloat(paymentTarget.exchangeRate) : null;
        const totalGrossEUR = paymentTarget.currency === "EUR" || !rate
          ? totalGross
          : Math.round(totalGross * rate * 100) / 100;
        return (
          <PaymentSidePanel
            open={true}
            onClose={() => setPaymentTarget(null)}
            doc={{
              id: paymentTarget.id,
              supplier: paymentTarget.recognizedSupplier ?? paymentTarget.fileName,
              totalGross,
              totalGrossEUR,
              currency: paymentTarget.currency,
              exchangeRate: rate,
              docDate: paymentTarget.recognizedDate?.slice(0, 10)
                ?? paymentTarget.createdAt.slice(0, 10),
              dueDate: paymentTarget.dueDate ? paymentTarget.dueDate.slice(0, 10) : null,
            }}
            onConfirm={async (data) => {
              const targetId = paymentTarget.id;
              setPaymentTarget(null);
              setPendingAction(targetId);
              const res = await markDocumentAsPaid(targetId, data.paidAt, data.method, {
                amount: data.amount,
                bankAccountId: data.bankAccountId,
                bankTransactionId: data.bankTransactionId,
                differenceReason: data.differenceReason,
                differenceNote: data.differenceNote,
              });
              if (res.success) {
                setDocuments((prev) =>
                  prev.map((d) => d.id === targetId
                    ? { ...d, isPaid: true, status: "PAID" as const }
                    : d,
                  ),
                );
              }
              setPendingAction(null);
              startTransition(() => router.refresh());
            }}
          />
        );
      })()}
    </div>
  );
}

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
