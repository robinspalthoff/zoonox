/**
 * React-Email template for non-invoice business documents (Angebot / AB).
 *
 * Parallel to invoice-email.tsx but parameterised on `docKind` so the same
 * template renders for both Angebote and Auftragsbestätigungen — they share
 * 90% of the visual identity, only labels and the meta-box vary.
 */

import {
  Body, Container, Head, Heading, Hr, Html, Img,
  Preview, Section, Text, Row, Column,
} from "@react-email/components";
import * as React from "react";

export type BusinessDocKind = "QUOTE" | "ORDER_CONFIRMATION";

interface BusinessDocEmailProps {
  docKind: BusinessDocKind;
  companyName: string;
  logoBase64?: string | null;
  /** Quote/AB number — used in subject, preview, and meta box. */
  docNumber: string;
  /** Issue date, formatted for display (dd.mm.yyyy). */
  docDate: string;
  /** Quote → "Gültig bis", AB → "Liefertermin". Null if unset. */
  deadlineLabel?: string | null;
  deadlineDate?: string | null;
  totalAmount: string;
  customMessage?: string | null;
  recipientName: string;
}

/**
 * Doc-kind-specific German labels. Kept inline (not next-intl) because emails
 * render server-side outside any React i18n context — same convention as the
 * existing invoice-email.tsx.
 */
const LABELS: Record<BusinessDocKind, {
  label: string;            // "Angebot" / "Auftragsbestätigung"
  numberFieldLabel: string; // "Angebotsnummer" / "AB-Nummer"
  defaultIntroDative: string; // body sentence for default greeting
}> = {
  QUOTE: {
    label: "Angebot",
    numberFieldLabel: "Angebotsnummer",
    defaultIntroDative: "anbei erhalten Sie unser Angebot",
  },
  ORDER_CONFIRMATION: {
    label: "Auftragsbestätigung",
    numberFieldLabel: "AB-Nummer",
    defaultIntroDative: "anbei erhalten Sie die Auftragsbestätigung",
  },
};

export function BusinessDocEmail({
  docKind,
  companyName,
  logoBase64,
  docNumber,
  docDate,
  deadlineLabel,
  deadlineDate,
  totalAmount,
  customMessage,
  recipientName: _recipientName,
}: BusinessDocEmailProps) {
  const labels = LABELS[docKind];

  return (
    <Html lang="de">
      <Head />
      <Preview>{labels.label} {docNumber} von {companyName} – {totalAmount}</Preview>
      <Body style={{ backgroundColor: "#f6f9fc", fontFamily: "Helvetica, Arial, sans-serif", margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: "600px", margin: "40px auto", backgroundColor: "#ffffff", borderRadius: "8px", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
          {/* Header */}
          <Section style={{ backgroundColor: "#111827", padding: "32px 40px" }}>
            {logoBase64 ? (
              <Img src={logoBase64} height={40} alt={companyName} style={{ borderRadius: "4px" }} />
            ) : (
              <Text style={{ color: "#ffffff", fontSize: "20px", fontWeight: "bold", margin: 0 }}>{companyName}</Text>
            )}
          </Section>

          {/* Body */}
          <Section style={{ padding: "40px" }}>
            <Heading as="h1" style={{ fontSize: "22px", color: "#111827", margin: "0 0 16px" }}>
              Ihr {labels.label} {docNumber}
            </Heading>

            {customMessage ? (
              <Text style={{ fontSize: "15px", color: "#374151", lineHeight: "1.6", whiteSpace: "pre-line", margin: "0 0 24px" }}>
                {customMessage}
              </Text>
            ) : (
              <Text style={{ fontSize: "15px", color: "#374151", lineHeight: "1.6", margin: "0 0 24px" }}>
                Sehr geehrte Damen und Herren,<br /><br />
                {labels.defaultIntroDative} <strong>{docNumber}</strong> über <strong>{totalAmount}</strong>.<br /><br />
                Das Dokument ist als PDF dieser E-Mail beigefügt.
              </Text>
            )}

            {/* Meta box */}
            <Section style={{ backgroundColor: "#f9fafb", borderRadius: "8px", padding: "20px 24px", margin: "0 0 24px" }}>
              <Row>
                <Column>
                  <Text style={{ fontSize: "12px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 4px" }}>
                    {labels.numberFieldLabel}
                  </Text>
                  <Text style={{ fontSize: "15px", color: "#111827", fontWeight: "bold", margin: 0 }}>{docNumber}</Text>
                </Column>
                <Column>
                  <Text style={{ fontSize: "12px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 4px" }}>Betrag</Text>
                  <Text style={{ fontSize: "15px", color: "#111827", fontWeight: "bold", margin: 0 }}>{totalAmount}</Text>
                </Column>
              </Row>
              <Row style={{ marginTop: "16px" }}>
                <Column>
                  <Text style={{ fontSize: "12px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 4px" }}>Datum</Text>
                  <Text style={{ fontSize: "14px", color: "#374151", margin: 0 }}>{docDate}</Text>
                </Column>
                {deadlineLabel && deadlineDate && (
                  <Column>
                    <Text style={{ fontSize: "12px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 4px" }}>{deadlineLabel}</Text>
                    <Text style={{ fontSize: "14px", color: "#374151", margin: 0 }}>{deadlineDate}</Text>
                  </Column>
                )}
              </Row>
            </Section>

            <Text style={{ fontSize: "14px", color: "#6b7280", lineHeight: "1.6", margin: 0 }}>
              Bei Rückfragen melden Sie sich gerne direkt bei uns — wir freuen uns auf Ihre Antwort.
            </Text>
          </Section>

          <Hr style={{ borderColor: "#e5e7eb", margin: 0 }} />

          {/* Footer */}
          <Section style={{ padding: "24px 40px" }}>
            <Text style={{ fontSize: "12px", color: "#9ca3af", margin: 0, lineHeight: "1.6" }}>
              Diese E-Mail wurde automatisch von {companyName} versandt.<br />
              Antworten landen direkt im Postfach des Absenders.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
