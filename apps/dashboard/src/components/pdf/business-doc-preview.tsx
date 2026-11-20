/**
 * HTML preview of a business document (Angebot / AB). Mirrors the PDF layout
 * pixel-by-pixel so the in-app preview matches the downloaded PDF. Shared by
 * the form's "Vorschau" modal and the detail page's left preview panel.
 */

import type React from "react";
import type { Contact, CompanySettings } from "@prisma/client";
import { VAT_REGULATION_MAP, type VatRegulationId } from "@/lib/vat-regulation";
import { getInvoiceLabels, type InvoiceDocType } from "@/lib/invoice/labels";
import { computeDocumentTotals, type DiscountType } from "@/lib/invoice/discount";
import type { BusinessDocData } from "./business-doc-pdf";

type Settings = (CompanySettings & { ownerName?: string | null; managingDirector?: string | null }) | null;

const fmt = (v: number | string | { toString(): string }) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(v));
const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

const COL_FLEX = { desc: "3.5", qty: "1", price: "1.3", vat: "0.8", amount: "1.3" };

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

export function BusinessDocPreview({
  doc,
  docType,
  settings: s,
  locale,
}: {
  doc: BusinessDocData & { contact: Contact };
  docType: InvoiceDocType;
  settings: Settings;
  locale?: string;
}) {
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
    <div style={{ colorScheme: "light" }}>
      <div
        style={{
          fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
          fontSize: "10px", color: "#111827", background: "#ffffff",
          paddingTop: "40px", paddingBottom: "60px", paddingLeft: "57px", paddingRight: "45px",
          borderRadius: "16px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.10)",
          width: "595px", minHeight: "842px", margin: "0 auto",
          display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "28px" }}>
          {s?.logoBase64 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.logoBase64} alt={s.name ?? "Logo"}
              style={{ width: "54px", height: "54px", objectFit: "contain", objectPosition: "right top" }} />
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: "24px", marginBottom: "28px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {senderLine && (
              <p style={{ fontSize: "7.5px", color: "#9ca3af", borderBottom: "0.5px solid #e5e7eb", paddingBottom: "3px", marginBottom: "6px" }}>
                {senderLine}
              </p>
            )}
            <p style={{ fontSize: "10px", fontWeight: 700, color: "#111827", lineHeight: 1.65 }}>{c.name}</p>
            {clientLines.map((line, i) => (
              <p key={i} style={{ fontSize: "10px", color: "#111827", lineHeight: 1.65 }}>{line}</p>
            ))}
          </div>
          <div style={{ width: "200px", display: "flex", flexDirection: "column" }}>
            <p style={{ fontSize: "7.5px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "6px", textAlign: "right" }}>
              {labels.docDetailsTitle}
            </p>
            {metaRows.map((row) => (
              <MetaRow key={row.label} label={row.label} value={row.value} bold={row.bold} />
            ))}
          </div>
        </div>

        <div style={{ borderBottom: "0.75px solid #e5e7eb", marginBottom: "18px" }} />

        <p style={{ fontSize: "18px", fontWeight: 700, color: "#111827", marginBottom: "4px" }}>{labels.docTitle}</p>
        <p style={{ fontSize: "9px", color: "#6b7280", marginBottom: "20px" }}>
          {doc.number}{"  ·  "}{fmtDate(doc.issueDate)}
        </p>

        {doc.introText && (
          <p style={{ fontSize: "9.5px", color: "#374151", lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: "18px" }}>
            {doc.introText}
          </p>
        )}

        <div style={{ display: "flex", background: "#f3f4f6", padding: "7px 8px", marginBottom: "2px" }}>
          <span style={hdr(COL_FLEX.desc)}>{labels.colDescription}</span>
          <span style={hdr(COL_FLEX.qty, "right")}>{labels.colQuantity}</span>
          <span style={hdr(COL_FLEX.price, "right")}>{labels.colUnitPrice}</span>
          {!isSmallBusiness && <span style={hdr(COL_FLEX.vat, "right")}>{labels.vat}</span>}
          <span style={hdr(COL_FLEX.amount, "right")}>{labels.colAmount}</span>
        </div>

        {doc.lineItems.map((item, i) => (
          <div key={item.id ?? i} style={{ display: "flex", padding: "7px 8px", borderBottom: "0.5px solid #f3f4f6" }}>
            <span style={cell(COL_FLEX.desc)}>{item.description}</span>
            <span style={cell(COL_FLEX.qty, "right")}>
              {Number(item.quantity).toLocaleString("de-DE")}{item.unit ? ` ${item.unit}` : ""}
            </span>
            <span style={cell(COL_FLEX.price, "right")}>{fmt(item.unitPrice)}</span>
            {!isSmallBusiness && <span style={cell(COL_FLEX.vat, "right")}>{item.vatRate} %</span>}
            <span style={cell(COL_FLEX.amount, "right")}>{fmt(item.amount)}</span>
          </div>
        ))}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "14px" }}>
          <div style={{ width: "200px" }}>
            {isSmallBusiness ? (
              <>
                {showDiscountLine && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "2.5px 0" }}>
                      <span style={{ fontSize: "9.5px", color: "#6b7280" }}>{labels.subtotalGross}</span>
                      <span style={{ fontSize: "9.5px", color: "#111827", textAlign: "right" }}>{fmt(subtotalBeforeDiscount)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "2.5px 0" }}>
                      <span style={{ fontSize: "9.5px", color: "#6b7280" }}>{labels.discountLabel}</span>
                      <span style={{ fontSize: "9.5px", color: "#111827", textAlign: "right" }}>-{fmt(discountAmount)}</span>
                    </div>
                  </>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid #111827" }}>
                  <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#111827" }}>{labels.totalSimple}</span>
                  <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#111827", textAlign: "right" }}>{fmt(doc.subtotal)}</span>
                </div>
              </>
            ) : (
              <>
                {showDiscountLine && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "2.5px 0" }}>
                      <span style={{ fontSize: "9.5px", color: "#6b7280" }}>{labels.subtotalGross}</span>
                      <span style={{ fontSize: "9.5px", color: "#111827", textAlign: "right" }}>{fmt(subtotalBeforeDiscount)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "2.5px 0" }}>
                      <span style={{ fontSize: "9.5px", color: "#6b7280" }}>{labels.discountLabel}</span>
                      <span style={{ fontSize: "9.5px", color: "#111827", textAlign: "right" }}>-{fmt(discountAmount)}</span>
                    </div>
                  </>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "2.5px 0" }}>
                  <span style={{ fontSize: "9.5px", color: "#6b7280" }}>{labels.subtotal}</span>
                  <span style={{ fontSize: "9.5px", color: "#111827", textAlign: "right" }}>{fmt(doc.subtotal)}</span>
                </div>
                {Object.entries(taxGroups).filter(([, v]) => v > 0.001).map(([rate, amount]) => (
                  <div key={rate} style={{ display: "flex", justifyContent: "space-between", padding: "2.5px 0" }}>
                    <span style={{ fontSize: "9.5px", color: "#6b7280" }}>{labels.vat} {rate} %</span>
                    <span style={{ fontSize: "9.5px", color: "#111827", textAlign: "right" }}>{fmt(amount)}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid #111827", marginTop: "4px" }}>
                  <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#111827" }}>{labels.grandTotal}</span>
                  <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#111827", textAlign: "right" }}>{fmt(doc.total)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {legalNotice && (
          <div style={{ marginTop: "18px", padding: "8px 10px", background: "#fefce8", borderRadius: "4px", border: "0.5px solid #fde68a" }}>
            <p style={{ fontSize: "8.5px", fontWeight: 700, color: "#92400e", lineHeight: 1.6 }}>{legalNotice}</p>
          </div>
        )}

        {(doc.notes || s?.defaultNotes) && (
          <div style={{ marginTop: "28px" }}>
            <p style={{ fontSize: "8.5px", color: "#6b7280", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {doc.notes ?? s?.defaultNotes}
            </p>
          </div>
        )}

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "0.5px solid #d1d5db", paddingTop: "10px", marginTop: "auto", gap: "8px" }}>
          <FooterBlock>
            {companyNameLine && <FooterLine>{companyNameLine}</FooterLine>}
            {s?.address       && <FooterLine>{s.address}</FooterLine>}
            {cityLine         && <FooterLine>{cityLine}</FooterLine>}
            {s?.country       && <FooterLine>{s.country}</FooterLine>}
          </FooterBlock>
          <FooterBlock>
            {s?.email   && <FooterLine>{s.email}</FooterLine>}
            {s?.phone   && <FooterLine>{s.phone}</FooterLine>}
            {s?.website && <FooterLine>{s.website}</FooterLine>}
          </FooterBlock>
          <FooterBlock>
            {s?.vatId            && <FooterLine>{labels.footerVat} {s.vatId}</FooterLine>}
            {s?.taxId            && <FooterLine>{labels.footerTaxId} {s.taxId}</FooterLine>}
            {s?.managingDirector && <FooterLine>{labels.footerManagingDirector} {s.managingDirector}</FooterLine>}
            {s?.ownerName        && <FooterLine>{labels.footerOwner} {s.ownerName}</FooterLine>}
          </FooterBlock>
          <FooterBlock alignRight>
            {s?.bankName && <FooterLine>{s.bankName}</FooterLine>}
            {s?.iban     && <FooterLine>{s.iban}</FooterLine>}
            {s?.bic      && <FooterLine>{s.bic}</FooterLine>}
            <FooterLine style={{ color: "#c4c9d4", marginTop: "4px" }}>{labels.page} 1 / 1</FooterLine>
          </FooterBlock>
        </div>
      </div>
    </div>
  );
}

function hdr(flex: string, align: "left" | "right" = "left"): React.CSSProperties {
  return { fontSize: "8.5px", fontWeight: 700, color: "#374151", flex, minWidth: 0, textAlign: align };
}
function cell(flex: string, align: "left" | "right" = "left"): React.CSSProperties {
  return { fontSize: "9.5px", color: "#111827", flex, minWidth: 0, textAlign: align };
}

function FooterBlock({ alignRight, children }: { alignRight?: boolean; children: React.ReactNode }) {
  return <div style={{ flex: 1, textAlign: alignRight ? "right" : "left" }}>{children}</div>;
}
function FooterLine({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <p style={{ fontSize: "7.5px", color: "#9ca3af", lineHeight: 1.6, ...style }}>{children}</p>;
}
function MetaRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "row", marginBottom: "3px" }}>
      <span style={{ fontSize: "9px", color: "#6b7280", flex: 1 }}>{label}</span>
      <span style={{ fontSize: "9px", fontWeight: bold ? 700 : 400, color: "#111827", textAlign: "right" }}>{value}</span>
    </div>
  );
}
