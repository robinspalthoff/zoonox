/**
 * Invoice document labels — localized strings for the rendered invoice
 * (the HTML preview and the PDF).
 *
 * Kept as a plain dictionary instead of next-intl messages on purpose:
 * the PDF is rendered outside any React / i18n context (in an API route
 * via `renderToBuffer`), so it can't call `useTranslations`. A flat
 * dictionary works identically in the preview, the PDF and on the server.
 *
 * NOTE: the VAT-regulation legal notices (§-references to German tax law)
 * are deliberately NOT part of this dictionary — they are statutory text
 * and stay German on every invoice regardless of the UI language.
 */

export type InvoiceLocale = "de" | "en";

/** Document types whose labels this module resolves. */
export type InvoiceDocType =
  | "INVOICE"
  | "CREDIT_NOTE"
  | "CORRECTION"
  | "QUOTE"
  | "ORDER_CONFIRMATION";

/** Narrow any incoming locale string to a supported invoice locale. */
export function normalizeInvoiceLocale(raw: string | null | undefined): InvoiceLocale {
  return raw === "en" ? "en" : "de";
}

/** Doc-type-resolved label set consumed by the preview + PDF. */
export interface InvoiceLabels {
  docTitle: string;
  docNumberLabel: string;
  docDateLabel: string;
  docDetailsTitle: string;
  due: string;
  serviceDate: string;
  servicePeriod: string;
  clientVat: string;
  clientCustomerNumber: string;
  colDescription: string;
  colQuantity: string;
  colUnitPrice: string;
  vat: string;
  colAmount: string;
  subtotal: string;
  subtotalGross: string;
  discountLabel: string;
  totalSimple: string;
  grandTotal: string;
  qrTitle: string;
  qrText: string;
  qrPlaceholderTitle: string;
  qrNoIban: string;
  qrNoAmount: string;
  footerVat: string;
  footerTaxId: string;
  footerManagingDirector: string;
  footerOwner: string;
  page: string;
  /** Prefix for the "corrects invoice X" reference line — corrections only. */
  correctionRefLabel: string;
  /** "vom" / "of" — connects an invoice number with its date in references. */
  dateConnector: string;
}

interface LocaleDict {
  invoice: { title: string; number: string; date: string; details: string };
  creditNote: { title: string; number: string; date: string; details: string };
  correction: { title: string; number: string; date: string; details: string };
  quote: { title: string; number: string; date: string; details: string };
  orderConfirmation: { title: string; number: string; date: string; details: string };
  correctionRefLabel: string;
  dateConnector: string;
  due: string;
  serviceDate: string;
  servicePeriod: string;
  clientVat: string;
  clientCustomerNumber: string;
  colDescription: string;
  colQuantity: string;
  colUnitPrice: string;
  vat: string;
  colAmount: string;
  subtotal: string;
  subtotalGross: string;
  discountLabel: string;
  totalSimple: string;
  grandTotal: string;
  qrTitle: string;
  qrText: string;
  qrPlaceholderTitle: string;
  qrNoIban: string;
  qrNoAmount: string;
  footerVat: string;
  footerTaxId: string;
  footerManagingDirector: string;
  footerOwner: string;
  page: string;
}

const DICT: Record<InvoiceLocale, LocaleDict> = {
  de: {
    invoice: {
      title: "Rechnung",
      number: "Rechnung-Nr.",
      date: "Rechnungdatum",
      details: "Rechnungsdetails",
    },
    creditNote: {
      title: "Gutschrift",
      number: "Gutschrift-Nr.",
      date: "Gutschriftdatum",
      details: "Gutschriftsdetails",
    },
    correction: {
      title: "Rechnungskorrektur",
      number: "Korrektur-Nr.",
      date: "Korrekturdatum",
      details: "Korrekturdetails",
    },
    quote: {
      title: "Angebot",
      number: "Angebot-Nr.",
      date: "Angebotsdatum",
      details: "Angebotsdetails",
    },
    orderConfirmation: {
      title: "Auftragsbestätigung",
      number: "AB-Nr.",
      date: "AB-Datum",
      details: "Auftragsdetails",
    },
    correctionRefLabel: "Korrigiert Rechnung",
    dateConnector: "vom",
    due: "Fällig am",
    serviceDate: "Leistungsdatum",
    servicePeriod: "Leistungszeitraum",
    clientVat: "Ihre USt-IdNr.",
    clientCustomerNumber: "Kundennummer",
    colDescription: "Beschreibung",
    colQuantity: "Menge",
    colUnitPrice: "Einzelpreis",
    vat: "MwSt.",
    colAmount: "Betrag",
    subtotal: "Nettobetrag",
    subtotalGross: "Zwischensumme",
    discountLabel: "Rabatt",
    totalSimple: "Gesamtbetrag",
    grandTotal: "Gesamtbetrag (Brutto)",
    qrTitle: "Bezahlen per QR-Code",
    qrText:
      "Scannen Sie den Code mit der Banking-App Ihrer Bank, um die Überweisung mit Betrag und Verwendungszweck vorausgefüllt zu starten.",
    qrPlaceholderTitle: "Zahlungs-QR-Code aktiviert",
    qrNoIban:
      "Der QR-Code erscheint, sobald eine IBAN in den Firmen-Einstellungen hinterlegt ist.",
    qrNoAmount:
      "Der QR-Code erscheint, sobald die Rechnung Positionen mit einem Betrag größer 0 € enthält.",
    footerVat: "USt-IdNr.:",
    footerTaxId: "St.-Nr.:",
    footerManagingDirector: "Geschäftsführung:",
    footerOwner: "Inhaber/in:",
    page: "Seite",
  },
  en: {
    invoice: {
      title: "Invoice",
      number: "Invoice no.",
      date: "Invoice date",
      details: "Invoice details",
    },
    creditNote: {
      title: "Credit note",
      number: "Credit note no.",
      date: "Credit note date",
      details: "Credit note details",
    },
    correction: {
      title: "Invoice correction",
      number: "Correction no.",
      date: "Correction date",
      details: "Correction details",
    },
    quote: {
      title: "Quote",
      number: "Quote no.",
      date: "Quote date",
      details: "Quote details",
    },
    orderConfirmation: {
      title: "Order confirmation",
      number: "OC no.",
      date: "OC date",
      details: "Order details",
    },
    correctionRefLabel: "Corrects invoice",
    dateConnector: "of",
    due: "Due date",
    serviceDate: "Service date",
    servicePeriod: "Service period",
    clientVat: "Your VAT ID",
    clientCustomerNumber: "Customer no.",
    colDescription: "Description",
    colQuantity: "Quantity",
    colUnitPrice: "Unit price",
    vat: "VAT",
    colAmount: "Amount",
    subtotal: "Net amount",
    subtotalGross: "Subtotal",
    discountLabel: "Discount",
    totalSimple: "Total amount",
    grandTotal: "Total amount (gross)",
    qrTitle: "Pay by QR code",
    qrText:
      "Scan the code with your bank's app to start the transfer with the amount and reference pre-filled.",
    qrPlaceholderTitle: "Payment QR code enabled",
    qrNoIban:
      "The QR code appears once an IBAN is set in your company settings.",
    qrNoAmount:
      "The QR code appears once the invoice has line items with an amount greater than €0.",
    footerVat: "VAT ID:",
    footerTaxId: "Tax no.:",
    footerManagingDirector: "Managing director:",
    footerOwner: "Owner:",
    page: "Page",
  },
};

/** Resolve the full label set for a locale and document type. */
export function getInvoiceLabels(
  localeRaw: string | null | undefined,
  type: InvoiceDocType,
): InvoiceLabels {
  const d = DICT[normalizeInvoiceLocale(localeRaw)];
  const doc =
    type === "CREDIT_NOTE"
      ? d.creditNote
      : type === "CORRECTION"
        ? d.correction
        : type === "QUOTE"
          ? d.quote
          : type === "ORDER_CONFIRMATION"
            ? d.orderConfirmation
            : d.invoice;
  return {
    docTitle: doc.title,
    docNumberLabel: doc.number,
    docDateLabel: doc.date,
    docDetailsTitle: doc.details,
    due: d.due,
    serviceDate: d.serviceDate,
    servicePeriod: d.servicePeriod,
    clientVat: d.clientVat,
    clientCustomerNumber: d.clientCustomerNumber,
    colDescription: d.colDescription,
    colQuantity: d.colQuantity,
    colUnitPrice: d.colUnitPrice,
    vat: d.vat,
    colAmount: d.colAmount,
    subtotal: d.subtotal,
    subtotalGross: d.subtotalGross,
    discountLabel: d.discountLabel,
    totalSimple: d.totalSimple,
    grandTotal: d.grandTotal,
    qrTitle: d.qrTitle,
    qrText: d.qrText,
    qrPlaceholderTitle: d.qrPlaceholderTitle,
    qrNoIban: d.qrNoIban,
    qrNoAmount: d.qrNoAmount,
    footerVat: d.footerVat,
    footerTaxId: d.footerTaxId,
    footerManagingDirector: d.footerManagingDirector,
    footerOwner: d.footerOwner,
    page: d.page,
    correctionRefLabel: d.correctionRefLabel,
    dateConnector: d.dateConnector,
  };
}
