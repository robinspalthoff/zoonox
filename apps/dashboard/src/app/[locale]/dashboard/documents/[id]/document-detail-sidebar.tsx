"use client";

import { useState, useTransition, useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  ChevronLeft, ChevronRight, Clock, Loader2, CheckCircle2, LinkIcon, ExternalLink,
  Hash, User, UserPlus, FileText, Tag, X, Plus, Trash2,
  ChevronDown, Save, Check, RefreshCw, AlertTriangle, Calendar,
  BookOpen, Search, Info, Pencil, Banknote, CreditCard,
  Wallet, Building2, Lock,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { saveDocument, deleteDocument, linkDocumentContact, lookupExchangeRate, markDocumentAsPaid, markDocumentAsUnpaid } from "../actions";
import { ContactFormDialog } from "@/components/contacts/contact-form-dialog";
import { SUPPORTED_FX_CURRENCIES } from "@/lib/fx";
import { PaymentSidePanel } from "./payment-side-panel";
import { SupplierLinkPanel } from "./supplier-link-panel";
import { AssetTogglePanel } from "./asset-toggle-panel";
import { DuplicateWarningBanner } from "./duplicate-warning-banner";
import { formatAmount, formatCurrency, formatFileSize, fmtDateShort, toInputDate } from "@/lib/format";

// ─── Types ──────────────────────────────────────────────────────────────────

interface LineItem {
  id: string;
  position: number;
  description: string;
  skrAccount: string;
  depreciation: string;
  amount: string;
  vatRule: string;
  vatRate: string;
  vatAmount: string;
  total: string;
}

interface DocumentData {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: string;
  documentType: "INCOME" | "EXPENSE" | null;
  bookingAccount: string | null;
  suggestedCategory: string | null;
  recognizedAmount: string | null;
  recognizedDate: string | null;
  recognizedDueDate: string | null;
  recognizedVatRate: string | null;
  dueDate: string | null;
  vatRate: string | null;
  inputVatKind: string | null;
  deliveryDate: string | null;
  deliveryDateEnd: string | null;
  recognizedSupplier: string | null;
  recognizedDescription: string | null;
  documentNumber: string | null;
  recognizedDocNumber: string | null;
  ocrText: string | null;
  ocrConfidence: number | null;
  notes: string | null;
  tags: string[];
  currency: string;
  exchangeRate: string | null;
  contact: { id: string; name: string; supplierNumber: string | null } | null;
  createdAt: string;
  uploadedBy: { firstName: string | null; lastName: string | null; email: string | null } | null;
  invoice: { id: string; number: string } | null;
  payment: { paidAt: string; method: PaymentMethod } | null;
  lineItems: Array<{
    id: string;
    position: number;
    description: string | null;
    skrAccount: string | null;
    depreciation: string | null;
    amount: string | null;
    vatRule: string | null;
    vatRate: string | null;
    vatAmount: string | null;
    total: string | null;
  }>;
}

interface Props {
  doc: DocumentData;
  prevDoc: { id: string; fileName: string } | null;
  nextDoc: { id: string; fileName: string } | null;
  locale: string;
  skrType: "SKR03" | "SKR04";
  skrAccountOptions: Array<{ number: string; label: string; group: string }>;
  initialPayment: { paidAt: string; method: PaymentMethod } | null;
  /**
   * Steuerstatus des Tenants — wird vom AfA-Panel gebraucht (Kleinunternehmer
   * = keine VSt-Abzugsberechtigung → AfA-Basis ist Brutto). Direkt als Daten-
   * Prop statt vorgerenderter Slot-Komponente, damit React 19/Next 16 die
   * Kind-Liste sauber reconciliert.
   */
  taxMode: string;
  /** Asset-Verknüpfung (falls Beleg bereits zu einem Anlagegut wurde). */
  fixedAsset: { id: string; assetNumber: string; name: string } | null;
  /**
   * True, wenn zu diesem Beleg bereits ein Journal-Eintrag existiert.
   *
   * Bewusst nicht aus dem Status abgeleitet: die OCR setzt am Ende ebenfalls
   * DONE, obwohl der Nutzer den Beleg noch gar nicht fertiggestellt hat.
   */
  isBooked: boolean;
}

// ─── Shared UI ──────────────────────────────────────────────────────────────

const INPUT_BASE = "w-full px-2.5 py-1.5 bg-muted border rounded-lg text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors";
const INPUT = `${INPUT_BASE} border-border`;
const INPUT_ERROR = `${INPUT_BASE} border-destructive/60 bg-destructive/5 focus:ring-destructive/30 focus:border-destructive/60`;
const LABEL = "block text-xs font-medium text-muted-foreground mb-1";
const LABEL_REQUIRED = "block text-xs font-medium text-muted-foreground mb-1 after:content-['*'] after:ml-0.5 after:text-destructive";

const VAT_RATES = [0, 7, 19] as const;

// ─── OCR category → documentType inference ───────────────────────────────────
// Maps the OCR-returned category string to INCOME / EXPENSE.
// CREDIT_NOTE is income (you receive money back); everything else that arrives
// as an incoming document is an expense.
function inferDocumentType(
  suggestedCategory: string | null
): "INCOME" | "EXPENSE" | null {
  if (!suggestedCategory) return null;
  if (suggestedCategory === "CREDIT_NOTE") return "INCOME";
  if (
    suggestedCategory === "INVOICE_INCOMING" ||
    suggestedCategory === "RECEIPT" ||
    suggestedCategory === "CONTRACT" ||
    suggestedCategory === "DELIVERY_NOTE" ||
    suggestedCategory === "OTHER"
  ) return "EXPENSE";
  return null;
}

function Card({ title, children, className = "", actions }: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={`border border-border/70 rounded-xl overflow-hidden ${className}`}>
      {title && (
        <div className="px-4 py-2 border-b border-border/70 bg-muted/40 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
          {actions}
        </div>
      )}
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

const MIME_LABELS: Record<string, string> = {
  "application/pdf": "PDF", "image/png": "PNG", "image/jpeg": "JPEG",
  "image/jpg": "JPG", "image/webp": "WebP", "image/gif": "GIF",
  "image/tiff": "TIFF", "image/bmp": "BMP",
};
function formatFileType(mime: string): string {
  return MIME_LABELS[mime] ?? mime.split("/").pop()?.toUpperCase() ?? mime;
}

// ─── Payment status ───────────────────────────────────────────────────────────

type PaymentStatus = "draft" | "processing" | "overdue" | "dueToday" | "dueSoon" | "open" | "noDueDate" | "paid";

function computePaymentStatus(
  ocrStatus: string,
  dueDateStr: string | null | undefined,
  isDraft = false,
) {
  if (isDraft) return { status: "draft" as PaymentStatus, days: null };
  if (ocrStatus === "PROCESSING" || ocrStatus === "PENDING") return { status: "processing" as PaymentStatus, days: null };
  if (!dueDateStr) return { status: "noDueDate" as PaymentStatus, days: null };

  // 1. Normalize "Today" to midnight
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 2. Normalize "Due Date" to midnight
  const dueDate = new Date(dueDateStr);
  dueDate.setHours(0, 0, 0, 0);

  // 3. Calculate difference in days
  const diffTime = dueDate.getTime() - today.getTime();
  const days = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (days < 0)  return { status: "overdue"  as PaymentStatus, days: Math.abs(days) };
  if (days === 0) return { status: "dueToday" as PaymentStatus, days: 0 };
  if (days <= 7) return { status: "dueSoon"  as PaymentStatus, days };
  
  return { status: "open" as PaymentStatus, days };
}

const PAYMENT_STATUS_CLASSES: Record<PaymentStatus, string> = {
  draft:      "bg-muted text-muted-foreground",
  processing: "bg-blue-500/10 text-blue-400",
  overdue:    "bg-destructive/10 text-destructive",
  dueToday:   "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  dueSoon:    "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  open:       "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  noDueDate:  "bg-muted text-muted-foreground",
  paid:       "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
};

function PaymentStatusIcon({ status }: { status: PaymentStatus }) {
  switch (status) {
    case "draft":      return <Save className="w-3 h-3" />;
    case "processing": return <Loader2 className="w-3 h-3 animate-spin" />;
    case "overdue":    return <AlertTriangle className="w-3 h-3" />;
    case "dueToday":   return <AlertTriangle className="w-3 h-3" />;
    case "dueSoon":
    case "noDueDate":  return <Clock className="w-3 h-3" />;
    case "open":       return <CheckCircle2 className="w-3 h-3" />;
    case "paid":       return <Check className="w-3 h-3" />;
  }
}

// ─── VAT summary (computed from line items) ───────────────────────────────────
// Shown below the line items card as a read-only breakdown.

function LineItemsVatSummary({
  lineItems,
  currency,
  exchangeRate,
  t,
}: {
  lineItems: LineItem[];
  currency: string;
  /** EUR pro 1 Einheit Fremdwährung — bei EUR-Belegen null. */
  exchangeRate: number | null;
  t: ReturnType<typeof useTranslations<"documents">>;
}) {
  // Group by VAT rate and sum totals
  const totalsGross = lineItems.reduce((sum, i) => sum + (parseFloat(i.total) || 0), 0);
  if (!totalsGross) return null;

  // For the summary we use a weighted average vat rate approach:
  // collect distinct rates used across line items
  // Je Satz Brutto UND Steuer sammeln. Die Steuer kommt aus dem Beleg, wenn
  // der Nutzer sie erfasst hat — Lieferanten dürfen je Position runden, dann
  // weicht die Summe von der Rückrechnung aus dem Brutto ab.
  const rateGroups: Record<string, { gross: number; vat: number }> = {};
  lineItems.forEach((item) => {
    const rate = item.vatRate !== "" ? item.vatRate : null;
    const gross = parseFloat(item.total) || 0;
    if (gross === 0) return;
    const key = rate ?? "unknown";
    const r = parseFloat(rate ?? "") || 0;
    const stated = item.vatAmount !== "" ? parseFloat(item.vatAmount) : NaN;
    const vat = Number.isNaN(stated) ? (r === 0 ? 0 : gross - gross / (1 + r / 100)) : stated;
    const g = rateGroups[key] ?? { gross: 0, vat: 0 };
    g.gross += gross;
    g.vat += vat;
    rateGroups[key] = g;
  });

  const entries = Object.entries(rateGroups);

  const totalNet = entries.reduce((sum, [, g]) => sum + g.gross - g.vat, 0);

  return (
    <div className="mt-1 pt-3 border-t border-border/60 space-y-1">
      <div className="flex items-baseline justify-between text-xs py-0.5">
        <span className="text-muted-foreground">{t("detail.fields.netAmount")}</span>
        <span className="font-medium tabular-nums">{formatAmount(totalNet, currency)}</span>
      </div>
      {entries.map(([rate, g]) => {
        const vat = g.vat;
        return (
          <div key={rate} className="flex items-baseline justify-between text-xs py-0.5">
            <span className="text-muted-foreground">{t("detail.fields.vatAmount")} ({rate !== "unknown" ? `${rate} %` : "—"})</span>
            <span className="font-medium tabular-nums">{formatAmount(vat, currency)}</span>
          </div>
        );
      })}
      <div className="flex items-baseline justify-between text-xs py-0.5 font-semibold border-t border-border/60 pt-1.5 mt-0.5">
        <span className="text-foreground">{t("detail.fields.grossAmount")}</span>
        <span className="text-right">
          <span className="tabular-nums text-foreground block">{formatAmount(totalsGross, currency)}</span>
          {currency !== "EUR" && exchangeRate && (
            <span className="tabular-nums text-[10px] text-muted-foreground font-normal block">
              ≈ {formatCurrency(totalsGross * exchangeRate)}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

// ─── SKR Account Input ────────────────────────────────────────────────────────
// Name as the prominent primary text, number as smaller text below.

function SkrAccountInput({
  value,
  onChange,
  onOpenPicker,
  skrAccountOptions,
  hasError = false,
  placeholder = "",
}: {
  value: string;
  onChange: (val: string) => void;
  onOpenPicker: () => void;
  skrAccountOptions: Array<{ number: string; label: string; group: string }>;
  hasError?: boolean;
  placeholder?: string;
}) {
  const matchedOption = value ? skrAccountOptions.find((o) => o.number === value) : null;
  const accountName = matchedOption
    ? (matchedOption.label.split(" – ")[1] ?? matchedOption.label)
    : null;

  return (
    <div className="relative">
      {/* When an account is selected, show a styled display block instead of raw input */}
      {matchedOption ? (
        <div
          className={`${hasError ? INPUT_ERROR : INPUT} pr-9 cursor-pointer min-h-[2.25rem] flex flex-col justify-center gap-0.5`}
          onClick={onOpenPicker}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpenPicker(); }}
        >
          <span className="text-xs font-medium text-foreground leading-tight truncate">{accountName}</span>
          <span className="text-[10px] font-mono text-muted-foreground leading-tight">{value}</span>
        </div>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${hasError ? INPUT_ERROR : INPUT} pr-9`}
        />
      )}
      <button
        type="button"
        onClick={onOpenPicker}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
        title="Konto auswählen"
      >
        <BookOpen className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── SKR Picker Modal ─────────────────────────────────────────────────────────

function SkrPickerModal({
  open,
  onClose,
  onSelect,
  skrAccountOptions,
  t,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (number: string) => void;
  skrAccountOptions: Array<{ number: string; label: string; group: string }>;
  t: ReturnType<typeof useTranslations<"documents">>;
}) {
  const [search, setSearch] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const groups = Array.from(new Set(skrAccountOptions.map((a) => a.group)));

  const filtered = skrAccountOptions.filter((a) => {
    const matchesGroup = !selectedGroup || a.group === selectedGroup;
    const q = search.toLowerCase();
    // Search by name first, number as fallback
    const name = (a.label.split(" – ")[1] ?? a.label).toLowerCase();
    const matchesSearch = !q || name.includes(q) || a.label.toLowerCase().includes(q) || a.number.startsWith(q);
    return matchesGroup && matchesSearch;
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">{t("detail.fields.bookingAccountPicker")}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search — by name */}
        <div className="px-4 py-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSelectedGroup(null); }}
              placeholder={t("detail.fields.bookingAccountSearch")}
              className="w-full pl-9 pr-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {!search && (
            <div className="w-48 shrink-0 border-r border-border overflow-y-auto py-2">
              <button
                onClick={() => setSelectedGroup(null)}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  !selectedGroup ? "bg-primary/10 text-primary font-medium" : "text-foreground hover:bg-muted"
                }`}
              >
                {t("detail.fields.bookingAccountAll")}
              </button>
              {groups.map((group) => (
                <button
                  key={group}
                  onClick={() => setSelectedGroup(group)}
                  className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                    selectedGroup === group ? "bg-primary/10 text-primary font-medium" : "text-foreground hover:bg-muted"
                  }`}
                >
                  {group}
                </button>
              ))}
            </div>
          )}

          {/* Account list — name prominent, number small below */}
          <div className="flex-1 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {t("detail.fields.bookingAccountNoResults")}
              </p>
            ) : filtered.map((account) => (
              <button
                key={account.number}
                onClick={() => { onSelect(account.number); onClose(); }}
                className="w-full flex flex-col px-4 py-2.5 text-left hover:bg-muted transition-colors group gap-0.5"
              >
                <span className="text-sm text-foreground group-hover:text-primary transition-colors truncate">
                  {account.label.split(" – ")[1] ?? account.label}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums">
                  {account.number} · {account.group}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Payment method ───────────────────────────────────────────────────────────

type PaymentMethod = "BANK_TRANSFER" | "CASH" | "CREDIT_CARD" | "PAYPAL";

const PAYMENT_METHOD_ICONS: Record<PaymentMethod, React.ReactNode> = {
  BANK_TRANSFER: <Building2 className="w-4 h-4" />,
  CASH:          <Banknote className="w-4 h-4" />,
  CREDIT_CARD:   <CreditCard className="w-4 h-4" />,
  PAYPAL:        <Wallet className="w-4 h-4" />,
};

interface PaymentData {
  paidAt: string;       // ISO date string
  method: PaymentMethod;
}

// ─── MarkAsPaidModal ──────────────────────────────────────────────────────────

function MarkAsPaidModal({
  open,
  onClose,
  onConfirm,
  defaultDate,
  t,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (data: PaymentData) => void;
  defaultDate: string;
  t: ReturnType<typeof useTranslations<"documents">>;
}) {
  const [paidAt, setPaidAt] = useState(defaultDate);
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");

  // Reset to today's date each time the modal opens
  useEffect(() => {
    if (open) {
      setPaidAt(defaultDate);
      setMethod("BANK_TRANSFER");
    }
  }, [open, defaultDate]);

  if (!open) return null;

  const methods: PaymentMethod[] = ["BANK_TRANSFER", "CASH", "CREDIT_CARD", "PAYPAL"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">{t("detail.payment.modalTitle")}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Payment date */}
          <div>
            <label className={LABEL}>{t("detail.payment.paidAt")}</label>
            <input
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              className={INPUT}
            />
          </div>

          {/* Payment method */}
          <div>
            <label className={LABEL}>{t("detail.payment.method")}</label>
            <div className="grid grid-cols-2 gap-2">
              {methods.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                    method === m
                      ? "bg-primary/10 border-primary/40 text-primary"
                      : "bg-muted/30 border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {PAYMENT_METHOD_ICONS[m]}
                  {t(`detail.payment.methods.${m}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("detail.payment.cancel")}
          </button>
          <button
            onClick={() => onConfirm({ paidAt, method })}
            disabled={!paidAt}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors disabled:opacity-50"
          >
            <Check className="w-3 h-3" />
            {t("detail.payment.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ConfirmEditModal ─────────────────────────────────────────────────────────

function ConfirmEditModal({
  open,
  onClose,
  onConfirm,
  t,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  t: ReturnType<typeof useTranslations<"documents">>;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-background border border-border rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{t("detail.editConfirm.title")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("detail.editConfirm.description")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted hover:bg-accent rounded-lg transition-colors"
            >
              {t("detail.editConfirm.cancel")}
            </button>
            <button
              onClick={() => { onConfirm(); onClose(); }}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-foreground bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors"
            >
              <Pencil className="w-3 h-3" />
              {t("detail.editConfirm.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ConfirmDuplicateModal ────────────────────────────────────────────────────
//
// Soft confirmation, wenn der Beleg einen exact-Datei-Match hat (gleiche Bytes
// wie ein bereits hochgeladener Beleg). Bei semantic matches greift dieser
// Dialog NICHT — dort ist die false-positive-Rate für recurring invoices zu
// hoch (gleicher Lieferant + gleicher Betrag + gleiches Datum kommt bei
// monatlichen Abos vor).

function ConfirmDuplicateModal({
  open,
  complete,
  onClose,
  onConfirm,
  t,
}: {
  open: boolean;
  complete: boolean;
  onClose: () => void;
  onConfirm: () => void;
  t: ReturnType<typeof useTranslations<"documents">>;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-background border border-border rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {t("detail.duplicates.confirmTitle")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("detail.duplicates.confirmBody")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted hover:bg-accent rounded-lg transition-colors"
            >
              {t("detail.duplicates.confirmCancel")}
            </button>
            <button
              onClick={() => { onConfirm(); onClose(); }}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-foreground bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors"
            >
              {complete
                ? t("detail.duplicates.confirmFinalize")
                : t("detail.duplicates.confirmDraft")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MarkAsUnpaidModal ────────────────────────────────────────────────────────

function MarkAsUnpaidModal({
  open,
  onClose,
  onConfirm,
  t,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  t: ReturnType<typeof useTranslations<"documents">>;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-background border border-border rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
              <RefreshCw className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{t("detail.payment.unpaidConfirm.title")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("detail.payment.unpaidConfirm.description")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted hover:bg-accent rounded-lg transition-colors"
            >
              {t("detail.payment.unpaidConfirm.cancel")}
            </button>
            <button
              onClick={() => { onConfirm(); onClose(); }}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-foreground bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              {t("detail.payment.unpaidConfirm.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CommittedSummaryView ─────────────────────────────────────────────────────
// Read-only summary shown after a document has been committed (status = DONE).
// Shows the information an accountant actually needs at a glance:
// supplier, amount, dates, payment status, line items.

function CommittedSummaryView({
  doc,
  lineItems,
  supplier,
  docDate,
  dueDate,
  docNumber,
  documentType,
  paymentInfo,
  paymentData,
  totalGross,
  skrAccountOptions,
  t,
}: {
  doc: DocumentData;
  lineItems: LineItem[];
  supplier: string;
  docDate: string;
  dueDate: string;
  docNumber: string;
  documentType: "INCOME" | "EXPENSE" | null;
  paymentInfo: ReturnType<typeof computePaymentStatus>;
  paymentData: PaymentData | null;
  totalGross: number;
  skrAccountOptions: Array<{ number: string; label: string; group: string }>;
  t: ReturnType<typeof useTranslations<"documents">>;
}) {
  const totalsGross = lineItems.reduce((sum, i) => sum + (parseFloat(i.total) || 0), 0);

  return (
    <div className="flex-1 px-4 py-4 space-y-3">

      {/* ── Summary card: core identity ──────────────────────────────── */}
      <Card>
        <div className="space-y-2.5">

          {/* Supplier + doc type. Bei verknüpftem Kontakt klickbar → Kontakt-Detail. */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              {doc.contact ? (
                <Link
                  href={`/dashboard/contacts/${doc.contact.id}`}
                  className="text-sm font-semibold text-foreground hover:text-primary transition-colors inline-flex items-center gap-1.5 truncate"
                >
                  <span className="truncate">{doc.contact.name}</span>
                  <ExternalLink className="w-3 h-3 opacity-60 shrink-0" />
                </Link>
              ) : (
                <p className="text-sm font-semibold text-foreground truncate">{supplier || "—"}</p>
              )}
              {doc.contact?.supplierNumber && (
                <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                  Lieferantennr. {doc.contact.supplierNumber}
                </p>
              )}
            </div>
          </div>

          {/* Amount — hero number. Bei Fremdwährung Original + EUR-Äquivalent. */}
          <div className="pt-2 border-t border-border/60">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{t("detail.fields.grossAmount")}</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {formatAmount(totalGross, doc.currency)}
            </p>
            {doc.currency && doc.currency !== "EUR" && doc.exchangeRate && (
              <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                ≈ {formatCurrency(totalGross * parseFloat(doc.exchangeRate))} ({doc.exchangeRate} EUR / 1 {doc.currency})
              </p>
            )}
          </div>

          {/* Key dates */}
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/60">
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">{t("detail.fields.documentDate")}</p>
              <p className="text-xs font-medium text-foreground">{docDate ? fmtDateShort(docDate) : "—"}</p>
            </div>
            {dueDate && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">{t("detail.fields.dueDate")}</p>
                <p className={`text-xs font-medium ${
                  paymentInfo.status === "overdue" ? "text-destructive" :
                  paymentInfo.status === "dueToday" ? "text-amber-600 dark:text-amber-400" :
                  "text-foreground"
                }`}>
                  {fmtDateShort(dueDate)}
                  {paymentInfo.status === "overdue" && paymentInfo.days !== null && (
                    <span className="ml-1 font-normal text-destructive/70">
                      ({t("detail.fields.dueSince", { days: paymentInfo.days })})
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>

          {/* Doc number */}
          <div className="flex items-baseline justify-between text-xs pt-1 border-t border-border/60">
            <span className="text-muted-foreground">{t("detail.fields.documentNumber")}</span>
            <span className="font-mono font-medium text-foreground">{docNumber || "—"}</span>
          </div>
        </div>
      </Card>

      {/* ── Payment info (if paid) ────────────────────────────────────── */}
      {paymentData && (
        <Card>
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{t("detail.payment.paidTitle")}</span>
            </div>
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">{t("detail.payment.paidAt")}</span>
              <span className="font-medium text-foreground">{fmtDateShort(paymentData.paidAt)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{t("detail.payment.method")}</span>
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                {PAYMENT_METHOD_ICONS[paymentData.method]}
                {t(`detail.payment.methods.${paymentData.method}`)}
              </span>
            </div>
          </div>
        </Card>
      )}

      {/* ── Line items (read-only) ────────────────────────────────────── */}
      {lineItems.length > 0 && (
        <Card title={t("detail.cards.lineItems")}>
          <div className="space-y-2">
            {lineItems.map((item, i) => (
              <div key={item.id} className={`space-y-1 ${i > 0 ? "pt-2 border-t border-border/60" : ""}`}>
                {item.description && (
                  <p className="text-xs font-medium text-foreground truncate">{item.description}</p>
                )}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {(() => {
                      const match = item.skrAccount ? skrAccountOptions.find((a) => a.number === item.skrAccount) : null;
                      return match ? (match.label.split(" – ")[1] ?? match.label) : (item.skrAccount || "—");
                    })()}
                  </span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {item.total ? formatAmount(parseFloat(item.total), doc.currency) : "—"}
                  </span>
                </div>
                {item.skrAccount && (
                  <p className="text-[10px] font-mono text-muted-foreground/60">{item.skrAccount}</p>
                )}
                {item.vatRate && (
                  <p className="text-xs text-muted-foreground">{t("detail.fields.vatRate")}: {item.vatRate} %</p>
                )}
              </div>
            ))}
            {/* VAT totals */}
            {totalsGross > 0 && (
              <LineItemsVatSummary
                lineItems={lineItems}
                currency={doc.currency}
                exchangeRate={doc.exchangeRate ? parseFloat(doc.exchangeRate) : null}
                t={t}
              />
            )}
          </div>
        </Card>
      )}

      {/* ── Tags (read-only) ─────────────────────────────────────────── */}
      {doc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1">
          {doc.tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted rounded-full text-xs text-muted-foreground">
              <Tag className="w-2.5 h-2.5" />
              {tag}
            </span>
          ))}
        </div>
      )}
      
      {/* ── Tags (read-only) ─────────────────────────────────────────── */}
      {documentType && (
        <span className={`inline-block mt-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
          documentType === "EXPENSE"
            ? "bg-red-500/10 text-red-700 dark:text-red-400"
            : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
        }`}>
          {t(`documentType.${documentType}`)}
        </span>
      )}
      
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DocumentDetailSidebar({
  doc,
  prevDoc,
  nextDoc,
  locale,
  skrType,
  skrAccountOptions,
  initialPayment,
  taxMode,
  fixedAsset,
  isBooked,
}: Props) {
  const t = useTranslations("documents");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

  // ── Form state ────────────────────────────────────────────────────────
  const [documentType, setDocumentType] = useState<"INCOME" | "EXPENSE" | null>(
    // Use persisted value first; fall back to OCR category inference
    doc.documentType ?? inferDocumentType(doc.suggestedCategory)
  );
  const [docDate, setDocDate] = useState(toInputDate(doc.recognizedDate));
  const [deliveryDateMode, setDeliveryDateMode] = useState<"date" | "range">(
    doc.deliveryDateEnd ? "range" : "date"
  );
  // Delivery date: use saved value → fall back to documentDate (like dueDate does)
  const [deliveryDate, setDeliveryDate] = useState(
    toInputDate(doc.deliveryDate) || toInputDate(doc.recognizedDate)
  );
  const [deliveryDateEnd, setDeliveryDateEnd] = useState(toInputDate(doc.deliveryDateEnd));
  const [dueDate, setDueDate] = useState(toInputDate(doc.dueDate ?? doc.recognizedDueDate));
  const [supplier, setSupplier] = useState(doc.recognizedSupplier ?? "");
  const [docNumber, setDocNumber] = useState(doc.documentNumber ?? doc.recognizedDocNumber ?? "");
  const [tags, setTags] = useState<string[]>(doc.tags);
  const [tagInput, setTagInput] = useState("");
  // Belegwährung + Wechselkurs zum Belegdatum. Bei EUR bleibt rate null;
  // bei Fremdwährung holt ein useEffect den ECB-Referenzkurs vom Belegdatum.
  const [currency, setCurrency] = useState<string>(doc.currency || "EUR");
  const [inputVatKind, setInputVatKind] = useState<string>(doc.inputVatKind ?? "");
  const [exchangeRate, setExchangeRate] = useState<string>(doc.exchangeRate ?? "");
  const [fxLookupPending, setFxLookupPending] = useState(false);
  const [fxLookupError, setFxLookupError] = useState<string | null>(null);

  // Auto-Lookup: bei jedem Wechsel der Währung oder des Belegdatums den
  // ECB-Tageskurs holen, sofern der User noch keinen manuellen Wert gesetzt
  // hat. Manuelle Eingabe wird nicht überschrieben — dann nur, wenn die
  // Währung wechselt (alter Kurs gilt nicht mehr).
  const lastFxLookupRef = useRef<{ date: string; currency: string } | null>(null);
  useEffect(() => {
    if (currency === "EUR") {
      setExchangeRate("");
      setFxLookupError(null);
      return;
    }
    if (!docDate) return;
    const key = { date: docDate, currency };
    if (
      lastFxLookupRef.current &&
      lastFxLookupRef.current.date === key.date &&
      lastFxLookupRef.current.currency === key.currency
    ) {
      return;
    }
    lastFxLookupRef.current = key;
    setFxLookupPending(true);
    setFxLookupError(null);
    lookupExchangeRate(docDate, currency)
      .then((res) => {
        if (res.success) {
          setExchangeRate(res.rate.toFixed(6));
        } else {
          setFxLookupError(res.error);
        }
      })
      .catch((e) => setFxLookupError(e instanceof Error ? e.message : "FX lookup failed"))
      .finally(() => setFxLookupPending(false));
  }, [currency, docDate]);
  
  const [fileInfoOpen, setFileInfoOpen] = useState(false);
  const [ocrInfoOpen, setOcrInfoOpen] = useState(false);

  // ── SKR picker: tracks which line item is being edited ────────────────
  const [skrPickerOpen, setSkrPickerOpen] = useState(false);
  const [skrPickerTarget, setSkrPickerTarget] = useState<string | null>(null);

  function openSkrPicker(lineItemId: string) {
    setSkrPickerTarget(lineItemId);
    setSkrPickerOpen(true);
  }

  // ── Draft state ───────────────────────────────────────────────────────
  // Initialised from DB. Flipped optimistically on Save Draft / Complete
  // so the badge updates instantly without waiting for router.refresh().
  const [isDraft, setIsDraft] = useState(doc.status === "DRAFT");

  // ── Committed state ───────────────────────────────────────────────────
  // True when the document has been marked complete (status DONE or PAID).
  // Switches the sidebar to read-only summary + action buttons.
  const [isCommitted, setIsCommitted] = useState(
    (doc.status === "DONE" || doc.status === "PAID") && !isDraft
  );
  const [paymentData, setPaymentData] = useState<PaymentData | null>(initialPayment);
  const [showMarkPaidModal, setShowMarkPaidModal] = useState(false);
  const [showMarkUnpaidModal, setShowMarkUnpaidModal] = useState(false);
  const [showEditConfirmModal, setShowEditConfirmModal] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSupplierDialog, setShowSupplierDialog] = useState(false);
  // Duplikat-Erkennung: Banner setzt diesen Flag, sobald ein exact-Match
  // gefunden wurde. `pendingSave` hält das Argument von handleSave fest,
  // während der Confirm-Dialog offen ist (true = fertigstellen, false = Entwurf).
  const [hasExactDuplicate, setHasExactDuplicate] = useState(false);
  const [pendingSave, setPendingSave] = useState<{ complete: boolean } | null>(null);

  // ── Line items ────────────────────────────────────────────────────────
  // If no persisted line items exist, auto-seed one from OCR data.
  const buildInitialLineItems = (): LineItem[] => {
    if (doc.lineItems.length > 0) {
      return doc.lineItems.map((item) => ({
        id: item.id,
        position: item.position,
        description: item.description ?? "",
        skrAccount: item.skrAccount ?? "",
        depreciation: item.depreciation ?? "",
        amount: item.amount ?? "",
        vatRule: item.vatRule ?? "",
        vatRate: item.vatRate ?? "",
        vatAmount: item.vatAmount ?? "",
        total: item.total ?? "",
      }));
    }
    return [{
      id: crypto.randomUUID(),
      position: 0,
      description: doc.recognizedDescription ?? "",
      skrAccount: doc.bookingAccount ?? "",
      depreciation: "",
      amount: doc.recognizedAmount ?? "",
      vatRule: "",
      vatAmount: "",
      vatRate: doc.vatRate ?? doc.recognizedVatRate ?? "",
      total: doc.recognizedAmount ?? "",
    }];
  };

  const [lineItems, setLineItems] = useState<LineItem[]>(buildInitialLineItems);
  const [showLineItems, setShowLineItems] = useState(true);

  // Derived totals from line items (replace standalone amount/vatRate fields)
  const totalGross = lineItems.reduce((s, i) => s + (parseFloat(i.total) || 0), 0);

  /** Steuerbetrag, wie er sich aus Brutto und Satz ergibt — der Vorschlagswert. */
  function derivedVatFor(item: { total: string; vatRate: string }): number {
    const gross = parseFloat(item.total) || 0;
    const rate = parseFloat(item.vatRate) || 0;
    if (gross === 0 || rate === 0) return 0;
    return Math.round((gross - gross / (1 + rate / 100)) * 100) / 100;
  }
  const primaryBookingAccount = lineItems[0]?.skrAccount ?? "";
  const primaryVatRate = lineItems[0]?.vatRate ?? "";
  const primaryTotal = lineItems[0]?.total ?? "";

  // ── Validation ────────────────────────────────────────────────────────
  const [showValidation, setShowValidation] = useState(false);

  const requiredFields = {
    documentType: documentType ?? "",
    // amount and vatRate now come from the first line item
    lineItemTotal: primaryTotal,
    lineItemVatRate: primaryVatRate,
    docDate,
    supplier,
    docNumber,
    bookingAccount: primaryBookingAccount,
    deliveryDate,
  } as const;

  type RequiredKey = keyof typeof requiredFields;

  const missingKeys = (Object.keys(requiredFields) as RequiredKey[]).filter(
    (k) => !requiredFields[k]?.trim()
  );
  const isComplete = missingKeys.length === 0;

  function fieldClass(key: RequiredKey) {
    return showValidation && !requiredFields[key]?.trim() ? INPUT_ERROR : INPUT;
  }

  // ── Auto-refresh while OCR is processing ──────────────────────────────
  const [ocrStatus, setOcrStatus] = useState(doc.status);
  const prevStatusRef = useRef(doc.status);

  useEffect(() => {
    if (ocrStatus !== "PROCESSING" && ocrStatus !== "PENDING") return;
    const interval = setInterval(() => { router.refresh(); }, 3000);
    return () => clearInterval(interval);
  }, [ocrStatus, router]);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = doc.status;
    setOcrStatus(doc.status);
    // Die Texterkennung setzt jetzt DRAFT statt DONE — DONE bleibt dem vom
    // Nutzer fertiggestellten Beleg vorbehalten. Beide Übergänge abfangen,
    // damit auch Bestandsbelege mit altem Verhalten noch vorbefüllt werden.
    const ocrJustFinished =
      (doc.status === "DRAFT" || doc.status === "DONE") &&
      (prev === "PROCESSING" || prev === "PENDING");
    if (ocrJustFinished) {
      setDocDate((c) => c || toInputDate(doc.recognizedDate));
      setDueDate((c) => c || toInputDate(doc.dueDate ?? doc.recognizedDueDate));
      // deliveryDate: use saved → recognizedDate as fallback (matches ocr-shared.ts pattern)
      setDeliveryDate((c) => c || toInputDate(doc.deliveryDate) || toInputDate(doc.recognizedDate));
      setSupplier((c) => c || doc.recognizedSupplier || "");
      setDocNumber((c) => c || doc.documentNumber || doc.recognizedDocNumber || "");
      // documentType: infer from OCR category if not already set
      setDocumentType((c) => c ?? inferDocumentType(doc.suggestedCategory));
      // Seed the default line item when OCR just completed
      setLineItems((prev) => {
        if (prev.length === 1 && !prev[0].total && doc.recognizedAmount) {
          return [{
            ...prev[0],
            total: doc.recognizedAmount,
            amount: doc.recognizedAmount,
            vatRate: prev[0].vatRate || doc.vatRate || doc.recognizedVatRate || "",
            skrAccount: prev[0].skrAccount || doc.bookingAccount || "",
          }];
        }
        return prev;
      });
    }
  }, [doc]);

  // ── Keyboard shortcut: Cmd/Ctrl+S → Save Draft ───────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // handleSave is stable within the render but we need current closure values —
  // listing the state deps that handleSave reads keeps the ref fresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentType, docDate, deliveryDate, deliveryDateEnd, deliveryDateMode,
      dueDate, supplier, docNumber, tags, lineItems, totalGross, isDraft]);

  // ── Delete state ──────────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // ── Payment status ────────────────────────────────────────────────────
  const effectiveDueDate = dueDate || toInputDate(doc.recognizedDueDate);
  const rawPaymentInfo = computePaymentStatus(ocrStatus, effectiveDueDate, isDraft);
  // Override status with "paid" if payment has been recorded
  const paymentInfo = paymentData
    ? { ...rawPaymentInfo, status: "paid" as PaymentStatus }
    : rawPaymentInfo;
  const isOverdueOrDueToday = paymentInfo.status === "overdue" || paymentInfo.status === "dueToday";
  const dueDays = paymentInfo.days;

  // ── Tags ──────────────────────────────────────────────────────────────
  const addTag = useCallback(() => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) setTags((p) => [...p, tag]);
    setTagInput("");
  }, [tagInput, tags]);

  const removeTag = useCallback((tag: string) => {
    setTags((p) => p.filter((t) => t !== tag));
  }, []);

  // ── Line item helpers ─────────────────────────────────────────────────
  const addLineItem = useCallback(() => {
    setLineItems((p) => [...p, {
      id: crypto.randomUUID(), position: p.length, description: "", skrAccount: "",
      depreciation: "", amount: "", vatRule: "", vatRate: "", vatAmount: "", total: "",
    }]);
    setShowLineItems(true);
  }, []);

  const removeLineItem = useCallback((id: string) => {
    setLineItems((p) => p.filter((i) => i.id !== id));
  }, []);

  const updateLineItem = useCallback((id: string, field: keyof LineItem, value: string) => {
    setLineItems((p) => p.map((i) => i.id === id ? { ...i, [field]: value } : i));
  }, []);

  // ── Save handler ──────────────────────────────────────────────────────
  function handleSave(complete: boolean, opts: { skipDuplicateCheck?: boolean } = {}) {
    if (complete && !isComplete) {
      setShowValidation(true);
      return;
    }

    // Soft duplicate confirmation: nur bei exact-Datei-Match (gleiche Bytes).
    // Semantic matches bleiben passiv (Banner) — sonst nervt es bei recurring
    // invoices. User kann via Dialog trotzdem speichern; nach Bestätigung wird
    // handleSave mit skipDuplicateCheck=true erneut gerufen.
    if (hasExactDuplicate && !opts.skipDuplicateCheck) {
      setPendingSave({ complete });
      return;
    }

    // Flip the draft badge immediately — don't wait for router.refresh()
    setIsDraft(!complete);

    const formData = new FormData();
    formData.set("id", doc.id);
    formData.set("documentType", documentType ?? "");
    // bookingAccount = first line item's skrAccount (backward compat)
    formData.set("bookingAccount", lineItems[0]?.skrAccount ?? "");
    // amount = sum of line item totals
    formData.set("recognizedAmount", totalGross ? String(totalGross) : "");
    formData.set("recognizedDate", docDate);
    formData.set("deliveryDate", deliveryDate);
    formData.set("deliveryDateEnd", deliveryDateMode === "range" ? deliveryDateEnd : "");
    formData.set("dueDate", dueDate);
    // vatRate = first line item's vatRate (backward compat)
    formData.set("vatRate", lineItems[0]?.vatRate ?? "");
    formData.set("recognizedSupplier", supplier);
    formData.set("documentNumber", docNumber);
    formData.set("notes", "");
    formData.set("tags", tags.join(","));
    formData.set("complete", complete ? "true" : "false");
    formData.set("lineItems", JSON.stringify(lineItems));
    formData.set("currency", currency);
    formData.set("inputVatKind", inputVatKind);
    formData.set("exchangeRate", currency === "EUR" ? "" : exchangeRate);

    startTransition(async () => {
      const result = await saveDocument(formData);
      if (result.success) {
        setSaveError(null);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
        if (complete) setIsCommitted(true);
        router.refresh();
      } else {
        // Optimistische Anzeige zurücknehmen — und den Fehler zeigen. Ohne
        // Hinweis wirkt ein fehlgeschlagenes Speichern wie Datenverlust.
        setIsDraft(doc.status === "DRAFT");
        setIsCommitted(false);
        setSaveError(result.error || t("detail.saveFailed"));
      }
    });
  }

  // ── Delete handler ────────────────────────────────────────────────────
  async function handleDelete() {
    setIsDeleting(true);
    const result = await deleteDocument(doc.id);
    if (result.success) {
      router.push("/dashboard/documents");
    } else {
      setIsDeleting(false);
      setDeleteConfirm(false);
    }
  }

  // ── OCR retry ─────────────────────────────────────────────────────────
  const [ocrRetrying, setOcrRetrying] = useState(false);
  async function handleRetryOcr() {
    setOcrRetrying(true);
    try {
      await fetch(`/api/documents/${doc.id}/ocr`, { method: "POST" });
      router.refresh();
    } finally {
      setOcrRetrying(false);
    }
  }

  // ── Field label i18n map for validation messages ──────────────────────
  const fieldLabels: Record<RequiredKey, string> = {
    documentType:    t("detail.fields.documentType"),
    lineItemTotal:   t("detail.cards.openAmount"),
    lineItemVatRate: t("detail.fields.vatRate"),
    docDate:         t("detail.fields.documentDate"),
    supplier:        t("detail.fields.supplier"),
    docNumber:       t("detail.fields.documentNumber"),
    bookingAccount:  t("detail.fields.bookingAccount"),
    deliveryDate:    t("detail.fields.deliveryDate"),
  };

  const paymentStatusClass = PAYMENT_STATUS_CLASSES[paymentInfo.status];

  return (
    <div className="w-[420px] shrink-0 flex flex-col overflow-y-auto border-l border-border bg-background">

      {/* ── Sticky header ─────────────────────────────────────────────── */}
      <div className={`sticky top-0 z-10 px-5 pt-4 pb-3 border-b bg-background/95 backdrop-blur-sm transition-colors duration-300 ${
        saveStatus === "saved" ? "border-emerald-500/60" : "border-border"
      }`}>

        {/* Row 1: Nav + Status */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1">
            {prevDoc ? (
              <Link href={`/dashboard/documents/${prevDoc.id}`}
                className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-muted transition-colors"
                title={prevDoc.fileName}>
                <ChevronLeft className="w-4 h-4 text-muted-foreground" />
              </Link>
            ) : <span className="w-7 h-7" />}
            {nextDoc ? (
              <Link href={`/dashboard/documents/${nextDoc.id}`}
                className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-muted transition-colors"
                title={nextDoc.fileName}>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </Link>
            ) : <span className="w-7 h-7" />}
          </div>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${paymentStatusClass}`}>
            <PaymentStatusIcon status={paymentInfo.status} />
            {t(`paymentStatus.${paymentInfo.status}`)}
          </span>
        </div>

        {/* File name + meta */}
        <h1 className="text-xl font-bold tracking-tight text-foreground leading-snug truncate" title={doc.fileName}>
          {doc.fileName}
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {fmtDateShort(doc.createdAt)} 
        </p>

        {/* Row 2: Action buttons — editing vs committed */}
        <div className="flex items-center gap-2 mt-3">
          {isCommitted ? (
            <>
              {paymentData ? (
                <>
                  {/* Paid: green checkmark badge with date + mark as unpaid */}
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3 h-3" />
                    {t("detail.payment.paidOn", { date: fmtDateShort(paymentData.paidAt) })}
                  </span>
                  <button
                    onClick={() => setShowMarkUnpaidModal(true)}
                    disabled={isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted rounded-lg hover:bg-accent transition-colors disabled:opacity-60"
                  >
                    {t("detail.payment.markAsUnpaid")}
                  </button>
                </>
              ) : (
                <>
                  {/* Not paid: Edit + Mark as paid */}
                  <button
                    onClick={() => setShowEditConfirmModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-foreground bg-muted rounded-lg hover:bg-accent transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                    {t("detail.editDocument")}
                  </button>
                  <button
                    onClick={() => setShowMarkPaidModal(true)}
                    disabled={isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-white bg-primary hover:bg-primary/90 transition-colors disabled:opacity-60"
                  >
                    <Banknote className="w-3 h-3" />
                    {t("detail.payment.markAsPaid")}
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              {/* Save Draft */}
              <button
                onClick={() => handleSave(false)}
                disabled={isPending}
                className="group flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-foreground bg-muted rounded-lg hover:bg-accent transition-colors disabled:opacity-60"
              >
                <div className="flex items-center gap-1.5">
                  {isPending ? <Loader2 className="w-3 h-3 animate-spin" />
                    : saveStatus === "saved" ? <Check className="w-3 h-3 text-emerald-500" />
                    : <Save className="w-3 h-3" />}
                  {isPending ? t("detail.saving") : saveStatus === "saved" ? t("detail.saved") : t("detail.saveDraft")}
                </div>
                {/* Keyboard shortcut indicator */}
                {!isPending && saveStatus !== "saved" && (
                  <span className="hidden ml-1 sm:flex items-center gap-0.5 text-[11px] font-sans opacity-50 group-hover:opacity-80 transition-opacity">
                    <kbd className="px-1 py-0.5 rounded-md border border-border/50 bg-background/50 shadow-sm">⌘</kbd>
                    <kbd className="px-1 py-0.5 rounded-md border border-border/50 bg-background/50 shadow-sm">S</kbd>
                  </span>
                )}
              </button>

              {/* Complete */}
              <button
                onClick={() => handleSave(true)}
                disabled={isPending}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-60 ${
                  isComplete
                    ? "text-white bg-primary hover:bg-primary/90"
                    : "text-white bg-primary/50 hover:bg-primary/60 cursor-pointer"
                }`}
              >
                <CheckCircle2 className="w-3 h-3" />
                {t("detail.complete")}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Scrollable body: summary (committed) or edit form ─────────── */}
      {isCommitted ? (
        <CommittedSummaryView
          doc={doc}
          lineItems={lineItems}
          supplier={supplier}
          docDate={docDate}
          dueDate={dueDate}
          docNumber={docNumber}
          documentType={documentType}
          paymentInfo={paymentInfo}
          paymentData={paymentData}
          totalGross={totalGross}
          skrAccountOptions={skrAccountOptions}
          t={t}
        />
      ) : (

      /* ── Scrollable card area (editing) ───────────────────────────── */
      <div className="flex-1 px-4 py-4 space-y-3">

        {/* ── Speicherfehler ───────────────────────────────────────────
            Muss sichtbar sein: schlägt das Speichern fehl, sind die
            Eingaben noch da, wurden aber nicht übernommen. Ohne Hinweis
            sieht das für den Nutzer aus wie Datenverlust. */}
        {saveError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 flex gap-2.5">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-xs min-w-0">
              <p className="font-medium text-foreground">{t("detail.saveFailed")}</p>
              <p className="text-muted-foreground mt-1 break-words">{saveError}</p>
            </div>
          </div>
        )}

        {/* ── Duplikat-Warnung (soft) ──────────────────────────────── */}
        <DuplicateWarningBanner
          documentId={doc.id}
          status={doc.status}
          locale={locale}
          onExactMatchChange={setHasExactDuplicate}
        />

        {/* ── Validation warning banner ──────────────────────────────── */}
        {showValidation && !isComplete && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-destructive mb-1.5">{t("detail.validation.title")}</p>
                <ul className="space-y-0.5">
                  {missingKeys.map((key) => (
                    <li key={key} className="text-xs text-destructive/80 flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-destructive/60 shrink-0" />
                      {fieldLabels[key]}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* ── Card: Kerndaten ───────────────────────────────────────────── */}
        <Card>

          {/* Belegart toggle * */}
          <div>
            <label className={`${LABEL_REQUIRED} ${showValidation && !documentType ? "text-destructive" : ""}`}>
              {t("detail.fields.documentType")}
            </label>
            <div className="grid grid-cols-2 gap-1.5 mt-1">
              {(["EXPENSE", "INCOME"] as const).map((type) => {
                const isSelected = documentType === type;
                const isExpense = type === "EXPENSE";
                const isError = showValidation && !documentType;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setDocumentType(type)}
                    className={`flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-all ${
                      isSelected
                        ? isExpense
                          ? "bg-red-500/10 border-red-500/50 text-red-700 dark:text-red-400"
                          : "bg-emerald-500/10 border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
                        : isError
                          ? "bg-destructive/5 border-destructive/30 text-muted-foreground hover:bg-muted/50"
                          : "bg-muted/30 border-border text-muted-foreground hover:border-border/80 hover:bg-muted/50"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isSelected
                        ? isExpense ? "bg-red-500" : "bg-emerald-500"
                        : "bg-muted-foreground/30"
                    }`} />
                    {t(`documentType.${type}`)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Document identity */}
          <div className="space-y-3 pt-4 mt-4 border-t border-border/60">
            <div>
              <label className={LABEL_REQUIRED}>{t("detail.fields.documentNumber")}</label>
              <input type="text" value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
                className={`${fieldClass("docNumber")} font-mono`}
              />
            </div>
            <div>
              <label className={LABEL_REQUIRED}>{t("detail.fields.documentDate")}</label>
              <input type="date" value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
                className={fieldClass("docDate")}
              />
            </div>
          </div>

          {/* Supplier + Dates */}
          <div className="pt-4 mt-4 border-t border-border/60 space-y-3">

            {/* Supplier * */}
            <div>
              <label className={LABEL_REQUIRED}>{t("detail.fields.supplier")}</label>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <input type="text" value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  className={`${fieldClass("supplier")} flex-1`}
                />
                {/* Status-Icon neben dem Lieferanten-Feld:
                    • verknüpft → grüner Check + Tooltip „verknüpft mit XYZ",
                      Klick öffnet die Kontakt-Detailseite.
                    • nicht verknüpft → UserPlus, Klick öffnet den Kontakt-
                      Dialog (Rolle SUPPLIER, Name prefilled). */}
                {doc.contact ? (
                  <Link
                    href={`/dashboard/contacts/${doc.contact.id}`}
                    title={t("detail.fields.supplierLinked", { name: doc.contact.name })}
                    className="shrink-0 w-8 h-8 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center transition-colors"
                  >
                    <LinkIcon className="w-4 h-4" />
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowSupplierDialog(true)}
                    title={t("detail.fields.supplierCreate")}
                    className="shrink-0 w-8 h-8 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

        {/* ── Lieferanten-Verknüpfung (rendert nichts wenn nicht verknüpft) ── */}
        <SupplierLinkPanel documentId={doc.id} currentContact={doc.contact} />

            {/* Lieferdatum * (date or range) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={LABEL_REQUIRED + " !mb-0"}>
                  {deliveryDateMode === "range"
                    ? t("detail.fields.deliveryDateRange")
                    : t("detail.fields.deliveryDate")}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setDeliveryDateMode((m) => m === "date" ? "range" : "date");
                    if (deliveryDateMode === "range") setDeliveryDateEnd("");
                  }}
                  className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                >
                  <Calendar className="w-3 h-3" />
                  {deliveryDateMode === "date"
                    ? t("detail.fields.deliveryDateSwitchRange")
                    : t("detail.fields.deliveryDateSwitchSingle")}
                </button>
              </div>
              {deliveryDateMode === "date" ? (
                <input type="date" value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className={fieldClass("deliveryDate")}
                />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5">{t("detail.fields.deliveryDateFrom")}</label>
                    <input type="date" value={deliveryDate}
                      onChange={(e) => setDeliveryDate(e.target.value)}
                      className={fieldClass("deliveryDate")}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5">{t("detail.fields.deliveryDateTo")}</label>
                    <input type="date" value={deliveryDateEnd}
                      onChange={(e) => setDeliveryDateEnd(e.target.value)}
                      className={INPUT}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Due date (optional) */}
            <div>
              <label className={LABEL}>
                {t("detail.fields.dueDate")}
                {paymentInfo.status === "overdue" && dueDays !== null && (
                  <span className="ml-1.5 text-destructive font-normal">
                    ({t("detail.fields.dueSince", { days: dueDays })})
                  </span>
                )}
                {paymentInfo.status === "dueToday" && (
                  <span className="ml-1.5 text-amber-600 dark:text-amber-400 font-normal">
                    ({t("paymentStatus.dueToday")})
                  </span>
                )}
              </label>
              <input type="date" value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={INPUT}
              />
              {/* Quick-set chips — standard payment terms */}
              <div className="flex items-center gap-1.5 mt-1.5">
                {([7, 14, 30] as const).map((days) => {
                  const d = new Date();
                  d.setDate(d.getDate() + days);
                  const val = d.toISOString().split("T")[0];
                  return (
                    <button
                      key={days}
                      type="button"
                      onClick={() => setDueDate(val)}
                      className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-muted hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("detail.fields.dueDateQuick", { days })}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

        </Card>

        {/* ── Card: Belegpositionen ─────────────────────────────────────── */}
        {/* Line items moved up — amount + vatRate replaced by line item fields */}
        <Card
          title={t("detail.cards.lineItems")}
          actions={
            <button onClick={addLineItem}
              className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/10 rounded-md transition-colors">
              <Plus className="w-3 h-3" />
              {t("detail.addLineItem")}
            </button>
          }
        >
          {/* ── Belegwährung + Wechselkurs (Belegebene, oberhalb der Positionen) */}
          <div className="space-y-1.5 mb-3 pb-3 border-b border-border/60">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={LABEL}>{t("detail.fields.currency")}</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className={INPUT}
                >
                  {SUPPORTED_FX_CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              {currency !== "EUR" && (
                <div>
                  <label className={LABEL}>
                    {t("detail.fields.exchangeRate")}
                    {fxLookupPending && <Loader2 className="inline w-3 h-3 ml-1 animate-spin opacity-60" />}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={exchangeRate}
                    onChange={(e) => {
                      setExchangeRate(e.target.value);
                      lastFxLookupRef.current = { date: docDate, currency };
                    }}
                    placeholder="0.000000"
                    className={INPUT}
                  />
                </div>
              )}
            </div>
            {currency !== "EUR" && (
              <p className="text-[10px] text-muted-foreground">
                {fxLookupError
                  ? t("detail.fields.fxLookupFailed", { error: fxLookupError })
                  : exchangeRate
                    ? t("detail.fields.fxHint", {
                        currency,
                        rate: exchangeRate,
                        eur: formatCurrency(totalGross * (parseFloat(exchangeRate) || 0)),
                      })
                    : t("detail.fields.fxHintMissing")}
              </p>
            )}

            {/* ── Steuerschuldumkehr (Belegebene) ────────────────────────
                Bei Reverse Charge und innergemeinschaftlichem Erwerb weist
                der Lieferant netto aus — der Rechnungsbetrag ist dann die
                Bemessungsgrundlage, nicht das Brutto. Ohne diese Angabe
                landet der Beleg in der falschen Kennzahl der UStVA. */}
            {documentType === "EXPENSE" && (
              <div className="pt-1.5">
                <label className={LABEL}>{t("detail.fields.inputVatKind")}</label>
                <select
                  value={inputVatKind}
                  onChange={(e) => setInputVatKind(e.target.value)}
                  className={INPUT}
                >
                  <option value="">{t("detail.inputVatKinds.standard")}</option>
                  <option value="REVERSE_CHARGE_EU_SERVICE">
                    {t("detail.inputVatKinds.reverseChargeEuService")}
                  </option>
                  <option value="REVERSE_CHARGE_OTHER">
                    {t("detail.inputVatKinds.reverseChargeOther")}
                  </option>
                  <option value="REVERSE_CHARGE_GRESTG">
                    {t("detail.inputVatKinds.reverseChargeGrEStG")}
                  </option>
                  <option value="INTRA_COMMUNITY_ACQUISITION">
                    {t("detail.inputVatKinds.intraCommunityAcquisition")}
                  </option>
                  <option value="IMPORT_VAT">{t("detail.inputVatKinds.importVat")}</option>
                </select>
                {inputVatKind !== "" && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {t("detail.fields.inputVatKindHint")}
                  </p>
                )}
              </div>
            )}
          </div>

          {lineItems.length > 0 ? (
            <>
              <button
                onClick={() => setShowLineItems(!showLineItems)}
                className="flex items-center gap-1.5 w-full text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
              >
                <ChevronDown className={`w-3 h-3 transition-transform ${showLineItems ? "" : "-rotate-90"}`} />
                {t("detail.lineItemsToggle")} ({lineItems.length})
              </button>

              {showLineItems && (
                <div className="space-y-3">
                  {lineItems.map((item, i) => (
                    <div key={item.id} className={`space-y-2 ${i > 0 ? "pt-3 border-t border-border/60" : ""}`}>

                      {/* Description + delete */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <label className={LABEL}>{t("detail.fields.description")}</label>
                          <input type="text" value={item.description}
                            onChange={(e) => updateLineItem(item.id, "description", e.target.value)}
                            className={INPUT} />
                        </div>
                        <button onClick={() => removeLineItem(item.id)}
                          className="mt-5 p-1 text-muted-foreground hover:text-destructive transition-colors"
                          title={t("detail.removeLineItem")}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Buchungskonto — full width, name-primary display */}
                      <div>
                        <label className={
                          i === 0
                            ? `${LABEL_REQUIRED} ${showValidation && !item.skrAccount ? "text-destructive" : ""}`
                            : LABEL
                        }>
                          {t("detail.fields.bookingAccount")}
                        </label>
                        <SkrAccountInput
                          value={item.skrAccount}
                          onChange={(val) => updateLineItem(item.id, "skrAccount", val)}
                          onOpenPicker={() => openSkrPicker(item.id)}
                          skrAccountOptions={skrAccountOptions}
                          hasError={showValidation && i === 0 && !item.skrAccount}
                          placeholder={t("detail.fields.bookingAccountPlaceholder")}
                        />
                      </div>

                      {/* VAT rate + Total Gross — the two mandatory financial fields */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className={
                            i === 0
                              ? `${LABEL_REQUIRED} ${showValidation && !item.vatRate ? "text-destructive" : ""}`
                              : LABEL
                          }>
                            {t("detail.fields.vatRate")}
                          </label>
                          <select
                            value={item.vatRate}
                            onChange={(e) => updateLineItem(item.id, "vatRate", e.target.value)}
                            className={i === 0 && showValidation && !item.vatRate ? INPUT_ERROR : INPUT}
                          >
                            <option value="">—</option>
                            {VAT_RATES.map((r) => <option key={r} value={r}>{r} %</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={
                            i === 0
                              ? `${LABEL_REQUIRED} ${showValidation && !item.total ? "text-destructive" : ""}`
                              : LABEL
                          }>
                            {t("detail.fields.total")}
                          </label>
                          <input
                            type="number" step="0.01" value={item.total}
                            onChange={(e) => updateLineItem(item.id, "total", e.target.value)}
                            placeholder="0,00"
                            className={`${i === 0 && showValidation && !item.total ? INPUT_ERROR : INPUT} font-semibold`}
                          />
                        </div>
                      </div>

                      {/* Steuerbetrag laut Beleg.
                          Normalerweise leer — dann wird die Steuer aus Brutto
                          und Satz abgeleitet. Nötig, weil Lieferanten je
                          Position runden dürfen (§ 14 UStG) und die Summe dann
                          um Cent von der Rückrechnung abweicht. Für den
                          Vorsteuerabzug zählt der ausgewiesene Betrag. */}
                      {item.vatRate !== "" && item.vatRate !== "0" && (
                        <div>
                          <label className={LABEL}>
                            {t("detail.fields.statedVatAmount")}
                          </label>
                          <input
                            type="number" step="0.01" value={item.vatAmount}
                            onChange={(e) => updateLineItem(item.id, "vatAmount", e.target.value)}
                            placeholder={derivedVatFor(item).toFixed(2).replace(".", ",")}
                            className={INPUT}
                          />
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {item.vatAmount === ""
                              ? t("detail.fields.statedVatHint")
                              : t("detail.fields.statedVatOverride")}
                          </p>
                        </div>
                      )}

                    </div>
                  ))}
                </div>
              )}

              {/* VAT summary below line items */}
              <LineItemsVatSummary
                lineItems={lineItems}
                currency={currency}
                exchangeRate={exchangeRate ? parseFloat(exchangeRate) : null}
                t={t}
              />
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-3 text-center">
              <p className="text-xs text-muted-foreground">{t("detail.noLineItems")}</p>
              <button onClick={addLineItem}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary bg-primary/5 border border-primary/20 rounded-lg hover:bg-primary/10 transition-colors">
                <Plus className="w-3.5 h-3.5" />
                {t("detail.addLineItem")}
              </button>
            </div>
          )}
        </Card>

        {/* ── Card: Buchung (Tags + collapsed file info) ─────────────────── */}
        <Card title={t("detail.cards.info")}>
          <div className="space-y-2.5">

            {/* Tags */}
            <div>
              <label className={LABEL}>{t("detail.fields.tags")}</label>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {tags.map((tag) => (
                    <span key={tag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted rounded-full text-xs text-muted-foreground">
                      <Tag className="w-2.5 h-2.5" />
                      {tag}
                      <button onClick={() => removeTag(tag)}
                        className="ml-0.5 text-muted-foreground/50 hover:text-destructive transition-colors">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <input type="text" value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                placeholder={t("detail.fields.tagsPlaceholder")}
                className={INPUT}
              />
            </div>

            {/* Dateiinformationen — collapsed by default */}
            <div className="pt-2 mt-1 border-t border-border/60">
              <button
                type="button"
                onClick={() => setFileInfoOpen((v) => !v)}
                className="flex items-center justify-between w-full py-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>{t("detail.cards.file")}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${fileInfoOpen ? "" : "-rotate-90"}`} />
              </button>
              {fileInfoOpen && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-baseline justify-between text-xs py-0.5">
                    <span className="text-muted-foreground">{t("detail.fields.fileType")}</span>
                    <span className="font-medium text-foreground">{formatFileType(doc.fileType)}</span>
                  </div>
                  <div className="flex items-baseline justify-between text-xs py-0.5">
                    <span className="text-muted-foreground">{t("detail.fields.fileSize")}</span>
                    <span className="font-medium text-foreground">{formatFileSize(doc.fileSize)}</span>
                  </div>
                  <div className="flex items-baseline justify-between text-xs py-0.5">
                    <span className="text-muted-foreground">{t("detail.fields.uploadedAt")}</span>
                    <span className="font-medium text-foreground">{fmtDateShort(doc.createdAt)}</span>
                  </div>
                  
                  {/* OCR Confidence with togglable info */}
                  {doc.ocrConfidence != null && (
                    <div className="flex flex-col py-0.5 gap-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">{t("detail.fields.ocrConfidence")}</span>
                          <button
                            type="button"
                            onClick={() => setOcrInfoOpen((v) => !v)}
                            className="text-muted-foreground/60 hover:text-primary transition-colors"
                            title={t("detail.fields.ocrInfoToggle")}
                          >
                            <Info className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <span className="font-medium text-foreground">{Math.round(doc.ocrConfidence * 100)} %</span>
                      </div>
                      {ocrInfoOpen && (
                        <div className="px-2 py-1.5 bg-muted/50 border border-border/50 rounded-md">
                          <p className="text-[10px] text-muted-foreground leading-relaxed">
                            {t("detail.fields.ocrConfidenceInfo")}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {doc.uploadedBy && (doc.uploadedBy.firstName || doc.uploadedBy.lastName) && (
                    <div className="flex items-baseline justify-between text-xs py-0.5">
                      <span className="text-muted-foreground">{t("detail.fields.uploadedBy")}</span>
                      <span className="font-medium text-foreground">
                        {[doc.uploadedBy.firstName, doc.uploadedBy.lastName].filter(Boolean).join(" ")}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        </Card>

        {/* ── OCR retry ─────────────────────────────────────────────────── */}
        {(doc.status === "FAILED" || doc.status === "PENDING") && (
          <button onClick={handleRetryOcr} disabled={ocrRetrying}
            className="flex items-center justify-center gap-2 w-full px-3 py-2 text-xs font-medium rounded-lg bg-muted hover:bg-accent text-foreground transition-colors disabled:opacity-60">
            {ocrRetrying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {ocrRetrying ? t("detail.ocrRetrying") : t("detail.retryOcr")}
          </button>
        )}

        {/* ── Card: Verknüpfte Rechnung ──────────────────────────────────── */}
        {doc.invoice && (
          <Card title={t("detail.cards.linkedInvoice")}>
            <Link href={`/dashboard/invoices/${doc.invoice.id}`} className="flex items-center gap-2 group">
              <FileText className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
              <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                {doc.invoice.number}
              </span>
            </Link>
          </Card>
        )}

        {/* ── AfA / Asset toggle ──────────────────────────────────────────── */}
        <AssetTogglePanel
          documentId={doc.id}
          isFinalized={isBooked}
          linkedAsset={fixedAsset}
          recognizedAmount={doc.recognizedAmount}
          recognizedDate={doc.recognizedDate}
          recognizedSupplier={doc.recognizedSupplier}
          vatRate={doc.vatRate}
          taxMode={taxMode as "STANDARD" | "SMALL_BUSINESS"}
        />


        {/* ── Delete (bottom, subtle) ────────────────────────────────────── */}
        <div className="pt-1 pb-2">
          {deleteConfirm ? (
            <div className="flex items-center gap-2 justify-center">
              <button onClick={handleDelete} disabled={isDeleting}
                className="px-3 py-1.5 text-xs font-medium text-white bg-destructive rounded-lg hover:bg-destructive/90 transition-colors disabled:opacity-60">
                {isDeleting ? <Loader2 className="w-3 h-3 animate-spin inline" /> : t("detail.deleteConfirm")}
              </button>
              <button onClick={() => setDeleteConfirm(false)}
                className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button onClick={() => setDeleteConfirm(true)}
              className="flex items-center justify-center gap-1.5 w-full px-3 py-2 text-xs font-medium text-destructive/70 hover:text-destructive hover:bg-destructive/5 rounded-lg transition-colors">
              <Trash2 className="w-3 h-3" />
              {t("detail.deleteDocument")}
            </button>
          )}
        </div>

      </div>
      )} {/* end isCommitted ternary */}

      {/* ── SKR Picker Modal ───────────────────────────────────────────── */}
      <SkrPickerModal
        open={skrPickerOpen}
        onClose={() => { setSkrPickerOpen(false); setSkrPickerTarget(null); }}
        onSelect={(num) => {
          if (skrPickerTarget) updateLineItem(skrPickerTarget, "skrAccount", num);
        }}
        skrAccountOptions={skrAccountOptions}
        t={t}
      />

      {/* ── Payment-Side-Panel (ersetzt das alte Modal) ─────────────────── */}
      <PaymentSidePanel
        open={showMarkPaidModal}
        onClose={() => setShowMarkPaidModal(false)}
        doc={{
          id: doc.id,
          supplier,
          totalGross,
          // Bei Fremdwährungen: EUR-Equivalent = Originalbetrag × Wechselkurs.
          // Das ist der Vergleichswert für Bank-Zahlungen (immer EUR).
          totalGrossEUR: currency === "EUR" || !exchangeRate
            ? totalGross
            : Math.round(totalGross * (parseFloat(exchangeRate) || 0) * 100) / 100,
          currency,
          exchangeRate: currency === "EUR" || !exchangeRate ? null : parseFloat(exchangeRate),
          docDate,
          dueDate: dueDate || null,
        }}
        onConfirm={async (data) => {
          setShowMarkPaidModal(false);
          setPaymentData({ paidAt: data.paidAt, method: data.method }); // optimistic
          const result = await markDocumentAsPaid(doc.id, data.paidAt, data.method, {
            amount: data.amount,
            bankAccountId: data.bankAccountId,
            bankTransactionId: data.bankTransactionId,
            differenceReason: data.differenceReason,
            differenceNote: data.differenceNote,
          });
          if (!result.success) {
            setPaymentData(null); // revert on failure
          }
        }}
      />

      {/* ── Inline-Anlage Lieferant (Kontakt-Dialog mit SUPPLIER) ───────── */}
      <ContactFormDialog
        open={showSupplierDialog}
        onClose={() => setShowSupplierDialog(false)}
        presetRole="SUPPLIER"
        presetName={supplier}
        onSaved={async (newId) => {
          // Sofort verknüpfen — derselbe Flow wie der Picker im Bottom-Panel.
          await linkDocumentContact(doc.id, newId);
          router.refresh();
        }}
      />

      {/* ── Mark as Unpaid Modal ───────────────────────────────────────── */}
      <MarkAsUnpaidModal
        open={showMarkUnpaidModal}
        onClose={() => setShowMarkUnpaidModal(false)}
        onConfirm={async () => {
          const prev = paymentData;
          setPaymentData(null); // optimistic update
          const result = await markDocumentAsUnpaid(doc.id);
          if (!result.success) {
            setPaymentData(prev); // revert on failure
          }
        }}
        t={t}
      />

      {/* ── Confirm Edit Modal ─────────────────────────────────────────── */}
      <ConfirmEditModal
        open={showEditConfirmModal}
        onClose={() => setShowEditConfirmModal(false)}
        onConfirm={() => {
          setIsCommitted(false);
          setIsDraft(true);
        }}
        t={t}
      />

      {/* ── Duplikat-Confirm (nur bei exact match) ─────────────────────── */}
      <ConfirmDuplicateModal
        open={pendingSave !== null}
        complete={pendingSave?.complete ?? false}
        onClose={() => setPendingSave(null)}
        onConfirm={() => {
          const saved = pendingSave;
          setPendingSave(null);
          if (saved) handleSave(saved.complete, { skipDuplicateCheck: true });
        }}
        t={t}
      />
    </div>
  );
}
