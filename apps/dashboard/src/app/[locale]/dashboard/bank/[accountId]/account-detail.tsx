"use client";

import { useState, useTransition, useRef, useCallback, useMemo, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  Plus, Upload, Search, Link2, Link2Off, EyeOff, Eye,
  ArrowUpRight, ArrowDownLeft, FileText, AlertTriangle, X, UserRound,
  ArrowUp, ArrowDown, ArrowUpDown, Trash2, Settings, Sparkles, Info, CheckCircle2, MessageCircle,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { formatCurrency, fmtDateShort } from "@/lib/format";
import { formatIban } from "@/lib/bank-utils";
import {
  createTransaction,
  unmatchTransaction,
  ignoreTransaction,
  unignoreTransaction,
  togglePrivateTransaction,
  deleteTransaction,
  autoMatchBankAccount,
  type AutoMatchResult,
} from "../actions";
import { cn } from "@/lib/utils";
import { MatchPicker } from "./match-picker";
import { CsvImportDialog } from "./csv-import-dialog";
import { EditBankAccountDialog } from "./edit-account-dialog";
import { TxActionsMenu } from "./tx-actions-menu";
import { CommentSection } from "@/components/comments/comment-section";
import type { CommentDTO } from "@/lib/comments/queries";

interface TransactionRow {
  id: string;
  date: string;
  valueDate: string | null;
  amount: number;
  counterpartName: string | null;
  counterpartIban: string | null;
  purpose: string | null;
  category: string | null;
  status: "UNMATCHED" | "MATCHED" | "IGNORED";
  importSource: string;
  documentId: string | null;
  documentName: string | null;
  invoiceId: string | null;
  invoiceLabel: string | null;
  isPrivate: boolean;
  autoMatched: boolean;
  openCommentCount: number;
}

interface AccountInfo {
  id: string;
  name: string;
  /** "BANK" or "CLEARING". Only BANK supports the in-place edit dialog;
   * a CLEARING gear click falls back to the accounts page. */
  type: "BANK" | "CLEARING";
  bankName: string | null;
  iban: string | null;
  bic: string | null;
  openingBalance: number;
  bookingAccount: string | null;
  isDefault: boolean;
  /**
   * Raw JSON blob holding the persisted CSV column mapping for this
   * account (or null if the user hasn't set one yet). Typed as
   * `unknown` deliberately — the import dialog runs it through
   * parseCsvMappingPreset so schema validation stays in one place.
   */
  csvMapping: unknown;
}

interface AccountDetailProps {
  account: AccountInfo;
  transactions: TransactionRow[];
  /** ID of the current user — passed into the comments drawer. */
  currentUserId: string;
  /** Permission gates for the inline comments drawer. */
  canWriteComments: boolean;
  canResolveComments: boolean;
  /** Pre-fetched comments keyed by transaction-id. Empty list if none. */
  commentsByTxId: Record<string, CommentDTO[]>;
}

export function AccountDetail({
  account,
  transactions,
  currentUserId,
  canWriteComments,
  canResolveComments,
  commentsByTxId,
}: AccountDetailProps) {
  const t = useTranslations("bank.transactions");
  const tFilter = useTranslations("bank.transactions.filter");
  const tStatus = useTranslations("bank.transactions.status");
  const tComments = useTranslations("comments");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Add transaction form
  const [showAddForm, setShowAddForm] = useState(false);
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
  const [txAmount, setTxAmount] = useState("");
  const [txCounterpart, setTxCounterpart] = useState("");
  const [txPurpose, setTxPurpose] = useState("");
  const [txType, setTxType] = useState<"income" | "expense">("expense");

  // Match picker
  const [matchFor, setMatchFor] = useState<TransactionRow | null>(null);

  // Ignore confirmation
  const [ignoreFor, setIgnoreFor] = useState<TransactionRow | null>(null);

  // Comment drawer — open per transaction, fetches from the pre-loaded
  // map (no extra round-trip). Mutations go through the CommentSection's
  // server actions, which call router.refresh() and re-hydrate the map.
  const [commentFor, setCommentFor] = useState<TransactionRow | null>(null);

  // Direct-Jump: kommt der User aus einer Notification mit `?txn={id}`,
  // direkt das Comment-Drawer für diese Transaktion öffnen. Wir lesen
  // den Param nur beim ersten Render — danach übernimmt setCommentFor
  // die Steuerung, damit ein Schließen den Drawer nicht sofort wieder
  // aufmacht.
  const txnHandledRef = useRef(false);
  useEffect(() => {
    if (txnHandledRef.current) return;
    const sp = new URLSearchParams(window.location.search);
    const txnId = sp.get("txn");
    if (!txnId) return;
    txnHandledRef.current = true;
    const target = transactions.find((tx) => tx.id === txnId);
    if (target) setCommentFor(target);
  }, [transactions]);

  // Import
  const fileInputRef = useRef<HTMLInputElement>(null);
  // We hold the raw bytes (not pre-decoded text) so the dialog can
  // re-decode under different encodings selected in Importoptionen.
  const [csvBytes, setCsvBytes] = useState<ArrayBuffer | null>(null);

  // Edit-account dialog (gear icon in header).
  const [showEditAccount, setShowEditAccount] = useState(false);

  // Auto-match flow: button kicks off the routine; the result modal
  // shows the summary once the server returns. `isAutoMatching` is
  // separate from `isPending` so the regular row actions stay clickable.
  const [isAutoMatching, setIsAutoMatching] = useState(false);
  const [autoMatchResult, setAutoMatchResult] = useState<AutoMatchResult | null>(null);

  function runAutoMatch() {
    if (isAutoMatching) return;
    setIsAutoMatching(true);
    (async () => {
      const res = await autoMatchBankAccount(account.id);
      setIsAutoMatching(false);
      if (res.success) {
        setAutoMatchResult(res.result);
        router.refresh();
      }
    })();
  }

  // Multi-select for bulk actions (privat markieren / ignorieren / löschen).
  // Held as a Set so toggling is O(1) and JSON-stringify never matters.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const anySelected = selectedIds.size > 0;

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Sorting. `key=null` means "preserve server order" — we only kick
  // in once the user explicitly clicks a sortable header, so we don't
  // accidentally override whatever the data-loader chose to ship.
  type SortKey = "date" | "amount" | "status" | "name";
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: SortKey) {
    // Side-effecting setters (here: calling setSortDir from inside
    // setSortKey's updater) get double-invoked under React StrictMode,
    // which silently toggles the direction twice on the second click —
    // so clicks 2, 4, 6… appeared to "do nothing". Keep both setters
    // at the top level instead.
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      // First click on a new column → most-useful default per column:
      // dates and amounts read newest/largest first; status reads in
      // workflow order (UNMATCHED → MATCHED → IGNORED); name reads A→Z.
      setSortKey(key);
      setSortDir(key === "status" || key === "name" ? "asc" : "desc");
    }
  }

  // Calculate running balance — IGNORED transactions are excluded.
  const balance = transactions
    .filter((tx) => tx.status !== "IGNORED")
    .reduce((s, tx) => s + tx.amount, account.openingBalance);

  // Filter transactions
  const filtered = transactions.filter((tx) => {
    if (statusFilter !== "all" && tx.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        tx.counterpartName?.toLowerCase().includes(q) ||
        tx.purpose?.toLowerCase().includes(q) ||
        tx.counterpartIban?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Sort the filtered list. Status uses a fixed workflow weighting
  // (UNMATCHED first) so "asc" gives the user the rows that still need
  // attention at the top — the most useful default for that column.
  const sortedFiltered = useMemo(() => {
    if (!sortKey) return filtered;
    const STATUS_WEIGHT: Record<TransactionRow["status"], number> = {
      UNMATCHED: 0,
      MATCHED: 1,
      IGNORED: 2,
    };
    const dir = sortDir === "asc" ? 1 : -1;
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") {
        cmp = a.date.localeCompare(b.date);
      } else if (sortKey === "amount") {
        cmp = a.amount - b.amount;
      } else if (sortKey === "name") {
        // Leere/fehlende Namen ans Ende sortieren — egal in welcher
        // Richtung; "kein Name" ist immer weniger informativ als irgendeiner.
        const an = a.counterpartName?.trim() ?? "";
        const bn = b.counterpartName?.trim() ?? "";
        if (!an && !bn) cmp = 0;
        else if (!an) return 1;
        else if (!bn) return -1;
        else cmp = an.localeCompare(bn, undefined, { sensitivity: "base" });
      } else {
        cmp = STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status];
      }
      return cmp * dir;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  // Selection-derived flags. Computed against `transactions` (not just
  // the visible set) because the toolbar still applies to any selected
  // rows the user filtered out after selecting.
  const hasPrivateInSelection = useMemo(
    () => transactions.some((tx) => selectedIds.has(tx.id) && tx.isPrivate),
    [transactions, selectedIds],
  );

  function handleAddTransaction(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmount = parseFloat(txAmount);
    if (isNaN(parsedAmount)) return;

    startTransition(async () => {
      const result = await createTransaction({
        bankAccountId: account.id,
        date: txDate,
        amount: txType === "expense" ? -Math.abs(parsedAmount) : Math.abs(parsedAmount),
        counterpartName: txCounterpart || null,
        purpose: txPurpose || null,
      });
      if (result.success) {
        setShowAddForm(false);
        setTxAmount("");
        setTxCounterpart("");
        setTxPurpose("");
        router.refresh();
      }
    });
  }

  function handleUnmatch(txId: string) {
    startTransition(async () => {
      await unmatchTransaction(txId);
      router.refresh();
    });
  }

  function confirmIgnore() {
    if (!ignoreFor) return;
    const id = ignoreFor.id;
    startTransition(async () => {
      await ignoreTransaction(id);
      setIgnoreFor(null);
      router.refresh();
    });
  }

  function handleUnignore(txId: string) {
    startTransition(async () => {
      await unignoreTransaction(txId);
      router.refresh();
    });
  }

  /**
   * Bulk handlers: loop the existing per-row server actions inside a
   * single transition. For typical statements (tens to a few hundred
   * rows) this is fine; if it ever bites, the cure is a dedicated
   * bulk endpoint that does a single DB updateMany + journal batch.
   *
   * We always clear the selection after the action completes so the
   * user can immediately see the resulting state without lingering
   * checkmarks on rows that may have moved out of the current filter.
   */
  function bulkSetPrivate(isPrivate: boolean) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    startTransition(async () => {
      for (const id of ids) {
        await togglePrivateTransaction(id, isPrivate);
      }
      clearSelection();
      router.refresh();
    });
  }
  function bulkIgnore() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    startTransition(async () => {
      for (const id of ids) {
        // ignoreTransaction is a no-op if the tx is already IGNORED, so
        // mixed-status selections are safe to bulk-ignore.
        await ignoreTransaction(id);
      }
      clearSelection();
      router.refresh();
    });
  }
  function bulkUnignore() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    startTransition(async () => {
      for (const id of ids) {
        await unignoreTransaction(id);
      }
      clearSelection();
      router.refresh();
    });
  }
  function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    // Destructive + irreversible — make the user confirm. A full modal
    // would be nicer UX-wise but the native confirm keeps the surface
    // area small and matches the "minimal UI" mandate from the user.
    if (!window.confirm(t("confirmBulkDelete", { count: ids.length }))) return;
    startTransition(async () => {
      for (const id of ids) {
        await deleteTransaction(id);
      }
      clearSelection();
      router.refresh();
    });
  }

  const handleFileImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      const ext = file.name.toLowerCase().split(".").pop();
      if (ext !== "csv" && ext !== "txt") {
        // Non-CSV import formats (MT940/CAMT.053) not yet wired here.
        return;
      }

      const bytes = await file.arrayBuffer();
      setCsvBytes(bytes);
    },
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Account Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{account.name}</h2>
            {/*
              Edit-in-place: opens the edit dialog directly on this page
              for BANK accounts. CLEARING accounts fall back to the
              accounts page because their edit form lives there.
            */}
            {account.type === "BANK" ? (
              <button
                type="button"
                onClick={() => setShowEditAccount(true)}
                title={t("editAccount")}
                aria-label={t("editAccount")}
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <Settings className="w-4 h-4" />
              </button>
            ) : (
              <Link
                href="/dashboard/bank/accounts"
                title={t("editAccount")}
                aria-label={t("editAccount")}
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <Settings className="w-4 h-4" />
              </Link>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {account.bankName && <span>{account.bankName}</span>}
            {account.iban && (
              <span className="font-mono text-xs">{formatIban(account.iban)}</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">{t("runningBalance")}</p>
          <p className={cn("text-xl font-semibold", balance < 0 && "text-destructive")}>
            {formatCurrency(balance)}
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tFilter("search")}
            className="w-full pl-9 pr-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">{tFilter("allStatuses")}</option>
          <option value="UNMATCHED">{tStatus("UNMATCHED")}</option>
          <option value="MATCHED">{tStatus("MATCHED")}</option>
          <option value="IGNORED">{tStatus("IGNORED")}</option>
        </select>

        <div className="flex gap-2 ml-auto">
          <button
            onClick={runAutoMatch}
            disabled={isAutoMatching}
            title={t("autoMatchTooltip")}
            className="group relative inline-flex items-center gap-2 px-3 py-2 border border-input rounded-lg text-sm hover:bg-accent transition-colors disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4 text-primary" />
            {isAutoMatching ? t("autoMatchRunning") : t("autoMatch")}
            <Info className="w-3 h-3 text-muted-foreground" />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-3 py-2 border border-input rounded-lg text-sm hover:bg-accent transition-colors"
          >
            <Upload className="w-4 h-4" />
            {t("import")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={handleFileImport}
          />
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t("add")}
          </button>
        </div>
      </div>

      {/* Add Transaction Form */}
      {showAddForm && (
        <form
          onSubmit={handleAddTransaction}
          className="flex flex-wrap items-end gap-3 p-4 bg-card border border-border rounded-lg"
        >
          <div>
            <label className="text-xs font-medium">{t("date")}</label>
            <input
              type="date"
              value={txDate}
              onChange={(e) => setTxDate(e.target.value)}
              required
              className="w-full mt-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setTxType("income")}
              className={cn(
                "mt-6 p-2 rounded-lg border transition-colors",
                txType === "income"
                  ? "bg-emerald-500/10 border-emerald-500 text-emerald-600"
                  : "border-input text-muted-foreground hover:bg-accent"
              )}
            >
              <ArrowDownLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setTxType("expense")}
              className={cn(
                "mt-6 p-2 rounded-lg border transition-colors",
                txType === "expense"
                  ? "bg-primary/10 border-primary text-primary"
                  : "border-input text-muted-foreground hover:bg-accent"
              )}
            >
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>

          <div>
            <label className="text-xs font-medium">{t("amount")}</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={txAmount}
              onChange={(e) => setTxAmount(e.target.value)}
              required
              className="w-full mt-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="flex-1 min-w-[150px]">
            <label className="text-xs font-medium">{t("counterpart")}</label>
            <input
              type="text"
              value={txCounterpart}
              onChange={(e) => setTxCounterpart(e.target.value)}
              className="w-full mt-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="flex-1 min-w-[150px]">
            <label className="text-xs font-medium">{t("purpose")}</label>
            <input
              type="text"
              value={txPurpose}
              onChange={(e) => setTxPurpose(e.target.value)}
              placeholder={t("purposePlaceholder")}
              className="w-full mt-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isPending ? "…" : t("add")}
          </button>
        </form>
      )}

      {/* Transaction Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <FileText className="w-10 h-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          {/*
            Bulk-action toolbar. Rendered above the table (not inside it)
            so it doesn't shift table layout when it appears/disappears.
            Visible only when the user has at least one row selected.
          */}
          {anySelected && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-accent/40 text-xs">
              <span className="font-medium">
                {t("selectedCount", { count: selectedIds.size })}
              </span>
              <div className="flex items-center gap-1 ml-auto">
                <button
                  type="button"
                  onClick={() => bulkSetPrivate(true)}
                  disabled={isPending}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-input hover:bg-accent disabled:opacity-50"
                >
                  <UserRound className="w-3 h-3" />
                  {t("bulkMarkPrivate")}
                </button>
                {/*
                  Conditional: only surface "Privat aufheben" when at least
                  one selected row actually IS private. Showing it otherwise
                  is just clutter and confuses users on what the button does.
                */}
                {hasPrivateInSelection && (
                  <button
                    type="button"
                    onClick={() => bulkSetPrivate(false)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-input hover:bg-accent disabled:opacity-50"
                  >
                    {t("bulkUnmarkPrivate")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={bulkIgnore}
                  disabled={isPending}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-input hover:bg-accent disabled:opacity-50"
                >
                  <EyeOff className="w-3 h-3" />
                  {t("bulkIgnore")}
                </button>
                <button
                  type="button"
                  onClick={bulkUnignore}
                  disabled={isPending}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-input hover:bg-accent disabled:opacity-50"
                >
                  <Eye className="w-3 h-3" />
                  {t("bulkUnignore")}
                </button>
                <button
                  type="button"
                  onClick={bulkDelete}
                  disabled={isPending}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3" />
                  {t("bulkDelete")}
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded hover:bg-accent text-muted-foreground"
                >
                  <X className="w-3 h-3" />
                  {t("bulkClear")}
                </button>
              </div>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 group">
                {/*
                  Checkbox cell stays in the layout so the table doesn't
                  jump when a selection appears/disappears — only the input
                  itself is shown/hidden via opacity. The select-all only
                  becomes interactive once *any* row is selected (or the
                  user hovers the header), keeping the chrome quiet.
                */}
                <th className="px-3 py-2 w-10">
                  <input
                    type="checkbox"
                    aria-label={t("selectAll")}
                    checked={
                      sortedFiltered.length > 0 &&
                      sortedFiltered.every((tx) => selectedIds.has(tx.id))
                    }
                    // Indeterminate when some but not all visible rows are selected.
                    ref={(el) => {
                      if (!el) return;
                      const some = sortedFiltered.some((tx) => selectedIds.has(tx.id));
                      const all =
                        sortedFiltered.length > 0 &&
                        sortedFiltered.every((tx) => selectedIds.has(tx.id));
                      el.indeterminate = some && !all;
                    }}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(
                          (prev) => new Set([...prev, ...sortedFiltered.map((tx) => tx.id)]),
                        );
                      } else {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          for (const tx of sortedFiltered) next.delete(tx.id);
                          return next;
                        });
                      }
                    }}
                    className={cn(
                      "cursor-pointer transition-opacity",
                      !anySelected && "opacity-0 group-hover:opacity-100",
                    )}
                  />
                </th>
                <SortableTh
                  active={sortKey === "status"}
                  dir={sortDir}
                  onClick={() => toggleSort("status")}
                  className="text-center w-24"
                >
                  {t("statusLabel")}
                </SortableTh>
                <SortableTh
                  active={sortKey === "name"}
                  dir={sortDir}
                  onClick={() => toggleSort("name")}
                  className="text-left"
                >
                  {t("counterpart")}
                </SortableTh>
                <th className="text-left px-4 py-2 font-medium">{t("purpose")}</th>
                <SortableTh
                  active={sortKey === "date"}
                  dir={sortDir}
                  onClick={() => toggleSort("date")}
                  className="text-left"
                >
                  {t("date")}
                </SortableTh>
                <SortableTh
                  active={sortKey === "amount"}
                  dir={sortDir}
                  onClick={() => toggleSort("amount")}
                  className="text-right"
                >
                  {t("amount")}
                </SortableTh>
                <th className="px-4 py-2 w-28" />
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map((tx) => {
                const isSelected = selectedIds.has(tx.id);
                const rowClickable = tx.status === "UNMATCHED";
                return (
                <tr
                  key={tx.id}
                  onClick={(e) => {
                    if (!rowClickable) return;
                    // Skip if the click landed on an interactive child —
                    // checkbox, action button, link, etc. — otherwise the
                    // row handler would fight with their own onClick.
                    const target = e.target as HTMLElement;
                    if (target.closest("button, input, a, label, select, [role='menuitem']")) {
                      return;
                    }
                    // Don't hijack text selections: opening a modal mid-
                    // drag is jarring and wipes the selection without the
                    // user being able to copy what they just highlighted.
                    const sel = window.getSelection();
                    if (sel && sel.toString().length > 0) return;
                    setMatchFor(tx);
                  }}
                  className={cn(
                    "border-b border-border last:border-0 hover:bg-muted/30 group",
                    tx.status === "IGNORED" && "opacity-50",
                    isSelected && "bg-accent/30",
                    rowClickable && "cursor-pointer",
                  )}
                >
                  <td className="px-3 py-2.5 w-10">
                    {/*
                      Hover-only by default to keep the table calm. Once the
                      row is selected OR any other row is selected, all
                      checkboxes stay visible so the user can extend the
                      selection without re-hovering each row.
                    */}
                    <input
                      type="checkbox"
                      aria-label={t("selectRow")}
                      checked={isSelected}
                      onChange={() => toggleSelected(tx.id)}
                      className={cn(
                        "cursor-pointer transition-opacity",
                        !isSelected && !anySelected && "opacity-0 group-hover:opacity-100",
                      )}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {/*
                      Auto-matched rows render the same green pill as
                      manually-matched ones (the user's call: visually
                      they're the same end state) but with the
                      "Auto-Zuordnung" label so the source is still
                      transparent. No icon — the Sparkles affordance
                      lives on the toolbar button only.
                    */}
                    <span
                      title={tx.status === "MATCHED" && tx.autoMatched ? t("autoMatchedTooltip") : undefined}
                      className={cn(
                        "inline-block px-2 py-0.5 rounded text-xs font-medium",
                        tx.status === "MATCHED" && "bg-emerald-500/10 text-emerald-600",
                        tx.status === "UNMATCHED" && "bg-blue-500/10 text-blue-400",
                        tx.status === "IGNORED" && "bg-muted text-muted-foreground",
                      )}
                    >
                      {tx.status === "MATCHED" && tx.autoMatched
                        ? tStatus("AUTO_MATCHED")
                        : tStatus(tx.status)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {/*
                      Counterpart name only — the IBAN sub-line was visual
                      clutter and is still searchable + visible in the row
                      detail. The Privat-badge lives here (next to the name)
                      because Date moved out of the leftmost data position
                      and Name is now the row's primary identifier.
                    */}
                    <div className="inline-flex items-center gap-1.5 font-medium">
                      <span>{tx.counterpartName || "—"}</span>
                      {tx.isPrivate && (
                        <span
                          title={t("privateTooltip")}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-700"
                        >
                          <UserRound className="w-2.5 h-2.5" />
                          {t("privateBadge")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    <div className="truncate max-w-[250px]">{tx.purpose || "—"}</div>
                    {tx.documentId && tx.documentName && (
                      <LinkedEntityChip
                        kind="document"
                        id={tx.documentId}
                        label={tx.documentName}
                        amount={tx.amount}
                        date={tx.date}
                      />
                    )}
                    {tx.invoiceId && tx.invoiceLabel && (
                      <LinkedEntityChip
                        kind="invoice"
                        id={tx.invoiceId}
                        label={tx.invoiceLabel}
                        amount={tx.amount}
                        date={tx.date}
                      />
                    )}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                    {fmtDateShort(tx.date)}
                  </td>
                  <td className={cn(
                    "px-4 py-2.5 text-right font-mono whitespace-nowrap",
                    tx.amount >= 0 && tx.status !== "IGNORED" ? "text-emerald-600" : "text-foreground",
                    tx.status === "IGNORED" && "line-through",
                  )}>
                    {tx.amount >= 0 ? "+" : ""}{formatCurrency(tx.amount)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      {tx.status === "MATCHED" ? (
                        <button
                          onClick={() => handleUnmatch(tx.id)}
                          disabled={isPending}
                          title={t("unmatch")}
                          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Link2Off className="w-3.5 h-3.5" />
                        </button>
                      ) : tx.status === "UNMATCHED" ? (
                        <>
                          <button
                            onClick={() => setMatchFor(tx)}
                            disabled={isPending}
                            title={t("matchDocument")}
                            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Link2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setIgnoreFor(tx)}
                            disabled={isPending}
                            title={t("ignore")}
                            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <EyeOff className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : tx.status === "IGNORED" ? (
                        <button
                          onClick={() => handleUnignore(tx.id)}
                          disabled={isPending}
                          title={t("unignore")}
                          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      ) : null}

                      <button
                        onClick={() => setCommentFor(tx)}
                        title={
                          tx.openCommentCount > 0
                            ? tComments("openBadge", { count: tx.openCommentCount })
                            : tComments("placeholder")
                        }
                        className={cn(
                          "relative p-1 rounded hover:bg-accent transition-colors",
                          tx.openCommentCount > 0
                            ? "text-primary hover:text-primary"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        {tx.openCommentCount > 0 && (
                          <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-primary text-[9px] font-semibold text-primary-foreground flex items-center justify-center">
                            {tx.openCommentCount}
                          </span>
                        )}
                      </button>

                      <TxActionsMenu
                        transactionId={tx.id}
                        isPrivate={tx.isPrivate}
                        status={tx.status}
                        hasDocument={tx.documentId !== null || tx.invoiceId !== null}
                        disabled={isPending}
                      />
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Match Picker Modal */}
      {matchFor && (
        <MatchPicker
          transactionId={matchFor.id}
          transactionAmount={matchFor.amount}
          transactionName={matchFor.counterpartName}
          transactionPurpose={matchFor.purpose}
          onClose={() => setMatchFor(null)}
          onMatched={() => router.refresh()}
        />
      )}

      {/* Ignore Confirmation Modal */}
      {ignoreFor && (
        <IgnoreConfirmDialog
          transaction={ignoreFor}
          isPending={isPending}
          onConfirm={confirmIgnore}
          onClose={() => setIgnoreFor(null)}
        />
      )}

      {/* CSV Import Modal */}
      {csvBytes && (
        <CsvImportDialog
          bankAccountId={account.id}
          rawBytes={csvBytes}
          savedMapping={account.csvMapping}
          onClose={() => setCsvBytes(null)}
          onDone={() => router.refresh()}
        />
      )}

      {/* Auto-Match Result Modal */}
      {autoMatchResult && (
        <AutoMatchResultDialog
          result={autoMatchResult}
          onClose={() => setAutoMatchResult(null)}
        />
      )}

      {/* Edit Account Dialog (BANK only) */}
      {showEditAccount && account.type === "BANK" && (
        <EditBankAccountDialog
          account={{
            id: account.id,
            name: account.name,
            type: account.type,
            bankName: account.bankName,
            iban: account.iban,
            bic: account.bic,
            openingBalance: account.openingBalance,
            bookingAccount: account.bookingAccount,
            isDefault: account.isDefault,
          }}
          onClose={() => setShowEditAccount(false)}
          onSaved={() => router.refresh()}
        />
      )}

      {commentFor && (
        <CommentDrawer
          transaction={commentFor}
          comments={commentsByTxId[commentFor.id] ?? []}
          currentUserId={currentUserId}
          canWrite={canWriteComments}
          canResolve={canResolveComments}
          onClose={() => setCommentFor(null)}
        />
      )}
    </div>
  );
}

function CommentDrawer({
  transaction,
  comments,
  currentUserId,
  canWrite,
  canResolve,
  onClose,
}: {
  transaction: TransactionRow;
  comments: CommentDTO[];
  currentUserId: string;
  canWrite: boolean;
  canResolve: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md h-full bg-card border-l border-border shadow-xl flex flex-col">
        <header className="px-4 py-3 border-b border-border flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">
              {transaction.counterpartName ?? "Bankbuchung"}
            </p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {fmtDateShort(transaction.date)} · {formatCurrency(transaction.amount)}
            </p>
            {transaction.purpose && (
              <p className="text-[12px] text-muted-foreground mt-1 line-clamp-2">
                {transaction.purpose}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
            aria-label="Schließen"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          <CommentSection
            entityType="BANK_TRANSACTION"
            entityId={transaction.id}
            comments={comments}
            currentUserId={currentUserId}
            canWrite={canWrite}
            canResolve={canResolve}
            titleKey="titleBank"
          />
        </div>
      </div>
    </div>
  );
}

function IgnoreConfirmDialog({
  transaction,
  isPending,
  onConfirm,
  onClose,
}: {
  transaction: TransactionRow;
  isPending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("bank.transactions.ignoreDialog");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 p-5">
          <div className="p-2 bg-amber-500/10 text-amber-600 rounded">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-sm">{t("title")}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t("message")}</p>
            <div className="mt-3 p-2 bg-muted rounded text-xs">
              <div className="font-medium">
                {transaction.counterpartName || t("unknownCounterpart")}
              </div>
              <div className="text-muted-foreground flex justify-between mt-0.5">
                <span>
                  {new Date(transaction.date).toLocaleDateString()}
                </span>
                <span className="font-mono">{formatCurrency(transaction.amount)}</span>
              </div>
              {transaction.purpose && (
                <div className="text-muted-foreground truncate mt-0.5">
                  {transaction.purpose}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">{t("reversibleHint")}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/30">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 border border-input rounded-lg text-sm hover:bg-accent transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            {isPending ? "…" : t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Inline chip showing the linked document or invoice on a transaction
 * row. Click opens a small popover with key facts + an "open in new
 * tab" link to the entity detail page. Single-line, truncated.
 *
 * Stops click propagation so the row-level click handler (which opens
 * the MatchPicker on UNMATCHED rows) doesn't fight with it — though
 * matched rows don't trigger row-click anyway, the chip can also appear
 * on rows where the user is mid-action.
 */
function LinkedEntityChip({
  kind,
  id,
  label,
  amount,
  date,
}: {
  kind: "document" | "invoice";
  id: string;
  label: string;
  amount: number;
  date: string;
}) {
  const t = useTranslations("bank.transactions.linkedEntity");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Outside-click + Escape close.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const href = kind === "document" ? `/dashboard/documents/${id}` : `/dashboard/invoices/${id}`;
  const openLabel = kind === "document" ? t("openDocument") : t("openInvoice");
  const kindLabel = kind === "document" ? t("kindDocument") : t("kindInvoice");

  return (
    <div ref={wrapperRef} className="relative mt-0.5 max-w-[250px]">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={label}
        className="inline-flex items-center gap-1 text-xs max-w-full truncate hover:underline"
        style={{ color: "var(--color-automatch)" }}
      >
        <Link2 className="w-3 h-3 shrink-0" />
        <span className="truncate">{label}</span>
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full mt-1 z-20 w-64 bg-card border border-border rounded-lg shadow-lg p-3 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide"
              style={{
                backgroundColor: "color-mix(in oklab, var(--color-automatch) 12%, transparent)",
                color: "var(--color-automatch)",
              }}
            >
              {kindLabel}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-0.5 rounded hover:bg-accent text-muted-foreground"
              aria-label={t("close")}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-2 font-medium text-foreground break-words">{label}</div>
          <dl className="mt-2 grid grid-cols-2 gap-1 text-muted-foreground">
            <dt>{t("amount")}</dt>
            <dd className="text-right font-mono text-foreground">{formatCurrency(amount)}</dd>
            <dt>{t("date")}</dt>
            <dd className="text-right text-foreground">{fmtDateShort(date)}</dd>
          </dl>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium hover:underline"
            style={{ color: "var(--color-automatch)" }}
          >
            <ArrowUpRight className="w-3 h-3" />
            {openLabel}
          </a>
        </div>
      )}
    </div>
  );
}

/**
 * Auto-match summary dialog. Renders the counts from a finished
 * autoMatchBankAccount run. We split the messaging so the user
 * understands what's actionable: matched (done), suggestions
 * (review by clicking rows), and unresolved (no candidate found).
 */
function AutoMatchResultDialog({
  result,
  onClose,
}: {
  result: AutoMatchResult;
  onClose: () => void;
}) {
  const t = useTranslations("bank.transactions.autoMatchResult");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 p-5">
          <div
            className="p-2 rounded"
            style={{
              backgroundColor: "color-mix(in oklab, var(--color-automatch) 12%, transparent)",
              color: "var(--color-automatch)",
            }}
          >
            {result.matched > 0 ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : (
              <Sparkles className="w-5 h-5" />
            )}
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-sm">{t("title")}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t("scannedSummary", { count: result.scanned })}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="p-3 bg-muted rounded">
                <div className="text-xl font-semibold text-emerald-600">
                  {result.matched}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {t("matched")}
                </div>
              </div>
              <div
                className="p-3 bg-muted rounded"
              >
                <div className="text-xl font-semibold" style={{ color: "var(--color-automatch)" }}>
                  {result.suggestions}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {t("suggestions")}
                </div>
              </div>
              <div className="p-3 bg-muted rounded">
                <div className="text-xl font-semibold text-muted-foreground">
                  {result.unresolved}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {t("unresolved")}
                </div>
              </div>
            </div>
            {result.suggestions > 0 && (
              <p className="text-xs text-muted-foreground mt-3">
                {t("suggestionsHint")}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/30">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Sortable table-header cell. Renders as a click target with a small
 * arrow indicator on the active sort column. Kept inline (rather than a
 * standalone util) because it's tightly coupled to this table's spacing
 * tokens and only used here.
 */
function SortableTh({
  active,
  dir,
  onClick,
  className,
  children,
}: {
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <th className={cn("px-4 py-2 font-medium", className)}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground transition-colors",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span>{children}</span>
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="w-3 h-3" />
          ) : (
            <ArrowDown className="w-3 h-3" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-40" />
        )}
      </button>
    </th>
  );
}
