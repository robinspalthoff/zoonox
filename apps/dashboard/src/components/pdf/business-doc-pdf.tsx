/**
 * Generic PDF renderer for non-invoice business documents (Angebot / AB).
 *
 * Shares the visual identity with the invoice PDF (header, address block,
 * line items, footer) but drops the invoice-specific bits: no EPC payment
 * QR-Code, no credit-note reference line, no due-date. Title and meta labels
 * are resolved from `lib/invoice/labels.ts` via the `docType` prop.
 */

import React from "react";
import {
  Document, Page, Text, View, StyleSheet, Image,
} from "@react-pdf/renderer";
import type { Contact, CompanySettings } from "@prisma/client";
import { VAT_REGULATION_MAP, type VatRegulationId } from "@/lib/vat-regulation";
import { getInvoiceLabels, type InvoiceDocType } from "@/lib/invoice/labels";
import { computeDocumentTotals, type DiscountType } from "@/lib/invoice/discount";

export interface BusinessDocLineItem {
  id?: string;
  position: number;
  description: string;
  quantity: number | string | { toString(): string };
  unit?: string | null;
  unitPrice: number | string | { toString(): string };
  vatRate: number;
  amount: number | string | { toString(): string };
}

export interface BusinessDocData {
  number: string;
  issueDate: Date | string;
  // Document-type-specific deadline (Quote → validUntil, AB → deliveryDate).
  // Rendered in the meta block as a "Gültig bis" / "Liefertermin" line.
  deadlineDate?: Date | string | null;
  deadlineLabel?: string;
  serviceDate?: Date | string | null;
  serviceDateEnd?: Date | string | null;
  notes?: string | null;
  introText?: string | null;
  vatRegulation?: string | null;
  subtotal: number | string | { toString(): string };
  taxAmount: number | string | { toString(): string };
  total: number | string | { toString(): string };
  globalDiscountType?: string | null;
  globalDiscountValue?: number | string | { toString(): string } | null;
  contact: Contact;
  lineItems: BusinessDocLineItem[];
}

type Settings = (CompanySettings & { ownerName?: string | null; managingDirector?: string | null }) | null;

interface Props {
  doc: BusinessDocData;
  docType: InvoiceDocType; // "QUOTE" or "ORDER_CONFIRMATION"
  settings: Settings;
  locale?: string;
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#111827",
    backgroundColor: "#ffffff",
    paddingTop: 40,
    paddingBottom: 60,
    paddingLeft: 57,
    paddingRight: 45,
  },
  header: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 28 },
  logo: { width: 54, height: 54, objectFit: "contain", objectPosition: "right top" },
  senderLine: {
    fontSize: 7.5, color: "#9ca3af",
    borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb",
    paddingBottom: 3, marginBottom: 6,
  },
  addressMetaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 28, gap: 24 },
  addressBlock: { flex: 1 },
  addressText: { fontSize: 10, lineHeight: 1.65, color: "#111827" },
  metaBlock: { width: 200 },
  metaTitle: {
    fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#9ca3af",
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6, textAlign: "right",
  },
  metaRow: { flexDirection: "row", marginBottom: 3 },
  metaLabel: { fontSize: 9, color: "#6b7280", flex: 1 },
  metaValue: { fontSize: 9, color: "#111827", textAlign: "right" },
  metaValueBold: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#111827", textAlign: "right" },
  divider: { borderBottomWidth: 0.75, borderBottomColor: "#e5e7eb", marginBottom: 18 },
  docTitle: { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#111827", marginBottom: 4 },
  docSubtitle: { fontSize: 9, color: "#6b7280", marginBottom: 20 },
  introText: { fontSize: 9.5, color: "#374151", lineHeight: 1.7, marginBottom: 18 },
  tableHeader: { flexDirection: "row", backgroundColor: "#f3f4f6", paddingVertical: 7, paddingHorizontal: 8, marginBottom: 2 },
  tableHeaderText: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: "#374151" },
  tableRow: { flexDirection: "row", paddingVertical: 7, paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: "#f3f4f6" },
  tableText: { fontSize: 9.5, color: "#111827" },
  col_desc:   { flex: 3.5 },
  col_qty:    { flex: 1,   textAlign: "right" },
  col_price:  { flex: 1.3, textAlign: "right" },
  col_vat:    { flex: 0.8, textAlign: "right" },
  col_amount: { flex: 1.3, textAlign: "right" },
  totalsBlock: { marginTop: 14, alignItems: "flex-end" },
  totalsInner: { width: 200 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  totalLabel: { fontSize: 9.5, color: "#6b7280" },
  totalValue: { fontSize: 9.5, color: "#111827", textAlign: "right" },
  grandTotalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#111827", marginTop: 4 },
  grandTotalLabel: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: "#111827" },
  grandTotalValue: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: "#111827", textAlign: "right" },
  notes: { marginTop: 28, fontSize: 8.5, color: "#6b7280", lineHeight: 1.6 },
  legalNoticeBox: { marginTop: 18, padding: "8 10", backgroundColor: "#fefce8", borderRadius: 4, borderWidth: 0.5, borderColor: "#fde68a" },
  legalNoticeText: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: "#92400e", lineHeight: 1.6 },
  footer: { position: "absolute", bottom: 24, left: 57, right: 45, borderTopWidth: 0.5, borderTopColor: "#d1d5db", paddingTop: 8, flexDirection: "row", justifyContent: "space-between" },
  footerBlock: { flexDirection: "column", gap: 2, flex: 1 },
  footerBlockLast: { flexDirection: "column", gap: 2, flex: 1, alignItems: "flex-end" },
  footerText: { fontSize: 7.5, color: "#9ca3af" },
  footerPage: { fontSize: 7.5, color: "#c4c9d4", marginTop: 4 },
});

const fmt = (v: number | string | { toString(): string }) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(v));
const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

const LEGAL_NOTICE_DE: Record<string, string> = {
  smallBusiness19: "Gemäß §19 UStG wird keine Umsatzsteuer berechnet.",
  taxExempt4: "Umsatzsteuerfreie Leistung gemäß §4 UStG.",
  reverseCharge13b: "Steuerschuldnerschaft des Leistungsempfängers gemäß §13b UStG.",
  reverseCharge18b: "Steuerschuldnerschaft des Leistungsempfängers gemäß §18b UStG.",
  intraCommunityDelivery: "Steuerfreie innergemeinschaftliche Lieferung gemäß §4 Nr. 1b i.V.m. §6a UStG.",
  oss: "Besteuerung nach dem One-Stop-Shop-Verfahren (OSS) gemäß §18j UStG.",
  export: "Steuerfreie Ausfuhrlieferung gemäß §4 Nr. 1a i.V.m. §6 UStG.",
  nonDomesticService: "Leistung nicht im Inland steuerbar gemäß §3a UStG.",
};

export function BusinessDocPDF({ doc, docType, settings: s, locale }: Props) {
  const c = doc.contact;
  const labels = getInvoiceLabels(locale, docType);

  const totalsRaw = computeDocumentTotals(
    doc.lineItems.map((li) => ({ amount: Number(li.amount), vatRate: li.vatRate })),
    (doc.globalDiscountType as DiscountType) ?? null,
    doc.globalDiscountValue !== null && doc.globalDiscountValue !== undefined
      ? Number(doc.globalDiscountValue)
      : null,
  );
  const subtotalBeforeDiscount = totalsRaw.subtotalBeforeDiscount;
  const discountAmount = totalsRaw.discountAmount;
  const taxGroups = totalsRaw.taxGroups;
  const showDiscountLine = discountAmount > 0;

  const clientLines = [
    [c.contactFirstName, c.contactLastName].filter(Boolean).join(" ") || null,
    c.address,
    c.zip && c.city ? `${c.zip} ${c.city}` : (c.city ?? null),
    c.country !== "DE" ? c.country : null,
  ].filter(Boolean) as string[];

  const senderLine = [s?.name, s?.address, [s?.zip, s?.city].filter(Boolean).join(" ")]
    .filter(Boolean).join("  ·  ");

  const serviceDateLabel = doc.serviceDateEnd ? labels.servicePeriod : labels.serviceDate;
  const serviceDateValue = doc.serviceDate
    ? doc.serviceDateEnd
      ? `${fmtDate(doc.serviceDate)} – ${fmtDate(doc.serviceDateEnd)}`
      : fmtDate(doc.serviceDate)
    : null;

  const metaRows: { label: string; value: string; bold?: boolean }[] = [
    { label: labels.docNumberLabel, value: doc.number, bold: true },
    { label: labels.docDateLabel, value: fmtDate(doc.issueDate) },
    ...(doc.deadlineDate && doc.deadlineLabel
      ? [{ label: doc.deadlineLabel, value: fmtDate(doc.deadlineDate) }]
      : []),
    ...(serviceDateValue ? [{ label: serviceDateLabel, value: serviceDateValue }] : []),
    ...(c.customerNumber ? [{ label: labels.clientCustomerNumber, value: c.customerNumber }] : []),
    ...(c.vatId ? [{ label: labels.clientVat, value: c.vatId }] : []),
  ];

  const companyNameLine = [s?.name, s?.nameSuffix].filter(Boolean).join(" ");
  const cityLine = [s?.zip, s?.city].filter(Boolean).join(" ");

  const vatRegId = (doc.vatRegulation ?? "STANDARD") as VatRegulationId;
  const vatRegConfig = VAT_REGULATION_MAP[vatRegId];
  const legalNotice = vatRegConfig.legalNoticeKey ? LEGAL_NOTICE_DE[vatRegConfig.legalNoticeKey] ?? null : null;
  const isSmallBusiness = vatRegId === "SMALL_BUSINESS_19";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          {s?.logoBase64 ? <Image src={s.logoBase64} style={styles.logo} /> : null}
        </View>

        <View style={styles.addressMetaRow}>
          <View style={styles.addressBlock}>
            {senderLine ? <Text style={styles.senderLine}>{senderLine}</Text> : null}
            <Text style={[styles.addressText, { fontFamily: "Helvetica-Bold" }]}>{c.name}</Text>
            {clientLines.map((line, i) => (
              <Text key={i} style={styles.addressText}>{line}</Text>
            ))}
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaTitle}>{labels.docDetailsTitle}</Text>
            {metaRows.map((row) => (
              <View key={row.label} style={styles.metaRow}>
                <Text style={styles.metaLabel}>{row.label}</Text>
                <Text style={row.bold ? styles.metaValueBold : styles.metaValue}>{row.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.divider} />

        <Text style={styles.docTitle}>{labels.docTitle}</Text>
        <Text style={styles.docSubtitle}>
          {doc.number}  ·  {fmtDate(doc.issueDate)}
        </Text>

        {doc.introText ? <Text style={styles.introText}>{doc.introText}</Text> : null}

        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, styles.col_desc]}>{labels.colDescription}</Text>
          <Text style={[styles.tableHeaderText, styles.col_qty]}>{labels.colQuantity}</Text>
          <Text style={[styles.tableHeaderText, styles.col_price]}>{labels.colUnitPrice}</Text>
          {!isSmallBusiness ? <Text style={[styles.tableHeaderText, styles.col_vat]}>{labels.vat}</Text> : null}
          <Text style={[styles.tableHeaderText, styles.col_amount]}>{labels.colAmount}</Text>
        </View>

        {doc.lineItems.map((item, i) => (
          <View key={item.id ?? i} style={styles.tableRow}>
            <Text style={[styles.tableText, styles.col_desc]}>{item.description}</Text>
            <Text style={[styles.tableText, styles.col_qty]}>
              {Number(item.quantity).toLocaleString("de-DE")}{item.unit ? ` ${item.unit}` : ""}
            </Text>
            <Text style={[styles.tableText, styles.col_price]}>{fmt(item.unitPrice)}</Text>
            {!isSmallBusiness ? <Text style={[styles.tableText, styles.col_vat]}>{item.vatRate} %</Text> : null}
            <Text style={[styles.tableText, styles.col_amount]}>{fmt(item.amount)}</Text>
          </View>
        ))}

        <View style={styles.totalsBlock}>
          <View style={styles.totalsInner}>
            {isSmallBusiness ? (
              <>
                {showDiscountLine && (
                  <>
                    <View style={styles.totalRow}>
                      <Text style={styles.totalLabel}>{labels.subtotalGross}</Text>
                      <Text style={styles.totalValue}>{fmt(subtotalBeforeDiscount)}</Text>
                    </View>
                    <View style={styles.totalRow}>
                      <Text style={styles.totalLabel}>{labels.discountLabel}</Text>
                      <Text style={styles.totalValue}>-{fmt(discountAmount)}</Text>
                    </View>
                  </>
                )}
                <View style={styles.grandTotalRow}>
                  <Text style={styles.grandTotalLabel}>{labels.totalSimple}</Text>
                  <Text style={styles.grandTotalValue}>{fmt(doc.subtotal)}</Text>
                </View>
              </>
            ) : (
              <>
                {showDiscountLine && (
                  <>
                    <View style={styles.totalRow}>
                      <Text style={styles.totalLabel}>{labels.subtotalGross}</Text>
                      <Text style={styles.totalValue}>{fmt(subtotalBeforeDiscount)}</Text>
                    </View>
                    <View style={styles.totalRow}>
                      <Text style={styles.totalLabel}>{labels.discountLabel}</Text>
                      <Text style={styles.totalValue}>-{fmt(discountAmount)}</Text>
                    </View>
                  </>
                )}
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>{labels.subtotal}</Text>
                  <Text style={styles.totalValue}>{fmt(doc.subtotal)}</Text>
                </View>
                {Object.entries(taxGroups).filter(([, v]) => v > 0.001).map(([rate, amount]) => (
                  <View key={rate} style={styles.totalRow}>
                    <Text style={styles.totalLabel}>{labels.vat} {rate} %</Text>
                    <Text style={styles.totalValue}>{fmt(amount)}</Text>
                  </View>
                ))}
                <View style={styles.grandTotalRow}>
                  <Text style={styles.grandTotalLabel}>{labels.grandTotal}</Text>
                  <Text style={styles.grandTotalValue}>{fmt(doc.total)}</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {legalNotice ? (
          <View style={styles.legalNoticeBox}>
            <Text style={styles.legalNoticeText}>{legalNotice}</Text>
          </View>
        ) : null}

        {(doc.notes || s?.defaultNotes) && (
          <View style={styles.notes}>
            <Text>{doc.notes ?? s?.defaultNotes}</Text>
          </View>
        )}

        <View style={styles.footer} fixed>
          <View style={styles.footerBlock}>
            {companyNameLine ? <Text style={styles.footerText}>{companyNameLine}</Text> : null}
            {s?.address ? <Text style={styles.footerText}>{s.address}</Text> : null}
            {cityLine   ? <Text style={styles.footerText}>{cityLine}</Text> : null}
            {s?.country ? <Text style={styles.footerText}>{s.country}</Text> : null}
          </View>
          <View style={styles.footerBlock}>
            {s?.email   ? <Text style={styles.footerText}>{s.email}</Text> : null}
            {s?.phone   ? <Text style={styles.footerText}>{s.phone}</Text> : null}
            {s?.website ? <Text style={styles.footerText}>{s.website}</Text> : null}
          </View>
          <View style={styles.footerBlock}>
            {s?.vatId            ? <Text style={styles.footerText}>{labels.footerVat} {s.vatId}</Text> : null}
            {s?.taxId            ? <Text style={styles.footerText}>{labels.footerTaxId} {s.taxId}</Text> : null}
            {s?.managingDirector ? <Text style={styles.footerText}>{labels.footerManagingDirector} {s.managingDirector}</Text> : null}
            {s?.ownerName        ? <Text style={styles.footerText}>{labels.footerOwner} {s.ownerName}</Text> : null}
          </View>
          <View style={styles.footerBlockLast}>
            {s?.bankName ? <Text style={styles.footerText}>{s.bankName}</Text> : null}
            {s?.iban     ? <Text style={styles.footerText}>{s.iban}</Text> : null}
            {s?.bic      ? <Text style={styles.footerText}>{s.bic}</Text> : null}
            <Text style={styles.footerPage} render={({ pageNumber, totalPages }) =>
              `${labels.page} ${pageNumber} / ${totalPages}`
            } />
          </View>
        </View>
      </Page>
    </Document>
  );
}
