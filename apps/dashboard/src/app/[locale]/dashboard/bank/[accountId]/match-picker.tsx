"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { X, FileText, Receipt, Search, AlertTriangle, Ban, Sparkles } from "lucide-react";
import { formatCurrency, fmtDateShort } from "@/lib/format";
import {
  listScoredMatchCandidates,
  matchTransactionToDocument,
  matchTransactionToInvoice,
  type ScoredMatchCandidate,
} from "../actions";
import { cn } from "@/lib/utils";

// Tolerance for floating-point amount comparisons (1 cent).
const AMOUNT_EPSILON = 0.01;

interface MatchPickerProps {
  transactionId: string;
  transactionAmount: number;
  /**
   * Counterpart name + Verwendungszweck of the source transaction.
   * Rendered in the dialog header so the user can verify they're
   * matching the right row without flipping back to the table — the
   * amount alone is rarely enough to disambiguate recurring payments
   * (e.g. monthly Spotify charges at the same price).
   */
  transactionName?: string | null;
  transactionPurpose?: string | null;
  onClose: () => void;
  onMatched: () => void;
}

export function MatchPicker({
  transactionId,
  transactionAmount,
  transactionName,
  transactionPurpose,
  onClose,
  onMatched,
}: MatchPickerProps) {
  const t = useTranslations("bank.matching");
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<ScoredMatchCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<"all" | "document" | "invoice">("all");
  // Holds a candidate pending mismatch confirmation. null = no confirmation needed.
  const [pendingMismatch, setPendingMismatch] = useState<ScoredMatchCandidate | null>(null);

  // Debounced load
  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      const results = await listScoredMatchCandidates(transactionId, search);
      setCandidates(results);
      setLoading(false);
    }, 200);
    return () => clearTimeout(handle);
  }, [search, transactionId]);

  function amountsMatch(candidateAmount: number | null, txAbs: number): boolean {
    if (candidateAmount == null) return false;
    return Math.abs(Math.abs(candidateAmount) - txAbs) < AMOUNT_EPSILON;
  }

  /**
   * Determine whether a candidate's declared direction is incompatible with the
   * transaction sign. Returns `true` only when we *know* the direction is wrong:
   *   - Invoices: type is always known (INVOICE = incoming, CREDIT_NOTE = outgoing).
   *   - Documents: only enforced when `documentType` has been declared
   *     (INCOME / EXPENSE). A null documentType means "undeclared" and is treated
   *     as compatible — the user hasn't classified it yet.
   *
   * A zero-amount transaction is a degenerate edge case and allowed through.
   */
  function isSignIncompatible(c: ScoredMatchCandidate): boolean {
    if (transactionAmount === 0) return false;
    const isIncoming = transactionAmount > 0;

    if (c.kind === "invoice") {
      // Corrections behave like invoices for matching — they carry the full
      // corrected total, which the customer still owes (or pays as a top-up).
      if (c.invoiceType === "INVOICE" || c.invoiceType === "CORRECTION") return !isIncoming;
      if (c.invoiceType === "CREDIT_NOTE") return isIncoming;
      return false;
    }
    // document
    if (c.documentType === "INCOME") return !isIncoming;
    if (c.documentType === "EXPENSE") return isIncoming;
    return false;
  }

  const filtered = candidates.filter((c) => tab === "all" || c.kind === tab);

  // Sort priority: (1) the scored suggestion (if any), then by score
  // descending, with sign-incompatible candidates pushed to the bottom.
  // The server already pre-sorts by score, but we re-sort client-side so
  // tab filtering doesn't mix up the order.
  const absAmount = Math.abs(transactionAmount);
  const sorted = [...filtered].sort((a, b) => {
    const aIncompat = isSignIncompatible(a) ? 1 : 0;
    const bIncompat = isSignIncompatible(b) ? 1 : 0;
    if (aIncompat !== bIncompat) return aIncompat - bIncompat;
    if (a.score !== b.score) return b.score - a.score;
    const aMatch = amountsMatch(a.amount, absAmount) ? 0 : 1;
    const bMatch = amountsMatch(b.amount, absAmount) ? 0 : 1;
    return aMatch - bMatch;
  });

  function performMatch(c: ScoredMatchCandidate) {
    startTransition(async () => {
      const res =
        c.kind === "document"
          ? await matchTransactionToDocument(transactionId, c.id)
          : await matchTransactionToInvoice(transactionId, c.id);
      if (res.success) {
        onMatched();
        onClose();
      }
    });
  }

  function handlePick(c: ScoredMatchCandidate) {
    // Guard: refuse wrong-sign picks outright. The button should already be
    // disabled for these, but this is defense in depth against any stray click
    // path (keyboard activation etc.). The server also enforces the same rule.
    if (isSignIncompatible(c)) return;

    // If candidate has a known amount and it differs from the transaction amount,
    // require explicit confirmation before linking. This is the DATEV/SAP convention:
    // warn on mismatch (partial payments, fees, or wrong pick are all possible),
    // but do not block — user makes the final call.
    if (c.amount != null && !amountsMatch(c.amount, absAmount)) {
      setPendingMismatch(c);
      return;
    }
    performMatch(c);
  }

  return (
    <div
      // `backdrop-blur-sm` softens the table behind the dialog so the
      // user's eye lands on the matching task. Subtle (sm, not md) —
      // strong blur reads as "the app crashed" more than as focus.
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-card border border-border rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-border gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-sm">{t("title")}</h2>
            {/*
              Header context: amount + name + purpose. The amount stays
              prominent (mono font) since it's the primary matching
              signal; name and purpose sit below as a smaller, muted
              "what is this transaction?" reminder.
            */}
            <div className="mt-1 flex flex-col gap-0.5 text-xs">
              <p className="font-mono text-muted-foreground">
                {formatCurrency(transactionAmount)}
              </p>
              {(transactionName || transactionPurpose) && (
                <div className="text-muted-foreground truncate">
                  {transactionName && (
                    <span className="font-medium text-foreground">
                      {transactionName}
                    </span>
                  )}
                  {transactionName && transactionPurpose && (
                    <span className="mx-1.5">·</span>
                  )}
                  {transactionPurpose && <span>{transactionPurpose}</span>}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 border-b border-border flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("search")}
              autoFocus
              className="w-full pl-9 pr-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex gap-1">
            {(["all", "document", "invoice"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={cn(
                  "px-3 py-1 rounded text-xs font-medium transition-colors",
                  tab === k
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent",
                )}
              >
                {t(`tab_${k}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">…</div>
          ) : sorted.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {t("noResults")}
            </div>
          ) : (
            <ul>
              {sorted.map((c) => {
                const amountMatches = amountsMatch(c.amount, absAmount);
                const hasMismatch = c.amount != null && !amountMatches;
                const signIncompat = isSignIncompatible(c);
                return (
                  <li key={`${c.kind}-${c.id}`} className="border-b border-border last:border-0">
                    <button
                      type="button"
                      disabled={isPending || signIncompat}
                      onClick={() => handlePick(c)}
                      title={signIncompat ? t("signMismatch") : undefined}
                      className={cn(
                        "w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors",
                        signIncompat
                          ? "opacity-50 cursor-not-allowed"
                          : "hover:bg-accent disabled:opacity-50",
                      )}
                    >
                      <div className="mt-0.5 text-muted-foreground">
                        {signIncompat ? (
                          <Ban className="w-4 h-4" />
                        ) : c.kind === "invoice" ? (
                          <Receipt className="w-4 h-4" />
                        ) : (
                          <FileText className="w-4 h-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{c.label}</span>
                          <span
                            className={cn(
                              "text-[10px] font-medium px-1.5 py-0.5 rounded",
                              c.kind === "invoice"
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {t(`kind_${c.kind}`)}
                          </span>
                          {signIncompat && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                              {t("signMismatchBadge")}
                            </span>
                          )}
                          {c.isSuggestion && !signIncompat && (
                            <span
                              title={t("suggestionTooltip")}
                              className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor: "color-mix(in oklab, var(--color-automatch) 12%, transparent)",
                                color: "var(--color-automatch)",
                              }}
                            >
                              <Sparkles className="w-2.5 h-2.5" />
                              {t("suggestionBadge")}
                            </span>
                          )}
                        </div>
                        {c.sublabel && (
                          <div className="text-xs text-muted-foreground truncate">
                            {c.sublabel}
                          </div>
                        )}
                      </div>
                      <div className="text-right whitespace-nowrap">
                        {c.amount != null && (
                          <div
                            className={cn(
                              "text-sm font-mono flex items-center gap-1 justify-end",
                              amountMatches && !signIncompat && "text-emerald-600 font-medium",
                              hasMismatch && !signIncompat && "text-amber-600",
                            )}
                          >
                            {hasMismatch && !signIncompat && <AlertTriangle className="w-3 h-3" />}
                            {formatCurrency(c.amount)}
                          </div>
                        )}
                        {c.date && (
                          <div className="text-xs text-muted-foreground">
                            {fmtDateShort(c.date)}
                          </div>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {pendingMismatch && (
          <MismatchConfirm
            candidate={pendingMismatch}
            transactionAmount={transactionAmount}
            isPending={isPending}
            onCancel={() => setPendingMismatch(null)}
            onConfirm={() => {
              const c = pendingMismatch;
              setPendingMismatch(null);
              performMatch(c);
            }}
          />
        )}
      </div>
    </div>
  );
}

function MismatchConfirm({
  candidate,
  transactionAmount,
  isPending,
  onCancel,
  onConfirm,
}: {
  candidate: ScoredMatchCandidate;
  transactionAmount: number;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("bank.matching.mismatch");
  const candAmount = candidate.amount ?? 0;
  const diff = Math.abs(transactionAmount) - Math.abs(candAmount);

  return (
    <div
      className="absolute inset-0 bg-background/95 flex items-center justify-center p-6 rounded-lg"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="w-full max-w-sm">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-amber-500/10 text-amber-600 rounded">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-sm">{t("title")}</h3>
            <p className="text-xs text-muted-foreground mt-1">{t("message")}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 bg-muted rounded">
                <div className="text-muted-foreground">{t("transaction")}</div>
                <div className="font-mono font-medium">
                  {formatCurrency(transactionAmount)}
                </div>
              </div>
              <div className="p-2 bg-muted rounded">
                <div className="text-muted-foreground">
                  {candidate.kind === "invoice" ? t("invoice") : t("document")}
                </div>
                <div className="font-mono font-medium">{formatCurrency(candAmount)}</div>
              </div>
            </div>
            <div className="mt-2 text-xs text-amber-700">
              {t("diff", { amount: formatCurrency(Math.abs(diff)) })}
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
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
