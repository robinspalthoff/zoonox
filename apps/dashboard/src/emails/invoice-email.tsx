import {
  Body, Container, Head, Heading, Hr, Html, Img,
  Preview, Section, Text, Row, Column,
} from "@react-email/components";
import * as React from "react";

interface InvoiceEmailProps {
  companyName: string;
  logoBase64?: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string | null;
  totalAmount: string;
  customMessage?: string | null;
  recipientName: string;
  isCreditNote?: boolean;
}

export function InvoiceEmail({
  companyName,
  logoBase64,
  invoiceNumber,
  invoiceDate,
  dueDate,
  totalAmount,
  customMessage,
  recipientName,
  isCreditNote = false,
}: InvoiceEmailProps) {
  const docLabel = isCreditNote ? "Gutschrift" : "Rechnung";
  const docLabelDative = isCreditNote ? "Gutschrift" : "Rechnung";

  return (
    <Html lang="de">
      <Head />
      <Preview>{docLabel} {invoiceNumber} von {companyName} – {totalAmount}</Preview>
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
              Ihre {docLabel} {invoiceNumber}
            </Heading>

            {customMessage ? (
              <Text style={{ fontSize: "15px", color: "#374151", lineHeight: "1.6", whiteSpace: "pre-line", margin: "0 0 24px" }}>
                {customMessage}
              </Text>
            ) : isCreditNote ? (
              <Text style={{ fontSize: "15px", color: "#374151", lineHeight: "1.6", margin: "0 0 24px" }}>
                Sehr geehrte Damen und Herren,<br /><br />
                anbei erhalten Sie die Gutschrift <strong>{invoiceNumber}</strong> über <strong>{totalAmount}</strong>.<br /><br />
                Die Gutschrift ist als PDF dieser E-Mail beigefügt.
              </Text>
            ) : (
              <Text style={{ fontSize: "15px", color: "#374151", lineHeight: "1.6", margin: "0 0 24px" }}>
                Sehr geehrte Damen und Herren,<br /><br />
                anbei erhalten Sie die Rechnung <strong>{invoiceNumber}</strong> über <strong>{totalAmount}</strong>.<br /><br />
                Die Rechnung ist als PDF dieser E-Mail beigefügt.
              </Text>
            )}

            {/* Invoice / Credit note meta box */}
            <Section style={{ backgroundColor: "#f9fafb", borderRadius: "8px", padding: "20px 24px", margin: "0 0 24px" }}>
              <Row>
                <Column>
                  <Text style={{ fontSize: "12px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 4px" }}>
                    {isCreditNote ? "Gutschrift-Nr." : "Rechnungsnummer"}
                  </Text>
                  <Text style={{ fontSize: "15px", color: "#111827", fontWeight: "bold", margin: 0 }}>{invoiceNumber}</Text>
                </Column>
                <Column>
                  <Text style={{ fontSize: "12px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 4px" }}>Betrag</Text>
                  <Text style={{ fontSize: "15px", color: "#111827", fontWeight: "bold", margin: 0 }}>{totalAmount}</Text>
                </Column>
              </Row>
              <Row style={{ marginTop: "16px" }}>
                <Column>
                  <Text style={{ fontSize: "12px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 4px" }}>Datum</Text>
                  <Text style={{ fontSize: "14px", color: "#374151", margin: 0 }}>{invoiceDate}</Text>
                </Column>
                {!isCreditNote && dueDate && (
                  <Column>
                    <Text style={{ fontSize: "12px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 4px" }}>Fällig am</Text>
                    <Text style={{ fontSize: "14px", color: "#374151", margin: 0 }}>{dueDate}</Text>
                  </Column>
                )}
              </Row>
            </Section>

            <Text style={{ fontSize: "14px", color: "#6b7280", lineHeight: "1.6", margin: 0 }}>
              Die {docLabelDative} im PDF-Format finden Sie im Anhang dieser E-Mail.
            </Text>
          </Section>

          <Hr style={{ borderColor: "#e5e7eb", margin: 0 }} />

          {/* Footer */}
          <Section style={{ padding: "24px 40px" }}>
            <Text style={{ fontSize: "12px", color: "#9ca3af", margin: 0, lineHeight: "1.6" }}>
              Diese E-Mail wurde automatisch von {companyName} versandt.<br />
              Bitte antworten Sie nicht direkt auf diese E-Mail.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
