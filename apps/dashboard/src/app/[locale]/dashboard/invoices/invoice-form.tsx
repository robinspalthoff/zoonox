"use client";

import { useState, useTransition, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import {
  Plus, Trash2, ArrowLeft, FileCode2, Info, Eye, Send,
  Save, MoreHorizontal, X, ChevronDown, UserPlus, Repeat, Zap, Mail, CalendarClock, QrCode,
} from "lucide-react";
import { createInvoice, updateDraftInvoice } from "./actions";
import {
  createRecurringInvoice,
  updateRecurringInvoice,
  type RecurringInvoiceInput,
} from "./recurring/actions";
import { upsertContact, getNextCustomerNumber } from "../contacts/actions";
import { Link } from "@/i18n/navigation";
import { InvoiceDocumentPreview } from "./[id]/invoice-document-preview";
import { computeDocumentTotals } from "@/lib/invoice/discount";
import { CountrySelect } from "@/components/ui/country-select";
import {
  VAT_REGULATIONS, VAT_REGULATION_MAP, VAT_REGULATION_GROUPS,
  type VatRegulationId,
} from "@/lib/vat-regulation";
import type { RecurringInterval, RecurringStatus } from "@prisma/client";
import { INTERVAL_ORDER, INTERVAL_I18N_KEY, nextNScheduledDates } from "@/lib/recurring/interval";
import { AnimatedCurrency } from "@/components/ui/animated-currency";
import { AutoGrowTextarea } from "@/components/ui/auto-grow-textarea";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Client {
  id: string;
  name: string;
  email: string | null;
  customerNumber: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  address: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  vatId: string | null;
}

interface FormSettings {
  name?: string | null;
  nameSuffix?: string | null;
  legalForm?: string | null;
  address?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  vatId?: string | null;
  taxId?: string | null;
  bankName?: string | null;
  iban?: string | null;
  bic?: string | null;
  logoBase64?: string | null;
  defaultNotes?: string | null;
  defaultIntroText?: string | null;
  ownerName?: string | null;
  managingDirector?: string | null;
  taxMode?: string | null;
}

type DiscountType = "none" | "percent" | "amount";

interface LineItem {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatRate: string;
  discountType: DiscountType;
  discountValue: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const INPUT = "w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors";
const LABEL = "block text-xs font-medium text-muted-foreground mb-1";

function fmtCur(n: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
}

function calcItemAmount(qty: number, price: number, discountType: DiscountType, discountValue: string): number {
  const base = qty * price;
  if (discountType === "percent") {
    return base * (1 - Math.min(parseFloat(discountValue) || 0, 100) / 100);
  }
  if (discountType === "amount") {
    return Math.max(0, base - (parseFloat(discountValue.replace(",", ".")) || 0));
  }
  return base;
}

function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  function handleEnter() {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setStyle({
      position: "fixed",
      top: r.top - 8,
      left: Math.min(r.left + r.width / 2, window.innerWidth - 160),
      transform: "translate(-50%, -100%)",
    });
    setShow(true);
  }

  return (
    <span
      ref={ref}
      className="inline-flex ml-1 align-middle shrink-0"
      onMouseEnter={handleEnter}
      onMouseLeave={() => setShow(false)}
      onClick={(e) => e.stopPropagation()}
    >
      <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
      {show && (
        <span
          className="w-72 rounded-lg bg-card border border-border text-xs text-muted-foreground px-3 py-2.5 shadow-xl leading-relaxed pointer-events-none"
          style={{ ...style, zIndex: 9999 }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

// ── New client quick-create modal ─────────────────────────────────────────────

function NewClientModal({ onCreated, onClose }: {
  onCreated: (client: Client) => void;
  onClose: () => void;
}) {
  const t  = useTranslations("invoices");
  const tc = useTranslations("contacts");
  const tCommon = useTranslations("common");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [customerNumber, setCustomerNumber] = useState("");

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Kundennummer automatisch mit der nächsten freien Nummer vorbefüllen.
  useEffect(() => {
    getNextCustomerNumber().then(setCustomerNumber).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    // Aus dem Rechnungs-Kontext angelegte Kontakte sind Kunden.
    fd.append("roles", "CUSTOMER");
    startTransition(async () => {
      const res = await upsertContact(fd);
      if (!res.success) { setError(res.error); return; }
      onCreated({
        id: res.id,
        name: (fd.get("name") as string) ?? "",
        email: (fd.get("email") as string) || null,
        contactFirstName: (fd.get("contactFirstName") as string) || null,
        contactLastName: (fd.get("contactLastName") as string) || null,
        address: (fd.get("address") as string) || null,
        zip: (fd.get("zip") as string) || null,
        city: (fd.get("city") as string) || null,
        country: (fd.get("country") as string) || "DE",
        vatId: (fd.get("vatId") as string) || null,
        customerNumber: (fd.get("customerNumber") as string) || null,
      });
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <UserPlus className="w-4 h-4 text-primary" />
            </div>
            <h2 className="text-base font-semibold text-foreground">{t("newClient.title")}</h2>
          </div>
          <button onClick={onClose} disabled={isPending} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={LABEL}>{tc("fields.name")} *</label>
              <input name="name" required placeholder={t("newClient.namePlaceholder")} className={INPUT} />
            </div>
            <div className="col-span-2">
              <label className={LABEL}>{tc("fields.customerNumber")} *</label>
              <input
                name="customerNumber"
                required
                inputMode="numeric"
                maxLength={4}
                value={customerNumber}
                onChange={(e) => setCustomerNumber(e.target.value)}
                placeholder="1001"
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL}>{tc("fields.contactFirstName")}</label>
              <input name="contactFirstName" placeholder="Max" className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>{tc("fields.contactLastName")}</label>
              <input name="contactLastName" placeholder="Mustermann" className={INPUT} />
            </div>
            <div className="col-span-2">
              <label className={LABEL}>{tc("fields.email")}</label>
              <input name="email" type="email" placeholder="info@firma.de" className={INPUT} />
            </div>
            <div className="col-span-2">
              <label className={LABEL}>{tc("fields.address")}</label>
              <input name="address" placeholder={t("form.streetPlaceholder")} className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>{tc("fields.zip")}</label>
              <input name="zip" placeholder="10115" className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>{tc("fields.city")}</label>
              <input name="city" placeholder="Berlin" className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>{tc("fields.country")}</label>
              <CountrySelect name="country" defaultValue="DE" />
            </div>
            <div>
              <label className={LABEL}>{tc("fields.vatId")}</label>
              <input name="vatId" placeholder="DE123456789" className={INPUT} />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} disabled={isPending}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-foreground hover:bg-accent transition-colors disabled:opacity-50">
              {tCommon("actions.cancel")}
            </button>
            <button type="submit" disabled={isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50">
              <UserPlus className="w-4 h-4" />
              {isPending ? t("newClient.creating") : t("newClient.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Preview modal ──────────────────────────────────────────────────────────────

function PreviewModal({ invoice, settings, onClose }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoice: any;
  settings: FormSettings | null;
  onClose: () => void;
}) {
  const t = useTranslations("invoices");
  const locale = useLocale();
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center py-8 px-4 min-h-full">
          <div className="w-full max-w-3xl">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-white/70">{t("form.previewDraft")}</p>
              <button onClick={onClose} className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <InvoiceDocumentPreview invoice={invoice} settings={settings as any} locale={locale} />
          </div>
        </div>
      </div>
    </div>
  );
}

type SubmitMode = "draft" | "send";

// Minimal snapshot of a source invoice, used to pre-fill the form when the
// user picks "Use as template" from the list. We never copy numbers, dates,
// or status — only content that speeds up re-entry.
export interface InvoiceTemplate {
  contactId: string;
  introText: string | null;
  notes: string | null;
  vatRegulation: string;
  buyerReference: string | null;
  leitwegId?: string | null;
  globalDiscountType?: "percent" | "amount" | null;
  globalDiscountValue?: number | null;
  lineItems: Array<{
    description: string;
    quantity: number;
    unit: string | null;
    unitPrice: number;
    vatRate: number;
    discountType?: "percent" | "amount" | null;
    discountValue?: number | null;
  }>;
}

// Recurring-mode configuration. When this prop is provided, the form switches
// into "template editor" mode: right sidebar shows recurrence config instead
// of due-date/service-date, the submit handler calls createRecurringInvoice /
// updateRecurringInvoice, the header gets a different button set, and the
// back link points to /invoices/recurring. Everything else (recipient box,
// line items, VAT regulation, intro/notes, E-Invoice toggle, preview, new-client
// modal) stays identical.
export interface RecurringConfig {
  /** Existing schedule id when editing; absent for create. */
  id?: string;
  title: string;
  firstIssueDate: string; // YYYY-MM-DD
  endDate: string;
  interval: RecurringInterval;
  autoGenerate: boolean;
  autoSend: boolean;
  paymentTermDays: number | null;
  /** When > 0, firstIssueDate edits won't rebase nextRunAt (server-side rule). */
  generatedCount?: number;
  /** Persisted nextRunAt for existing schedules (ISO string). Used as the
   *  anchor for the live "next dates" preview when generations have already
   *  fired — changing the interval mid-stream advances from there, not from
   *  firstIssueDate. */
  nextRunAt?: string;
  /** Persisted status — hides the preview entirely for COMPLETED schedules. */
  status?: RecurringStatus;
}

// Edit-mode payload — when set, the form pre-fills with this invoice's full
// state and `handleSubmit` calls `updateDraftInvoice(id, ...)` instead of
// `createInvoice(...)`. Only valid for DRAFT invoices; the server action
// rejects anything else.
export interface EditingInvoice {
  id: string;
  number: string;
  contactId: string;
  issueDate: string; // YYYY-MM-DD
  dueDate: string | null;
  serviceDate: string | null;
  serviceDateEnd: string | null;
  notes: string | null;
  introText: string | null;
  vatRegulation: string;
  leitwegId: string | null;
  buyerReference: string | null;
  paymentQrEnabled: boolean;
  globalDiscountType?: string | null;
  globalDiscountValue?: number | string | null;
  lineItems: Array<{
    description: string;
    quantity: number;
    unit: string | null;
    unitPrice: number;
    vatRate: number;
    amount: number;
    discountType?: string | null;
    discountValue?: number | string | null;
  }>;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function InvoiceForm({
  clients: initialClients,
  settings,
  nextNumber,
  template,
  editingInvoice,
  recurring,
  headerSlot,
  sourceQuoteId,
  sourceOrderConfirmationId,
}: {
  clients: Client[];
  settings: FormSettings | null;
  nextNumber?: string;
  template?: InvoiceTemplate;
  /** When set, the form runs in edit mode for an existing DRAFT invoice. */
  editingInvoice?: EditingInvoice;
  /** When set, the form behaves as a recurring-invoice template editor. */
  recurring?: RecurringConfig;
  /** Optional content rendered between the sticky bar and the form fields.
   *  Used by the recurring detail page to show the schedule-level actions
   *  toolbar + next-dates preview above the form without redesigning the form. */
  headerSlot?: React.ReactNode;
  /** When creating an invoice from a Quote, link it on save and flip the
   *  Quote to ACCEPTED + convertedAt. */
  sourceQuoteId?: string;
  /** When creating an invoice from an AB, link it on save and flip the AB
   *  to INVOICED. */
  sourceOrderConfirmationId?: string;
}) {
  const tRec = useTranslations("invoices.recurring");
  const isRecurringMode = !!recurring;
  const isRecurringEdit = !!recurring?.id;
  const isEditMode = !!editingInvoice;
  const t = useTranslations("invoices");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [submitMode, setSubmitMode] = useState<SubmitMode>("draft");
  const [showPreview, setShowPreview] = useState(false);
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [clients, setClients] = useState<Client[]>(initialClients);

  const [showOverflow, setShowOverflow] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) setShowOverflow(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const today = new Date().toISOString().split("T")[0];
  const in14  = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];

  // Resolve the source client for pre-fill. Both "use as template" and edit
  // mode start from a real Client record; pick whichever is set (editingInvoice
  // wins since it represents the authoritative current state).
  const sourceContactId = editingInvoice?.contactId ?? template?.contactId ?? null;
  const sourceClient = sourceContactId
    ? initialClients.find((c) => c.id === sourceContactId) ?? null
    : null;

  const [contactId, setContactId] = useState(sourceContactId ?? "");
  const [recipientName, setRecipientName] = useState(sourceClient?.name ?? "");
  const [recipientAddress, setRecipientAddress] = useState(sourceClient?.address ?? "");
  const [recipientZip, setRecipientZip] = useState(sourceClient?.zip ?? "");
  const [recipientCity, setRecipientCity] = useState(sourceClient?.city ?? "");
  const [recipientCountry, setRecipientCountry] = useState(sourceClient?.country ?? "DE");

  const [issueDate, setIssueDate] = useState(editingInvoice?.issueDate ?? today);
  const [dueDate, setDueDate] = useState(editingInvoice?.dueDate ?? in14);
  const [serviceDateMode, setServiceDateMode] = useState<"date" | "period">(
    editingInvoice?.serviceDateEnd ? "period" : "date",
  );
  const [serviceDate, setServiceDate] = useState(editingInvoice?.serviceDate ?? "");
  const [serviceDateEnd, setServiceDateEnd] = useState(editingInvoice?.serviceDateEnd ?? "");
  // EPC payment QR-Code on the invoice PDF — defaults to on for new invoices.
  const [paymentQrEnabled, setPaymentQrEnabled] = useState(
    editingInvoice?.paymentQrEnabled ?? true,
  );

  // ── Recurring-mode state ─────────────────────────────────────────────────
  // Only populated when `recurring` prop is set; otherwise inert defaults so
  // the field types stay consistent across renders. Initial values come from
  // the prop (edit) or sensible defaults (new).
  const [recurringTitle, setRecurringTitle] = useState(recurring?.title ?? "");
  const [recurringFirstIssue, setRecurringFirstIssue] = useState(recurring?.firstIssueDate ?? today);
  const [recurringEndDate, setRecurringEndDate] = useState(recurring?.endDate ?? "");
  const [recurringInterval, setRecurringInterval] = useState<RecurringInterval>(recurring?.interval ?? "MONTHLY");
  const [recurringAutoGenerate, setRecurringAutoGenerate] = useState(recurring?.autoGenerate ?? true);
  const [recurringAutoSend, setRecurringAutoSend] = useState(recurring?.autoSend ?? false);
  const [recurringPaymentTermDays, setRecurringPaymentTermDays] = useState<number | null>(
    recurring?.paymentTermDays ?? 14,
  );

  // True when saving will also trigger immediate invoice generation (today's
  // or past first issue + auto-generation on). Drives the contextual save
  // button label + the inline notice banner below the sticky bar.
  const willCreateImmediately =
    isRecurringMode &&
    recurringAutoGenerate &&
    !!recurringFirstIssue &&
    recurringFirstIssue <= today;

  // ── Live next-dates preview ─────────────────────────────────────────────
  // Reacts instantly to changes in interval, firstIssueDate, endDate or the
  // autoGenerate toggle — no save needed to see the new rhythm.
  //
  // Anchor logic mirrors the server (updateRecurringInvoice in
  // recurring/actions.ts): if the schedule has already generated invoices,
  // the persisted nextRunAt is the anchor (changing firstIssueDate in the
  // form won't rebase it, so we don't pretend otherwise in the preview).
  // For fresh templates the anchor is the form's firstIssueDate.
  const upcomingDates = useMemo(() => {
    if (!isRecurringMode) return [];
    if (recurring?.status === "COMPLETED") return [];
    const hasGenerated = (recurring?.generatedCount ?? 0) > 0;
    const anchorISO = hasGenerated && recurring?.nextRunAt
      ? recurring.nextRunAt
      : recurringFirstIssue;
    if (!anchorISO) return [];
    const anchor = new Date(anchorISO);
    if (Number.isNaN(anchor.getTime())) return [];
    const end = recurringEndDate ? new Date(recurringEndDate) : null;
    return nextNScheduledDates(anchor, recurringInterval, 5, end);
  }, [
    isRecurringMode,
    recurring?.status,
    recurring?.generatedCount,
    recurring?.nextRunAt,
    recurringFirstIssue,
    recurringInterval,
    recurringEndDate,
  ]);

  const upcomingDatesFmt = useMemo(
    () => new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }),
    [],
  );

  const [introText, setIntroText] = useState(
    editingInvoice?.introText ??
    template?.introText ??
    settings?.defaultIntroText ??
    t("form.defaultIntroText"),
  );
  const [notes, setNotes] = useState(editingInvoice?.notes ?? template?.notes ?? "");

  // Pre-open the E-Invoice section if the saved invoice/template has any
  // E-Invoice fields (so the user immediately sees "their" config on reload).
  const [isEInvoice, setIsEInvoice] = useState(
    !!(editingInvoice?.buyerReference || editingInvoice?.leitwegId) ||
      !!(recurring && (template?.buyerReference || template?.leitwegId)),
  );
  const [buyerReference, setBuyerReference] = useState(
    editingInvoice?.buyerReference ?? template?.buyerReference ?? "00",
  );
  const [eInvoiceEmail, setEInvoiceEmail] = useState(sourceClient?.email ?? "");

  const isSmallBusiness = settings?.taxMode === "SMALL_BUSINESS";
  const [vatRegulation, setVatRegulation] = useState<VatRegulationId>(
    (editingInvoice?.vatRegulation as VatRegulationId | undefined) ??
      (template?.vatRegulation as VatRegulationId | undefined) ??
      (isSmallBusiness ? "SMALL_BUSINESS_19" : "STANDARD"),
  );
  const vatConfig = VAT_REGULATION_MAP[vatRegulation];
  const vatLocked = !vatConfig.vatEditable || isSmallBusiness;

  const [items, setItems] = useState<LineItem[]>(() => {
    // Edit-Modus liest persistierte Rabatte aus den line items; Template (z.B.
    // "from quote/AB") überträgt sie aus der Quelle.
    const sourceItems = editingInvoice?.lineItems ?? template?.lineItems ?? [];
    if (sourceItems.length > 0) {
      return sourceItems.map((li) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyLi = li as any;
        const dt = anyLi.discountType as "percent" | "amount" | null | undefined;
        const dv = anyLi.discountValue;
        return {
          description: li.description,
          quantity: String(li.quantity),
          unit: li.unit ?? "",
          unitPrice: String(li.unitPrice),
          vatRate: String(li.vatRate),
          discountType: (dt ?? "none") as DiscountType,
          discountValue: dv !== null && dv !== undefined ? String(dv) : "",
        };
      });
    }
    return [
      { description: "", quantity: "1", unit: "", unitPrice: "", vatRate: isSmallBusiness ? "0" : "19", discountType: "none", discountValue: "" },
    ];
  });

  // Gesamtrabatt — wird neben "+ Position" hinzufügen ein-/ausgeblendet.
  const editingDocAny = editingInvoice as unknown as
    | { globalDiscountType?: string | null; globalDiscountValue?: number | string | null }
    | undefined;
  const initialGlobalType: DiscountType =
    (editingDocAny?.globalDiscountType as DiscountType | null | undefined)
    ?? (template?.globalDiscountType as DiscountType | null | undefined)
    ?? "none";
  const initialGlobalValue =
    editingDocAny?.globalDiscountValue !== null && editingDocAny?.globalDiscountValue !== undefined
      ? String(editingDocAny.globalDiscountValue)
      : template?.globalDiscountValue !== null && template?.globalDiscountValue !== undefined
      ? String(template.globalDiscountValue)
      : "";
  const [globalDiscountType, setGlobalDiscountType] = useState<DiscountType>(initialGlobalType);
  const [globalDiscountValue, setGlobalDiscountValue] = useState(initialGlobalValue);

  // When VAT regulation changes and locks rates, force all items to 0%
  function handleVatRegulationChange(id: VatRegulationId) {
    setVatRegulation(id);
    const config = VAT_REGULATION_MAP[id];
    if (!config.vatEditable) {
      setItems((prev) =>
        prev.map((item) => ({ ...item, vatRate: String(config.forcedVatRate) }))
      );
    }
  }

  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [skontoEnabled, setSkontoEnabled] = useState(false);
  const [skontoPercent, setSkontoPercent] = useState("2");
  const [skontoDays, setSkontoDays] = useState("14");
  const [expandedVatGroup, setExpandedVatGroup] = useState<string | null>(null);

  // ── Handlers ──────────────────────────────────────────────────────────────────

  // Apply a Client's fields into the recipient form block. Lifted out of
  // `handleClientChange` so callers that already have the Client object
  // (e.g. handleNewClientCreated immediately after upsert) can apply directly,
  // without depending on the `clients` state having flushed the new entry.
  function applyClientToForm(client: Client) {
    setRecipientName(client.name);
    setRecipientAddress(client.address ?? "");
    setRecipientZip(client.zip ?? "");
    setRecipientCity(client.city ?? "");
    setRecipientCountry(client.country ?? "DE");
    if (client.email) setEInvoiceEmail(client.email);
  }

  function handleClientChange(id: string) {
    setContactId(id);
    const client = clients.find((c) => c.id === id);
    if (!client) return;
    applyClientToForm(client);
  }

  function handleNewClientCreated(client: Client) {
    setClients((prev) => [...prev, client].sort((a, b) => a.name.localeCompare(b.name)));
    setShowNewClientModal(false);
    // Important: pass the Client object directly. Going through
    // `handleClientChange(client.id)` would re-read the `clients` state which
    // hasn't applied the setClients call from the line above yet — the lookup
    // would miss and only the name (typed earlier) would survive.
    setContactId(client.id);
    applyClientToForm(client);
  }

  function handleEInvoiceToggle(enabled: boolean) {
    setIsEInvoice(enabled);
    if (enabled && !eInvoiceEmail) {
      const client = clients.find((c) => c.id === contactId);
      if (client?.email) setEInvoiceEmail(client.email);
    }
  }

  function addItem() {
    const defaultRate = vatLocked ? String(vatConfig.forcedVatRate) : "19";
    setItems((prev) => [
      ...prev,
      { description: "", quantity: "1", unit: "", unitPrice: "", vatRate: defaultRate, discountType: "none", discountValue: "" },
    ]);
  }

  function removeItem(i: number) { setItems((prev) => prev.filter((_, idx) => idx !== i)); }

  function updateItem(i: number, field: keyof LineItem, value: string) {
    setItems((prev) => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  }

  function updateDiscountType(i: number, type: DiscountType) {
    setItems((prev) =>
      prev.map((item, idx) =>
        idx === i ? { ...item, discountType: type, discountValue: type === "none" ? "" : item.discountValue } : item
      )
    );
  }

  // ── Totals ────────────────────────────────────────────────────────────────────

  const parsed = items.map((item) => {
    const qty    = parseFloat(item.quantity) || 0;
    const price  = parseFloat(item.unitPrice.replace(",", ".")) || 0;
    const rate   = parseInt(item.vatRate) || 0;
    const amount = calcItemAmount(qty, price, item.discountType, item.discountValue);
    return { amount, rate };
  });

  // Live-Totals via shared helper inkl. Gesamtrabatt — exakt wie der Server
  // rechnet, damit Summary-Panel und gespeicherte Werte synchron sind.
  const liveTotals = computeDocumentTotals(
    parsed.map((p) => ({ amount: p.amount, vatRate: p.rate })),
    globalDiscountType === "none" ? null : globalDiscountType,
    globalDiscountValue,
  );
  const subtotalBeforeDiscount = liveTotals.subtotalBeforeDiscount;
  const discountAmount = liveTotals.discountAmount;
  const subtotal = liveTotals.subtotal;
  const tax19    = liveTotals.taxGroups[19] ?? 0;
  const tax7     = liveTotals.taxGroups[7] ?? 0;
  const total    = liveTotals.total;

  function buildFinalNotes(base: string): string {
    if (!skontoEnabled) return base;
    const pct  = parseFloat(skontoPercent) || 2;
    const days = parseInt(skontoDays) || 14;
    const txt  = t("form.skontoText", { pct, days });
    return base ? `${base}\n\n${txt}` : txt;
  }

  function buildMockInvoice() {
    const client = clients.find((c) => c.id === contactId);
    const mockLineItems = items.map((item, i) => {
      const qty   = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unitPrice.replace(",", ".")) || 0;
      const amount = calcItemAmount(qty, price, item.discountType, item.discountValue);
      return {
        id: String(i), position: i + 1,
        description: item.description || "…",
        quantity: qty, unit: item.unit || null, unitPrice: price,
        vatRate: Number(item.vatRate), amount,
        invoiceId: "", createdAt: new Date(), updatedAt: new Date(),
      };
    });
    const mockTotals = computeDocumentTotals(
      mockLineItems.map((li) => ({ amount: li.amount, vatRate: li.vatRate })),
      globalDiscountType === "none" ? null : globalDiscountType,
      globalDiscountValue,
    );
    return {
      type: "INVOICE" as const,
      number: nextNumber ?? "ENTWURF",
      issueDate: issueDate ? new Date(issueDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      serviceDate: serviceDate ? new Date(serviceDate) : null,
      serviceDateEnd: (serviceDateMode === "period" && serviceDateEnd) ? new Date(serviceDateEnd) : null,
      notes: buildFinalNotes(notes) || null,
      introText: introText || null,
      vatRegulation,
      paymentQrEnabled,
      subtotal: mockTotals.subtotal,
      taxAmount: mockTotals.taxAmount,
      total: mockTotals.total,
      globalDiscountType: globalDiscountType === "none" ? null : globalDiscountType,
      globalDiscountValue: globalDiscountType === "none" ? null : (parseFloat(globalDiscountValue.replace(",", ".")) || 0),
      contact: {
        name: recipientName || client?.name || "",
        contactFirstName: client?.contactFirstName ?? null,
        contactLastName: client?.contactLastName ?? null,
        address: recipientAddress || null, zip: recipientZip || null,
        city: recipientCity || null, country: recipientCountry || "DE",
        vatId: client?.vatId ?? null,
        customerNumber: client?.customerNumber ?? null,
      },
      lineItems: mockLineItems,
    };
  }

  // ── Submit ────────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!contactId) { setError(t("form.clientRequired")); return; }
    if (isEInvoice && !eInvoiceEmail.trim()) { setError(t("form.emailRequired")); return; }

    // Per-position validation (only in recurring mode do we hard-reject 0 prices —
    // single invoices may include complimentary items, but a recurring template
    // billing 0 every month is almost always a forgotten field).
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.description.trim()) { setError(tRec("form.errors.itemDescription", { position: i + 1 })); return; }
      const qty = parseFloat(it.quantity) || 0;
      if (qty <= 0) { setError(tRec("form.errors.itemQuantity", { position: i + 1 })); return; }
      if (isRecurringMode) {
        const price = parseFloat(it.unitPrice.replace(",", "."));
        if (!Number.isFinite(price) || price <= 0) {
          setError(tRec("form.errors.itemPrice", { position: i + 1 }));
          return;
        }
      }
    }

    const parsedItems = items.map((item) => {
      const qty   = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unitPrice.replace(",", ".")) || 0;
      const dType = item.discountType === "none" ? null : item.discountType;
      const dVal = dType ? (parseFloat(item.discountValue.replace(",", ".")) || 0) : null;
      return {
        description: item.description.trim(), quantity: qty, unit: item.unit || null,
        unitPrice: price, vatRate: parseInt(item.vatRate) || 0,
        amount: calcItemAmount(qty, price, item.discountType, item.discountValue),
        discountType: dType,
        discountValue: dVal,
      };
    });

    const globalDiscountPayload = globalDiscountType === "none"
      ? null
      : {
          type: globalDiscountType,
          value: parseFloat(globalDiscountValue.replace(",", ".")) || 0,
        };

    const ref = buyerReference.trim() || "00";
    const isLeitwegId = /^\d+-\d+-\d+$/.test(ref);

    // ── Recurring branch ───────────────────────────────────────────────────
    if (isRecurringMode) {
      const payload: RecurringInvoiceInput = {
        contactId,
        title: recurringTitle.trim() || null,
        firstIssueDate: recurringFirstIssue,
        endDate: recurringEndDate || null,
        interval: recurringInterval,
        autoGenerate: recurringAutoGenerate,
        autoSend: recurringAutoSend,
        paymentTermDays: recurringPaymentTermDays,
        notes: buildFinalNotes(notes),
        introText: introText || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vatRegulation: vatRegulation as any,
        leitwegId: isEInvoice && isLeitwegId ? ref : null,
        buyerReference: isEInvoice ? ref : null,
        items: parsedItems.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          unit: it.unit,
          unitPrice: it.unitPrice,
          vatRate: it.vatRate,
        })),
      };

      const result = recurring?.id
        ? await updateRecurringInvoice(recurring.id, payload)
        : await createRecurringInvoice(payload);

      if (!result.success) { setError(result.error); return; }
      startTransition(() => {
        router.push(`/dashboard/invoices/recurring/${result.id}`);
      });
      return;
    }

    // ── Single-invoice branch (create + edit) ─────────────────────────────
    // Same payload on both sides — only the action target differs.
    const result = editingInvoice
      ? await updateDraftInvoice(
          editingInvoice.id,
          contactId, issueDate, dueDate || null, serviceDate || null,
          (serviceDateMode === "period" && serviceDateEnd) ? serviceDateEnd : null,
          buildFinalNotes(notes), parsedItems,
          isEInvoice && isLeitwegId ? ref : null,
          isEInvoice ? ref : null,
          introText || null,
          vatRegulation,
          paymentQrEnabled,
          globalDiscountPayload,
        )
      : await createInvoice(
          contactId, issueDate, dueDate || null, serviceDate || null,
          (serviceDateMode === "period" && serviceDateEnd) ? serviceDateEnd : null,
          buildFinalNotes(notes), parsedItems,
          isEInvoice && isLeitwegId ? ref : null,
          isEInvoice ? ref : null,
          introText || null,
          vatRegulation,
          paymentQrEnabled,
          sourceQuoteId ?? null,
          sourceOrderConfirmationId ?? null,
          globalDiscountPayload,
        );

    if (!result.success) { setError(result.error); return; }

    const mode = submitMode;
    startTransition(() => {
      // After an edit save: stay on the detail page (with optional ?send=1 if
      // the user clicked "Überprüfen & Versenden"). After a create: same.
      if (mode === "send") router.push(`/dashboard/invoices/${result.id}?send=1`);
      else if (editingInvoice) router.push(`/dashboard/invoices/${result.id}`);
      else router.push("/dashboard/invoices");
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      {showPreview && (
        <PreviewModal invoice={buildMockInvoice()} settings={settings} onClose={() => setShowPreview(false)} />
      )}
      {showNewClientModal && (
        <NewClientModal onCreated={handleNewClientCreated} onClose={() => setShowNewClientModal(false)} />
      )}

      {/* Cancel parent <main>'s p-6 so sticky bar can sit flush at top */}
      <div className="p-6">

        {/* ── Top bar — sticky ─────────────────────────────────────────── */}
        <div className="sticky top-0 z-30 px-6 py-3 bg-background/80 backdrop-blur-md border-b border-border/50">
          <div className="max-w-5xl mx-auto flex items-center gap-3">
            <Link
              href={
                isRecurringMode
                  ? "/dashboard/invoices/recurring"
                  : isEditMode
                    ? `/dashboard/invoices/${editingInvoice!.id}`
                    : "/dashboard/invoices"
              }
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-xl font-semibold text-foreground whitespace-nowrap">
              {isRecurringMode
                ? isRecurringEdit
                  ? tRec("form.editTitle")
                  : tRec("form.createTitle")
                : isEditMode
                  ? t("editTitle", { number: editingInvoice!.number })
                  : t("newTitle")}
            </h1>

            {/* E-Invoice toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
              <div onClick={() => handleEInvoiceToggle(!isEInvoice)}
                className={`w-9 h-5 rounded-full flex items-center transition-colors duration-200 px-0.5 ${isEInvoice ? "bg-success" : "bg-muted-foreground/30"}`}>
                <span className={`w-4 h-4 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${isEInvoice ? "translate-x-4" : "translate-x-0"}`} />
              </div>
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <FileCode2 className="w-3.5 h-3.5" />
                {t("form.invoiceType.eInvoice")}
              </span>
            </label>

            <div className="flex items-center gap-2 ml-auto shrink-0">
              <div ref={overflowRef} className="relative">
                <button type="button" onClick={() => setShowOverflow((o) => !o)}
                  className="p-2 text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors">
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {showOverflow && (
                  <div className="absolute right-0 top-full mt-1.5 bg-card border border-border rounded-xl shadow-xl py-1.5 min-w-36 z-20">
                    <button
                      type="button"
                      onClick={() => {
                        setShowOverflow(false);
                        router.push(isRecurringMode ? "/dashboard/invoices/recurring" : "/dashboard/invoices");
                      }}
                      className="w-full px-4 py-2 text-sm text-left text-destructive hover:bg-muted transition-colors"
                    >
                      {tCommon("actions.cancel")}
                    </button>
                  </div>
                )}
              </div>

              {/* Preview button — single-invoice mode only; recurring template
                  preview is an unsolved UX problem (no concrete dates yet). */}
              {!isRecurringMode && (
                <button type="button" onClick={() => setShowPreview(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground border border-border bg-background rounded-lg hover:bg-muted transition-colors">
                  <Eye className="w-4 h-4" />
                  {t("form.preview")}
                </button>
              )}

              {isRecurringMode ? (
                <button
                  type="submit"
                  form="invoice-form"
                  disabled={isPending}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {willCreateImmediately ? <Zap className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                  {isPending
                    ? tRec("form.submitting")
                    : willCreateImmediately
                      ? isRecurringEdit
                        ? tRec("form.submitUpdateAndRun")
                        : tRec("form.submitCreateAndRun")
                      : isRecurringEdit
                        ? tRec("form.submitUpdate")
                        : tRec("form.submitCreate")}
                </button>
              ) : (
                <>
                  <button type="submit" form="invoice-form" disabled={isPending} onClick={() => setSubmitMode("draft")}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground border border-border bg-background rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
                    <Save className="w-4 h-4" />
                    {isPending && submitMode === "draft" ? t("form.saving") : tCommon("actions.save")}
                  </button>

                  <button type="submit" form="invoice-form" disabled={isPending} onClick={() => setSubmitMode("send")}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                    <Send className="w-4 h-4" />
                    {isPending && submitMode === "send" ? t("form.creating") : t("form.reviewAndSend")}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Form content — re-apply padding ──────────────────────────── */}
        <div className="p-6">
          <div className="max-w-5xl mx-auto space-y-5">

        {/* Optional caller-provided header content (e.g., schedule actions
            toolbar on the recurring detail page). Renders before any form
            content so it sits high in the visual hierarchy. */}
        {headerSlot}

        {/* Live next-dates preview — recomputes as the user changes interval /
            firstIssueDate / endDate / autoGenerate, no save needed. */}
        {isRecurringMode && upcomingDates.length > 0 && (
          <div className="bg-card border border-border rounded-xl px-5 py-3">
            <div className="flex items-center gap-2 mb-2">
              <CalendarClock className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {tRec("nextDates.title")}
              </span>
              {!recurringAutoGenerate && (
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  · {tRec("nextDates.pausedHint")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {upcomingDates.map((d, i) => (
                <span
                  key={d.toISOString()}
                  className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs tabular-nums border ${
                    i === 0
                      ? "border-primary/30 bg-primary/5 text-foreground font-medium"
                      : "border-border bg-muted/40 text-muted-foreground"
                  }`}
                >
                  {i === 0 && (
                    <span className="text-[10px] uppercase tracking-wide text-primary mr-1.5">
                      {tRec("nextDates.next")}
                    </span>
                  )}
                  {upcomingDatesFmt.format(d)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Inline notice: "first invoice will be created immediately" */}
        {isRecurringMode && willCreateImmediately && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 flex items-start gap-3">
            <Zap className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="text-sm text-foreground">
              <p className="font-medium">{tRec("form.immediateNoticeTitle")}</p>
              <p className="text-muted-foreground mt-0.5">
                {recurringAutoSend
                  ? tRec("form.immediateNoticeAutoSend")
                  : tRec("form.immediateNoticeDraft")}
              </p>
            </div>
          </div>
        )}

        {/* ── Form ──────────────────────────────────────────────────────────── */}
        <form id="invoice-form" onSubmit={handleSubmit} className="space-y-5">

          {/* Row 1: Recipient (left) + Invoice Details (right, 380px) */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5">

            {/* Box 1: Recipient */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <h2 className="text-m font-semibold text-foreground">{t("form.recipient")}</h2>

              <div>
                <label className={LABEL}>{t("fields.client")} *</label>
                <div className="flex gap-2">
                  <select value={contactId} onChange={(e) => handleClientChange(e.target.value)} required className={INPUT}>
                    <option value="" disabled>{t("form.selectClientPlaceholder")}</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setShowNewClientModal(true)} title={t("form.newClientTooltip")}
                    className="shrink-0 flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-muted text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                    <UserPlus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className={LABEL}>{t("form.recipientName")}</label>
                  <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)}
                    placeholder={t("form.recipientNamePlaceholder")} className={INPUT} />
                </div>
                <div className="sm:col-span-2">
                  <label className={LABEL}>{t("form.street")}</label>
                  <input value={recipientAddress} onChange={(e) => setRecipientAddress(e.target.value)}
                    placeholder={t("form.streetPlaceholder")} className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>{t("form.zip")}</label>
                  <input value={recipientZip} onChange={(e) => setRecipientZip(e.target.value)} placeholder="10115" className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>{t("form.city")}</label>
                  <input value={recipientCity} onChange={(e) => setRecipientCity(e.target.value)} placeholder="Berlin" className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>{t("form.country")}</label>
                  <CountrySelect value={recipientCountry} onChange={setRecipientCountry} />
                </div>
              </div>
            </div>

            {/* Box 2: Right sidebar — single-invoice details OR recurrence config */}
            {isRecurringMode ? (
              <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                <h2 className="text-m font-semibold text-foreground flex items-center gap-2">
                  <Repeat className="w-4 h-4 text-muted-foreground" />
                  {tRec("form.sectionRecurrence")}
                </h2>

                <div>
                  <label className={LABEL}>
                    {tRec("form.titleLabel")}{" "}
                    <span className="text-muted-foreground/70 font-normal ml-1">
                      ({tRec("form.optional")})
                    </span>
                  </label>
                  <input
                    type="text"
                    className={INPUT}
                    placeholder={tRec("form.titlePlaceholder")}
                    value={recurringTitle}
                    onChange={(e) => setRecurringTitle(e.target.value)}
                  />
                </div>

                <div>
                  <label className={LABEL}>{tRec("form.firstIssueDate")} *</label>
                  <input
                    type="date"
                    required
                    className={INPUT}
                    value={recurringFirstIssue}
                    onChange={(e) => setRecurringFirstIssue(e.target.value)}
                  />
                  {isRecurringEdit && (recurring?.generatedCount ?? 0) > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tRec("form.firstIssueDateLockedHint")}
                    </p>
                  )}
                </div>

                <div>
                  <label className={LABEL}>{tRec("form.interval")} *</label>
                  <select
                    className={INPUT}
                    value={recurringInterval}
                    onChange={(e) => setRecurringInterval(e.target.value as RecurringInterval)}
                  >
                    {INTERVAL_ORDER.map((iv) => (
                      <option key={iv} value={iv}>
                        {tRec(`intervals.${INTERVAL_I18N_KEY[iv]}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={LABEL}>
                    {tRec("form.endDate")}{" "}
                    <span className="text-muted-foreground/70 font-normal ml-1">
                      ({tRec("form.optional")})
                    </span>
                  </label>
                  <input
                    type="date"
                    className={INPUT}
                    value={recurringEndDate}
                    min={recurringFirstIssue}
                    onChange={(e) => setRecurringEndDate(e.target.value)}
                  />
                </div>

                <div>
                  <label className={LABEL}>
                    {tRec("form.paymentTermDays")}{" "}
                    <span className="text-muted-foreground/70 font-normal ml-1">
                      ({tRec("form.optional")})
                    </span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    className={INPUT}
                    placeholder="14"
                    value={recurringPaymentTermDays ?? ""}
                    onChange={(e) =>
                      setRecurringPaymentTermDays(e.target.value === "" ? null : Number(e.target.value))
                    }
                  />
                </div>

                <div className="pt-2 border-t border-border space-y-3">
                  <RecurringToggleRow
                    title={tRec("form.autoGenerate.title")}
                    description={tRec("form.autoGenerate.description")}
                    checked={recurringAutoGenerate}
                    onChange={setRecurringAutoGenerate}
                  />
                  <RecurringToggleRow
                    title={tRec("form.autoSend.title")}
                    description={tRec("form.autoSend.description")}
                    checked={recurringAutoSend}
                    onChange={setRecurringAutoSend}
                    icon={<Mail className="w-3.5 h-3.5" />}
                    disabled={!recurringAutoGenerate}
                    disabledHint={tRec("form.autoSend.requiresAutoGenerate")}
                  />
                </div>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                <h2 className="text-m font-semibold text-foreground">{t("form.invoiceDetails")}</h2>

                <div>
                  <label className={LABEL}>{t("fields.number")}</label>
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border border-border rounded-lg text-sm select-none">
                    <span className="tabular-nums font-medium text-foreground">{nextNumber ?? "—"}</span>
                    <span className="text-xs text-muted-foreground">{t("form.numberAutoAssigned")}</span>
                  </div>
                </div>

                <div>
                  <label className={LABEL}>{t("fields.issueDate")}</label>
                  <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required className={INPUT} />
                </div>

                <div>
                  <label className={LABEL}>{t("fields.dueDate")}</label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={INPUT} />
                </div>

                {/* Service date toggle */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={LABEL + " mb-0"}>
                      {serviceDateMode === "date" ? t("fields.serviceDate") : t("fields.serviceDateEnd")}
                    </label>
                    <div className="inline-flex rounded-lg border border-border bg-muted p-0.5 gap-0.5 text-xs">
                      <button type="button"
                        onClick={() => { setServiceDateMode("date"); setServiceDateEnd(""); }}
                        className={`px-2 py-0.5 rounded-md font-medium transition-all ${serviceDateMode === "date" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                        {t("form.serviceDateMode.date")}
                      </button>
                      <button type="button"
                        onClick={() => setServiceDateMode("period")}
                        className={`px-2 py-0.5 rounded-md font-medium transition-all ${serviceDateMode === "period" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                        {t("form.serviceDateMode.period")}
                      </button>
                    </div>
                  </div>
                  {serviceDateMode === "date" ? (
                    <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className={INPUT} />
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">{t("form.serviceDateFrom")}</p>
                        <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className={INPUT} />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">{t("form.serviceDateTo")}</p>
                        <input type="date" value={serviceDateEnd} onChange={(e) => setServiceDateEnd(e.target.value)} className={INPUT} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Payment QR-Code toggle — controls whether the EPC
                    ("GiroCode") QR is printed on the invoice PDF. */}
                <div className="flex items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <QrCode className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{t("form.paymentQr.label")}</p>
                      <p className="text-xs text-muted-foreground">{t("form.paymentQr.hint")}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={paymentQrEnabled}
                    onClick={() => setPaymentQrEnabled((v) => !v)}
                    className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${paymentQrEnabled ? "bg-primary" : "bg-muted-foreground/30"}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${paymentQrEnabled ? "translate-x-4" : "translate-x-0"}`} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* E-Rechnung fields */}
          {isEInvoice && (
            <div className="bg-card border border-border rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="sm:col-span-2 xl:col-span-4 flex items-center gap-2">
                <FileCode2 className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-semibold text-foreground">{t("form.eInvoiceSection")}</span>
              </div>
              <div className="sm:col-span-2">
                <label className={LABEL}>
                  {t("form.eInvoiceEmailLabel")} * <span className="font-normal">{t("form.eInvoiceEmailSubLabel")}</span>
                </label>
                <input type="email" value={eInvoiceEmail} onChange={(e) => setEInvoiceEmail(e.target.value)}
                  required={isEInvoice} placeholder={t("form.eInvoiceEmailPlaceholder")} className={INPUT} />
              </div>
              <div className="sm:col-span-2">
                <label className={LABEL}>
                  {t("form.buyerRef")}
                  <InfoTooltip text={t("form.buyerRefTooltip")} />
                </label>
                <input type="text" value={buyerReference} onChange={(e) => setBuyerReference(e.target.value)}
                  placeholder="00" className={INPUT} />
              </div>
            </div>
          )}

          {/* Intro text */}
          <div className="bg-card border border-border rounded-xl p-5">
            <label className="block text-sm font-semibold text-foreground mb-3">{t("form.introText")}</label>
            <textarea value={introText} onChange={(e) => setIntroText(e.target.value)} rows={4}
              placeholder={t("form.introTextPlaceholder")} className={INPUT + " resize-none"} />
          </div>

          {/* Line items */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">{t("lineItems.title")}</h2>
            </div>
            <div className="p-5 space-y-3">
              <div className="hidden md:grid md:grid-cols-[1fr_70px_80px_110px_70px_130px_100px_36px] gap-3">
                <span className={LABEL}>{t("lineItems.description")}</span>
                <span className={LABEL}>{t("lineItems.quantity")}</span>
                <span className={LABEL}>{t("unit")}</span>
                <span className={LABEL}>{t("lineItems.unitPrice")}</span>
                <span className={LABEL}>{t("lineItems.vatRate")}</span>
                <span className={LABEL}>{t("form.discount")}</span>
                <span className={LABEL + " text-right"}>{t("lineItems.amount")}</span>
                <span />
              </div>

              {items.map((item, i) => {
                const qty   = parseFloat(item.quantity) || 0;
                const price = parseFloat(item.unitPrice.replace(",", ".")) || 0;
                const amt   = calcItemAmount(qty, price, item.discountType, item.discountValue);
                return (
                  <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_70px_80px_110px_70px_130px_100px_36px] gap-3 items-start">
                    <AutoGrowTextarea value={item.description} onChange={(e) => updateItem(i, "description", e.target.value)}
                      required placeholder={t("lineItems.description")} className={INPUT} />
                    <input value={item.quantity} onChange={(e) => updateItem(i, "quantity", e.target.value)}
                      required type="number" min="0.001" step="0.001" placeholder="1" className={INPUT} />
                    <select value={item.unit} onChange={(e) => updateItem(i, "unit", e.target.value)} className={INPUT}>
                      <option value="">—</option>
                      <option value="Stk.">Stk.</option>
                      <option value="Std.">Std.</option>
                      <option value="Tage">Tage</option>
                      <option value="Monat">Monat</option>
                      <option value="kg">kg</option>
                      <option value="m">m</option>
                      <option value="m²">m²</option>
                      <option value="pauschal">pauschal</option>
                    </select>
                    <input value={item.unitPrice} onChange={(e) => updateItem(i, "unitPrice", e.target.value)}
                      required placeholder="0,00" className={INPUT} />
                    <select value={item.vatRate} onChange={(e) => updateItem(i, "vatRate", e.target.value)}
                      disabled={vatLocked}
                      className={INPUT + (vatLocked ? " opacity-50 cursor-not-allowed" : "")}
                      title={vatLocked ? t("vatRegulation.vatLocked") : undefined}>
                      <option value="19">19 %</option>
                      <option value="7">7 %</option>
                      <option value="0">0 %</option>
                    </select>
                    <div className="flex gap-1">
                      <select value={item.discountType} onChange={(e) => updateDiscountType(i, e.target.value as DiscountType)}
                        className="w-14 shrink-0 px-2 py-2 bg-muted border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors">
                        <option value="none">—</option>
                        <option value="percent">%</option>
                        <option value="amount">€</option>
                      </select>
                      {item.discountType !== "none" && (
                        <input value={item.discountValue} onChange={(e) => updateItem(i, "discountValue", e.target.value)}
                          placeholder={item.discountType === "percent" ? "10" : "5,00"}
                          className="min-w-0 flex-1 px-2 py-2 bg-muted border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors" />
                      )}
                    </div>
                    <p className="text-sm font-medium text-foreground text-right tabular-nums">{fmtCur(amt)}</p>
                    <button type="button" onClick={() => removeItem(i)} disabled={items.length === 1}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}

              <div className="flex flex-wrap items-center gap-4 mt-1">
                <button type="button" onClick={addItem}
                  className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors">
                  <Plus className="w-4 h-4" />
                  {t("lineItems.addItem")}
                </button>
                {globalDiscountType === "none" ? (
                  <button type="button"
                    onClick={() => setGlobalDiscountType("percent")}
                    className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors">
                    <Plus className="w-4 h-4" />
                    {t("form.globalDiscountAdd")}
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{t("form.globalDiscountLabel")}:</span>
                    <select
                      value={globalDiscountType}
                      onChange={(e) => setGlobalDiscountType(e.target.value as DiscountType)}
                      className="w-14 shrink-0 px-2 py-2 bg-muted border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors">
                      <option value="percent">%</option>
                      <option value="amount">€</option>
                    </select>
                    <input
                      value={globalDiscountValue}
                      onChange={(e) => setGlobalDiscountValue(e.target.value)}
                      placeholder={globalDiscountType === "percent" ? "10" : "50,00"}
                      className="w-24 px-2 py-2 bg-muted border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
                    />
                    <button type="button"
                      onClick={() => { setGlobalDiscountType("none"); setGlobalDiscountValue(""); }}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label={t("form.globalDiscountRemove")}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Notes + Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-card border border-border rounded-xl p-5">
              <label className="block text-sm font-semibold text-foreground mb-3">{t("fields.notes")}</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
                placeholder={t("fields.notes") + "…"} className={INPUT + " resize-none"} />
            </div>
            <div className="bg-card border border-border rounded-xl p-5 space-y-2">
              <h3 className="text-sm font-semibold text-foreground mb-3">{t("form.summary")}</h3>
              {isSmallBusiness ? (
                <>
                  {discountAmount > 0 && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t("summary.subtotal")}</span>
                        <span className="tabular-nums">{fmtCur(subtotalBeforeDiscount)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t("form.globalDiscountLabel")}</span>
                        <span className="tabular-nums">-{fmtCur(discountAmount)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-base font-semibold border-t border-border pt-2 mt-2">
                    <span>{t("summary.totalSmallBusiness")}</span>
                    <AnimatedCurrency value={subtotal} className="tabular-nums text-primary" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{t("vatRegulation.legalNotice.smallBusiness19")}</p>
                </>
              ) : (
                <>
                  {discountAmount > 0 && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t("summary.subtotal")}</span>
                        <span className="tabular-nums">{fmtCur(subtotalBeforeDiscount)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t("form.globalDiscountLabel")}</span>
                        <span className="tabular-nums">-{fmtCur(discountAmount)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{discountAmount > 0 ? t("summary.subtotal") + " (rabattiert)" : t("summary.subtotal")}</span>
                    <span className="font-medium tabular-nums">{fmtCur(subtotal)}</span>
                  </div>
                  {tax19 > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t("summary.vat19")}</span>
                      <span className="tabular-nums">{fmtCur(tax19)}</span>
                    </div>
                  )}
                  {tax7 > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t("summary.vat7")}</span>
                      <span className="tabular-nums">{fmtCur(tax7)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base font-semibold border-t border-border pt-2 mt-2">
                    <span>{t("summary.total")}</span>
                    <AnimatedCurrency value={total} className="tabular-nums text-primary" />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* More options (Skonto + VAT regulation) */}
          <div className="bg-card border border-border rounded-xl">
            <button type="button" onClick={() => setShowMoreOptions((o) => !o)}
              className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors rounded-xl">
              {t("form.moreOptions")}
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${showMoreOptions ? "rotate-180" : ""}`} />
            </button>
            {showMoreOptions && (
              <div className="px-5 pb-5 border-t border-border pt-4 space-y-6">
                {/* Skonto */}
                <div>
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <div onClick={() => setSkontoEnabled((s) => !s)}
                      className={`w-9 h-5 rounded-full flex items-center transition-colors duration-200 px-0.5 ${skontoEnabled ? "bg-emerald-500" : "bg-muted-foreground/30"}`}>
                      <span className={`w-4 h-4 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${skontoEnabled ? "translate-x-4" : "translate-x-0"}`} />
                    </div>
                    <span className="text-sm font-medium text-foreground">{t("form.skonto")}</span>
                  </label>
                  {skontoEnabled && (
                    <div className="mt-4 space-y-3">
                      <div className="grid grid-cols-2 gap-3 max-w-xs">
                        <div>
                          <label className={LABEL}>{t("form.skontoPercent")}</label>
                          <input type="number" min="0.01" max="100" step="0.01" value={skontoPercent}
                            onChange={(e) => setSkontoPercent(e.target.value)} placeholder="2" className={INPUT} />
                        </div>
                        <div>
                          <label className={LABEL}>{t("form.skontoDays")}</label>
                          <input type="number" min="1" value={skontoDays}
                            onChange={(e) => setSkontoDays(e.target.value)} placeholder="14" className={INPUT} />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("form.skontoHint")}{" "}
                        <span className="text-foreground">
                          {t("form.skontoText", { pct: skontoPercent || "2", days: skontoDays || "14" })}
                        </span>
                      </p>
                    </div>
                  )}
                </div>

                {/* Divider */}
                <div className="border-t border-border" />

                {/* VAT regulation */}
                <div>
                  <p className="text-sm font-semibold text-foreground mb-3">{t("vatRegulation.title")}</p>
                  {isSmallBusiness ? (
                    <div className="bg-primary/10 rounded-lg px-4 py-3">
                      <p className="text-sm font-medium text-primary">{t("vatRegulation.options.smallBusiness19")}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t("vatRegulation.smallBusinessSettingsHint")}</p>
                    </div>
                  ) : (
                    <>
                      {vatRegulation !== "STANDARD" && (
                        <p className="text-xs text-primary bg-primary/10 rounded-lg px-3 py-2 mb-3">
                          {t(`vatRegulation.options.${vatConfig.labelKey}`)}
                        </p>
                      )}
                      <div className="space-y-1">
                        {VAT_REGULATION_GROUPS
                          .filter((g) => g.key !== "smallBusiness")
                          .map((group) => {
                          const groupRegs = VAT_REGULATIONS.filter((r) => r.group === group.key);
                          const isExpanded = expandedVatGroup === group.key;
                          const hasActiveInGroup = groupRegs.some((r) => r.id === vatRegulation);
                          return (
                            <div key={group.key} className="border border-border rounded-lg">
                              <button
                                type="button"
                                onClick={() => setExpandedVatGroup(isExpanded ? null : group.key)}
                                className="w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors"
                              >
                                <span className={`font-medium ${hasActiveInGroup ? "text-primary" : "text-foreground"}`}>
                                  {t(`vatRegulation.groups.${group.i18nKey}`)}
                                </span>
                                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                              </button>
                              {isExpanded && (
                                <div className="px-2 pb-2 space-y-0.5">
                                  {groupRegs.map((reg) => (
                                    <div
                                      key={reg.id}
                                      onClick={() => handleVatRegulationChange(reg.id)}
                                      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                                        vatRegulation === reg.id
                                          ? "bg-primary/10"
                                          : "hover:bg-muted"
                                      }`}
                                    >
                                      <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                                        vatRegulation === reg.id ? "border-primary" : "border-muted-foreground/40"
                                      }`}>
                                        {vatRegulation === reg.id && (
                                          <span className="w-2 h-2 rounded-full bg-primary" />
                                        )}
                                      </span>
                                      <span className="text-sm text-foreground flex-1">
                                        {t(`vatRegulation.options.${reg.labelKey}`)}
                                      </span>
                                      <InfoTooltip text={t(`vatRegulation.tooltips.${reg.tooltipKey}`)} />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {vatLocked && !isSmallBusiness && (
                        <p className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2 mt-3">
                          {t("vatRegulation.vatLocked")}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">{error}</p>
          )}
        </form>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Recurring helper component ──────────────────────────────────────────────
// Compact on/off toggle row used in the recurrence sidebar. Local to this
// file because it's purely presentational and shares nothing else.

function RecurringToggleRow({
  title,
  description,
  checked,
  onChange,
  icon,
  disabled,
  disabledHint,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 ${disabled ? "opacity-50" : ""}`}>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
          {icon}
          {title}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        {disabled && disabledHint && (
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">{disabledHint}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        role="switch"
        aria-checked={checked}
        className={`relative inline-flex items-center w-9 h-5 rounded-full transition-colors disabled:cursor-not-allowed shrink-0 ${
          checked ? "bg-primary" : "bg-border"
        }`}
      >
        <span
          className={`inline-block w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
