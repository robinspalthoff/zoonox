// Default account-code mappings per chart of accounts (SKR03 / SKR04).
//
// Phase 1 (shadow mode) only needs the minimum to write balanced journal
// entries. Refine in Phase 2 once we read from the journal.

import type { SkrType, VatRegulation } from "@prisma/client";

// ── VAT accounts ────────────────────────────────────────────────────────────

export function inputVatAccount(skr: SkrType, rate: number): string {
  if (skr === "SKR03") {
    if (rate === 7) return "1571";
    if (rate === 19) return "1576";
    return "1570";
  }
  if (rate === 7) return "1401";
  if (rate === 19) return "1406";
  return "1400";
}

export function salesVatAccount(skr: SkrType, rate: number): string {
  if (skr === "SKR03") {
    if (rate === 7) return "1771";
    if (rate === 19) return "1776";
    return "1770";
  }
  if (rate === 7) return "3801";
  if (rate === 19) return "3806";
  return "3800";
}

// ── Revenue / expense / receivables / payables / bank ───────────────────────

export function defaultRevenueAccount(skr: SkrType, rate: number): string {
  if (skr === "SKR03") {
    if (rate === 7) return "8300";
    if (rate === 19) return "8400";
    return "8200";
  }
  if (rate === 7) return "4300";
  if (rate === 19) return "4400";
  return "4200";
}

export function defaultExpenseAccount(skr: SkrType): string {
  // "Sonstige betriebliche Aufwendungen" — used as fallback when no SKR
  // account is assigned to a document line.
  return skr === "SKR03" ? "4900" : "6300";
}

export function receivableAccount(skr: SkrType): string {
  // Forderungen aus Lieferungen und Leistungen
  return skr === "SKR03" ? "1400" : "1200";
}

export function payableAccount(skr: SkrType): string {
  // Verbindlichkeiten aus Lieferungen und Leistungen
  return skr === "SKR03" ? "1600" : "3300";
}

export function bankAccount(skr: SkrType): string {
  // Bank (Geldkonto) — generic default, real bank-account mapping is per
  // BankAccount record and will be added in Phase 2.
  return skr === "SKR03" ? "1200" : "1800";
}

export function cashAccount(skr: SkrType): string {
  return skr === "SKR03" ? "1000" : "1600";
}

// ── VAT codes (used in JournalLine.vatCode for downstream reporting) ────────

export function inputVatCode(rate: number): string {
  return `VSt${rate}`;
}
export function salesVatCode(rate: number): string {
  return `USt${rate}`;
}

// ── Umkehr der Steuerschuld auf der Eingangsseite ───────────────────────────
//
// Bei Reverse Charge (§ 13b UStG) und beim innergemeinschaftlichen Erwerb
// rechnet der Lieferant netto ab. Wir schulden die Umsatzsteuer selbst und
// ziehen sie — bei voller Vorsteuerabzugsberechtigung — im selben Vorgang
// wieder ab. In der Voranmeldung sind das zwei getrennte Kennzahlen:
// die geschuldete Steuer (Abschnitt C bzw. D) und die Vorsteuer (Kz 61/67).
//
// ── Kontonummern: Quellenlage ───────────────────────────────────────────────
//
// SKR03: geprüft gegen DATEV Standardkontenrahmen SKR 03, Art.-Nr. 11174,
//        Stand 2026-01-01, gültig für 2026.
// SKR04: geprüft gegen DATEV Standardkontenrahmen SKR 04, Art.-Nr. 11175,
//        Stand 2026-01-01, gültig für 2026.
//
// Kontenrahmen ändern sich jährlich. Wer diese Nummern anfasst, prüft sie
// gegen den DATEV-Kontenrahmen des jeweiligen Jahres, nicht gegen eine
// beliebige Fundstelle im Netz — Suchtreffer sind oft mehrere Jahre alt.
// Im Stand 2026 sind unter anderem 1405, 1575, 1773, 3803 und 3836 als
// „reserviert" geführt, in älteren Ständen waren sie teilweise belegt.
//
// Benachbarte Nummern bedeuten etwas ganz anderes — hier stolpert man leicht:
//
//   SKR03 1573 = Vorsteuer Dreiecksgeschäft  (igE 19 % ist 1574)
//   SKR03 1772 = USt igE generisch           (igE 19 % ist 1774, nicht 1773)
//   SKR04 1436 = Vorsteuer Dreiecksgeschäft  (igE 19 % ist 1404)
//
// Für den ermäßigten Satz gibt es keine eigenen § 13b-Konten. Dafür sind die
// generischen Konten vorgesehen (SKR03 1578/1785, SKR04 1408/3835); die
// Zuordnung zur Kennzahl der Voranmeldung hängt ohnehin am Steuerschlüssel,
// nicht am Konto.

export type InputVatKindLike =
  | "REVERSE_CHARGE_EU_SERVICE"
  | "REVERSE_CHARGE_OTHER"
  | "REVERSE_CHARGE_GRESTG"
  | "INTRA_COMMUNITY_ACQUISITION"
  | "IMPORT_VAT";

/** Steuerschlüssel der geschuldeten Steuer — trägt Bemessungsgrundlage + Steuer. */
export function reverseChargeVatCode(kind: InputVatKindLike, rate: number): string | null {
  switch (kind) {
    case "REVERSE_CHARGE_EU_SERVICE":
      return `RC13b${rate}`;
    case "REVERSE_CHARGE_OTHER":
      return `RC13bOther${rate}`;
    case "REVERSE_CHARGE_GRESTG":
      return `RC13bGrESt${rate}`;
    case "INTRA_COMMUNITY_ACQUISITION":
      return `IGE${rate}`;
    // Einfuhrumsatzsteuer wird vom Zoll erhoben, nicht von uns geschuldet —
    // es gibt hier keine Gegenbuchung, nur den Vorsteuerabzug.
    case "IMPORT_VAT":
      return null;
  }
}

/** Steuerschlüssel der zugehörigen abziehbaren Vorsteuer. */
export function reverseChargeInputVatCode(kind: InputVatKindLike): string {
  switch (kind) {
    case "INTRA_COMMUNITY_ACQUISITION":
      return "VSt:IGE";
    case "IMPORT_VAT":
      return "VSt:EUSt";
    default:
      return "VSt:13b";
  }
}

/**
 * Konto der geschuldeten Umsatzsteuer aus umgekehrter Steuerschuld.
 *
 * SKR03 (Art.-Nr. 11174, gültig 2026):
 *   1772 Umsatzsteuer aus innergemeinschaftlichem Erwerb
 *   1774 Umsatzsteuer aus innergemeinschaftlichem Erwerb 19 %
 *   1785 Umsatzsteuer nach § 13b UStG
 *   1787 Umsatzsteuer nach § 13b UStG 19 %
 */
export function reverseChargeVatAccount(
  skr: SkrType,
  kind: InputVatKindLike,
  rate: number,
): string {
  const isIgE = kind === "INTRA_COMMUNITY_ACQUISITION";
  if (skr === "SKR03") {
    if (isIgE) return rate === 19 ? "1774" : "1772";
    return rate === 19 ? "1787" : "1785";
  }
  // SKR04 (Art.-Nr. 11175, gültig 2026):
  //   3802 Umsatzsteuer aus innergemeinschaftlichem Erwerb
  //   3804 Umsatzsteuer aus innergemeinschaftlichem Erwerb 19 %
  //   3835 Umsatzsteuer nach § 13b UStG
  //   3837 Umsatzsteuer nach § 13b UStG 19 %
  if (isIgE) return rate === 19 ? "3804" : "3802";
  return rate === 19 ? "3837" : "3835";
}

/**
 * Konto der abziehbaren Vorsteuer aus umgekehrter Steuerschuld.
 *
 * SKR03 (Art.-Nr. 11174, gültig 2026):
 *   1572 Abziehbare Vorsteuer aus innergemeinschaftlichem Erwerb
 *   1574 Abziehbare Vorsteuer aus innergemeinschaftlichem Erwerb 19 %
 *   1577 Abziehbare Vorsteuer nach § 13b UStG 19 %
 *   1578 Abziehbare Vorsteuer nach § 13b UStG
 *   1588 Entstandene Einfuhrumsatzsteuer
 */
export function reverseChargeInputVatAccount(
  skr: SkrType,
  kind: InputVatKindLike,
  rate: number,
): string {
  if (skr === "SKR03") {
    if (kind === "IMPORT_VAT") return "1588";
    if (kind === "INTRA_COMMUNITY_ACQUISITION") return rate === 19 ? "1574" : "1572";
    return rate === 19 ? "1577" : "1578";
  }
  // SKR04 (Art.-Nr. 11175, gültig 2026):
  //   1402 Abziehbare Vorsteuer aus innergemeinschaftlichem Erwerb
  //   1404 Abziehbare Vorsteuer aus innergemeinschaftlichem Erwerb 19 %
  //   1407 Abziehbare Vorsteuer nach § 13b UStG 19 %
  //   1408 Abziehbare Vorsteuer nach § 13b UStG   (1405 ist reserviert!)
  //   1433 Entstandene Einfuhrumsatzsteuer
  if (kind === "IMPORT_VAT") return "1433";
  if (kind === "INTRA_COMMUNITY_ACQUISITION") return rate === 19 ? "1404" : "1402";
  return rate === 19 ? "1407" : "1408";
}

// ── Tax-free / special-regime VAT regulations ───────────────────────────────
// Non-STANDARD invoices carry 0% VAT but still need to surface as turnover
// in specific UStVA Kennzahlen. We tag the revenue journal line with a
// regulation-specific code (`USt0:<TAG>`) so the VAT-return report can
// bucket them separately instead of dropping them as "no VAT, no relevance".
//
// The TAG suffix maps 1:1 to the VatRegulation enum (sans STANDARD/SMALL_BUSINESS_19,
// which are handled in their own code paths).

export type RegulationTag = "IG" | "EXP" | "NDS" | "13b" | "18b" | "TE4" | "OSS";

const REGULATION_TAGS: Partial<Record<VatRegulation, RegulationTag>> = {
  INTRA_COMMUNITY_DELIVERY: "IG",
  EXPORT: "EXP",
  NON_DOMESTIC_SERVICE: "NDS",
  REVERSE_CHARGE_13B: "13b",
  REVERSE_CHARGE_18B: "18b",
  TAX_EXEMPT_4: "TE4",
  OSS: "OSS",
};

/** Tag for the sales-side journal line. Returns null for STANDARD/SMALL_BUSINESS. */
export function salesVatCodeForRegulation(reg: VatRegulation): string | null {
  const tag = REGULATION_TAGS[reg];
  return tag ? `USt0:${tag}` : null;
}

/** Parse "USt0:IG" → "IG". Returns null for unrecognized codes. */
export function regulationTagFromCode(code: string): RegulationTag | null {
  const m = code.match(/^USt0:([A-Za-z0-9]+)$/);
  if (!m) return null;
  const tag = m[1] as RegulationTag;
  return (Object.values(REGULATION_TAGS) as RegulationTag[]).includes(tag) ? tag : null;
}

/**
 * SKR-specific revenue account for non-STANDARD regulations.
 *
 * Mapping based on common SKR03/SKR04 conventions for steuerfreie Umsätze:
 * - SKR03 8125 / SKR04 4125 — Steuerfreie innergem. Lieferungen § 4 Nr.1b
 * - SKR03 8120 / SKR04 4120 — Steuerfreie Umsätze § 4 Nr.1a (Ausfuhren)
 * - SKR03 8336 / SKR04 4336 — Erlöse aus im Inland nicht steuerbaren Leistungen
 *                              (§ 18b — sonstige Leistung an EU-Unternehmer)
 * - SKR03 8337 / SKR04 4337 — Erlöse aus Leistungen, für die der Leistungsempfänger
 *                              die Steuer schuldet (§ 13b — domestic reverse charge)
 * - SKR03 8338 / SKR04 4338 — Steuerfreie Umsätze ohne Vorsteuerabzug (§ 4 Nr.8 ff.)
 *
 * Falls die Regelung STANDARD/Kleinunternehmer ist oder unbekannt → null
 * (Caller falls back to `defaultRevenueAccount`).
 */
export function revenueAccountForRegulation(
  skr: SkrType,
  reg: VatRegulation,
): string | null {
  if (skr === "SKR03") {
    switch (reg) {
      case "INTRA_COMMUNITY_DELIVERY": return "8125";
      case "EXPORT":                    return "8120";
      case "NON_DOMESTIC_SERVICE":
      case "REVERSE_CHARGE_18B":        return "8336";
      case "REVERSE_CHARGE_13B":        return "8337";
      case "TAX_EXEMPT_4":              return "8338";
      // OSS — destination-state VAT; for now keep on generic 0% account.
      default:                          return null;
    }
  }
  // SKR04
  switch (reg) {
    case "INTRA_COMMUNITY_DELIVERY": return "4125";
    case "EXPORT":                    return "4120";
    case "NON_DOMESTIC_SERVICE":
    case "REVERSE_CHARGE_18B":        return "4336";
    case "REVERSE_CHARGE_13B":        return "4337";
    case "TAX_EXEMPT_4":              return "4338";
    default:                          return null;
  }
}

// ── Account classification (for report aggregation) ─────────────────────────
// Report aggregations need to tell a revenue line apart from a receivable
// line apart from an expense line, given only the accountCode string.
// The rules are coarse but match SKR03/SKR04 ranges for the accounts we
// actually post to today.

export type AccountClass =
  | "REVENUE"
  | "EXPENSE"
  | "RECEIVABLE"
  | "PAYABLE"
  | "BANK"
  | "INPUT_VAT"
  | "SALES_VAT"
  | "OTHER";

export function classifyAccount(code: string, skr: SkrType): AccountClass {
  const n = Number(code);
  if (!Number.isFinite(n)) return "OTHER";

  if (skr === "SKR03") {
    if (code === "1400") return "RECEIVABLE";
    if (code === "1600") return "PAYABLE";
    if (code === "1000" || code === "1200") return "BANK";
    if (n >= 1570 && n <= 1599) return "INPUT_VAT";
    if (n >= 1770 && n <= 1799) return "SALES_VAT";
    if (n >= 8000 && n <= 8999) return "REVENUE"; // includes 8120/8125/8336/8337/8338 (steuerfreie Erlöse)
    if (n >= 3000 && n <= 7999) return "EXPENSE";
    return "OTHER";
  }
  // SKR04
  if (code === "1200") return "RECEIVABLE";
  if (code === "3300") return "PAYABLE";
  if (code === "1600" || code === "1800") return "BANK";
  if (n >= 1400 && n <= 1499) return "INPUT_VAT";
  if (n >= 3800 && n <= 3899) return "SALES_VAT";
  if (n >= 4000 && n <= 4999) return "REVENUE";
  if (n >= 5000 && n <= 7999) return "EXPENSE";
  return "OTHER";
}
