import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import type { CompanySettings } from "@prisma/client";
import {
  BWA_SCHEMA,
  getRowMonthly,
  sumYear,
  type BwaResult,
  type BwaYearMatrix,
} from "@/lib/reports/bwa";

// Layout choice: A4 landscape with the 12 months across and BWA rows
// down — that's how a Steuerberater expects to see a "kurzfristige
// Erfolgsrechnung" and exactly how DATEV prints Form 01. Required
// content (firm name, period, signed result, VAT note, signature,
// generation timestamp) is laid out per DIN 5008-friendly margins.

const COLOR = {
  ink: "#0f172a",
  body: "#1f2937",
  muted: "#6b7280",
  faint: "#9ca3af",
  hair: "#e5e7eb",
  rule: "#d1d5db",
  profit: "#047857",
  loss: "#b91c1c",
  accent: "#0f172a",
  surface: "#f8fafc",
  zebraBg: "#fafbfc",
  subtotalBg: "#f1f5f9",
  resultBg: "#ecfdf5",
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 7.5,
    color: COLOR.body,
    backgroundColor: "#ffffff",
    paddingTop: 32,
    paddingBottom: 50,
    paddingLeft: 36,
    paddingRight: 36,
  },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  headerLeft: { flex: 1 },
  companyName: { fontSize: 11, fontFamily: "Helvetica-Bold", color: COLOR.ink },
  companyLine: { fontSize: 8, color: COLOR.muted, marginTop: 2, lineHeight: 1.5 },
  logo: { width: 46, height: 46, objectFit: "contain", objectPosition: "right top" },

  // Title block
  titleBlock: {
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1.2,
    borderBottomColor: COLOR.accent,
  },
  kicker: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 1.1,
    color: COLOR.muted,
  },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", color: COLOR.ink, marginTop: 4 },
  titleMeta: { flexDirection: "row", marginTop: 6, gap: 22 },
  titleMetaItem: { flexDirection: "column" },
  titleMetaLabel: {
    fontSize: 7,
    color: COLOR.faint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  titleMetaValue: {
    fontSize: 9,
    color: COLOR.ink,
    fontFamily: "Helvetica-Bold",
    marginTop: 2,
  },

  // Table
  table: { borderTopWidth: 0.5, borderTopColor: COLOR.rule },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.4,
    borderBottomColor: COLOR.hair,
  },
  headerRow: {
    flexDirection: "row",
    backgroundColor: COLOR.subtotalBg,
    borderBottomWidth: 0.6,
    borderBottomColor: COLOR.rule,
  },
  subtotalRow: {
    flexDirection: "row",
    backgroundColor: COLOR.subtotalBg,
    borderTopWidth: 0.6,
    borderTopColor: COLOR.rule,
    borderBottomWidth: 0.5,
    borderBottomColor: COLOR.rule,
  },
  resultRow: {
    flexDirection: "row",
    backgroundColor: COLOR.resultBg,
    borderTopWidth: 1.5,
    borderTopColor: COLOR.profit,
    borderBottomWidth: 0.6,
    borderBottomColor: COLOR.profit,
  },
  zebraRow: {
    flexDirection: "row",
    backgroundColor: COLOR.zebraBg,
    borderBottomWidth: 0.4,
    borderBottomColor: COLOR.hair,
  },
  labelCell: {
    flex: 2.6,
    paddingVertical: 4.5,
    paddingHorizontal: 6,
  },
  monthCell: {
    flex: 1,
    paddingVertical: 4.5,
    paddingHorizontal: 3,
    textAlign: "right",
  },
  yearCell: {
    flex: 1.3,
    paddingVertical: 4.5,
    paddingHorizontal: 6,
    textAlign: "right",
    borderLeftWidth: 0.5,
    borderLeftColor: COLOR.rule,
  },
  priorYearCell: {
    flex: 1.3,
    paddingVertical: 4.5,
    paddingHorizontal: 6,
    textAlign: "right",
  },
  deltaCell: {
    flex: 1.3,
    paddingVertical: 4.5,
    paddingHorizontal: 6,
    textAlign: "right",
  },

  // Cell text
  headerCellText: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: COLOR.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  labelText: { fontSize: 8, color: COLOR.body },
  labelTextSubtotal: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: COLOR.ink },
  labelTextResult: { fontSize: 9, fontFamily: "Helvetica-Bold", color: COLOR.profit },
  valueText: { fontSize: 7.5, color: COLOR.body, textAlign: "right" },
  valueTextStrong: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COLOR.ink,
    textAlign: "right",
  },
  valueTextResult: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: COLOR.profit,
    textAlign: "right",
  },
  valueTextLoss: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: COLOR.loss,
    textAlign: "right",
  },
  deltaPositive: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: COLOR.profit,
    textAlign: "right",
  },
  deltaNegative: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: COLOR.loss,
    textAlign: "right",
  },

  // VAT context
  vatBlock: {
    marginTop: 14,
    padding: 8,
    backgroundColor: COLOR.surface,
    borderRadius: 3,
    borderWidth: 0.5,
    borderColor: COLOR.hair,
    width: 280,
  },
  vatTitle: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: COLOR.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  vatRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 1.5,
  },
  vatLabel: { fontSize: 8, color: COLOR.body },
  vatValue: { fontSize: 8, color: COLOR.ink, fontFamily: "Helvetica-Bold" },

  // Disclaimer + signature
  disclaimer: {
    marginTop: 14,
    fontSize: 7,
    color: COLOR.faint,
    lineHeight: 1.5,
  },
  signatureBlock: {
    marginTop: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 24,
  },
  signatureCol: { flex: 1 },
  signatureLine: {
    borderBottomWidth: 0.5,
    borderBottomColor: COLOR.body,
    height: 22,
    marginBottom: 4,
  },
  signatureLabel: { fontSize: 7, color: COLOR.muted },

  // Footer
  footer: {
    position: "absolute",
    bottom: 18,
    left: 36,
    right: 36,
    borderTopWidth: 0.5,
    borderTopColor: COLOR.rule,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerBlock: { flexDirection: "column", gap: 1.5, flex: 1 },
  footerBlockLast: {
    flexDirection: "column",
    gap: 1.5,
    flex: 1,
    alignItems: "flex-end",
  },
  footerText: { fontSize: 6.5, color: COLOR.faint },
  footerPage: { fontSize: 6.5, color: "#c4c9d4", marginTop: 3 },
});

// ── Helpers ────────────────────────────────────────────────────────────────

const CURRENCY_FMT = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const CURRENCY_SIGNED_FMT = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
});

function fmt(n: number): string {
  if (Math.abs(n) < 0.005) return "—";
  return CURRENCY_FMT.format(n);
}

function fmtSigned(n: number): string {
  if (Math.abs(n) < 0.005) return "—";
  return CURRENCY_SIGNED_FMT.format(n);
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Props ──────────────────────────────────────────────────────────────────

type I18n = {
  monthLabels: string[]; // length 12
  rowLabels: Record<string, string>;
  methodLabel: string;
  kicker: string;
  title: string;
  periodLabel: string;
  createdAtLabel: string;
  methodMetaLabel: string;
  yearTotalLabel: string;
  priorYearTotalLabel: string;
  yearChangeLabel: string;
  categoryLabel: string;
  vatTitle: string;
  vatSales: string;
  vatInput: string;
  vatBalance: string;
  disclaimer: string;
  signaturePlace: string;
  signatureLine: string;
  preparedBy: (date: string) => string;
};

interface Props {
  settings: CompanySettings | null;
  result: BwaResult;
  generatedAt: Date;
  i18n: I18n;
}

// ── Document ───────────────────────────────────────────────────────────────

export function BwaPDF({ settings: s, result, generatedAt, i18n }: Props) {
  const compare = result.prior !== null;
  const opResultYear = sumYear(getRowMonthly(result.current, "betriebsergebnis"));
  const companyNameLine = [s?.name, s?.nameSuffix].filter(Boolean).join(" ");
  const cityLine = [s?.zip, s?.city].filter(Boolean).join(" ");

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        {/* Company header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {companyNameLine ? (
              <Text style={styles.companyName}>{companyNameLine}</Text>
            ) : null}
            {s?.ownerName ? <Text style={styles.companyLine}>{s.ownerName}</Text> : null}
            {s?.address ? <Text style={styles.companyLine}>{s.address}</Text> : null}
            {cityLine ? <Text style={styles.companyLine}>{cityLine}</Text> : null}
            {s?.country && s.country !== "DE" ? (
              <Text style={styles.companyLine}>{s.country}</Text>
            ) : null}
          </View>
          {s?.logoBase64 ? <Image src={s.logoBase64} style={styles.logo} /> : null}
        </View>

        {/* Title */}
        <View style={styles.titleBlock}>
          <Text style={styles.kicker}>{i18n.kicker}</Text>
          <Text style={styles.title}>{i18n.title}</Text>
          <View style={styles.titleMeta}>
            <View style={styles.titleMetaItem}>
              <Text style={styles.titleMetaLabel}>{i18n.periodLabel}</Text>
              <Text style={styles.titleMetaValue}>
                01.01.{result.year} – 31.12.{result.year}
              </Text>
            </View>
            <View style={styles.titleMetaItem}>
              <Text style={styles.titleMetaLabel}>{i18n.methodMetaLabel}</Text>
              <Text style={styles.titleMetaValue}>{i18n.methodLabel}</Text>
            </View>
            <View style={styles.titleMetaItem}>
              <Text style={styles.titleMetaLabel}>{i18n.createdAtLabel}</Text>
              <Text style={styles.titleMetaValue}>{fmtDateTime(generatedAt)}</Text>
            </View>
            {s?.taxId ? (
              <View style={styles.titleMetaItem}>
                <Text style={styles.titleMetaLabel}>Steuernummer</Text>
                <Text style={styles.titleMetaValue}>{s.taxId}</Text>
              </View>
            ) : null}
            {s?.vatId ? (
              <View style={styles.titleMetaItem}>
                <Text style={styles.titleMetaLabel}>USt-IdNr.</Text>
                <Text style={styles.titleMetaValue}>{s.vatId}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Table header */}
        <View style={styles.table}>
          <View style={styles.headerRow} fixed>
            <View style={styles.labelCell}>
              <Text style={styles.headerCellText}>{i18n.categoryLabel}</Text>
            </View>
            {i18n.monthLabels.map((m, i) => (
              <View key={i} style={styles.monthCell}>
                <Text style={styles.headerCellText}>{m}</Text>
              </View>
            ))}
            <View style={styles.yearCell}>
              <Text style={styles.headerCellText}>{i18n.yearTotalLabel}</Text>
            </View>
            {compare ? (
              <>
                <View style={styles.priorYearCell}>
                  <Text style={styles.headerCellText}>
                    {i18n.priorYearTotalLabel}
                  </Text>
                </View>
                <View style={styles.deltaCell}>
                  <Text style={styles.headerCellText}>{i18n.yearChangeLabel}</Text>
                </View>
              </>
            ) : null}
          </View>

          {/* Rows */}
          {BWA_SCHEMA.map((row, idx) => (
            <BwaPdfRow
              key={row.key}
              row={row}
              matrix={result.current}
              priorMatrix={result.prior}
              label={i18n.rowLabels[row.key] ?? row.key}
              zebra={row.kind === "revenue" || row.kind === "expense" ? idx % 2 === 0 : false}
            />
          ))}
        </View>

        {/* VAT context */}
        {Math.abs(result.salesVatYear) > 0.005 || Math.abs(result.inputVatYear) > 0.005 ? (
          <View style={styles.vatBlock} wrap={false}>
            <Text style={styles.vatTitle}>{i18n.vatTitle}</Text>
            <View style={styles.vatRow}>
              <Text style={styles.vatLabel}>{i18n.vatSales}</Text>
              <Text style={styles.vatValue}>{fmt(result.salesVatYear)}</Text>
            </View>
            <View style={styles.vatRow}>
              <Text style={styles.vatLabel}>{i18n.vatInput}</Text>
              <Text style={styles.vatValue}>{fmt(result.inputVatYear)}</Text>
            </View>
            <View
              style={[
                styles.vatRow,
                {
                  borderTopWidth: 0.5,
                  borderTopColor: COLOR.rule,
                  paddingTop: 3,
                  marginTop: 2,
                },
              ]}
            >
              <Text style={[styles.vatLabel, { fontFamily: "Helvetica-Bold" }]}>
                {i18n.vatBalance}
              </Text>
              <Text style={styles.vatValue}>
                {fmt(result.salesVatYear - result.inputVatYear)}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Disclaimer */}
        <Text style={styles.disclaimer}>{i18n.disclaimer}</Text>

        {/* Signature */}
        <View style={styles.signatureBlock} wrap={false}>
          <View style={styles.signatureCol}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>{i18n.signaturePlace}</Text>
          </View>
          <View style={styles.signatureCol}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>
              {i18n.signatureLine}
              {s?.ownerName
                ? ` (${s.ownerName})`
                : s?.managingDirector
                ? ` (${s.managingDirector})`
                : ""}
            </Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <View style={styles.footerBlock}>
            {companyNameLine ? (
              <Text style={styles.footerText}>{companyNameLine}</Text>
            ) : null}
            {s?.address ? <Text style={styles.footerText}>{s.address}</Text> : null}
            {cityLine ? <Text style={styles.footerText}>{cityLine}</Text> : null}
          </View>
          <View style={styles.footerBlock}>
            {s?.email ? <Text style={styles.footerText}>{s.email}</Text> : null}
            {s?.phone ? <Text style={styles.footerText}>{s.phone}</Text> : null}
            {s?.website ? <Text style={styles.footerText}>{s.website}</Text> : null}
          </View>
          <View style={styles.footerBlock}>
            {s?.vatId ? (
              <Text style={styles.footerText}>USt-IdNr.: {s.vatId}</Text>
            ) : null}
            {s?.taxId ? (
              <Text style={styles.footerText}>St.-Nr.: {s.taxId}</Text>
            ) : null}
            <Text style={styles.footerText}>
              {i18n.preparedBy(fmtDate(generatedAt))}
            </Text>
          </View>
          <View style={styles.footerBlockLast}>
            {s?.bankName ? <Text style={styles.footerText}>{s.bankName}</Text> : null}
            {s?.iban ? <Text style={styles.footerText}>{s.iban}</Text> : null}
            <Text
              style={styles.footerPage}
              render={({ pageNumber, totalPages }) =>
                `Seite ${pageNumber} / ${totalPages}`
              }
            />
            {/* Result summary tucked into the footer for the recipient
                to spot without scrolling — Steuerberater habit. */}
            <Text
              style={{
                fontSize: 6.5,
                color: opResultYear >= 0 ? COLOR.profit : COLOR.loss,
                fontFamily: "Helvetica-Bold",
                marginTop: 2,
              }}
            >
              {result.year} · {fmtSigned(opResultYear)}
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

function BwaPdfRow({
  row,
  matrix,
  priorMatrix,
  label,
  zebra,
}: {
  row: (typeof BWA_SCHEMA)[number];
  matrix: BwaYearMatrix;
  priorMatrix: BwaYearMatrix | null;
  label: string;
  zebra: boolean;
}) {
  const monthly = getRowMonthly(matrix, row.key);
  const yearTotal = sumYear(monthly);
  const priorTotal = priorMatrix ? sumYear(getRowMonthly(priorMatrix, row.key)) : null;
  const delta = priorTotal !== null ? yearTotal - priorTotal : null;

  const isSubtotal = row.kind === "subtotal";
  const isResult = row.kind === "result";

  const rowStyle = isResult
    ? styles.resultRow
    : isSubtotal
    ? styles.subtotalRow
    : zebra
    ? styles.zebraRow
    : styles.row;

  const labelStyle = isResult
    ? styles.labelTextResult
    : isSubtotal
    ? styles.labelTextSubtotal
    : styles.labelText;

  const valueStyle = isResult
    ? yearTotal >= 0
      ? styles.valueTextResult
      : styles.valueTextLoss
    : isSubtotal
    ? styles.valueTextStrong
    : styles.valueText;

  const deltaStyle =
    delta !== null && Math.abs(delta) >= 0.005
      ? delta > 0
        ? styles.deltaPositive
        : styles.deltaNegative
      : styles.valueText;

  return (
    <View style={rowStyle} wrap={false}>
      <View style={styles.labelCell}>
        <Text style={labelStyle}>{label}</Text>
      </View>
      {monthly.map((v, i) => (
        <View key={i} style={styles.monthCell}>
          <Text style={valueStyle}>{fmt(v)}</Text>
        </View>
      ))}
      <View style={styles.yearCell}>
        <Text style={valueStyle}>{fmt(yearTotal)}</Text>
      </View>
      {priorMatrix && (
        <>
          <View style={styles.priorYearCell}>
            <Text style={styles.valueText}>
              {priorTotal !== null ? fmt(priorTotal) : "—"}
            </Text>
          </View>
          <View style={styles.deltaCell}>
            <Text style={deltaStyle}>
              {delta !== null ? fmtSigned(delta) : "—"}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}
