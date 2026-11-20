"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import {
  Plus, Trash2, ArrowLeft, Eye, Send, Save, X, ChevronDown, UserPlus,
} from "lucide-react";
import { createQuote, updateQuote, type QuoteInput } from "./actions";
import { upsertContact, getNextCustomerNumber } from "../contacts/actions";
import { Link } from "@/i18n/navigation";
import { BusinessDocPreview } from "@/components/pdf/business-doc-preview";
import { computeDocumentTotals } from "@/lib/invoice/discount";
import { CountrySelect } from "@/components/ui/country-select";
import { AnimatedCurrency } from "@/components/ui/animated-currency";
import { AutoGrowTextarea } from "@/components/ui/auto-grow-textarea";
import {
  VAT_REGULATIONS, VAT_REGULATION_MAP, VAT_REGULATION_GROUPS,
  type VatRegulationId,
} from "@/lib/vat-regulation";

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

export interface QuoteTemplate {
  contactId: string;
  introText: string | null;
  notes: string | null;
  vatRegulation: string;
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

export interface EditingQuote {
  id: string;
  number: string;
  contactId: string;
  issueDate: string;
  validUntil: string | null;
  serviceDate: string | null;
  serviceDateEnd: string | null;
  notes: string | null;
  introText: string | null;
  vatRegulation: string;
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

const INPUT = "w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors";
const LABEL = "block text-xs font-medium text-muted-foreground mb-1";

function fmtCur(n: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
}

// ── New client quick-create modal (parallel zur Rechnungs-Variante) ───────────
function NewClientModal({ onCreated, onClose }: { onCreated: (c: Client) => void; onClose: () => void }) {
  const t  = useTranslations("quotes");
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

  useEffect(() => { getNextCustomerNumber().then(setCustomerNumber).catch(() => {}); }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
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
            <h2 className="text-base font-semibold text-foreground">{tc("newTitle")}</h2>
          </div>
          <button onClick={onClose} disabled={isPending} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={LABEL}>{tc("fields.name")} *</label>
              <input name="name" required className={INPUT} />
            </div>
            <div className="col-span-2">
              <label className={LABEL}>{tc("fields.customerNumber")} *</label>
              <input name="customerNumber" required value={customerNumber} onChange={(e) => setCustomerNumber(e.target.value)} className={INPUT} />
            </div>
            <div className="col-span-2">
              <label className={LABEL}>{tc("fields.email")}</label>
              <input name="email" type="email" className={INPUT} />
            </div>
            <div className="col-span-2">
              <label className={LABEL}>{tc("fields.address")}</label>
              <input name="address" className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>{tc("fields.zip")}</label>
              <input name="zip" className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>{tc("fields.city")}</label>
              <input name="city" className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>{tc("fields.country")}</label>
              <CountrySelect name="country" defaultValue="DE" />
            </div>
            <div>
              <label className={LABEL}>{tc("fields.vatId")}</label>
              <input name="vatId" className={INPUT} />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} disabled={isPending} className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-foreground hover:bg-accent transition-colors disabled:opacity-50">
              {tCommon("actions.cancel")}
            </button>
            <button type="submit" disabled={isPending} className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50">
              <UserPlus className="w-4 h-4" />
              {isPending ? "…" : t("form.creating")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PreviewModal({ doc, settings, onClose }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any;
  settings: FormSettings | null;
  onClose: () => void;
}) {
  const t = useTranslations("quotes");
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
            <BusinessDocPreview
              doc={doc}
              docType="QUOTE"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              settings={settings as any}
              locale={locale}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

type SubmitMode = "draft" | "send";

export function QuoteForm({
  clients: initialClients,
  settings,
  nextNumber,
  template,
  editingQuote,
}: {
  clients: Client[];
  settings: FormSettings | null;
  nextNumber?: string;
  template?: QuoteTemplate;
  editingQuote?: EditingQuote;
}) {
  const t = useTranslations("quotes");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [submitMode, setSubmitMode] = useState<SubmitMode>("draft");
  const [showPreview, setShowPreview] = useState(false);
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [clients, setClients] = useState<Client[]>(initialClients);

  const today = new Date().toISOString().split("T")[0];
  const in14  = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];

  const sourceContactId = editingQuote?.contactId ?? template?.contactId ?? null;
  const sourceClient = sourceContactId
    ? initialClients.find((c) => c.id === sourceContactId) ?? null
    : null;

  const [contactId, setContactId] = useState(sourceContactId ?? "");
  const [recipientName, setRecipientName] = useState(sourceClient?.name ?? "");
  const [recipientAddress, setRecipientAddress] = useState(sourceClient?.address ?? "");
  const [recipientZip, setRecipientZip] = useState(sourceClient?.zip ?? "");
  const [recipientCity, setRecipientCity] = useState(sourceClient?.city ?? "");
  const [recipientCountry, setRecipientCountry] = useState(sourceClient?.country ?? "DE");

  const [issueDate, setIssueDate] = useState(editingQuote?.issueDate ?? today);
  const [validUntil, setValidUntil] = useState(editingQuote?.validUntil ?? in14);
  const [serviceDateMode, setServiceDateMode] = useState<"date" | "period">(
    editingQuote?.serviceDateEnd ? "period" : "date",
  );
  const [serviceDate, setServiceDate] = useState(editingQuote?.serviceDate ?? "");
  const [serviceDateEnd, setServiceDateEnd] = useState(editingQuote?.serviceDateEnd ?? "");

  const [introText, setIntroText] = useState(
    editingQuote?.introText ??
    template?.introText ??
    settings?.defaultIntroText ??
    t("form.defaultIntroText"),
  );
  const [notes, setNotes] = useState(editingQuote?.notes ?? template?.notes ?? "");

  const isSmallBusiness = settings?.taxMode === "SMALL_BUSINESS";
  const [vatRegulation, setVatRegulation] = useState<VatRegulationId>(
    (editingQuote?.vatRegulation as VatRegulationId | undefined) ??
      (template?.vatRegulation as VatRegulationId | undefined) ??
      (isSmallBusiness ? "SMALL_BUSINESS_19" : "STANDARD"),
  );
  const vatConfig = VAT_REGULATION_MAP[vatRegulation];
  const vatLocked = !vatConfig.vatEditable || isSmallBusiness;

  const [items, setItems] = useState<LineItem[]>(() => {
    const source = editingQuote?.lineItems ?? template?.lineItems ?? [];
    if (source.length > 0) {
      return source.map((li) => {
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
      { description: "", quantity: "1", unit: "", unitPrice: "", vatRate: isSmallBusiness ? "0" : "19", discountType: "none" as DiscountType, discountValue: "" },
    ];
  });

  // Gesamtrabatt (Quote-Head).
  const editingQuoteAny = editingQuote as unknown as
    | { globalDiscountType?: string | null; globalDiscountValue?: number | string | null }
    | undefined;
  const initialGlobalType: DiscountType =
    (editingQuoteAny?.globalDiscountType as DiscountType | null | undefined)
    ?? (template?.globalDiscountType as DiscountType | null | undefined)
    ?? "none";
  const initialGlobalValue =
    editingQuoteAny?.globalDiscountValue !== null && editingQuoteAny?.globalDiscountValue !== undefined
      ? String(editingQuoteAny.globalDiscountValue)
      : template?.globalDiscountValue !== null && template?.globalDiscountValue !== undefined
      ? String(template.globalDiscountValue)
      : "";
  const [globalDiscountType, setGlobalDiscountType] = useState<DiscountType>(initialGlobalType);
  const [globalDiscountValue, setGlobalDiscountValue] = useState(initialGlobalValue);

  function handleVatRegulationChange(id: VatRegulationId) {
    setVatRegulation(id);
    const config = VAT_REGULATION_MAP[id];
    if (!config.vatEditable) {
      setItems((prev) => prev.map((item) => ({ ...item, vatRate: String(config.forcedVatRate) })));
    }
  }

  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [expandedVatGroup, setExpandedVatGroup] = useState<string | null>(null);

  // ── Skonto ───────────────────────────────────────────────────────────────
  // Parallel to the invoice form: an optional discount-for-early-payment
  // hint that gets appended to the quote's notes on submit. We don't store
  // skonto fields explicitly — the rendered text in `notes` is the source
  // of truth, same as on invoices. Editing keeps the notes-as-rendered;
  // the toggle defaults to off so re-saving doesn't double the hint.
  const [skontoEnabled, setSkontoEnabled] = useState(false);
  const [skontoPercent, setSkontoPercent] = useState("2");
  const [skontoDays, setSkontoDays] = useState("14");

  function buildFinalNotes(base: string): string {
    if (!skontoEnabled) return base;
    const pct = parseFloat(skontoPercent) || 2;
    const days = parseInt(skontoDays) || 14;
    const txt = t("skontoText", { pct, days });
    return base ? `${base}\n\n${txt}` : txt;
  }

  function applyClientToForm(client: Client) {
    setRecipientName(client.name);
    setRecipientAddress(client.address ?? "");
    setRecipientZip(client.zip ?? "");
    setRecipientCity(client.city ?? "");
    setRecipientCountry(client.country ?? "DE");
  }
  function handleClientChange(id: string) {
    setContactId(id);
    const client = clients.find((c) => c.id === id);
    if (client) applyClientToForm(client);
  }
  function handleNewClientCreated(client: Client) {
    setClients((prev) => [...prev, client].sort((a, b) => a.name.localeCompare(b.name)));
    setShowNewClientModal(false);
    setContactId(client.id);
    applyClientToForm(client);
  }

  function addItem() {
    const defaultRate = vatLocked ? String(vatConfig.forcedVatRate) : "19";
    setItems((prev) => [...prev, { description: "", quantity: "1", unit: "", unitPrice: "", vatRate: defaultRate, discountType: "none", discountValue: "" }]);
  }
  function removeItem(i: number) { setItems((prev) => prev.filter((_, idx) => idx !== i)); }
  function updateItem(i: number, field: keyof LineItem, value: string) {
    setItems((prev) => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  }
  function updateDiscountType(i: number, type: DiscountType) {
    setItems((prev) => prev.map((item, idx) =>
      idx === i ? { ...item, discountType: type, discountValue: type === "none" ? "" : item.discountValue } : item
    ));
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

  const parsed = items.map((item) => {
    const qty   = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.unitPrice.replace(",", ".")) || 0;
    const rate  = parseInt(item.vatRate) || 0;
    const amount = calcItemAmount(qty, price, item.discountType, item.discountValue);
    return { amount, rate };
  });
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

  function buildMockDoc() {
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
      };
    });
    const mockTotals = computeDocumentTotals(
      mockLineItems.map((li) => ({ amount: li.amount, vatRate: li.vatRate })),
      globalDiscountType === "none" ? null : globalDiscountType,
      globalDiscountValue,
    );
    return {
      number: nextNumber ?? "ENTWURF",
      issueDate: issueDate ? new Date(issueDate) : new Date(),
      deadlineDate: validUntil ? new Date(validUntil) : null,
      deadlineLabel: validUntil ? t("fields.validUntil") : undefined,
      serviceDate: serviceDate ? new Date(serviceDate) : null,
      serviceDateEnd: (serviceDateMode === "period" && serviceDateEnd) ? new Date(serviceDateEnd) : null,
      notes: buildFinalNotes(notes) || null,
      introText: introText || null,
      vatRegulation,
      subtotal: mockTotals.subtotal, taxAmount: mockTotals.taxAmount, total: mockTotals.total,
      globalDiscountType: globalDiscountType === "none" ? null : globalDiscountType,
      globalDiscountValue: globalDiscountType === "none" ? null : (parseFloat(globalDiscountValue.replace(",", ".")) || 0),
      contact: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(client as any),
        name: recipientName || client?.name || "",
        address: recipientAddress || null, zip: recipientZip || null,
        city: recipientCity || null, country: recipientCountry || "DE",
      },
      lineItems: mockLineItems,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!contactId) { setError(t("form.clientRequired")); return; }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.description.trim()) { setError(`Position ${i + 1}: Beschreibung fehlt.`); return; }
      const qty = parseFloat(it.quantity) || 0;
      if (qty <= 0) { setError(`Position ${i + 1}: Menge muss größer als 0 sein.`); return; }
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

    const payload: QuoteInput = {
      contactId,
      issueDate,
      validUntil: validUntil || null,
      serviceDate: serviceDate || null,
      serviceDateEnd: (serviceDateMode === "period" && serviceDateEnd) ? serviceDateEnd : null,
      notes: buildFinalNotes(notes),
      introText: introText || null,
      vatRegulation,
      items: parsedItems,
      globalDiscountType: globalDiscountType === "none" ? null : globalDiscountType,
      globalDiscountValue: globalDiscountType === "none" ? null : (parseFloat(globalDiscountValue.replace(",", ".")) || 0),
    };

    const result = editingQuote
      ? await updateQuote(editingQuote.id, payload)
      : await createQuote(payload);

    if (!result.success) { setError(result.error); return; }

    const mode = submitMode;
    startTransition(() => {
      if (mode === "send") router.push(`/dashboard/quotes/${result.id}?send=1`);
      else if (editingQuote) router.push(`/dashboard/quotes/${result.id}`);
      else router.push("/dashboard/quotes");
    });
  }

  const isEditMode = !!editingQuote;

  return (
    <>
      {showPreview && (
        <PreviewModal doc={buildMockDoc()} settings={settings} onClose={() => setShowPreview(false)} />
      )}
      {showNewClientModal && (
        <NewClientModal onCreated={handleNewClientCreated} onClose={() => setShowNewClientModal(false)} />
      )}

      <div className="p-6">
        <div className="sticky top-0 z-30 px-6 py-3 bg-background/80 backdrop-blur-md border-b border-border/50">
          <div className="max-w-5xl mx-auto flex items-center gap-3">
            <Link
              href={isEditMode ? `/dashboard/quotes/${editingQuote!.id}` : "/dashboard/quotes"}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-xl font-semibold text-foreground whitespace-nowrap">
              {isEditMode ? t("editTitle", { number: editingQuote!.number }) : t("newTitle")}
            </h1>

            <div className="flex items-center gap-2 ml-auto shrink-0">
              <button type="button" onClick={() => setShowPreview(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground border border-border bg-background rounded-lg hover:bg-muted transition-colors">
                <Eye className="w-4 h-4" />
                {t("form.preview")}
              </button>

              <button type="submit" form="quote-form" disabled={isPending} onClick={() => setSubmitMode("draft")}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground border border-border bg-background rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
                <Save className="w-4 h-4" />
                {isPending && submitMode === "draft" ? t("form.saving") : tCommon("actions.save")}
              </button>

              <button type="submit" form="quote-form" disabled={isPending} onClick={() => setSubmitMode("send")}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                <Send className="w-4 h-4" />
                {isPending && submitMode === "send" ? t("form.creating") : t("form.reviewAndSend")}
              </button>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className="max-w-5xl mx-auto space-y-5">
            <form id="quote-form" onSubmit={handleSubmit} className="space-y-5">

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5">
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
                      <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder={t("form.recipientNamePlaceholder")} className={INPUT} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={LABEL}>{t("form.street")}</label>
                      <input value={recipientAddress} onChange={(e) => setRecipientAddress(e.target.value)} placeholder={t("form.streetPlaceholder")} className={INPUT} />
                    </div>
                    <div>
                      <label className={LABEL}>{t("form.zip")}</label>
                      <input value={recipientZip} onChange={(e) => setRecipientZip(e.target.value)} className={INPUT} />
                    </div>
                    <div>
                      <label className={LABEL}>{t("form.city")}</label>
                      <input value={recipientCity} onChange={(e) => setRecipientCity(e.target.value)} className={INPUT} />
                    </div>
                    <div>
                      <label className={LABEL}>{t("form.country")}</label>
                      <CountrySelect value={recipientCountry} onChange={setRecipientCountry} />
                    </div>
                  </div>
                </div>

                <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                  <h2 className="text-m font-semibold text-foreground">{t("form.details")}</h2>

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
                    <label className={LABEL}>{t("fields.validUntil")}</label>
                    <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={INPUT} />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className={LABEL + " mb-0"}>
                        {serviceDateMode === "date" ? t("fields.serviceDate") : t("fields.serviceDateEnd")}
                      </label>
                      <div className="inline-flex rounded-lg border border-border bg-muted p-0.5 gap-0.5 text-xs">
                        <button type="button" onClick={() => { setServiceDateMode("date"); setServiceDateEnd(""); }}
                          className={`px-2 py-0.5 rounded-md font-medium transition-all ${serviceDateMode === "date" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                          {t("form.serviceDateMode.date")}
                        </button>
                        <button type="button" onClick={() => setServiceDateMode("period")}
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
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-5">
                <label className="block text-sm font-semibold text-foreground mb-3">{t("form.introText")}</label>
                <textarea value={introText} onChange={(e) => setIntroText(e.target.value)} rows={4}
                  placeholder={t("form.introTextPlaceholder")} className={INPUT + " resize-none"} />
              </div>

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
                    <span className={LABEL}>Rabatt</span>
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
                          className={INPUT + (vatLocked ? " opacity-50 cursor-not-allowed" : "")}>
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
                        Gesamtrabatt hinzufügen
                      </button>
                    ) : (
                      <div className="inline-flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Gesamtrabatt:</span>
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
                          aria-label="Gesamtrabatt entfernen">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

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
                            <span className="text-muted-foreground">Gesamtrabatt</span>
                            <span className="tabular-nums">-{fmtCur(discountAmount)}</span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between text-base font-semibold border-t border-border pt-2 mt-2">
                        <span>{t("summary.totalSmallBusiness")}</span>
                        <AnimatedCurrency value={subtotal} className="tabular-nums text-primary" />
                      </div>
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
                            <span className="text-muted-foreground">Gesamtrabatt</span>
                            <span className="tabular-nums">-{fmtCur(discountAmount)}</span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{discountAmount > 0 ? `${t("summary.subtotal")} (rabattiert)` : t("summary.subtotal")}</span>
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

              <div className="bg-card border border-border rounded-xl">
                <button type="button" onClick={() => setShowMoreOptions((o) => !o)}
                  className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors rounded-xl">
                  {t("moreOptions")}
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${showMoreOptions ? "rotate-180" : ""}`} />
                </button>
                {showMoreOptions && (
                  <div className="px-5 pb-5 border-t border-border pt-4 space-y-6">
                    {/* ── Skonto ─────────────────────────────────────────── */}
                    <div>
                      <label className="flex items-center gap-3 cursor-pointer select-none">
                        <div onClick={() => setSkontoEnabled((s) => !s)}
                          className={`w-9 h-5 rounded-full flex items-center transition-colors duration-200 px-0.5 ${skontoEnabled ? "bg-emerald-500" : "bg-muted-foreground/30"}`}>
                          <span className={`w-4 h-4 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${skontoEnabled ? "translate-x-4" : "translate-x-0"}`} />
                        </div>
                        <span className="text-sm font-medium text-foreground">{t("skonto")}</span>
                      </label>
                      {skontoEnabled && (
                        <div className="mt-4 space-y-3">
                          <div className="grid grid-cols-2 gap-3 max-w-xs">
                            <div>
                              <label className={LABEL}>{t("skontoPercent")}</label>
                              <input type="number" min="0.01" max="100" step="0.01" value={skontoPercent}
                                onChange={(e) => setSkontoPercent(e.target.value)} placeholder="2" className={INPUT} />
                            </div>
                            <div>
                              <label className={LABEL}>{t("skontoDays")}</label>
                              <input type="number" min="1" value={skontoDays}
                                onChange={(e) => setSkontoDays(e.target.value)} placeholder="14" className={INPUT} />
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t("skontoHint")}{" "}
                            <span className="text-foreground">
                              {t("skontoText", { pct: skontoPercent || "2", days: skontoDays || "14" })}
                            </span>
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="border-t border-border" />

                    {/* ── VAT regulation ─────────────────────────────────── */}
                    <div>
                      <p className="text-sm font-semibold text-foreground mb-3">Umsatzsteuerregelung</p>
                    {isSmallBusiness ? (
                      <div className="bg-primary/10 rounded-lg px-4 py-3">
                        <p className="text-sm font-medium text-primary">Kleinunternehmerregelung §19 UStG</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {VAT_REGULATION_GROUPS.filter((g) => g.key !== "smallBusiness").map((group) => {
                          const groupRegs = VAT_REGULATIONS.filter((r) => r.group === group.key);
                          const isExpanded = expandedVatGroup === group.key;
                          const hasActiveInGroup = groupRegs.some((r) => r.id === vatRegulation);
                          return (
                            <div key={group.key} className="border border-border rounded-lg">
                              <button type="button" onClick={() => setExpandedVatGroup(isExpanded ? null : group.key)}
                                className="w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors">
                                <span className={`font-medium ${hasActiveInGroup ? "text-primary" : "text-foreground"}`}>
                                  {group.key}
                                </span>
                                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                              </button>
                              {isExpanded && (
                                <div className="px-2 pb-2 space-y-0.5">
                                  {groupRegs.map((reg) => (
                                    <div key={reg.id} onClick={() => handleVatRegulationChange(reg.id)}
                                      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${vatRegulation === reg.id ? "bg-primary/10" : "hover:bg-muted"}`}>
                                      <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${vatRegulation === reg.id ? "border-primary" : "border-muted-foreground/40"}`}>
                                        {vatRegulation === reg.id && <span className="w-2 h-2 rounded-full bg-primary" />}
                                      </span>
                                      <span className="text-sm text-foreground flex-1">{reg.id}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
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
