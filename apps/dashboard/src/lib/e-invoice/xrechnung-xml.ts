/**
 * XRechnung 3.0 XML Generator — UBL 2.1 Format
 *
 * XRechnung is the mandatory format for invoices sent to German federal, state,
 * and municipal authorities (B2G — Business to Government).
 *
 * Legal basis:
 *  - E-Rechnungsverordnung des Bundes (ERechV)
 *  - EU Directive 2014/55/EU
 *  - EN 16931:2017
 *
 * Format: UBL 2.1 (OASIS Universal Business Language)
 * Profile: XRechnung 3.0 (KOSIT)
 * Customization ID: urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0
 *
 * Mandatory for B2G: Leitweg-ID must be provided in invoice.leitwegId
 * Transmission: Usually via Peppol network (not email) — plan provider integration
 */

import { create } from "xmlbuilder2";
import type { EInvoiceGeneratorInput, TaxGroup } from "./types";
import {
  getVatCategoryCode,
  getVatExemptionReason,
  getUnitCode,
  XRECHNUNG_CUSTOMIZATION_ID,
  XRECHNUNG_PROFILE_ID,
} from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format date as YYYY-MM-DD (ISO 8601 — UBL uses this, not format="102") */
function fmtDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fmtAmt(value: unknown): string {
  return Number(value).toFixed(2);
}

function fmtQty(value: unknown): string {
  return Number(value).toFixed(3).replace(/\.?0+$/, "") || "0";
}

function groupByVatRate(
  lineItems: EInvoiceGeneratorInput["invoice"]["lineItems"],
  vatRegulation?: string | null
): TaxGroup[] {
  const map = new Map<number, TaxGroup>();
  for (const item of lineItems) {
    const rate = item.vatRate;
    const net = Number(item.amount);
    const tax = Math.round(net * (rate / 100) * 100) / 100;
    if (map.has(rate)) {
      const g = map.get(rate)!;
      g.netAmount = Math.round((g.netAmount + net) * 100) / 100;
      g.taxAmount = Math.round((g.taxAmount + tax) * 100) / 100;
    } else {
      map.set(rate, {
        vatRate: rate,
        categoryCode: getVatCategoryCode(rate, vatRegulation),
        netAmount: net,
        taxAmount: tax,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.vatRate - a.vatRate);
}

// ─── Main Generator ───────────────────────────────────────────────────────────

/**
 * Generates an XRechnung 3.0 XML string in UBL 2.1 format.
 *
 * For B2G invoices only. For B2B, use generateZugferdXml() instead.
 * The Leitweg-ID (invoice.leitwegId) is required and goes into BuyerReference (BT-10).
 */
export function generateXrechnungXml(input: EInvoiceGeneratorInput): string {
  const { invoice, settings } = input;
  const { contact: client, lineItems } = invoice;

  const isCreditNote = invoice.type === "CREDIT_NOTE";
  const vatRegulation = (invoice as any).vatRegulation ?? "STANDARD";
  const taxGroups = groupByVatRate(lineItems, vatRegulation);
  const exemptionReason = getVatExemptionReason(vatRegulation);

  // ── Root ─────────────────────────────────────────────────────────────────────
  const ns = {
    "xmlns:ubl": isCreditNote
      ? "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
      : "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    "xmlns:cac":
      "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "xmlns:cbc":
      "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  };

  const rootTag = isCreditNote ? "ubl:CreditNote" : "ubl:Invoice";
  const lineTag = isCreditNote
    ? "cac:CreditNoteLine"
    : "cac:InvoiceLine";
  const qtyTag = isCreditNote
    ? "cbc:CreditedQuantity"
    : "cbc:InvoicedQuantity";

  const root = create({ version: "1.0", encoding: "UTF-8" }).ele(rootTag, ns);

  // ── Header ───────────────────────────────────────────────────────────────────
  root.ele("cbc:CustomizationID").txt(XRECHNUNG_CUSTOMIZATION_ID); // BT-24
  root.ele("cbc:ProfileID").txt(XRECHNUNG_PROFILE_ID);             // BT-23
  root.ele("cbc:ID").txt(invoice.number);                           // BT-1
  root.ele("cbc:IssueDate").txt(fmtDate(invoice.issueDate));        // BT-2

  if (invoice.dueDate) {
    root.ele("cbc:DueDate").txt(fmtDate(invoice.dueDate));          // BT-9
  }

  // BT-3: type code — 380 Invoice, 381 Credit Note
  if (!isCreditNote) {
    root.ele("cbc:InvoiceTypeCode").txt("380");
  }

  root.ele("cbc:DocumentCurrencyCode").txt("EUR");                  // BT-5

  // BT-10: Buyer reference — mandatory for XRechnung / B2G
  const buyerRef =
    invoice.leitwegId?.trim() || invoice.buyerReference?.trim();
  if (buyerRef) {
    root.ele("cbc:BuyerReference").txt(buyerRef);
  }

  // BT-25/BT-26: Preceding invoice reference for credit notes
  if (isCreditNote && invoice.creditNoteFor) {
    const billingRef = root.ele("cac:BillingReference");
    const invoiceDocRef = billingRef.ele("cac:InvoiceDocumentReference");
    invoiceDocRef
      .ele("cbc:ID")
      .txt(invoice.creditNoteFor.number ?? invoice.creditNoteForId ?? "");
    if (invoice.creditNoteFor.issueDate) {
      invoiceDocRef
        .ele("cbc:IssueDate")
        .txt(fmtDate(invoice.creditNoteFor.issueDate));
    }
  }

  // ── Seller (BG-4) ────────────────────────────────────────────────────────────
  const sellerParty = root
    .ele("cac:AccountingSupplierParty")
    .ele("cac:Party");

  // BT-34: Seller electronic address (required for XRechnung — use email)
  if (settings.email?.trim()) {
    sellerParty
      .ele("cbc:EndpointID", { schemeID: "EM" })
      .txt(settings.email);
  }

  const sellerName = sellerParty.ele("cac:PartyName");
  sellerName.ele("cbc:Name").txt(settings.name ?? "");             // BT-27

  const sellerAddr = sellerParty.ele("cac:PostalAddress");
  if (settings.address?.trim()) {
    sellerAddr.ele("cbc:StreetName").txt(settings.address);        // BT-35
  }
  if (settings.zip?.trim()) {
    sellerAddr.ele("cbc:PostalZone").txt(settings.zip);            // BT-38
  }
  if (settings.city?.trim()) {
    sellerAddr.ele("cbc:CityName").txt(settings.city);             // BT-37
  }
  sellerAddr
    .ele("cac:Country")
    .ele("cbc:IdentificationCode")
    .txt(settings.country || "DE");                                // BT-40

  const sellerTaxScheme = sellerParty.ele("cac:PartyTaxScheme");
  if (settings.vatId?.trim()) {
    sellerTaxScheme.ele("cbc:CompanyID").txt(settings.vatId);      // BT-31
    sellerTaxScheme.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT");
  } else if (settings.taxId?.trim()) {
    sellerTaxScheme.ele("cbc:CompanyID").txt(settings.taxId);      // BT-32
    sellerTaxScheme.ele("cac:TaxScheme").ele("cbc:ID").txt("FC");
  }

  sellerParty
    .ele("cac:PartyLegalEntity")
    .ele("cbc:RegistrationName")
    .txt(settings.name ?? "");                                     // BT-27

  // ── Buyer (BG-7) ─────────────────────────────────────────────────────────────
  const buyerParty = root
    .ele("cac:AccountingCustomerParty")
    .ele("cac:Party");

  // BT-49: Buyer electronic address (required for XRechnung)
  if (client.email?.trim()) {
    buyerParty
      .ele("cbc:EndpointID", { schemeID: "EM" })
      .txt(client.email);
  }

  buyerParty.ele("cac:PartyName").ele("cbc:Name").txt(client.name); // BT-44

  const buyerAddr = buyerParty.ele("cac:PostalAddress");
  if (client.address?.trim()) {
    buyerAddr.ele("cbc:StreetName").txt(client.address);           // BT-50
  }
  if (client.zip?.trim()) {
    buyerAddr.ele("cbc:PostalZone").txt(client.zip);               // BT-53
  }
  if (client.city?.trim()) {
    buyerAddr.ele("cbc:CityName").txt(client.city);                // BT-52
  }
  buyerAddr
    .ele("cac:Country")
    .ele("cbc:IdentificationCode")
    .txt(client.country || "DE");                                  // BT-55

  if (client.vatId?.trim()) {
    buyerParty
      .ele("cac:PartyTaxScheme")
      .ele("cbc:CompanyID")
      .up()
      .ele("cac:TaxScheme")
      .ele("cbc:ID")
      .txt("VAT");
    // Re-set companyID properly
  }

  buyerParty
    .ele("cac:PartyLegalEntity")
    .ele("cbc:RegistrationName")
    .txt(client.name);                                             // BT-44

  // ── Payment Means (BG-16) ────────────────────────────────────────────────────
  if (settings.iban?.trim()) {
    const payMeans = root.ele("cac:PaymentMeans");
    payMeans.ele("cbc:PaymentMeansCode").txt("58"); // SEPA Credit Transfer
    if (invoice.dueDate) {
      payMeans.ele("cbc:PaymentDueDate").txt(fmtDate(invoice.dueDate));
    }
    payMeans
      .ele("cbc:PaymentID")
      .txt(invoice.number);                                       // BT-83
    const payeeAccount = payMeans.ele("cac:PayeeFinancialAccount");
    payeeAccount
      .ele("cbc:ID")
      .txt(settings.iban.replace(/\s/g, ""));                    // BT-84
    if (settings.bic?.trim()) {
      payeeAccount
        .ele("cac:FinancialInstitutionBranch")
        .ele("cbc:ID")
        .txt(settings.bic.replace(/\s/g, ""));                   // BT-86
    }
  }

  // ── Tax Total (BG-23) ────────────────────────────────────────────────────────
  const taxTotal = root.ele("cac:TaxTotal");
  taxTotal
    .ele("cbc:TaxAmount", { currencyID: "EUR" })
    .txt(fmtAmt(invoice.taxAmount));                              // BT-110

  for (const group of taxGroups) {
    const subtotal = taxTotal.ele("cac:TaxSubtotal");
    subtotal
      .ele("cbc:TaxableAmount", { currencyID: "EUR" })
      .txt(fmtAmt(group.netAmount));                             // BT-116
    subtotal
      .ele("cbc:TaxAmount", { currencyID: "EUR" })
      .txt(fmtAmt(group.taxAmount));                             // BT-117
    const taxCat = subtotal.ele("cac:TaxCategory");
    taxCat.ele("cbc:ID").txt(group.categoryCode);                // BT-118
    taxCat.ele("cbc:Percent").txt(String(group.vatRate));        // BT-119
    // BT-120/BT-121: Exemption reason (required for E, AE, K, G, O)
    if (exemptionReason && group.categoryCode !== "S" && group.categoryCode !== "Z") {
      taxCat.ele("cbc:TaxExemptionReason").txt(exemptionReason);
    }
    taxCat.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT");
  }

  // ── Legal Monetary Total (BG-22) ─────────────────────────────────────────────
  const lmt = root.ele("cac:LegalMonetaryTotal");
  lmt
    .ele("cbc:LineExtensionAmount", { currencyID: "EUR" })
    .txt(fmtAmt(invoice.subtotal));                              // BT-106
  lmt
    .ele("cbc:TaxExclusiveAmount", { currencyID: "EUR" })
    .txt(fmtAmt(invoice.subtotal));                              // BT-109
  lmt
    .ele("cbc:TaxInclusiveAmount", { currencyID: "EUR" })
    .txt(fmtAmt(invoice.total));                                 // BT-112
  lmt
    .ele("cbc:PayableAmount", { currencyID: "EUR" })
    .txt(fmtAmt(invoice.total));                                 // BT-115

  // ── Line Items (BG-25) ────────────────────────────────────────────────────────
  lineItems.forEach((item, idx) => {
    const line = root.ele(lineTag);
    line.ele("cbc:ID").txt(String(idx + 1));                     // BT-126

    line
      .ele(qtyTag, { unitCode: getUnitCode(item.unit) })
      .txt(fmtQty(item.quantity));                               // BT-129 + BT-130

    line
      .ele("cbc:LineExtensionAmount", { currencyID: "EUR" })
      .txt(fmtAmt(item.amount));                                 // BT-131

    // Line VAT (BG-30)
    const lineItem = line.ele("cac:Item");
    lineItem.ele("cbc:Name").txt(item.description);             // BT-153

    const classifiedTax = lineItem.ele("cac:ClassifiedTaxCategory");
    classifiedTax.ele("cbc:ID").txt(getVatCategoryCode(item.vatRate, vatRegulation)); // BT-151
    classifiedTax.ele("cbc:Percent").txt(String(item.vatRate)); // BT-152
    classifiedTax.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT");

    // Unit price (BT-146)
    line
      .ele("cac:Price")
      .ele("cbc:PriceAmount", { currencyID: "EUR" })
      .txt(fmtAmt(item.unitPrice));
  });

  return root.end({ prettyPrint: true });
}
