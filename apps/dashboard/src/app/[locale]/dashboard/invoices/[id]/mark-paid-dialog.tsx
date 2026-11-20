"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { CircleCheckBig, X, Link2, CheckCircle2 } from "lucide-react";
import type { PaymentMethod } from "@prisma/client";
import { formatCurrency, fmtDateShort } from "@/lib/format";
import {
  markInvoiceAsPaid,
  listUnmatchedBankTransactionsForInvoice,
} from "../actions";
import { cn } from "@/lib/utils";

interface MarkPaidDialogProps {
  invoiceId: string;
  invoiceNumber: string;
  invoiceTotal: number;
  onClose: () => void;
}

const METHODS: PaymentMethod[] = ["BANK_TRANSFER", "CASH", "CREDIT_CARD", "PAYPAL"];

export function MarkPaidDialog({
  invoiceId,
  invoiceNumber,
  invoiceTotal,
  onClose,
}: MarkPaidDialogProps) {
  const t = useTranslations("invoices.markPaid");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [txs, setTxs] = useState<
    Awaited<ReturnType<typeof listUnmatchedBankTransactionsForInvoice>>
  >([]);
  const [loadingTxs, setLoadingTxs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load candidate bank transactions only when the user picks bank transfer.
  useEffect(() => {
    if (method !== "BANK_TRANSFER") {
      setSelectedTxId(null);
      return;
    }
    let cancelled = false;
    setLoadingTxs(true);
    listUnmatchedBankTransactionsForInvoice(invoiceId).then((rows) => {
      if (cancelled) return;
      setTxs(rows);
      setLoadingTxs(false);
      // Auto-pick exact match if exactly one
      const exact = rows.filter((r) => r.exactMatch);
      if (exact.length === 1) setSelectedTxId(exact[0].id);
    });
    return () => {
      cancelled = true;
    };
  }, [invoiceId, method]);

  function handleSubmit() {
    startTransition(async () => {
      const res = await markInvoiceAsPaid(invoiceId, {
        paidAt,
        method,
        bankTransactionId: method === "BANK_TRANSFER" ? selectedTxId : null,
      });
      if (res.success) {
        router.refresh();
        onClose();
      } else {
        setError(res.error ?? "Fehler");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={!isPending ? onClose : undefined} />
      <div className="relative z-10 bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CircleCheckBig className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold">{t("title")}</h2>
              <p className="text-xs text-muted-foreground">
                {invoiceNumber} · {formatCurrency(invoiceTotal)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isPending}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {/* Paid date */}
          <div>
            <label className="block text-sm font-medium mb-1.5">{t("paidAt")}</label>
            <input
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Payment method */}
          <div>
            <label className="block text-sm font-medium mb-1.5">{t("method")}</label>
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={cn(
                    "px-3 py-2 rounded-lg border text-sm transition-colors text-left",
                    method === m
                      ? "bg-primary/10 border-primary text-primary"
                      : "border-input hover:bg-accent",
                  )}
                >
                  {t(`methods.${m}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Bank transaction linking (only for bank transfer) */}
          {method === "BANK_TRANSFER" && (
            <div>
              <label className="block text-sm font-medium mb-1.5">{t("linkTx")}</label>
              <p className="text-xs text-muted-foreground mb-2">{t("linkTxHint")}</p>

              {loadingTxs ? (
                <div className="text-xs text-muted-foreground py-2">…</div>
              ) : txs.length === 0 ? (
                <div className="text-xs text-muted-foreground bg-muted/50 rounded p-3">
                  {t("noTxAvailable")}
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                  <button
                    type="button"
                    onClick={() => setSelectedTxId(null)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent",
                      selectedTxId === null && "bg-accent",
                    )}
                  >
                    <div
                      className={cn(
                        "w-4 h-4 rounded-full border-2 flex-shrink-0",
                        selectedTxId === null ? "border-primary bg-primary" : "border-muted-foreground/30",
                      )}
                    />
                    <span className="text-muted-foreground">{t("noneLinked")}</span>
                  </button>
                  {txs.map((tx) => (
                    <button
                      key={tx.id}
                      type="button"
                      onClick={() => setSelectedTxId(tx.id)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent",
                        selectedTxId === tx.id && "bg-accent",
                      )}
                    >
                      <div
                        className={cn(
                          "w-4 h-4 rounded-full border-2 flex-shrink-0",
                          selectedTxId === tx.id ? "border-primary bg-primary" : "border-muted-foreground/30",
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">
                            {tx.counterpartName ?? t("unknownCounterpart")}
                          </span>
                          {tx.exactMatch && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600">
                              <CheckCircle2 className="w-3 h-3" />
                              {t("exactMatch")}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground flex justify-between">
                          <span>
                            {fmtDateShort(tx.date)} · {tx.accountName}
                          </span>
                          <span className="font-mono">{formatCurrency(tx.amount)}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="px-3 py-2 bg-destructive/10 text-destructive text-xs rounded">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-muted hover:bg-accent transition-colors disabled:opacity-50"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            {selectedTxId && <Link2 className="w-4 h-4" />}
            <CircleCheckBig className="w-4 h-4" />
            {isPending ? "…" : t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
