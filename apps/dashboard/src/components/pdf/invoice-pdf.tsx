import React from "react";
import {
  Document, Page, Text, View, StyleSheet, Image, Svg, Path,
} from "@react-pdf/renderer";
import type { Invoice, InvoiceLineItem, Contact, CompanySettings } from "@prisma/client";
import { VAT_REGULATION_MAP, type VatRegulationId } from "@/lib/vat-regulation";
import { buildEpcQrSvg } from "@/lib/invoice/epc-qr";
import { getInvoiceLabels } from "@/lib/invoice/labels";
import { computeDocumentTotals, type DiscountType } from "@/lib/invoice/discount";

type InvoiceWithRelations = Invoice & {
  contact: Contact;
  lineItems: InvoiceLineItem[];
  introText?: string | null;
  vatRegulation?: string | null;
  globalDiscountType?: string | null;
  globalDiscountValue?: number | string | { toString(): string } | null;
  /** Original invoice — present on credit notes AND corrections. */
  creditNoteFor?: { number: string; issueDate: Date } | null;
};

type Settings = (CompanySettings & { ownerName?: string | null; managingDirector?: string | null }) | null;

interface Props {
  invoice: InvoiceWithRelations;
  settings: Settings;
  /** UI language to render the invoice in. Defaults to German. */
  locale?: string;
}

// DIN 5008 compliant layout
// A4: 210×297mm — margins: left 25mm, right 20mm, top 20mm, bottom 20mm
// At 72dpi: 1mm ≈ 2.835pt → 25mm ≈ 71pt, 20mm ≈ 57pt
const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#111827",
    backgroundColor: "#ffffff",
    paddingTop: 40,
    paddingBottom: 60,      // room for fixed footer
    paddingLeft: 57,
    paddingRight: 45,
  },

  // ── Header: logo only, RIGHT aligned ────────────────────────────────────────
  header: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 28,
  },
  logo: {
    width: 54,   // 75% of original 72
    height: 54,
    objectFit: "contain",
    objectPosition: "right top",
  },

  // ── Sender line (Absenderzeile) above recipient ──────────────────────────────
  senderLine: {
    fontSize: 7.5,
    color: "#9ca3af",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
    paddingBottom: 3,
    marginBottom: 6,
  },

  // ── Address + meta row ───────────────────────────────────────────────────────
  // Mit @react-pdf/renderer (Yoga) sind Prozent-Breiten unzuverlässig, wenn
  // Kinder `minWidth` haben und Content-Breite die Spalte sprengt — Yoga
  // expandiert dann die Row statt zu wrappen, was den Meta-Block über die
  // Adress-Spalte ausquetscht. Wir nutzen daher absolute Punktbreiten:
  //   - Content-Bereich = 595 (A4) − 57 (left) − 45 (right) = 493 pt
  //   - addressBlock flex 1 (= alles, was übrig bleibt)
  //   - metaBlock 200 pt (genug für "01.02.2026 – 30.04.2026")
  // Damit hat der metaBlock eine harte Außen­breite, an der sich die
  // metaRows verlässlich orientieren können.
  addressMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 28,
    gap: 24,
  },
  addressBlock: {
    flex: 1,
  },
  addressText: {
    fontSize: 10,
    lineHeight: 1.65,
    color: "#111827",
  },

  // ── Invoice meta table (right side) ─────────────────────────────────────────
  // Feste 200 pt Breite. Kein `alignItems` nötig — default `stretch` reicht,
  // damit jede metaRow die volle 200 pt einnimmt. Innerhalb der Row:
  // Label `flex: 1` (saugt Restraum nach links) + Value rechts mit
  // textAlign: right. Kein `width: 100%` auf der Row mehr — das war der
  // Auslöser für die Yoga-Overflow-Bugs.
  metaBlock: {
    width: 200,
  },
  metaTitle: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
    textAlign: "right",
  },
  metaRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  metaLabel: {
    fontSize: 9,
    color: "#6b7280",
    flex: 1,
  },
  metaValue: {
    fontSize: 9,
    color: "#111827",
    textAlign: "right",
  },
  metaValueBold: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    textAlign: "right",
  },

  // ── Divider ─────────────────────────────────────────────────────────────────
  divider: {
    borderBottomWidth: 0.75,
    borderBottomColor: "#e5e7eb",
    marginBottom: 18,
  },

  // ── Invoice title ────────────────────────────────────────────────────────────
  invoiceTitle: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    marginBottom: 4,
  },
  invoiceSubtitle: {
    fontSize: 9,
    color: "#6b7280",
    marginBottom: 20,
  },

  // ── Intro text (Anrede / Einleitung above the line items) ──────────────────
  introText: {
    fontSize: 9.5,
    color: "#374151",
    lineHeight: 1.7,
    marginBottom: 18,
  },

  // ── Line items table ─────────────────────────────────────────────────────────
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    paddingVertical: 7,
    paddingHorizontal: 8,
    marginBottom: 2,
  },
  tableHeaderText: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#374151",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: "#f3f4f6",
  },
  tableText: {
    fontSize: 9.5,
    color: "#111827",
  },
  // Column flex weights: desc=3.5 / qty=1 / price=1.3 / vat=0.8 / amount=1.3
  col_desc:   { flex: 3.5 },
  col_qty:    { flex: 1,   textAlign: "right" },
  col_price:  { flex: 1.3, textAlign: "right" },
  col_vat:    { flex: 0.8, textAlign: "right" },
  col_amount: { flex: 1.3, textAlign: "right" },

  // ── Totals ───────────────────────────────────────────────────────────────────
  totalsBlock: {
    marginTop: 14,
    alignItems: "flex-end",
  },
  totalsInner: {
    width: 200,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2.5,
  },
  totalLabel: {
    fontSize: 9.5,
    color: "#6b7280",
  },
  totalValue: {
    fontSize: 9.5,
    color: "#111827",
    textAlign: "right",
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: "#111827",
    marginTop: 4,
  },
  grandTotalLabel: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },
  grandTotalValue: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    textAlign: "right",
  },

  // ── EPC QR-Code ("GiroCode") payment block ───────────────────────────────────
  qrSection: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  qrCode: {
    width: 84,
    height: 84,
  },
  qrTextBlock: {
    flex: 1,
  },
  qrTitle: {
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    marginBottom: 3,
  },
  qrText: {
    fontSize: 8.5,
    color: "#6b7280",
    lineHeight: 1.6,
  },

  // ── Notes ────────────────────────────────────────────────────────────────────
  notes: {
    marginTop: 28,
    fontSize: 8.5,
    color: "#6b7280",
    lineHeight: 1.6,
  },
  legalNoticeBox: {
    marginTop: 18,
    padding: "8 10",
    backgroundColor: "#fefce8",
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: "#fde68a",
  },
  legalNoticeText: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#92400e",
    lineHeight: 1.6,
  },

  // ── Footer (fixed, repeats on every page) ────────────────────────────────────
  footer: {
    position: "absolute",
    bottom: 24,
    left: 57,
    right: 45,
    borderTopWidth: 0.5,
    borderTopColor: "#d1d5db",
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerBlock: {
    flexDirection: "column",
    gap: 2,
    flex: 1,
  },
  footerBlockLast: {
    flexDirection: "column",
    gap: 2,
    flex: 1,
    alignItems: "flex-end",
  },
  footerText: {
    fontSize: 7.5,
    color: "#9ca3af",
  },
  footerPage: {
    fontSize: 7.5,
    color: "#c4c9d4",
    marginTop: 4,
  },
});

function fmt(val: number | string | { toString(): string }) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(val));
}

function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function InvoicePDF({ invoice, settings: s, locale }: Props) {
  const c = invoice.contact;
  const isCreditNote = invoice.type === "CREDIT_NOTE";
  const isCorrection = invoice.type === "CORRECTION";
  const labels = getInvoiceLabels(locale, invoice.type);

  // Totals (subtotal vor/nach Rabatt + tax pro VAT-Gruppe) via shared helper,
  // damit Anzeige und gespeicherte Werte exakt zusammenpassen. Gutschriften:
  // mit Betrag-Beträgen rechnen, danach Vorzeichen flippen — sonst clamped
  // der Helper den Rabatt weg, da der subtotal negativ ist.
  const sign = isCreditNote ? -1 : 1;
  const totalsRaw = computeDocumentTotals(
    invoice.lineItems.map((li) => ({
      amount: Math.abs(Number(li.amount)),
      vatRate: li.vatRate,
    })),
    (invoice.globalDiscountType as DiscountType) ?? null,
    invoice.globalDiscountValue !== null && invoice.globalDiscountValue !== undefined
      ? Number(invoice.globalDiscountValue)
      : null,
  );
  const subtotalBeforeDiscount = totalsRaw.subtotalBeforeDiscount * sign;
  const discountAmount = totalsRaw.discountAmount * sign;
  const taxGroups: Record<number, number> = Object.fromEntries(
    Object.entries(totalsRaw.taxGroups).map(([k, v]) => [k, v * sign]),
  );
  const showDiscountLine = totalsRaw.discountAmount > 0;

  const clientLines = [
    [c.contactFirstName, c.contactLastName].filter(Boolean).join(" ") || null,
    c.address,
    c.zip && c.city ? `${c.zip} ${c.city}` : (c.city ?? null),
    c.country !== "DE" ? c.country : null,
  ].filter(Boolean) as string[];

  const senderLine = [s?.name, s?.address, [s?.zip, s?.city].filter(Boolean).join(" ")]
    .filter(Boolean).join("  ·  ");

  const serviceDateLabel = invoice.serviceDateEnd ? labels.servicePeriod : labels.serviceDate;
  const serviceDateValue = invoice.serviceDate
    ? invoice.serviceDateEnd
      ? `${fmtDate(invoice.serviceDate)} – ${fmtDate(invoice.serviceDateEnd)}`
      : fmtDate(invoice.serviceDate)
    : null;

  const metaRows: { label: string; value: string; bold?: boolean }[] = [
    { label: labels.docNumberLabel, value: invoice.number, bold: true },
    { label: labels.docDateLabel, value: fmtDate(invoice.issueDate) },
    ...(invoice.dueDate ? [{ label: labels.due, value: fmtDate(invoice.dueDate) }] : []),
    ...(serviceDateValue ? [{ label: serviceDateLabel, value: serviceDateValue }] : []),
    ...(c.customerNumber ? [{ label: labels.clientCustomerNumber, value: c.customerNumber }] : []),
    ...(c.vatId ? [{ label: labels.clientVat, value: c.vatId }] : []),
  ];

  const companyNameLine = [s?.name, s?.nameSuffix].filter(Boolean).join(" ");
  const cityLine = [s?.zip, s?.city].filter(Boolean).join(" ");

  // VAT regulation legal notice — always German for official invoices
  const vatRegId = (invoice.vatRegulation ?? "STANDARD") as VatRegulationId;
  const vatRegConfig = VAT_REGULATION_MAP[vatRegId];
  const LEGAL_NOTICE_DE: Record<string, string> = {
    smallBusiness19: "Gemäß §19 UStG wird keine Umsatzsteuer berechnet.",
    taxExempt4: "Umsatzsteuerfreie Leistung gemäß §4 UStG.",
    reverseCharge13b: "Steuerschuldnerschaft des Leistungsempfängers gemäß §13b UStG.",
    reverseCharge18b: "Steuerschuldnerschaft des Leistungsempfängers gemäß §18b UStG. Die Umsatzsteuer ist vom Leistungsempfänger anzumelden und abzuführen.",
    intraCommunityDelivery: "Steuerfreie innergemeinschaftliche Lieferung gemäß §4 Nr. 1b i.V.m. §6a UStG.",
    oss: "Besteuerung nach dem One-Stop-Shop-Verfahren (OSS) gemäß §18j UStG.",
    export: "Steuerfreie Ausfuhrlieferung gemäß §4 Nr. 1a i.V.m. §6 UStG.",
    nonDomesticService: "Leistung nicht im Inland steuerbar gemäß §3a UStG.",
  };
  const legalNotice = vatRegConfig.legalNoticeKey ? LEGAL_NOTICE_DE[vatRegConfig.legalNoticeKey] ?? null : null;
  const isSmallBusiness = vatRegId === "SMALL_BUSINESS_19";

  // EPC QR-Code ("GiroCode"): encodes a SEPA credit transfer the payer can
  // scan to get a pre-filled bank transfer. Only for real, payable invoices —
  // skipped for credit notes, when the per-invoice toggle is off, and when no
  // IBAN / no positive total is set (buildEpcQrSvg returns null in those cases).
  // Corrections behave like regular invoices: the customer still owes the
  // full corrected amount, so the GiroCode applies. Only true credit notes
  // (refunds going *back* to the customer) suppress it.
  const epcQr = !isCreditNote && invoice.paymentQrEnabled
    ? buildEpcQrSvg({
        beneficiaryName: s?.name,
        iban: s?.iban,
        bic: s?.bic,
        amount: Number(invoice.total),
        remittance: `${labels.docTitle} ${invoice.number}`,
      })
    : null;

  return (
    <Document>
      <Page size="A4" style={styles.page}>

        {/* ── Header: logo only — RIGHT aligned ────────────────────────────── */}
        <View style={styles.header}>
          {s?.logoBase64 ? (
            <Image src={s.logoBase64} style={styles.logo} />
          ) : null}
        </View>

        {/* ── Sender line + recipient + meta ────────────────────────────────── */}
        <View style={styles.addressMetaRow}>

          {/* LEFT: sender breadcrumb → client address */}
          <View style={styles.addressBlock}>
            {senderLine ? <Text style={styles.senderLine}>{senderLine}</Text> : null}
            <Text style={[styles.addressText, { fontFamily: "Helvetica-Bold" }]}>{c.name}</Text>
            {clientLines.map((line, i) => (
              <Text key={i} style={styles.addressText}>{line}</Text>
            ))}
          </View>

          {/* RIGHT: invoice meta table — label left, value right */}
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

        {/* ── Divider ───────────────────────────────────────────────────────── */}
        <View style={styles.divider} />

        {/* ── Invoice title ─────────────────────────────────────────────────── */}
        <Text style={styles.invoiceTitle}>{labels.docTitle}</Text>
        <Text style={styles.invoiceSubtitle}>
          {invoice.number}  ·  {fmtDate(invoice.issueDate)}
        </Text>

        {/* ── Correction reference — "Korrigiert Rechnung X vom Y" ──────────── */}
        {isCorrection && invoice.creditNoteFor ? (
          <Text style={styles.invoiceSubtitle}>
            {labels.correctionRefLabel} {invoice.creditNoteFor.number} {labels.dateConnector} {fmtDate(invoice.creditNoteFor.issueDate)}
          </Text>
        ) : null}

        {/* ── Intro text (parity with HTML preview) ────────────────────────── */}
        {invoice.introText ? (
          <Text style={styles.introText}>{invoice.introText}</Text>
        ) : null}

        {/* ── Line items table ──────────────────────────────────────────────── */}
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, styles.col_desc]}>{labels.colDescription}</Text>
          <Text style={[styles.tableHeaderText, styles.col_qty]}>{labels.colQuantity}</Text>
          <Text style={[styles.tableHeaderText, styles.col_price]}>{labels.colUnitPrice}</Text>
          {!isSmallBusiness ? <Text style={[styles.tableHeaderText, styles.col_vat]}>{labels.vat}</Text> : null}
          <Text style={[styles.tableHeaderText, styles.col_amount]}>{labels.colAmount}</Text>
        </View>

        {invoice.lineItems.map((item) => (
          <View key={item.id} style={styles.tableRow}>
            <Text style={[styles.tableText, styles.col_desc]}>{item.description}</Text>
            <Text style={[styles.tableText, styles.col_qty]}>
              {Number(item.quantity).toLocaleString("de-DE")}{item.unit ? ` ${item.unit}` : ""}
            </Text>
            <Text style={[styles.tableText, styles.col_price]}>{fmt(item.unitPrice)}</Text>
            {!isSmallBusiness ? <Text style={[styles.tableText, styles.col_vat]}>{item.vatRate} %</Text> : null}
            <Text style={[styles.tableText, styles.col_amount]}>{fmt(item.amount)}</Text>
          </View>
        ))}

        {/* ── Totals ────────────────────────────────────────────────────────── */}
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
                      <Text style={styles.totalValue}>-{fmt(Math.abs(discountAmount))}</Text>
                    </View>
                  </>
                )}
                <View style={styles.grandTotalRow}>
                  <Text style={styles.grandTotalLabel}>{labels.totalSimple}</Text>
                  <Text style={styles.grandTotalValue}>{fmt(invoice.subtotal)}</Text>
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
                      <Text style={styles.totalValue}>-{fmt(Math.abs(discountAmount))}</Text>
                    </View>
                  </>
                )}
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>{labels.subtotal}</Text>
                  <Text style={styles.totalValue}>{fmt(invoice.subtotal)}</Text>
                </View>
                {Object.entries(taxGroups).filter(([, v]) => Math.abs(v) > 0.001).map(([rate, amount]) => (
                  <View key={rate} style={styles.totalRow}>
                    <Text style={styles.totalLabel}>{labels.vat} {rate} %</Text>
                    <Text style={styles.totalValue}>{fmt(amount)}</Text>
                  </View>
                ))}
                <View style={styles.grandTotalRow}>
                  <Text style={styles.grandTotalLabel}>{labels.grandTotal}</Text>
                  <Text style={styles.grandTotalValue}>{fmt(invoice.total)}</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* ── VAT regulation legal notice ─────────────────────────────── */}
        {legalNotice ? (
          <View style={styles.legalNoticeBox}>
            <Text style={styles.legalNoticeText}>{legalNotice}</Text>
          </View>
        ) : null}

        {/* ── EPC QR-Code ("GiroCode") payment block ─────────────────────────── */}
        {epcQr ? (
          <View style={styles.qrSection} wrap={false}>
            <Svg viewBox={epcQr.viewBox} style={styles.qrCode}>
              <Path d={epcQr.path} fill="#111827" />
            </Svg>
            <View style={styles.qrTextBlock}>
              <Text style={styles.qrTitle}>{labels.qrTitle}</Text>
              <Text style={styles.qrText}>{labels.qrText}</Text>
            </View>
          </View>
        ) : null}

        {/* ── Notes ─────────────────────────────────────────────────────────── */}
        {(invoice.notes || s?.defaultNotes) && (
          <View style={styles.notes}>
            <Text>{invoice.notes ?? s?.defaultNotes}</Text>
          </View>
        )}

        {/* ── Footer (fixed on every page) ──────────────────────────────────── */}
        <View style={styles.footer} fixed>

          {/* Block 1: Company info — name, address, city, country */}
          <View style={styles.footerBlock}>
            {companyNameLine ? <Text style={styles.footerText}>{companyNameLine}</Text> : null}
            {s?.address ? <Text style={styles.footerText}>{s.address}</Text> : null}
            {cityLine   ? <Text style={styles.footerText}>{cityLine}</Text> : null}
            {s?.country ? <Text style={styles.footerText}>{s.country}</Text> : null}
          </View>

          {/* Block 2: Contact */}
          <View style={styles.footerBlock}>
            {s?.email   ? <Text style={styles.footerText}>{s.email}</Text> : null}
            {s?.phone   ? <Text style={styles.footerText}>{s.phone}</Text> : null}
            {s?.website ? <Text style={styles.footerText}>{s.website}</Text> : null}
          </View>

          {/* Block 3: Tax — USt-ID, Steuernr, Geschäftsführung/Inhaber */}
          <View style={styles.footerBlock}>
            {s?.vatId            ? <Text style={styles.footerText}>{labels.footerVat} {s.vatId}</Text> : null}
            {s?.taxId            ? <Text style={styles.footerText}>{labels.footerTaxId} {s.taxId}</Text> : null}
            {s?.managingDirector ? <Text style={styles.footerText}>{labels.footerManagingDirector} {s.managingDirector}</Text> : null}
            {s?.ownerName        ? <Text style={styles.footerText}>{labels.footerOwner} {s.ownerName}</Text> : null}
          </View>

          {/* Block 4: Bank info + page number */}
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
