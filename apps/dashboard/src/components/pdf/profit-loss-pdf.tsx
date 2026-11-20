import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import type { CompanySettings } from "@prisma/client";
import type { ProfitLossResult } from "@/lib/reports/profit-loss";

// Layout-Prinzip:
// Officially required content of an EÜR / GuV (company header, period,
// income/expense breakdown, signed summary) served in a modern, legible
// layout that doesn't look like it was faxed in 1998. DIN 5008 margins,
// sober colour accents, tabular numerals.

type Group = {
  key: string;
  label: string;
  total: number;
  rows: Array<{ code: string; label: string; value: number }>;
};

interface Props {
  settings: CompanySettings | null;
  result: ProfitLossResult;
  incomeGroups: Group[];
  expenseGroups: Group[];
  generatedAt: Date;
}

const COLOR = {
  ink: "#0f172a",
  body: "#1f2937",
  muted: "#6b7280",
  faint: "#9ca3af",
  hair: "#e5e7eb",
  rule: "#d1d5db",
  profit: "#047857",
  profitBg: "#ecfdf5",
  loss: "#b91c1c",
  lossBg: "#fef2f2",
  accent: "#0f172a",
  surface: "#f8fafc",
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: COLOR.body,
    backgroundColor: "#ffffff",
    paddingTop: 40,
    paddingBottom: 60,
    paddingLeft: 57,
    paddingRight: 45,
  },

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
  },
  headerLeft: { flex: 1 },
  companyName: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: COLOR.ink,
  },
  companyLine: {
    fontSize: 8.5,
    color: COLOR.muted,
    marginTop: 2,
    lineHeight: 1.5,
  },
  logo: {
    width: 54,
    height: 54,
    objectFit: "contain",
    objectPosition: "right top",
  },

  // ── Title block ────────────────────────────────────────────────────────────
  titleBlock: {
    marginTop: 6,
    marginBottom: 20,
    paddingBottom: 14,
    borderBottomWidth: 1.5,
    borderBottomColor: COLOR.accent,
  },
  kicker: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: COLOR.muted,
  },
  title: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: COLOR.ink,
    marginTop: 4,
  },
  titleMeta: {
    flexDirection: "row",
    marginTop: 8,
    gap: 24,
  },
  titleMetaItem: {
    flexDirection: "column",
  },
  titleMetaLabel: {
    fontSize: 7.5,
    color: COLOR.faint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  titleMetaValue: {
    fontSize: 10,
    color: COLOR.ink,
    fontFamily: "Helvetica-Bold",
    marginTop: 2,
  },

  // ── Summary (hero) ─────────────────────────────────────────────────────────
  summaryRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 22,
  },
  summaryCard: {
    flex: 1,
    borderWidth: 0.75,
    borderColor: COLOR.hair,
    borderRadius: 6,
    padding: 10,
    backgroundColor: COLOR.surface,
  },
  summaryResultCard: {
    flex: 1.3,
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
  },
  summaryLabel: {
    fontSize: 7.5,
    color: COLOR.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  summaryValue: {
    fontSize: 14,
    color: COLOR.ink,
    fontFamily: "Helvetica-Bold",
    marginTop: 4,
  },
  summaryValueLg: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    marginTop: 4,
  },
  summarySub: {
    fontSize: 8,
    color: COLOR.muted,
    marginTop: 4,
  },

  // ── Section heading ────────────────────────────────────────────────────────
  sectionHeading: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 6,
    marginBottom: 10,
    paddingBottom: 5,
    borderBottomWidth: 0.75,
    borderBottomColor: COLOR.rule,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: COLOR.ink,
    letterSpacing: 0.3,
  },
  sectionTotal: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: COLOR.ink,
  },

  // ── Group rows ─────────────────────────────────────────────────────────────
  group: {
    marginBottom: 10,
  },
  groupHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 3,
  },
  groupLabel: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: COLOR.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  groupTotal: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: COLOR.ink,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    borderBottomWidth: 0.3,
    borderBottomColor: COLOR.hair,
  },
  rowLabel: {
    fontSize: 9.5,
    color: COLOR.body,
    flex: 1,
    paddingRight: 12,
  },
  rowValue: {
    fontSize: 9.5,
    color: COLOR.ink,
    textAlign: "right",
    minWidth: 90,
  },

  // ── Result / signature block ───────────────────────────────────────────────
  resultBlock: {
    marginTop: 18,
    borderTopWidth: 1.5,
    borderTopColor: COLOR.accent,
    paddingTop: 12,
  },
  resultRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  resultLabel: {
    fontSize: 10,
    color: COLOR.body,
  },
  resultValue: {
    fontSize: 10,
    color: COLOR.ink,
    fontFamily: "Helvetica-Bold",
  },
  resultFinalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 10,
    marginTop: 6,
    borderTopWidth: 0.75,
    borderTopColor: COLOR.rule,
  },
  resultFinalLabel: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: COLOR.ink,
  },
  resultFinalValue: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
  },

  // ── VAT context ────────────────────────────────────────────────────────────
  vatBlock: {
    marginTop: 16,
    padding: 10,
    backgroundColor: COLOR.surface,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: COLOR.hair,
  },
  vatTitle: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: COLOR.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  vatRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 1.5,
  },
  vatLabel: {
    fontSize: 9,
    color: COLOR.body,
  },
  vatValue: {
    fontSize: 9,
    color: COLOR.ink,
    fontFamily: "Helvetica-Bold",
  },

  // ── Signature ──────────────────────────────────────────────────────────────
  signatureBlock: {
    marginTop: 30,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 24,
  },
  signatureCol: {
    flex: 1,
  },
  signatureLine: {
    borderBottomWidth: 0.5,
    borderBottomColor: COLOR.body,
    height: 28,
    marginBottom: 4,
  },
  signatureLabel: {
    fontSize: 7.5,
    color: COLOR.muted,
  },
  signatureHint: {
    fontSize: 7.5,
    color: COLOR.faint,
    marginTop: 10,
    lineHeight: 1.5,
  },

  // ── Footer (fixed) ─────────────────────────────────────────────────────────
  footer: {
    position: "absolute",
    bottom: 24,
    left: 57,
    right: 45,
    borderTopWidth: 0.5,
    borderTopColor: COLOR.rule,
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
    color: COLOR.faint,
  },
  footerPage: {
    fontSize: 7.5,
    color: "#c4c9d4",
    marginTop: 4,
  },
});

function fmt(val: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(val);
}

function fmtDate(d: Date) {
  return new Date(d).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtDateTime(d: Date) {
  return new Date(d).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ProfitLossPDF({
  settings: s,
  result,
  incomeGroups,
  expenseGroups,
  generatedAt,
}: Props) {
  const isEur = result.method === "EUR";
  const docTitle = isEur ? "Einnahmen-Überschuss-Rechnung" : "Gewinn- und Verlustrechnung";
  const docKicker = isEur
    ? "EÜR · §4 Abs. 3 EStG · Zufluss-/Abflussprinzip"
    : "GuV · Periodengerechte Abgrenzung · Soll-/Realisationsprinzip";

  const resultState: "profit" | "loss" | "neutral" =
    result.result > 0.005 ? "profit" : result.result < -0.005 ? "loss" : "neutral";

  const resultColor =
    resultState === "profit"
      ? COLOR.profit
      : resultState === "loss"
      ? COLOR.loss
      : COLOR.ink;
  const resultBg =
    resultState === "profit"
      ? COLOR.profitBg
      : resultState === "loss"
      ? COLOR.lossBg
      : COLOR.surface;

  const companyAddressLines = [
    [s?.zip, s?.city].filter(Boolean).join(" "),
    s?.country && s.country !== "DE" ? s.country : null,
  ].filter(Boolean) as string[];

  const companyNameLine = [s?.name, s?.nameSuffix].filter(Boolean).join(" ");
  const cityLine = [s?.zip, s?.city].filter(Boolean).join(" ");

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* ── Company header ─────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {companyNameLine ? <Text style={styles.companyName}>{companyNameLine}</Text> : null}
            {s?.ownerName ? <Text style={styles.companyLine}>{s.ownerName}</Text> : null}
            {s?.address ? <Text style={styles.companyLine}>{s.address}</Text> : null}
            {companyAddressLines.map((l, i) => (
              <Text key={i} style={styles.companyLine}>
                {l}
              </Text>
            ))}
          </View>
          {s?.logoBase64 ? <Image src={s.logoBase64} style={styles.logo} /> : null}
        </View>

        {/* ── Title ──────────────────────────────────────────────────────── */}
        <View style={styles.titleBlock}>
          <Text style={styles.kicker}>{docKicker}</Text>
          <Text style={styles.title}>{docTitle}</Text>
          <View style={styles.titleMeta}>
            <View style={styles.titleMetaItem}>
              <Text style={styles.titleMetaLabel}>Zeitraum</Text>
              <Text style={styles.titleMetaValue}>
                {fmtDate(result.from)} – {fmtDate(result.to)}
              </Text>
            </View>
            <View style={styles.titleMetaItem}>
              <Text style={styles.titleMetaLabel}>Erstellt am</Text>
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

        {/* ── Summary hero ──────────────────────────────────────────────── */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Einnahmen</Text>
            <Text style={styles.summaryValue}>{fmt(result.incomeTotal)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Ausgaben</Text>
            <Text style={styles.summaryValue}>{fmt(result.expenseTotal)}</Text>
          </View>
          <View
            style={[
              styles.summaryResultCard,
              { borderColor: resultColor, backgroundColor: resultBg },
            ]}
          >
            <Text style={[styles.summaryLabel, { color: resultColor }]}>
              {resultState === "loss" ? "Verlust" : "Gewinn"}
            </Text>
            <Text style={[styles.summaryValueLg, { color: resultColor }]}>
              {fmt(result.result)}
            </Text>
            {result.incomeTotal > 0 ? (
              <Text style={styles.summarySub}>
                Marge:{" "}
                {new Intl.NumberFormat("de-DE", {
                  style: "percent",
                  maximumFractionDigits: 1,
                }).format(result.margin)}
              </Text>
            ) : null}
          </View>
        </View>

        {/* ── Income breakdown ──────────────────────────────────────────── */}
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>1. Betriebseinnahmen</Text>
          <Text style={styles.sectionTotal}>{fmt(result.incomeTotal)}</Text>
        </View>
        {incomeGroups.length === 0 ? (
          <Text style={{ fontSize: 9, color: COLOR.muted, marginBottom: 10 }}>
            Keine Einnahmen im Zeitraum.
          </Text>
        ) : (
          incomeGroups.map((g) => (
            <View key={g.key} style={styles.group} wrap={false}>
              <View style={styles.groupHead}>
                <Text style={styles.groupLabel}>{g.label}</Text>
                <Text style={styles.groupTotal}>{fmt(g.total)}</Text>
              </View>
              {g.rows.map((r) => (
                <View key={r.code} style={styles.row}>
                  <Text style={styles.rowLabel}>{r.label}</Text>
                  <Text style={styles.rowValue}>{fmt(r.value)}</Text>
                </View>
              ))}
            </View>
          ))
        )}

        {/* ── Expense breakdown ─────────────────────────────────────────── */}
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>2. Betriebsausgaben</Text>
          <Text style={styles.sectionTotal}>{fmt(result.expenseTotal)}</Text>
        </View>
        {expenseGroups.length === 0 ? (
          <Text style={{ fontSize: 9, color: COLOR.muted, marginBottom: 10 }}>
            Keine Ausgaben im Zeitraum.
          </Text>
        ) : (
          expenseGroups.map((g) => (
            <View key={g.key} style={styles.group} wrap={false}>
              <View style={styles.groupHead}>
                <Text style={styles.groupLabel}>{g.label}</Text>
                <Text style={styles.groupTotal}>{fmt(g.total)}</Text>
              </View>
              {g.rows.map((r) => (
                <View key={r.code} style={styles.row}>
                  <Text style={styles.rowLabel}>{r.label}</Text>
                  <Text style={styles.rowValue}>{fmt(r.value)}</Text>
                </View>
              ))}
            </View>
          ))
        )}

        {/* ── Signed result ─────────────────────────────────────────────── */}
        <View style={styles.resultBlock} wrap={false}>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Summe Betriebseinnahmen</Text>
            <Text style={styles.resultValue}>{fmt(result.incomeTotal)}</Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Summe Betriebsausgaben</Text>
            <Text style={styles.resultValue}>./. {fmt(result.expenseTotal)}</Text>
          </View>
          <View style={styles.resultFinalRow}>
            <Text style={styles.resultFinalLabel}>
              {resultState === "loss" ? "Verlust" : "Gewinn / Überschuss"}
            </Text>
            <Text style={[styles.resultFinalValue, { color: resultColor }]}>
              {fmt(result.result)}
            </Text>
          </View>
        </View>

        {/* ── VAT context ───────────────────────────────────────────────── */}
        {Math.abs(result.salesVat) > 0.005 || Math.abs(result.inputVat) > 0.005 ? (
          <View style={styles.vatBlock} wrap={false}>
            <Text style={styles.vatTitle}>Nachrichtlich: Umsatzsteuer im Zeitraum</Text>
            <View style={styles.vatRow}>
              <Text style={styles.vatLabel}>Umsatzsteuer (vereinnahmt)</Text>
              <Text style={styles.vatValue}>{fmt(result.salesVat)}</Text>
            </View>
            <View style={styles.vatRow}>
              <Text style={styles.vatLabel}>Vorsteuer (gezahlt)</Text>
              <Text style={styles.vatValue}>{fmt(result.inputVat)}</Text>
            </View>
            <View style={[styles.vatRow, { borderTopWidth: 0.5, borderTopColor: COLOR.rule, paddingTop: 4, marginTop: 2 }]}>
              <Text style={[styles.vatLabel, { fontFamily: "Helvetica-Bold" }]}>Zahllast / Erstattung</Text>
              <Text style={styles.vatValue}>{fmt(result.salesVat - result.inputVat)}</Text>
            </View>
          </View>
        ) : null}

        {/* ── Signature ─────────────────────────────────────────────────── */}
        <View style={styles.signatureBlock} wrap={false}>
          <View style={styles.signatureCol}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>
              Ort, Datum
            </Text>
          </View>
          <View style={styles.signatureCol}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>
              Unterschrift{s?.ownerName ? ` (${s.ownerName})` : s?.managingDirector ? ` (${s.managingDirector})` : ""}
            </Text>
          </View>
        </View>

        <Text style={styles.signatureHint}>
          Erstellt mit Zoonox am {fmtDateTime(generatedAt)}. Beträge in Euro.
          Die Auswertung basiert auf den zum Erstellungszeitpunkt finalisierten Buchungen und ist unverbindlich bis zur steuerlichen Feststellung.
        </Text>

        {/* ── Footer (fixed) ────────────────────────────────────────────── */}
        <View style={styles.footer} fixed>
          <View style={styles.footerBlock}>
            {companyNameLine ? <Text style={styles.footerText}>{companyNameLine}</Text> : null}
            {s?.address ? <Text style={styles.footerText}>{s.address}</Text> : null}
            {cityLine ? <Text style={styles.footerText}>{cityLine}</Text> : null}
            {s?.country ? <Text style={styles.footerText}>{s.country}</Text> : null}
          </View>
          <View style={styles.footerBlock}>
            {s?.email ? <Text style={styles.footerText}>{s.email}</Text> : null}
            {s?.phone ? <Text style={styles.footerText}>{s.phone}</Text> : null}
            {s?.website ? <Text style={styles.footerText}>{s.website}</Text> : null}
          </View>
          <View style={styles.footerBlock}>
            {s?.vatId ? <Text style={styles.footerText}>USt-IdNr.: {s.vatId}</Text> : null}
            {s?.taxId ? <Text style={styles.footerText}>St.-Nr.: {s.taxId}</Text> : null}
            {s?.managingDirector ? (
              <Text style={styles.footerText}>GF: {s.managingDirector}</Text>
            ) : null}
          </View>
          <View style={styles.footerBlockLast}>
            {s?.bankName ? <Text style={styles.footerText}>{s.bankName}</Text> : null}
            {s?.iban ? <Text style={styles.footerText}>{s.iban}</Text> : null}
            {s?.bic ? <Text style={styles.footerText}>{s.bic}</Text> : null}
            <Text
              style={styles.footerPage}
              render={({ pageNumber, totalPages }) => `Seite ${pageNumber} / ${totalPages}`}
            />
          </View>
        </View>
      </Page>
    </Document>
  );
}
