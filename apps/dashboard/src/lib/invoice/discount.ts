/**
 * Geteilte Rabatt-Logik für Rechnungen, Angebote und Auftragsbestätigungen.
 *
 * Zwei Ebenen:
 *  1) Positions-Rabatt: applyLineDiscount(qty, unitPrice, type, value) → Netto
 *     pro Position. Wird in `lineItem.amount` persistiert — Source of Truth
 *     fürs Journal.
 *  2) Gesamtrabatt: applyGlobalDiscount(subtotalBeforeDiscount, type, value)
 *     → Rabatt-Euro auf die Summe der Positions-Beträge. Steuer wird auf den
 *     rabattierten Netto-Betrag erhoben; bei mehreren MwSt-Sätzen wird der
 *     Rabatt proportional über die Steuergruppen verteilt, damit jede Gruppe
 *     korrekt skaliert ist.
 *
 * Server (actions.ts) und UI (Form-Live-Berechnung, PDF/HTML-Preview) teilen
 * sich exakt diese Funktionen — sonst driften Anzeige und gespeicherte
 * subtotal/taxAmount/total auseinander.
 */

export type DiscountType = "percent" | "amount" | null | undefined;

/** Auf 2 Nachkomma-Cent runden. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Positions-Netto = qty × unitPrice abzgl. Positions-Rabatt.
 * Resultat ist ≥ 0 (Rabatt kann den Beleg nicht unter null drücken).
 */
export function applyLineDiscount(
  quantity: number,
  unitPrice: number,
  type: DiscountType,
  value: number | string | null | undefined,
): number {
  const base = quantity * unitPrice;
  const v = typeof value === "string" ? parseFloat(value.replace(",", ".")) : Number(value ?? 0);
  if (!type || type === undefined || !Number.isFinite(v) || v <= 0) {
    return round2(base);
  }
  if (type === "percent") {
    const pct = Math.min(Math.max(v, 0), 100);
    return round2(base * (1 - pct / 100));
  }
  // amount: Euro-Abzug, mind. 0
  return round2(Math.max(0, base - v));
}

/**
 * Resultat-Euro des Gesamtrabatts auf den Netto-Subtotal (Summe der bereits
 * positions-rabattierten amounts). Resultat ist 0..subtotal.
 */
export function applyGlobalDiscount(
  subtotalBeforeDiscount: number,
  type: DiscountType,
  value: number | string | null | undefined,
): number {
  const v = typeof value === "string" ? parseFloat(value.replace(",", ".")) : Number(value ?? 0);
  if (!type || !Number.isFinite(v) || v <= 0 || subtotalBeforeDiscount <= 0) return 0;
  if (type === "percent") {
    const pct = Math.min(Math.max(v, 0), 100);
    return round2(subtotalBeforeDiscount * (pct / 100));
  }
  return round2(Math.min(subtotalBeforeDiscount, v));
}

export interface LineTotal {
  /** Netto-Betrag nach Positions-Rabatt, vor Gesamtrabatt. */
  amount: number;
  vatRate: number;
}

export interface DocumentTotals {
  /** Σ amount nach Positions-Rabatt, vor Gesamtrabatt. */
  subtotalBeforeDiscount: number;
  /** Gesamtrabatt in Euro (0 falls keiner gesetzt). */
  discountAmount: number;
  /** Netto-Subtotal nach Gesamtrabatt — Basis für die Steuerberechnung und für `Invoice.subtotal`. */
  subtotal: number;
  /** Σ Steuer (auf rabattierten Netto). */
  taxAmount: number;
  /** Brutto = subtotal + taxAmount. */
  total: number;
  /** Steuer pro vatRate (rabattiert), für PDF-Breakdown. */
  taxGroups: Record<number, number>;
  /** Netto pro vatRate (rabattiert), für Konsistenzprüfungen. */
  netGroups: Record<number, number>;
}

/**
 * Aggregiert Positions-Beträge zu Dokument-Totals inkl. Gesamtrabatt.
 *
 * Allokations-Logik bei mehreren VAT-Sätzen: der prozentuale Discount-Faktor
 * (discountAmount / subtotalBeforeDiscount) wird auf JEDE Steuergruppe
 * angewandt. Damit bleibt das Verhältnis der Gruppen konstant — wichtig für
 * korrekte MwSt-Breakdown im PDF.
 */
export function computeDocumentTotals(
  lines: LineTotal[],
  globalDiscountType: DiscountType,
  globalDiscountValue: number | string | null | undefined,
): DocumentTotals {
  const netGroupsRaw: Record<number, number> = {};
  for (const li of lines) {
    netGroupsRaw[li.vatRate] = (netGroupsRaw[li.vatRate] ?? 0) + li.amount;
  }
  const subtotalBeforeDiscount = round2(
    Object.values(netGroupsRaw).reduce((s, v) => s + v, 0),
  );
  const discountAmount = applyGlobalDiscount(
    subtotalBeforeDiscount,
    globalDiscountType,
    globalDiscountValue,
  );
  const factor =
    subtotalBeforeDiscount > 0 ? (subtotalBeforeDiscount - discountAmount) / subtotalBeforeDiscount : 1;

  const netGroups: Record<number, number> = {};
  const taxGroups: Record<number, number> = {};
  let subtotal = 0;
  let taxAmount = 0;
  for (const [rateStr, rawNet] of Object.entries(netGroupsRaw)) {
    const rate = Number(rateStr);
    const net = round2(rawNet * factor);
    const tax = round2(net * (rate / 100));
    netGroups[rate] = net;
    taxGroups[rate] = tax;
    subtotal += net;
    taxAmount += tax;
  }
  subtotal = round2(subtotal);
  taxAmount = round2(taxAmount);
  const total = round2(subtotal + taxAmount);

  return {
    subtotalBeforeDiscount,
    discountAmount,
    subtotal,
    taxAmount,
    total,
    taxGroups,
    netGroups,
  };
}
