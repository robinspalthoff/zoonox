"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ArrowLeft, Plus, Trash2, AlertCircle, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { createInvoiceCorrection } from "../../actions";

interface OriginalLineItem {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  vatRate: number;
  amount: number;
}

interface OriginalInvoice {
  id: string;
  number: string;
  issueDate: string;
  contactName: string;
  total: number;
  lineItems: OriginalLineItem[];
}

interface EditableItem {
  description: string;
  quantity: string; // string for input ergonomics; parsed on submit
  unit: string;
  unitPrice: string;
  /** Locked — inherited from the corresponding original position. */
  vatRate: number;
}

const INPUT =
  "w-full h-9 px-2.5 rounded-md border border-border bg-input text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors";
const LABEL = "block text-[11px] font-semibold uppercase tracking-[.06em] text-muted-foreground mb-1.5";

function parseNum(v: string): number {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function lineAmount(q: number, p: number): number {
  return Math.round(q * p * 100) / 100;
}

export function CorrectionForm({ original }: { original: OriginalInvoice }) {
  const t = useTranslations("invoices.correction");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().split("T")[0];
  const [issueDate, setIssueDate] = useState<string>(today);
  const [notes, setNotes] = useState<string>(
    t("notesDefault", { number: original.number }),
  );

  // VAT for newly added items inherits from the original's first position so
  // a correction never silently changes the tax treatment.
  const inheritedVatRate = original.lineItems[0]?.vatRate ?? 19;

  const [items, setItems] = useState<EditableItem[]>(() =>
    original.lineItems.map((li) => ({
      description: li.description,
      quantity: String(li.quantity),
      unit: li.unit ?? "",
      unitPrice: String(li.unitPrice),
      vatRate: li.vatRate,
    })),
  );

  // ── Derived totals ────────────────────────────────────────────────────────
  //
  // A correction reads like a regular invoice: full corrected positions,
  // full positive total. The customer sees what the bill *should* have been;
  // any delta against the original is settled in the books, not in the doc.
  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const it of items) {
      const a = lineAmount(parseNum(it.quantity), parseNum(it.unitPrice));
      subtotal += a;
      tax += Math.round(a * (it.vatRate / 100) * 100) / 100;
    }
    subtotal = Math.round(subtotal * 100) / 100;
    tax = Math.round(tax * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
    return { subtotal, tax, total };
  }, [items]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  function updateItem<K extends keyof EditableItem>(
    i: number,
    key: K,
    value: EditableItem[K],
  ) {
    setItems((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [key]: value };
      return next;
    });
  }
  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        description: "",
        quantity: "1",
        unit: "",
        unitPrice: "0",
        // Inherit the original's first-position rate — never user-editable.
        vatRate: inheritedVatRate,
      },
    ]);
  }
  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  function submit() {
    setError(null);
    const lineItems = items
      .filter((it) => it.description.trim().length > 0)
      .map((it) => {
        const quantity = parseNum(it.quantity);
        const unitPrice = parseNum(it.unitPrice);
        return {
          description: it.description.trim(),
          quantity,
          unit: it.unit.trim() || null,
          unitPrice,
          vatRate: it.vatRate,
        };
      });
    if (lineItems.length === 0) {
      setError(t("errors.noItems"));
      return;
    }

    startTransition(async () => {
      const res = await createInvoiceCorrection({
        originalInvoiceId: original.id,
        issueDate,
        notes,
        lineItems,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.push(`/dashboard/invoices/${res.id}`);
    });
  }

  const origDate = new Date(original.issueDate).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      {/* ── Header / back link ───────────────────────────────────────────── */}
      <div>
        <Link
          href={`/dashboard/invoices/${original.id}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("backToInvoice")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
      </div>

      {/* ── Reference card: original invoice ─────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-muted/40 px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-muted-foreground mb-2">
          {t("originalInvoice")}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-[11px] text-muted-foreground">{t("ref.number")}</p>
            <p className="font-mono font-medium text-foreground">{original.number}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">{t("ref.date")}</p>
            <p className="font-medium text-foreground tabular-nums">{origDate}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">{t("ref.contact")}</p>
            <p className="font-medium text-foreground truncate">{original.contactName}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">{t("ref.total")}</p>
            <p className="font-medium text-foreground tabular-nums">
              {formatCurrency(original.total)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Meta inputs ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className={LABEL} htmlFor="issueDate">
            {t("fields.issueDate")}
          </label>
          <input
            id="issueDate"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            className={INPUT}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL} htmlFor="notes">
            {t("fields.notes")}
          </label>
          <input
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={INPUT}
          />
        </div>
      </div>

      {/* ── Line items ───────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t("items.title")}</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">{t("items.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={addItem}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("items.add")}
          </button>
        </div>

        {/* Column headers — desktop only */}
        <div className="hidden md:grid md:grid-cols-[1fr_80px_70px_110px_70px_110px_36px] gap-2 px-5 py-2 border-b border-border bg-muted/30 text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">
          <div>{t("items.cols.description")}</div>
          <div className="text-right">{t("items.cols.quantity")}</div>
          <div>{t("items.cols.unit")}</div>
          <div className="text-right">{t("items.cols.unitPrice")}</div>
          <div className="text-right">{t("items.cols.vat")}</div>
          <div className="text-right">{t("items.cols.amount")}</div>
          <div />
        </div>

        <div className="divide-y divide-border">
          {items.map((it, i) => {
            const amount = lineAmount(parseNum(it.quantity), parseNum(it.unitPrice));
            return (
              <div
                key={i}
                className="grid grid-cols-1 md:grid-cols-[1fr_80px_70px_110px_70px_110px_36px] gap-2 px-5 py-2.5"
              >
                <input
                  value={it.description}
                  onChange={(e) => updateItem(i, "description", e.target.value)}
                  placeholder={t("items.cols.description")}
                  className={INPUT}
                />
                <input
                  value={it.quantity}
                  onChange={(e) => updateItem(i, "quantity", e.target.value)}
                  inputMode="decimal"
                  className={`${INPUT} text-right tabular-nums`}
                />
                <input
                  value={it.unit}
                  onChange={(e) => updateItem(i, "unit", e.target.value)}
                  placeholder="Std"
                  className={INPUT}
                />
                <input
                  value={it.unitPrice}
                  onChange={(e) => updateItem(i, "unitPrice", e.target.value)}
                  inputMode="decimal"
                  className={`${INPUT} text-right tabular-nums`}
                />
                {/* VAT is inherited from the original invoice and locked —
                    a correction never changes the tax treatment. */}
                <div
                  className="flex h-9 items-center justify-end px-2.5 text-sm tabular-nums text-muted-foreground"
                  title={t("items.vatLocked")}
                  aria-label={t("items.vatLocked")}
                >
                  {it.vatRate}%
                </div>
                <div className="flex items-center justify-end font-mono text-sm tabular-nums text-foreground px-2.5">
                  {formatCurrency(amount)}
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  aria-label={t("items.remove")}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        {/* ── Totals — the corrected invoice's full subtotal/VAT/total. ── */}
        <div className="px-5 py-4 border-t border-border bg-muted/20">
          <div className="ml-auto max-w-xs space-y-1 text-sm">
            <Row label={t("totals.subtotal")} value={formatCurrency(totals.subtotal)} />
            <Row label={t("totals.tax")} value={formatCurrency(totals.tax)} />
            <div className="border-t border-border pt-2 mt-2 flex items-baseline justify-between gap-3">
              <span className="text-xs font-semibold text-foreground">
                {t("totals.total")}
              </span>
              <span className="text-base font-bold tabular-nums text-foreground">
                {formatCurrency(totals.total)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        {error ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/invoices/${original.id}`}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("cancel")}
          </Link>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/30 transition-all hover:-translate-y-0.5 hover:bg-primary/90 disabled:opacity-50 disabled:translate-y-0"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("submit")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}
