"use client";

/**
 * Quote → AB partial-conversion modal.
 *
 * Lets the user pick a subset of the quote's positions (default: all) and
 * optionally override quantities before generating the Auftragsbestätigung.
 * Useful when a customer accepts an offer "for parts X+Z only" or wants a
 * smaller quantity than the original tender. Unit price, VAT rate and unit
 * stay fixed — touching pricing would mean a re-quote, not a conversion.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileSignature, X } from "lucide-react";
import {
  getQuoteLineItemsForConversion,
  convertQuoteToOrderConfirmation,
  type LineItemOverride,
} from "../actions";

interface QuoteLine {
  id: string;
  position: number;
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  vatRate: number;
  amount: number;
}

const fmtCur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

export function ConvertToOCModal({
  quoteId,
  quoteNumber,
  onClose,
}: {
  quoteId: string;
  quoteNumber: string;
  onClose: () => void;
}) {
  const t = useTranslations("quotes");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<QuoteLine[] | null>(null);
  // Per-line state: selected (boolean) + quantity override (string for the
  // input). Stored separately from `lines` so we can render the original
  // values next to the edit fields.
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [qtyOverride, setQtyOverride] = useState<Record<string, string>>({});

  // Load the line items on mount. Cheap server fetch — same data the form
  // would query for "edit", but client-side so the modal opens instantly.
  useEffect(() => {
    let cancelled = false;
    getQuoteLineItemsForConversion(quoteId).then((rows) => {
      if (cancelled) return;
      setLines(rows);
      // Default selection: everything checked. Most conversions are
      // full conversions; the modal exists for the "edit before
      // converting" minority.
      const sel: Record<string, boolean> = {};
      const qty: Record<string, string> = {};
      for (const li of rows) {
        sel[li.id] = true;
        qty[li.id] = String(li.quantity);
      }
      setSelected(sel);
      setQtyOverride(qty);
    });
    return () => { cancelled = true; };
  }, [quoteId]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !isPending) onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, isPending]);

  // Recompute totals live from the *current* selection — gives the user a
  // sanity check before they hit "Erstellen".
  const totals = lines
    ? lines.reduce(
        (acc, li) => {
          if (!selected[li.id]) return acc;
          const qty = parseFloat(qtyOverride[li.id]?.replace(",", ".") ?? "") || 0;
          const amount = qty * li.unitPrice;
          return {
            subtotal: acc.subtotal + amount,
            tax: acc.tax + amount * (li.vatRate / 100),
          };
        },
        { subtotal: 0, tax: 0 },
      )
    : { subtotal: 0, tax: 0 };
  const total = totals.subtotal + totals.tax;

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const allSelected = lines && selectedCount === lines.length;
  const noneSelected = selectedCount === 0;

  function toggleAll() {
    if (!lines) return;
    const next: Record<string, boolean> = {};
    const target = !allSelected;
    for (const li of lines) next[li.id] = target;
    setSelected(next);
  }

  function handleConfirm() {
    if (!lines) return;
    setError(null);

    // Build the selection map the server action expects. We only include
    // selected lines; for each one we pass the *override* quantity when
    // the user changed it, otherwise null so the server uses the original.
    const selection: Record<string, LineItemOverride> = {};
    for (const li of lines) {
      if (!selected[li.id]) continue;
      const raw = qtyOverride[li.id]?.replace(",", ".") ?? "";
      const parsed = parseFloat(raw);
      if (!(parsed > 0)) {
        setError(t("convert.invalidQuantity", { position: li.position }));
        return;
      }
      // Only treat it as an override when it's *actually* different — keeps
      // the server-side audit detail clean ("partial" = positions dropped
      // and/or quantities changed; identical values mean no override).
      const isDifferent = Math.abs(parsed - li.quantity) > 0.0001;
      selection[li.id] = { quantity: isDifferent ? parsed : null };
    }

    startTransition(async () => {
      const res = await convertQuoteToOrderConfirmation(quoteId, selection);
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.push(`/dashboard/order-confirmations/${res.id}`);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={!isPending ? onClose : undefined} />
      <div className="relative z-10 bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <FileSignature className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">{t("convert.title")}</h2>
              <p className="text-xs text-muted-foreground">{t("convert.subtitle", { number: quoteNumber })}</p>
            </div>
          </div>
          <button onClick={onClose} disabled={isPending} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {lines === null ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t("convert.loading")}</p>
          ) : lines.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t("convert.noLines")}</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-muted-foreground">{t("convert.hint")}</p>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {allSelected ? t("convert.deselectAll") : t("convert.selectAll")}
                </button>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs w-10"></th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">{t("lineItems.description")}</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground text-xs w-32">{t("convert.quantity")}</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground text-xs w-28">{t("lineItems.unitPrice")}</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground text-xs w-28">{t("lineItems.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((li) => {
                      const isSelected = !!selected[li.id];
                      const qty = parseFloat(qtyOverride[li.id]?.replace(",", ".") ?? "") || 0;
                      const amount = qty * li.unitPrice;
                      return (
                        <tr key={li.id} className={`border-t border-border ${!isSelected ? "opacity-50" : ""}`}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) =>
                                setSelected((s) => ({ ...s, [li.id]: e.target.checked }))
                              }
                              className="h-4 w-4 rounded border-border accent-primary"
                            />
                          </td>
                          <td className="px-3 py-2 text-foreground">
                            <p className="font-medium">{li.description}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                              {t("convert.original")}: {li.quantity.toLocaleString("de-DE")}{li.unit ? ` ${li.unit}` : ""}
                            </p>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="text"
                              value={qtyOverride[li.id] ?? ""}
                              disabled={!isSelected}
                              onChange={(e) =>
                                setQtyOverride((q) => ({ ...q, [li.id]: e.target.value }))
                              }
                              className="w-full px-2 py-1 text-sm bg-muted border border-border rounded-md text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {fmtCur(li.unitPrice)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium text-foreground">
                            {isSelected ? fmtCur(amount) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Live totals — recomputed from the *current* selection */}
              <div className="mt-4 flex justify-end">
                <div className="w-64 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("summary.subtotal")}</span>
                    <span className="tabular-nums">{fmtCur(totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">MwSt.</span>
                    <span className="tabular-nums">{fmtCur(totals.tax)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-base border-t border-border pt-2 mt-2">
                    <span>{t("summary.total")}</span>
                    <span className="tabular-nums text-primary">{fmtCur(total)}</span>
                  </div>
                </div>
              </div>

              {error && (
                <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 mt-4">{error}</p>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 justify-end p-6 border-t border-border">
          <button onClick={onClose} disabled={isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-foreground hover:bg-accent transition-colors disabled:opacity-50">
            {t("convert.cancel")}
          </button>
          <button onClick={handleConfirm} disabled={isPending || noneSelected || lines === null}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50">
            <FileSignature className="w-4 h-4" />
            {isPending ? t("convert.creating") : t("convert.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
