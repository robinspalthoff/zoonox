/**
 * E-Invoice Types — XRechnung / ZUGFeRD
 *
 * Based on EN 16931:2017 (European e-invoice standard)
 * Applicable German law: E-Rechnungsverordnung, §14 UStG, GoBD
 */

import type { Invoice, InvoiceLineItem, Contact, CompanySettings } from "@prisma/client";

// ─── Extended Invoice type with optional creditNoteFor relation ───────────────
// The base Prisma Invoice type only has creditNoteForId (scalar). The relation
// creditNoteFor is loaded separately via include and may be present or absent.
type CreditNoteForRef = { number: string; issueDate: Date } | null;

// ─── Format Selection ─────────────────────────────────────────────────────────

/** E-invoice output format. ZUGFeRD = hybrid PDF/A-3 + XML; XRECHNUNG = pure UBL XML (B2G) */
export type EInvoiceFormat = "ZUGFERD" | "XRECHNUNG";

/**
 * ZUGFeRD profile levels.
 * EN16931 = COMFORT level — broadest B2B/B2G compatibility, recommended default.
 */
export type ZugferdProfile = "MINIMUM" | "BASIC_WL" | "BASIC" | "EN16931" | "EXTENDED";

// ─── Input ────────────────────────────────────────────────────────────────────

export type InvoiceWithRelations = Invoice & {
  contact: Contact;
  lineItems: InvoiceLineItem[];
  /** Loaded when invoice is a credit note — the original invoice being credited */
  creditNoteFor?: CreditNoteForRef;
};

export interface EInvoiceGeneratorInput {
  invoice: InvoiceWithRelations;
  settings: CompanySettings;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface EInvoiceValidationError {
  /** Prisma field name or logical field name */
  field: string;
  /** Human-readable German error message */
  message: string;
  /** EN 16931 Business Term reference, e.g. "BT-31" */
  bt?: string;
  /** Severity: blocking = cannot generate XML */
  severity: "error" | "warning";
}

export interface EInvoiceValidationResult {
  valid: boolean;
  errors: EInvoiceValidationError[];
}

// ─── Tax / VAT ────────────────────────────────────────────────────────────────

/**
 * EN 16931 VAT category codes (BT-118).
 * S = Standard, Z = Zero rated, E = Exempt, AE = Reverse charge,
 * K = Intra-community, G = Export, O = Out of scope
 */
export type VatCategoryCode = "S" | "Z" | "E" | "AE" | "K" | "G" | "O";

export interface TaxGroup {
  vatRate: number;
  categoryCode: VatCategoryCode;
  netAmount: number;
  taxAmount: number;
}

// ─── Unit Codes (UNECE Rec 20) ────────────────────────────────────────────────

/**
 * Maps German unit labels to UNECE Recommendation 20 unit codes.
 * Required by EN 16931 for BT-130.
 */
export const UNIT_CODE_MAP: Record<string, string> = {
  "Stk.": "C62",     // piece / unit
  "Std.": "HUR",     // hour
  "Tage": "DAY",     // day
  "Monat": "MON",    // month
  "kg": "KGM",       // kilogram
  "m": "MTR",        // metre
  "m²": "MTK",       // square metre
  "m³": "MTQ",       // cubic metre
  "l": "LTR",        // litre
  "km": "KMT",       // kilometre
  "pauschal": "LS",  // lump sum
};

export function getUnitCode(unit: string | null | undefined): string {
  if (!unit) return "C62"; // default: piece
  return UNIT_CODE_MAP[unit] ?? "C62";
}

// ─── VAT Category Mapping ─────────────────────────────────────────────────────

/**
 * Returns the EN 16931 VAT category code (BT-118/BT-151) based on the
 * VAT rate and the invoice's VAT regulation.
 *
 * Codes per EN 16931:
 *   S  = Standard rated (19%, 7%)
 *   Z  = Zero rated
 *   E  = Exempt from VAT (§4 UStG)
 *   AE = Reverse charge (§13b, §18b UStG)
 *   K  = Intra-community supply (§4 Nr. 1b i.V.m. §6a UStG)
 *   G  = Export / free export item (§4 Nr. 1a i.V.m. §6 UStG)
 *   O  = Services outside scope of tax (§3a UStG)
 */
export function getVatCategoryCode(
  vatRate: number,
  vatRegulation?: string | null
): VatCategoryCode {
  switch (vatRegulation) {
    case "SMALL_BUSINESS_19":
      return "E";
    case "TAX_EXEMPT_4":
      return "E";
    case "REVERSE_CHARGE_13B":
    case "REVERSE_CHARGE_18B":
      return "AE";
    case "INTRA_COMMUNITY_DELIVERY":
      return "K";
    case "EXPORT":
      return "G";
    case "NON_DOMESTIC_SERVICE":
      return "O";
    case "OSS":
      // OSS uses standard rating with the destination country's rate
      return vatRate > 0 ? "S" : "Z";
    case "STANDARD":
    default:
      return vatRate > 0 ? "S" : "Z";
  }
}

/**
 * Returns the EN 16931 VAT exemption reason text (BT-120) for non-standard
 * VAT regulations. Required by EN 16931 when category is E, AE, K, G, or O.
 */
export function getVatExemptionReason(vatRegulation?: string | null): string | null {
  switch (vatRegulation) {
    case "SMALL_BUSINESS_19":
      return "Gemäß §19 UStG wird keine Umsatzsteuer berechnet";
    case "TAX_EXEMPT_4":
      return "Umsatzsteuerfreie Leistung gemäß §4 UStG";
    case "REVERSE_CHARGE_13B":
      return "Steuerschuldnerschaft des Leistungsempfängers gemäß §13b UStG";
    case "REVERSE_CHARGE_18B":
      return "Steuerschuldnerschaft des Leistungsempfängers gemäß §18b UStG";
    case "INTRA_COMMUNITY_DELIVERY":
      return "Steuerfreie innergemeinschaftliche Lieferung gemäß §4 Nr. 1b i.V.m. §6a UStG";
    case "EXPORT":
      return "Steuerfreie Ausfuhrlieferung gemäß §4 Nr. 1a i.V.m. §6 UStG";
    case "NON_DOMESTIC_SERVICE":
      return "Leistung nicht im Inland steuerbar gemäß §3a UStG";
    default:
      return null;
  }
}

// ─── ZUGFeRD Profile Identifiers ─────────────────────────────────────────────

export const ZUGFERD_PROFILE_IDS: Record<ZugferdProfile, string> = {
  MINIMUM:
    "urn:factur-x.eu:1p0:minimum",
  BASIC_WL:
    "urn:factur-x.eu:1p0:basicwl",
  BASIC:
    "urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic",
  EN16931:
    "urn:cen.eu:en16931:2017",
  EXTENDED:
    "urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended",
};

/** XRechnung 3.0 customization ID (UBL 2.1) */
export const XRECHNUNG_CUSTOMIZATION_ID =
  "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";

export const XRECHNUNG_PROFILE_ID =
  "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
