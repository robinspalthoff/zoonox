import type React from "react";
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
  paymentQrEnabled?: boolean;
  globalDiscountType?: string | null;
  globalDiscountValue?: number | string | { toString(): string } | null;
  /** Original invoice — present on credit notes AND corrections. */
  creditNoteFor?: { number: string; issueDate: Date } | null;
};

// CompanySettings gained `ownerName` in migration 20260403110000_add_owner_name.
type Settings = (CompanySettings & { ownerName?: string | null; managingDirector?: string | null }) | null;

const fmt = (v: number | string | { toString(): string }) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(v));

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

// Column flex weights matching the PDF exactly. Using `flex-grow` instead of
// percentage widths so the browser distributes any sub-pixel rounding the
// same way react-pdf does — keeps preview and download pixel-identical.
//   desc=3.5 / qty=1 / price=1.3 / vat=0.8 / amount=1.3   (total 7.9)
const COL_FLEX = {
  desc:   "3.5",
  qty:    "1",
  price:  "1.3",
  vat:    "0.8",
  amount: "1.3",
};

export function InvoiceDocumentPreview({
  invoice,
  settings: s,
  locale,
}: {
  invoice: InvoiceWithRelations;
  settings: Settings;
  locale?: string;
}) {
  const c = invoice.contact;
  const isCreditNote = invoice.type === "CREDIT_NOTE";
  const isCorrection = invoice.type === "CORRECTION";
  const labels = getInvoiceLabels(locale, invoice.type);

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

  // VAT regulation legal notice (hardcoded DE for PDF/preview — matches official legal text)
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

  // EPC QR-Code ("GiroCode") — mirrors invoice-pdf.tsx. Skipped for credit
  // notes, when the per-invoice toggle is off, or when buildEpcQrSvg returns
  // null (no IBAN / non-positive total).
  // Corrections behave like regular invoices for QR purposes — see PDF note.
  const epcQr = !isCreditNote && invoice.paymentQrEnabled !== false
    ? buildEpcQrSvg({
        beneficiaryName: s?.name,
        iban: s?.iban,
        bic: s?.bic,
        amount: Number(invoice.total),
        remittance: `${labels.docTitle} ${invoice.number}`,
      })
    : null;

  return (
    // Force light rendering — never affected by dark mode
    <div style={{ colorScheme: "light" }}>
      <div
        style={{
          fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
          fontSize: "10px",
          color: "#111827",
          background: "#ffffff",
          paddingTop: "40px",
          paddingBottom: "60px",
          paddingLeft: "57px",
          paddingRight: "45px",
          borderRadius: "16px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.10)",
          width: "595px",
          minHeight: "842px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
        }}
      >

        {/* ── Header: logo only — RIGHT aligned ────────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "28px" }}>
          {s?.logoBase64 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={s.logoBase64}
              alt={s.name ?? "Logo"}
              style={{ width: "54px", height: "54px", objectFit: "contain", objectPosition: "right top" }}
            />
          )}
        </div>

        {/* ── Address + meta row ───────────────────────────────────────────── */}
        {/* Geometrie identisch zum PDF: addressBlock flex 1, metaBlock fix 200 px. */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: "24px", marginBottom: "28px" }}>

          {/* LEFT: sender breadcrumb + client address */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {senderLine && (
              <p style={{
                fontSize: "7.5px",
                color: "#9ca3af",
                borderBottom: "0.5px solid #e5e7eb",
                paddingBottom: "3px",
                marginBottom: "6px",
              }}>
                {senderLine}
              </p>
            )}
            <p style={{ fontSize: "10px", fontWeight: 700, color: "#111827", lineHeight: 1.65 }}>{c.name}</p>
            {clientLines.map((line, i) => (
              <p key={i} style={{ fontSize: "10px", color: "#111827", lineHeight: 1.65 }}>{line}</p>
            ))}
          </div>

          {/* RIGHT: invoice meta table — label left, value right.
              Fixe 200 px Breite + Default `align-items: stretch`, damit jede
              Zeile die volle Spaltenbreite einnimmt (Label nach links, Wert
              nach rechts via textAlign). */}
          <div style={{ width: "200px", display: "flex", flexDirection: "column" }}>
            <p style={{
              fontSize: "7.5px",
              fontWeight: 700,
              color: "#9ca3af",
              textTransform: "uppercase",
              letterSpacing: "0.6px",
              marginBottom: "6px",
              textAlign: "right",
            }}>
              {labels.docDetailsTitle}
            </p>
            {metaRows.map((row) => (
              <MetaRow key={row.label} label={row.label} value={row.value} bold={row.bold} />
            ))}
          </div>
        </div>

        {/* ── Divider ──────────────────────────────────────────────────────── */}
        <div style={{ borderBottom: "0.75px solid #e5e7eb", marginBottom: "18px" }} />

        {/* ── Invoice title ─────────────────────────────────────────────────── */}
        <p style={{ fontSize: "18px", fontWeight: 700, color: "#111827", marginBottom: "4px" }}>{labels.docTitle}</p>
        <p style={{ fontSize: "9px", color: "#6b7280", marginBottom: isCorrection && invoice.creditNoteFor ? "4px" : "20px" }}>
          {invoice.number}{"  ·  "}{fmtDate(invoice.issueDate)}
        </p>
        {isCorrection && invoice.creditNoteFor && (
          <p style={{ fontSize: "9px", color: "#6b7280", marginBottom: "20px" }}>
            {labels.correctionRefLabel} {invoice.creditNoteFor.number} {labels.dateConnector} {fmtDate(invoice.creditNoteFor.issueDate)}
          </p>
        )}

        {/* ── Intro text ────────────────────────────────────────────────────── */}
        {invoice.introText && (
          <p style={{ fontSize: "9.5px", color: "#374151", lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: "18px" }}>
            {invoice.introText}
          </p>
        )}

        {/* ── Line items table ──────────────────────────────────────────────── */}
        <div style={{
          display: "flex",
          background: "#f3f4f6",
          padding: "7px 8px",
          marginBottom: "2px",
        }}>
          <span style={{ fontSize: "8.5px", fontWeight: 700, color: "#374151", flex: COL_FLEX.desc, minWidth: 0 }}>{labels.colDescription}</span>
          <span style={{ fontSize: "8.5px", fontWeight: 700, color: "#374151", flex: COL_FLEX.qty, minWidth: 0, textAlign: "right" }}>{labels.colQuantity}</span>
          <span style={{ fontSize: "8.5px", fontWeight: 700, color: "#374151", flex: COL_FLEX.price, minWidth: 0, textAlign: "right" }}>{labels.colUnitPrice}</span>
          {!isSmallBusiness && (
            <span style={{ fontSize: "8.5px", fontWeight: 700, color: "#374151", flex: COL_FLEX.vat, minWidth: 0, textAlign: "right" }}>{labels.vat}</span>
          )}
          <span style={{ fontSize: "8.5px", fontWeight: 700, color: "#374151", flex: COL_FLEX.amount, minWidth: 0, textAlign: "right" }}>{labels.colAmount}</span>
        </div>

        {invoice.lineItems.map((item) => (
          <div key={item.id} style={{
            display: "flex",
            padding: "7px 8px",
            borderBottom: "0.5px solid #f3f4f6",
          }}>
            <span style={{ fontSize: "9.5px", color: "#111827", flex: COL_FLEX.desc, minWidth: 0 }}>{item.description}</span>
            <span style={{ fontSize: "9.5px", color: "#111827", flex: COL_FLEX.qty, minWidth: 0, textAlign: "right" }}>
              {Number(item.quantity).toLocaleString("de-DE")}{item.unit ? ` ${item.unit}` : ""}
            </span>
            <span style={{ fontSize: "9.5px", color: "#111827", flex: COL_FLEX.price, minWidth: 0, textAlign: "right" }}>{fmt(item.unitPrice)}</span>
            {!isSmallBusiness && (
              <span style={{ fontSize: "9.5px", color: "#111827", flex: COL_FLEX.vat, minWidth: 0, textAlign: "right" }}>{item.vatRate} %</span>
            )}
            <span style={{ fontSize: "9.5px", color: "#111827", flex: COL_FLEX.amount, minWidth: 0, textAlign: "right" }}>{fmt(item.amount)}</span>
          </div>
        ))}

        {/* ── Totals ────────────────────────────────────────────────────────── */}
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
                      <span style={{ fontSize: "9.5px", color: "#111827", textAlign: "right" }}>-{fmt(Math.abs(discountAmount))}</span>
                    </div>
                  </>
                )}
                <div style={{
                  display: "flex", justifyContent: "space-between",
                  padding: "6px 0",
                  borderTop: "1px solid #111827",
                }}>
                  <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#111827" }}>{labels.totalSimple}</span>
                  <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#111827", textAlign: "right" }}>{fmt(invoice.subtotal)}</span>
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
                      <span style={{ fontSize: "9.5px", color: "#111827", textAlign: "right" }}>-{fmt(Math.abs(discountAmount))}</span>
                    </div>
                  </>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "2.5px 0" }}>
                  <span style={{ fontSize: "9.5px", color: "#6b7280" }}>{labels.subtotal}</span>
                  <span style={{ fontSize: "9.5px", color: "#111827", textAlign: "right" }}>{fmt(invoice.subtotal)}</span>
                </div>
                {Object.entries(taxGroups).filter(([, v]) => Math.abs(v) > 0.001).map(([rate, amount]) => (
                  <div key={rate} style={{ display: "flex", justifyContent: "space-between", padding: "2.5px 0" }}>
                    <span style={{ fontSize: "9.5px", color: "#6b7280" }}>{labels.vat} {rate} %</span>
                    <span style={{ fontSize: "9.5px", color: "#111827", textAlign: "right" }}>{fmt(amount)}</span>
                  </div>
                ))}
                <div style={{
                  display: "flex", justifyContent: "space-between",
                  padding: "6px 0",
                  borderTop: "1px solid #111827",
                  marginTop: "4px",
                }}>
                  <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#111827" }}>{labels.grandTotal}</span>
                  <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#111827", textAlign: "right" }}>{fmt(invoice.total)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── VAT regulation legal notice ─────────────────────────────── */}
        {legalNotice && (
          <div style={{ marginTop: "18px", padding: "8px 10px", background: "#fefce8", borderRadius: "4px", border: "0.5px solid #fde68a" }}>
            <p style={{ fontSize: "8.5px", fontWeight: 700, color: "#92400e", lineHeight: 1.6 }}>
              {legalNotice}
            </p>
          </div>
        )}

        {/* ── EPC QR-Code ("GiroCode") payment block ─────────────────────────── */}
        {/* When the toggle is on we always render something so the preview
            visibly reflects the toggle: the real QR once an IBAN + a positive
            amount exist, otherwise an explanatory placeholder. The placeholder
            is preview-only — the final PDF simply omits the QR. */}
        {!isCreditNote && invoice.paymentQrEnabled !== false && (
          epcQr ? (
            <div style={{ marginTop: "22px", display: "flex", alignItems: "center", gap: "14px" }}>
              <svg
                viewBox={epcQr.viewBox}
                xmlns="http://www.w3.org/2000/svg"
                style={{ width: "84px", height: "84px", flexShrink: 0 }}
              >
                <path d={epcQr.path} fill="#111827" />
              </svg>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: "9.5px", fontWeight: 700, color: "#111827", marginBottom: "3px" }}>
                  {labels.qrTitle}
                </p>
                <p style={{ fontSize: "8.5px", color: "#6b7280", lineHeight: 1.6 }}>
                  {labels.qrText}
                </p>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: "22px", display: "flex", alignItems: "center", gap: "14px", border: "1px dashed #d1d5db", borderRadius: "6px", padding: "12px 14px" }}>
              <div style={{ width: "84px", height: "84px", flexShrink: 0, border: "1px dashed #d1d5db", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: "8px", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.5px" }}>QR</span>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: "9.5px", fontWeight: 700, color: "#6b7280", marginBottom: "3px" }}>
                  {labels.qrPlaceholderTitle}
                </p>
                <p style={{ fontSize: "8.5px", color: "#9ca3af", lineHeight: 1.6 }}>
                  {!s?.iban ? labels.qrNoIban : labels.qrNoAmount}
                </p>
              </div>
            </div>
          )
        )}

        {/* ── Notes ─────────────────────────────────────────────────────────── */}
        {(invoice.notes || s?.defaultNotes) && (
          <div style={{ marginTop: "28px" }}>
            <p style={{ fontSize: "8.5px", color: "#6b7280", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {invoice.notes ?? s?.defaultNotes}
            </p>
          </div>
        )}

        {/* ── Spacer — pushes footer to bottom of A4 page ──────────────── */}
        <div style={{ flex: 1 }} />

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          borderTop: "0.5px solid #d1d5db",
          paddingTop: "10px",
          marginTop: "auto",
          gap: "8px",
        }}>

          {/* Block 1: Company info — name, address, city, country */}
          <FooterBlock>
            {companyNameLine    && <FooterLine>{companyNameLine}</FooterLine>}
            {s?.address         && <FooterLine>{s.address}</FooterLine>}
            {cityLine           && <FooterLine>{cityLine}</FooterLine>}
            {s?.country         && <FooterLine>{s.country}</FooterLine>}
          </FooterBlock>

          {/* Block 2: Contact */}
          <FooterBlock>
            {s?.email   && <FooterLine>{s.email}</FooterLine>}
            {s?.phone   && <FooterLine>{s.phone}</FooterLine>}
            {s?.website && <FooterLine>{s.website}</FooterLine>}
          </FooterBlock>

          {/* Block 3: Tax — USt-ID, Steuernr, Geschäftsführung/Inhaber */}
          <FooterBlock>
            {s?.vatId            && <FooterLine>{labels.footerVat} {s.vatId}</FooterLine>}
            {s?.taxId            && <FooterLine>{labels.footerTaxId} {s.taxId}</FooterLine>}
            {s?.managingDirector && <FooterLine>{labels.footerManagingDirector} {s.managingDirector}</FooterLine>}
            {s?.ownerName        && <FooterLine>{labels.footerOwner} {s.ownerName}</FooterLine>}
          </FooterBlock>

          {/* Block 4: Bank info + page */}
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

// ── Footer helpers ────────────────────────────────────────────────────────────

function FooterBlock({
  alignRight,
  children,
}: {
  alignRight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ flex: 1, textAlign: alignRight ? "right" : "left" }}>
      {children}
    </div>
  );
}

function FooterLine({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <p style={{ fontSize: "7.5px", color: "#9ca3af", lineHeight: 1.6, ...style }}>{children}</p>
  );
}

// ── Meta row ─────────────────────────────────────────────────────────────────

// Meta row: label stretches left, value pinned right. Geometrie spiegelt
// das PDF — feste Spaltenbreite ist am Eltern-Container, hier nur Flex-Layout.
function MetaRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "row", marginBottom: "3px" }}>
      <span style={{ fontSize: "9px", color: "#6b7280", flex: 1 }}>{label}</span>
      <span style={{
        fontSize: "9px",
        fontWeight: bold ? 700 : 400,
        color: "#111827",
        textAlign: "right",
      }}>
        {value}
      </span>
    </div>
  );
}
