// Shared VAT regulation configuration — single source of truth.
// Used in: invoice form, invoice preview, invoice PDF, actions.

export type VatRegulationId =
  | "STANDARD"
  | "SMALL_BUSINESS_19"
  | "TAX_EXEMPT_4"
  | "REVERSE_CHARGE_13B"
  | "REVERSE_CHARGE_18B"
  | "INTRA_COMMUNITY_DELIVERY"
  | "OSS"
  | "EXPORT"
  | "NON_DOMESTIC_SERVICE";

export type VatRegulationGroup = "domestic" | "eu" | "nonEu" | "smallBusiness";

export interface VatRegulationConfig {
  id: VatRegulationId;
  group: VatRegulationGroup;
  /** Whether the user can still choose VAT rates per line item */
  vatEditable: boolean;
  /** If vatEditable is false, force all line items to this rate */
  forcedVatRate: number;
  /** i18n key for the label (under invoices.vatRegulation.options) */
  labelKey: string;
  /** i18n key for the tooltip (under invoices.vatRegulation.tooltips) */
  tooltipKey: string;
  /** i18n key for the legal notice printed on the invoice (under invoices.vatRegulation.legalNotice) */
  legalNoticeKey: string | null;
}

export const VAT_REGULATIONS: VatRegulationConfig[] = [
  // ── Kleinunternehmer (only shown when taxMode = SMALL_BUSINESS) ──────────
  {
    id: "SMALL_BUSINESS_19",
    group: "smallBusiness",
    vatEditable: false,
    forcedVatRate: 0,
    labelKey: "smallBusiness19",
    tooltipKey: "smallBusiness19",
    legalNoticeKey: "smallBusiness19",
  },

  // ── Domestic (Germany) ────────────────────────────────────────────────────
  {
    id: "STANDARD",
    group: "domestic",
    vatEditable: true,
    forcedVatRate: 0,
    labelKey: "standard",
    tooltipKey: "standard",
    legalNoticeKey: null,
  },
  {
    id: "TAX_EXEMPT_4",
    group: "domestic",
    vatEditable: false,
    forcedVatRate: 0,
    labelKey: "taxExempt4",
    tooltipKey: "taxExempt4",
    legalNoticeKey: "taxExempt4",
  },
  {
    id: "REVERSE_CHARGE_13B",
    group: "domestic",
    vatEditable: false,
    forcedVatRate: 0,
    labelKey: "reverseCharge13b",
    tooltipKey: "reverseCharge13b",
    legalNoticeKey: "reverseCharge13b",
  },

  // ── EU ─────────────────────────────────────────────────────────────────────
  {
    id: "REVERSE_CHARGE_18B",
    group: "eu",
    vatEditable: false,
    forcedVatRate: 0,
    labelKey: "reverseCharge18b",
    tooltipKey: "reverseCharge18b",
    legalNoticeKey: "reverseCharge18b",
  },
  {
    id: "INTRA_COMMUNITY_DELIVERY",
    group: "eu",
    // Innergem. Lieferung (§ 4 Nr.1b i.V.m. § 6a UStG) ist immer steuerfrei —
    // USt-Satz auf 0 % erzwingen, analog zu Reverse-Charge §13b/§18b.
    // (OSS bleibt editable, weil der Satz vom Zielland abhängt.)
    vatEditable: false,
    forcedVatRate: 0,
    labelKey: "intraCommunityDelivery",
    tooltipKey: "intraCommunityDelivery",
    legalNoticeKey: "intraCommunityDelivery",
  },
  {
    id: "OSS",
    group: "eu",
    vatEditable: true,
    forcedVatRate: 0,
    labelKey: "oss",
    tooltipKey: "oss",
    legalNoticeKey: "oss",
  },

  // ── Non-EU ─────────────────────────────────────────────────────────────────
  {
    id: "EXPORT",
    group: "nonEu",
    vatEditable: false,
    forcedVatRate: 0,
    labelKey: "export",
    tooltipKey: "export",
    legalNoticeKey: "export",
  },
  {
    id: "NON_DOMESTIC_SERVICE",
    group: "nonEu",
    vatEditable: false,
    forcedVatRate: 0,
    labelKey: "nonDomesticService",
    tooltipKey: "nonDomesticService",
    legalNoticeKey: "nonDomesticService",
  },
];

export const VAT_REGULATION_MAP = Object.fromEntries(
  VAT_REGULATIONS.map((r) => [r.id, r])
) as Record<VatRegulationId, VatRegulationConfig>;

export const VAT_REGULATION_GROUPS: { key: VatRegulationGroup; i18nKey: string }[] = [
  { key: "smallBusiness", i18nKey: "smallBusiness" },
  { key: "domestic", i18nKey: "domestic" },
  { key: "eu", i18nKey: "eu" },
  { key: "nonEu", i18nKey: "nonEu" },
];
