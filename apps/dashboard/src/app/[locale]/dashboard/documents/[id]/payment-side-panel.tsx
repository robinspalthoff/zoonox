"use client";

/**
 * PaymentSidePanel
 * ─────────────────
 * Rechtsbündig einfahrendes Panel als Ersatz für das alte MarkAsPaidModal.
 * Erlaubt zusätzlich:
 *   - "Zahlungsdatum = Belegdatum" Checkbox (Default ON)
 *   - Auswahl einer Banktransaktion aus den UNMATCHED-Bewegungen im Konto
 *     im ±60-Tage-Fenster um das Belegdatum (mit Suche/Filter)
 *   - Erkennung von Differenzen zwischen Belegbetrag und Zahlung →
 *     Reason-Dropdown (Rundung / Skonto / FX / Sonstige) + freier Notiz
 *
 * Das Panel ruft `markDocumentAsPaid` mit den `extras` auf; die Verknüpfung
 * zwischen BankTransaction und Document wird dort atomar gesetzt.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Banknote, Check, CreditCard, Landmark, Loader2, Search, SlidersHorizontal,
  Wallet, X,
} from "lucide-react";
import type { PaymentMethod, PaymentDifferenceReason } from "@prisma/client";
import {
  listBankAccountsForPicker,
  listOpenBankTransactions,
  type BankAccountOption,
  type OpenBankTxOption,
} from "../actions";
import { formatAmount, formatCurrency, fmtDateShort } from "@/lib/format";

const PAYMENT_METHOD_ICONS: Record<PaymentMethod, React.ReactNode> = {
  BANK_TRANSFER: <Landmark className="w-3.5 h-3.5" />,
  CASH:          <Banknote className="w-3.5 h-3.5" />,
  CREDIT_CARD:   <CreditCard className="w-3.5 h-3.5" />,
  PAYPAL:        <Wallet className="w-3.5 h-3.5" />,
};

const METHODS: PaymentMethod[] = ["BANK_TRANSFER", "CASH", "CREDIT_CARD", "PAYPAL"];
const REASONS: PaymentDifferenceReason[] = ["ROUNDING", "SKONTO", "FX", "OTHER"];

export interface PaymentConfirmPayload {
  paidAt: string; // ISO YYYY-MM-DD
  method: PaymentMethod;
  amount: number | null;
  bankAccountId: string | null;
  bankTransactionId: string | null;
  differenceReason: PaymentDifferenceReason | null;
  differenceNote: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (data: PaymentConfirmPayload) => void | Promise<void>;
  /** Beleg-Kontext für die Anzeige + sinnvolle Defaults. */
  doc: {
    id: string;
    supplier: string;
    /** Brutto-Wert in der Belegwährung (Original, z.B. 6.98 USD). */
    totalGross: number;
    /**
     * Brutto-Wert umgerechnet in EUR. Für EUR-Belege identisch zu totalGross;
     * für Fremdwährungen = totalGross × exchangeRate (am Belegdatum).
     * Wird intern für die Diff-Berechnung gegen die EUR-Zahlung verwendet —
     * Bank-Transaktionen sind immer in EUR.
     */
    totalGrossEUR: number;
    currency: string;
    /** EUR pro 1 Einheit Fremdwährung; null bei EUR-Belegen oder fehlendem Kurs. */
    exchangeRate: number | null;
    docDate: string;   // ISO YYYY-MM-DD
    dueDate: string | null;
  };
}

const LABEL = "block text-[11px] font-medium text-muted-foreground mb-1";
const INPUT = "w-full px-2.5 py-1.5 bg-muted border border-border rounded-lg text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors";
// Größere Variante: kommt im neuen, breiteren Side-Panel an mehreren Stellen
// zum Einsatz (Suche, Beträge). Mehr Padding + größere Schrift für bessere
// Lesbarkeit beim Tippen.
const INPUT_LG = "w-full h-10 px-3 bg-muted border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors";

/** Akzeptiert deutsche („1.234,56") und englische („1234.56") Notation. */
function parseLocaleNumber(value: string): number {
  if (typeof value !== "string") return NaN;
  const cleaned = value.trim()
    .replace(/\s/g, "")
    .replace(/\./g, "")  // Tausender-Punkte raus
    .replace(",", ".");  // Komma → Dezimalpunkt
  if (cleaned === "") return NaN;
  return Number(cleaned);
}

function formatGermanAmount(n: number): string {
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function PaymentSidePanel({ open, onClose, onConfirm, doc }: Props) {
  const t = useTranslations("documents.detail.payment");

  // ── Form-State ────────────────────────────────────────────────────────────
  const [useDocDate, setUseDocDate] = useState(true);
  const [paidAt, setPaidAt] = useState(doc.docDate);
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [pickedTx, setPickedTx] = useState<OpenBankTxOption | null>(null);
  // Zahlung erfolgt in EUR (alle Bank-Konten sind EUR-denominiert): wir
  // pre-fillen entsprechend mit dem EUR-Equivalent des Belegs.
  const [paidAmount, setPaidAmount] = useState<string>(formatGermanAmount(doc.totalGrossEUR));
  const [differenceReason, setDifferenceReason] = useState<PaymentDifferenceReason | null>(null);
  const [differenceNote, setDifferenceNote] = useState("");
  const [isConfirming, startConfirm] = useTransition();

  // ── Daten (Konten + Transaktionen) ───────────────────────────────────────
  const [accounts, setAccounts] = useState<BankAccountOption[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [txs, setTxs] = useState<OpenBankTxOption[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txSearch, setTxSearch] = useState("");
  const [amountSign, setAmountSign] = useState<"all" | "negative" | "positive">("negative");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);

  // Klick außerhalb schließt das Filter-Popover wieder.
  useEffect(() => {
    if (!filtersOpen) return;
    const handler = (e: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) {
        setFiltersOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [filtersOpen]);

  // ── Reset beim Öffnen ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setUseDocDate(true);
    setPaidAt(doc.docDate);
    setMethod("BANK_TRANSFER");
    setPickedTx(null);
    setPaidAmount(formatGermanAmount(doc.totalGrossEUR));
    setDifferenceReason(null);
    setDifferenceNote("");
    setTxSearch("");
    setAmountSign("negative");
    setFiltersOpen(false);
  }, [open, doc.docDate, doc.totalGrossEUR]);

  // ── Bankkonten laden (einmal beim ersten Öffnen) ─────────────────────────
  useEffect(() => {
    if (!open || accountsLoaded) return;
    listBankAccountsForPicker()
      .then((list) => {
        setAccounts(list);
        const def = list.find((a) => a.isDefault) ?? list[0];
        setBankAccountId(def?.id ?? null);
      })
      .finally(() => setAccountsLoaded(true));
  }, [open, accountsLoaded]);

  // ── Transaktionen laden — getriggert durch Konto/Suche/Vorzeichen ────────
  const dateWindow = useMemo(() => {
    const ref = new Date(doc.docDate || new Date().toISOString().slice(0, 10));
    const from = new Date(ref); from.setDate(ref.getDate() - 60);
    const to   = new Date(ref); to.setDate(ref.getDate() + 60);
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    };
  }, [doc.docDate]);

  useEffect(() => {
    if (!open || method !== "BANK_TRANSFER" || !bankAccountId) return;
    let cancelled = false;
    setTxLoading(true);
    listOpenBankTransactions({
      bankAccountId,
      dateFrom: dateWindow.from,
      dateTo: dateWindow.to,
      search: txSearch || undefined,
      amountSign,
    })
      .then((list) => { if (!cancelled) setTxs(list); })
      .finally(() => { if (!cancelled) setTxLoading(false); });
    return () => { cancelled = true; };
  }, [open, method, bankAccountId, dateWindow.from, dateWindow.to, txSearch, amountSign]);

  // ── "Zahlungsdatum = Belegdatum" zieht das Datum nach ─────────────────────
  useEffect(() => {
    if (useDocDate) setPaidAt(doc.docDate);
  }, [useDocDate, doc.docDate]);

  // ── Tx ausgewählt: paidAt + paidAmount übernehmen ─────────────────────────
  function handlePickTx(tx: OpenBankTxOption) {
    setPickedTx(tx);
    setUseDocDate(false);
    setPaidAt(tx.date.slice(0, 10));
    // Banktransaktionen sind aus Kontoseite gesehen vorzeichenbehaftet: bei
    // Ausgaben (Lieferantenrechnung) ist amount negativ. Wir vergleichen den
    // Beleg-Brutto absolut.
    setPaidAmount(formatGermanAmount(Math.abs(tx.amount)));
  }

  const diff = useMemo(() => {
    const p = parseLocaleNumber(paidAmount);
    if (!Number.isFinite(p)) return 0;
    // Diff wird IMMER in EUR berechnet: paidAmount ist EUR (Bankkonto),
    // doc.totalGrossEUR ist der EUR-umgerechnete Belegbetrag am Belegdatum.
    // So entsteht bei reinem Wechselkurs-Match keine fälschliche Differenz.
    return Math.round((p - doc.totalGrossEUR) * 100) / 100;
  }, [paidAmount, doc.totalGrossEUR]);
  const hasDiff = Math.abs(diff) > 0.01;

  if (!open) return null;

  function handleConfirm() {
    if (!paidAt) return;
    const parsedAmount = parseLocaleNumber(paidAmount);
    const payload: PaymentConfirmPayload = {
      paidAt,
      method,
      amount: Number.isFinite(parsedAmount) ? parsedAmount : null,
      bankAccountId: method === "BANK_TRANSFER" ? bankAccountId : null,
      bankTransactionId: pickedTx?.id ?? null,
      differenceReason: hasDiff ? differenceReason : null,
      differenceNote: hasDiff ? (differenceNote.trim() || null) : null,
    };
    startConfirm(async () => {
      await onConfirm(payload);
    });
  }

  return (
    <>
      {/* Backdrop — leichter, ohne Blur, damit man den Beleg im Hintergrund noch sieht */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className="fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-card border-l border-border shadow-2xl flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">{t("modalTitle")}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Beleg-Summary */}
          <section className="rounded-xl border border-border/60 bg-muted/20 px-3.5 py-3 space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("docSummary.supplier")}</span>
              <span className="text-xs font-medium text-foreground text-right truncate">{doc.supplier || "—"}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("docSummary.gross")}</span>
              <span className="text-right">
                <span className="text-sm font-bold tabular-nums text-foreground block">
                  {formatAmount(doc.totalGross, doc.currency)}
                </span>
                {doc.currency !== "EUR" && (
                  <span className="text-[10px] tabular-nums text-muted-foreground block">
                    ≈ {formatCurrency(doc.totalGrossEUR)}
                    {doc.exchangeRate && ` @ ${doc.exchangeRate.toFixed(4)}`}
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("docSummary.docDate")}</span>
              <span className="text-xs tabular-nums text-foreground">{fmtDateShort(doc.docDate)}</span>
            </div>
            {doc.dueDate && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("docSummary.dueDate")}</span>
                <span className="text-xs tabular-nums text-foreground">{fmtDateShort(doc.dueDate)}</span>
              </div>
            )}
          </section>

          {/* Datum */}
          <section>
            <label className={LABEL}>{t("paidAt")}</label>
            <input
              type="date"
              value={paidAt}
              onChange={(e) => { setPaidAt(e.target.value); setUseDocDate(false); }}
              className={INPUT}
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-foreground select-none cursor-pointer">
              <input
                type="checkbox"
                checked={useDocDate}
                onChange={(e) => setUseDocDate(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-border accent-primary"
              />
              {t("useDocDate")}
            </label>
          </section>

          {/* Zahlungsart */}
          <section>
            <label className={LABEL}>{t("method")}</label>
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMethod(m); if (m !== "BANK_TRANSFER") setPickedTx(null); }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                    method === m
                      ? "bg-primary/10 border-primary/40 text-primary"
                      : "bg-muted/30 border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {PAYMENT_METHOD_ICONS[m]}
                  {t(`methods.${m}`)}
                </button>
              ))}
            </div>
          </section>

          {/* Banktransaktions-Picker — nur bei Überweisung */}
          {method === "BANK_TRANSFER" && (
            <section className="space-y-2">
              <div>
                <label className={LABEL}>{t("bankAccount")}</label>
                {accounts.length === 0 && accountsLoaded ? (
                  <p className="text-xs text-muted-foreground italic">{t("noBankAccount")}</p>
                ) : (
                  <select
                    value={bankAccountId ?? ""}
                    onChange={(e) => { setBankAccountId(e.target.value || null); setPickedTx(null); }}
                    className={INPUT}
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}{a.bankName ? ` — ${a.bankName}` : ""}
                        {a.isDefault ? " ★" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {bankAccountId && (
                <>
                  {/* Such-/Filterleiste */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                      <input
                        type="text"
                        value={txSearch}
                        onChange={(e) => setTxSearch(e.target.value)}
                        placeholder={t("txSearchPlaceholder")}
                        className={`${INPUT_LG} pl-9`}
                      />
                    </div>
                    <div ref={filtersRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setFiltersOpen((o) => !o)}
                        title={t("moreFilters")}
                        className={`h-10 w-10 flex items-center justify-center rounded-lg border transition-colors ${
                          amountSign !== "negative" || filtersOpen
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border bg-muted text-muted-foreground hover:text-foreground hover:bg-accent"
                        }`}
                      >
                        <SlidersHorizontal className="w-4 h-4" />
                      </button>
                      {filtersOpen && (
                        <div className="absolute right-0 top-full mt-1.5 z-10 w-56 rounded-lg border border-border bg-card shadow-xl p-3 space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {t("txFilter.label")}
                          </p>
                          {(["negative", "positive", "all"] as const).map((opt) => (
                            <label
                              key={opt}
                              className="flex items-center gap-2 text-sm text-foreground cursor-pointer hover:text-primary"
                            >
                              <input
                                type="radio"
                                name="amountSign"
                                checked={amountSign === opt}
                                onChange={() => setAmountSign(opt)}
                                className="accent-primary"
                              />
                              {t(`txFilter.${opt === "negative" ? "outflow" : opt === "positive" ? "inflow" : "all"}`)}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Liste */}
                  <div className="rounded-lg border border-border/60 max-h-72 overflow-y-auto divide-y divide-border/60">
                    {txLoading ? (
                      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                        <Loader2 className="inline w-3.5 h-3.5 animate-spin mr-1.5" />
                        {t("txLoading")}
                      </div>
                    ) : txs.length === 0 ? (
                      <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t("txEmpty")}</p>
                    ) : (
                      txs.map((tx) => {
                        const selected = pickedTx?.id === tx.id;
                        const isOutflow = tx.amount < 0;
                        return (
                          <button
                            key={tx.id}
                            type="button"
                            onClick={() => handlePickTx(tx)}
                            className={`w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors ${
                              selected ? "bg-primary/10" : ""
                            }`}
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xs font-medium text-foreground truncate">
                                {tx.counterpartName || t("txUnknownCounterpart")}
                              </span>
                              <span className={`text-xs tabular-nums font-semibold shrink-0 ${
                                isOutflow ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
                              }`}>
                                {isOutflow ? "−" : "+"}{formatCurrency(Math.abs(tx.amount))}
                              </span>
                            </div>
                            {tx.purpose && (
                              <p className="text-[11px] text-muted-foreground truncate mt-0.5">{tx.purpose}</p>
                            )}
                            <p className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                              {fmtDateShort(tx.date)}
                            </p>
                          </button>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          {/* Differenz / Reason */}
          <section className="space-y-2">
            <div>
              <label className={LABEL}>{t("paidAmount")}</label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  onBlur={() => {
                    // Beim Verlassen normalisieren: erlaubte Eingabeformen
                    // (Komma/Punkt, mit/ohne Tausender) auf de-DE bringen,
                    // ungültiges einfach stehen lassen damit der User selbst
                    // sieht, dass die Validierung fehlschlägt.
                    const n = parseLocaleNumber(paidAmount);
                    if (Number.isFinite(n)) setPaidAmount(formatGermanAmount(n));
                  }}
                  className={`${INPUT_LG} pr-8 text-right tabular-nums`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                  €
                </span>
              </div>
            </div>
            {hasDiff && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 space-y-2">
                <p className="text-xs text-foreground">
                  {t("diffDetected", {
                    diff: formatCurrency(diff),
                    sign: diff > 0 ? "+" : "",
                  })}
                </p>
                <select
                  value={differenceReason ?? ""}
                  onChange={(e) => setDifferenceReason((e.target.value || null) as PaymentDifferenceReason | null)}
                  className={INPUT}
                >
                  <option value="">{t("diffReasonPlaceholder")}</option>
                  {REASONS.map((r) => (
                    <option key={r} value={r}>{t(`diffReason.${r}`)}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={differenceNote}
                  onChange={(e) => setDifferenceNote(e.target.value)}
                  placeholder={t("diffNotePlaceholder")}
                  className={INPUT}
                />
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20">
          <button
            onClick={onClose}
            disabled={isConfirming}
            className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {t("cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!paidAt || isConfirming || (hasDiff && !differenceReason)}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
          >
            {isConfirming ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            {t("confirm")}
          </button>
        </footer>
      </aside>
    </>
  );
}
