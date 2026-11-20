/**
 * ZUGFeRD 2.x XML Generator — CII Format (Cross Industry Invoice)
 *
 * Generates a factur-x.xml compliant with:
 *  - EN 16931:2017 (European standard for electronic invoicing)
 *  - ZUGFeRD 2.3 / Factur-X 1.0 EN 16931 profile
 *  - §14 UStG (German VAT act requirements)
 *
 * The XML is the legally binding document. The PDF is only the visual representation.
 *
 * Profile: EN16931 (= COMFORT) — suitable for B2B and B2G invoices.
 * For B2G (public authorities) use XRechnung UBL instead (see xrechnung-xml.ts).
 */

import { create } from "xmlbuilder2";
import type { EInvoiceGeneratorInput, TaxGroup } from "./types";
import {
  getVatCategoryCode,
  getVatExemptionReason,
  getUnitCode,
  ZUGFERD_PROFILE_IDS,
} from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a date as YYYYMMDD (format="102" per UN/CEFACT) */
function fmt102(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/** Format a decimal/number as string with exactly 2 decimal places */
function fmtAmt(value: unknown): string {
  return Number(value).toFixed(2);
}

/** Format a decimal/number as string with up to 4 decimal places (quantities) */
function fmtQty(value: unknown): string {
  const n = Number(value);
  // Use 3 decimal places to match EN 16931 requirements
  return n.toFixed(3).replace(/\.?0+$/, "") || "0";
}

// ─── Tax Grouping ─────────────────────────────────────────────────────────────

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
      const existing = map.get(rate)!;
      existing.netAmount = Math.round((existing.netAmount + net) * 100) / 100;
      existing.taxAmount = Math.round((existing.taxAmount + tax) * 100) / 100;
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
 * Generates a ZUGFeRD 2.x / Factur-X 1.0 XML string in CII format.
 *
 * The returned string must be saved as `factur-x.xml` and embedded into the PDF.
 * It must also be archived for 10 years per GoBD.
 */
export function generateZugferdXml(input: EInvoiceGeneratorInput): string {
  const { invoice, settings } = input;
  const { contact: client, lineItems } = invoice;

  const isCreditNote = invoice.type === "CREDIT_NOTE";
  // BT-3: 380 = Invoice, 381 = Credit Note (Gutschrift)
  const typeCode = isCreditNote ? "381" : "380";

  const vatRegulation = (invoice as any).vatRegulation ?? "STANDARD";
  const taxGroups = groupByVatRate(lineItems, vatRegulation);
  const exemptionReason = getVatExemptionReason(vatRegulation);
  const profileId = ZUGFERD_PROFILE_IDS.EN16931;

  // ── Root Element ────────────────────────────────────────────────────────────
  const root = create({ version: "1.0", encoding: "UTF-8" }).ele(
    "rsm:CrossIndustryInvoice",
    {
      "xmlns:rsm":
        "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
      "xmlns:ram":
        "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
      "xmlns:udt":
        "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
      "xmlns:qdt":
        "urn:un:unece:uncefact:data:standard:QualifiedDataType:100",
      "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    }
  );

  // ── ExchangedDocumentContext ────────────────────────────────────────────────
  root
    .ele("rsm:ExchangedDocumentContext")
    .ele("ram:GuidelineSpecifiedDocumentContextParameter")
    .ele("ram:ID")
    .txt(profileId);

  // ── ExchangedDocument ───────────────────────────────────────────────────────
  const exDoc = root.ele("rsm:ExchangedDocument");
  exDoc.ele("ram:ID").txt(invoice.number);           // BT-1
  exDoc.ele("ram:TypeCode").txt(typeCode);            // BT-3
  exDoc
    .ele("ram:IssueDateTime")
    .ele("udt:DateTimeString", { format: "102" })
    .txt(fmt102(invoice.issueDate));                  // BT-2

  // Optional notes (BT-22)
  if (invoice.notes?.trim()) {
    exDoc.ele("ram:IncludedNote").ele("ram:Content").txt(invoice.notes.trim());
  }

  // ── SupplyChainTradeTransaction ─────────────────────────────────────────────
  const tx = root.ele("rsm:SupplyChainTradeTransaction");

  // ── Line Items (BG-25) ──────────────────────────────────────────────────────
  lineItems.forEach((item, idx) => {
    const line = tx.ele("ram:IncludedSupplyChainTradeLineItem");

    // Line ID (BT-126)
    line
      .ele("ram:AssociatedDocumentLineDocument")
      .ele("ram:LineID")
      .txt(String(idx + 1));

    // Item name (BT-153)
    line.ele("ram:SpecifiedTradeProduct").ele("ram:Name").txt(item.description);

    // Prices
    const agreement = line.ele("ram:SpecifiedLineTradeAgreement");
    agreement
      .ele("ram:GrossPriceProductTradePrice")
      .ele("ram:ChargeAmount")
      .txt(fmtAmt(item.unitPrice));                   // BT-148
    agreement
      .ele("ram:NetPriceProductTradePrice")
      .ele("ram:ChargeAmount")
      .txt(fmtAmt(item.unitPrice));                   // BT-146

    // Quantity (BT-129 + BT-130)
    line
      .ele("ram:SpecifiedLineTradeDelivery")
      .ele("ram:BilledQuantity", { unitCode: getUnitCode(item.unit) })
      .txt(fmtQty(item.quantity));

    // Line settlement
    const lineSettlement = line.ele("ram:SpecifiedLineTradeSettlement");

    // Tax on line level (BG-30)
    const lineTax = lineSettlement.ele("ram:ApplicableTradeTax");
    lineTax.ele("ram:TypeCode").txt("VAT");
    lineTax
      .ele("ram:CategoryCode")
      .txt(getVatCategoryCode(item.vatRate, vatRegulation));  // BT-151
    lineTax
      .ele("ram:RateApplicablePercent")
      .txt(String(item.vatRate));                      // BT-152

    // Line net amount (BT-131)
    lineSettlement
      .ele("ram:SpecifiedTradeSettlementLineMonetarySummation")
      .ele("ram:LineTotalAmount")
      .txt(fmtAmt(item.amount));
  });

  // ── ApplicableHeaderTradeAgreement ──────────────────────────────────────────
  const agreement = tx.ele("ram:ApplicableHeaderTradeAgreement");

  // BT-10: Buyer reference (required for B2G — Leitweg-ID)
  const buyerRef = invoice.buyerReference?.trim() || invoice.leitwegId?.trim();
  if (buyerRef) {
    agreement.ele("ram:BuyerReference").txt(buyerRef);
  }

  // ── Seller (BG-4) ─────────────────────────────────────────────────────────
  const seller = agreement.ele("ram:SellerTradeParty");
  seller.ele("ram:Name").txt(settings.name ?? "");    // BT-27

  // Legal organization name
  const sellerLegal = seller.ele("ram:SpecifiedLegalOrganization");
  sellerLegal
    .ele("ram:TradingBusinessName")
    .txt(settings.name ?? "");                        // BT-28

  // Seller contact (BG-6) — optional but recommended
  if (settings.email?.trim()) {
    seller
      .ele("ram:DefinedTradeContact")
      .ele("ram:EmailURIUniversalCommunication")
      .ele("ram:URIID")
      .txt(settings.email);
  }

  // Seller postal address (BG-5)
  const sellerAddr = seller.ele("ram:PostalTradeAddress");
  if (settings.zip?.trim()) {
    sellerAddr.ele("ram:PostcodeCode").txt(settings.zip);   // BT-38
  }
  if (settings.address?.trim()) {
    sellerAddr.ele("ram:LineOne").txt(settings.address);    // BT-35
  }
  if (settings.city?.trim()) {
    sellerAddr.ele("ram:CityName").txt(settings.city);      // BT-37
  }
  sellerAddr.ele("ram:CountryID").txt(settings.country || "DE"); // BT-40

  // Seller VAT ID (BT-31)
  if (settings.vatId?.trim()) {
    seller
      .ele("ram:SpecifiedTaxRegistration")
      .ele("ram:ID", { schemeID: "VA" })
      .txt(settings.vatId);
  }
  // Seller tax number / Steuernummer (BT-32)
  if (settings.taxId?.trim()) {
    seller
      .ele("ram:SpecifiedTaxRegistration")
      .ele("ram:ID", { schemeID: "FC" })
      .txt(settings.taxId);
  }

  // ── Buyer (BG-7) ─────────────────────────────────────────────────────────
  const buyer = agreement.ele("ram:BuyerTradeParty");
  buyer.ele("ram:Name").txt(client.name);             // BT-44

  // Buyer VAT ID (BT-48)
  if (client.vatId?.trim()) {
    buyer
      .ele("ram:SpecifiedTaxRegistration")
      .ele("ram:ID", { schemeID: "VA" })
      .txt(client.vatId);
  }

  // Buyer postal address (BG-8)
  const buyerAddr = buyer.ele("ram:PostalTradeAddress");
  if (client.zip?.trim()) {
    buyerAddr.ele("ram:PostcodeCode").txt(client.zip);      // BT-53
  }
  if (client.address?.trim()) {
    buyerAddr.ele("ram:LineOne").txt(client.address);       // BT-50
  }
  if (client.city?.trim()) {
    buyerAddr.ele("ram:CityName").txt(client.city);         // BT-52
  }
  buyerAddr
    .ele("ram:CountryID")
    .txt(client.country || "DE");                     // BT-55

  // Buyer contact email (BT-49 electronic address)
  if (client.email?.trim()) {
    buyer
      .ele("ram:URIUniversalCommunication")
      .ele("ram:URIID", { schemeID: "EM" })
      .txt(client.email);
  }

  // BT-13: Buyer order reference (Leitweg-ID for B2G routing)
  if (invoice.leitwegId?.trim()) {
    agreement
      .ele("ram:BuyerOrderReferencedDocument")
      .ele("ram:IssuerAssignedID")
      .txt(invoice.leitwegId);
  }

  // BT-25: Preceding invoice reference (for credit notes)
  if (isCreditNote && invoice.creditNoteFor) {
    const precedingDoc = agreement.ele("ram:InvoiceReferencedDocument");
    precedingDoc
      .ele("ram:IssuerAssignedID")
      .txt(invoice.creditNoteFor.number ?? invoice.creditNoteForId ?? "");
    if (invoice.creditNoteFor.issueDate) {
      precedingDoc
        .ele("ram:FormattedIssueDateTime")
        .ele("qdt:DateTimeString", { format: "102" })
        .txt(fmt102(invoice.creditNoteFor.issueDate));
    }
  }

  // ── ApplicableHeaderTradeDelivery ────────────────────────────────────────
  const delivery = tx.ele("ram:ApplicableHeaderTradeDelivery");

  if (invoice.serviceDate) {
    delivery
      .ele("ram:ActualDeliverySupplyChainEvent")
      .ele("ram:OccurrenceDateTime")
      .ele("udt:DateTimeString", { format: "102" })
      .txt(fmt102(invoice.serviceDate));              // BT-72
  }

  // ── ApplicableHeaderTradeSettlement ──────────────────────────────────────
  const settlement = tx.ele("ram:ApplicableHeaderTradeSettlement");

  settlement.ele("ram:PaymentReference").txt(invoice.number); // BT-83 (Verwendungszweck)
  settlement.ele("ram:InvoiceCurrencyCode").txt("EUR");        // BT-5

  // Payment means (BG-16) — SEPA Credit Transfer (TypeCode 58)
  if (settings.iban?.trim()) {
    const payMeans = settlement.ele(
      "ram:SpecifiedTradeSettlementPaymentMeans"
    );
    payMeans.ele("ram:TypeCode").txt("58");           // BT-81: SEPA Credit Transfer
    const creditorAccount = payMeans.ele(
      "ram:PayeePartyCreditorFinancialAccount"
    );
    creditorAccount
      .ele("ram:IBANID")
      .txt(settings.iban.replace(/\s/g, ""));        // BT-84
    if (settings.bic?.trim()) {
      payMeans
        .ele("ram:PayeeSpecifiedCreditorFinancialInstitution")
        .ele("ram:BICID")
        .txt(settings.bic.replace(/\s/g, ""));       // BT-86
    }
  }

  // Tax breakdown by VAT rate (BG-23)
  for (const group of taxGroups) {
    const tradeTax = settlement.ele("ram:ApplicableTradeTax");
    tradeTax.ele("ram:CalculatedAmount").txt(fmtAmt(group.taxAmount));  // BT-117
    tradeTax.ele("ram:TypeCode").txt("VAT");
    // BT-120: Exemption reason (required for categories E, AE, K, G, O)
    if (exemptionReason && group.categoryCode !== "S" && group.categoryCode !== "Z") {
      tradeTax.ele("ram:ExemptionReason").txt(exemptionReason);
    }
    tradeTax.ele("ram:BasisAmount").txt(fmtAmt(group.netAmount));       // BT-116
    tradeTax.ele("ram:CategoryCode").txt(group.categoryCode);           // BT-118
    tradeTax
      .ele("ram:RateApplicablePercent")
      .txt(String(group.vatRate));                                       // BT-119
  }

  // Billing period (BG-14) — when serviceDate + serviceDateEnd are set
  if (invoice.serviceDate && invoice.serviceDateEnd) {
    const period = settlement.ele("ram:BillingSpecifiedPeriod");
    period
      .ele("ram:StartDateTime")
      .ele("udt:DateTimeString", { format: "102" })
      .txt(fmt102(invoice.serviceDate));              // BT-73
    period
      .ele("ram:EndDateTime")
      .ele("udt:DateTimeString", { format: "102" })
      .txt(fmt102(invoice.serviceDateEnd));           // BT-74
  }

  // Payment terms / due date (BG-22)
  if (invoice.dueDate) {
    settlement
      .ele("ram:SpecifiedTradePaymentTerms")
      .ele("ram:DueDateDateTime")
      .ele("udt:DateTimeString", { format: "102" })
      .txt(fmt102(invoice.dueDate));                  // BT-9
  }

  // Monetary summary (BG-22)
  const summary = settlement.ele(
    "ram:SpecifiedTradeSettlementHeaderMonetarySummation"
  );
  summary.ele("ram:LineTotalAmount").txt(fmtAmt(invoice.subtotal));     // BT-106
  summary.ele("ram:TaxBasisTotalAmount").txt(fmtAmt(invoice.subtotal)); // BT-109
  summary
    .ele("ram:TaxTotalAmount", { currencyID: "EUR" })
    .txt(fmtAmt(invoice.taxAmount));                                     // BT-110
  summary.ele("ram:GrandTotalAmount").txt(fmtAmt(invoice.total));       // BT-112
  summary.ele("ram:DuePayableAmount").txt(fmtAmt(invoice.total));       // BT-115

  return root.end({ prettyPrint: true });
}
