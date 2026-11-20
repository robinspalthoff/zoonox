import {
  Body, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from "@react-email/components";
import * as React from "react";

interface Props {
  previewLine: string;
  heading: string;
  greeting: string;
  body: string;
  openButtonLabel: string;
  footer: string;
  reviewUrl: string;
  platformName: string;
}

/**
 * Sprachneutral aufgebaut: alle übersetzten Strings kommen als Props rein,
 * damit die Action den Locale anhand der Empfänger-Sprache wählen kann.
 */
export function MonthCloseSubmittedEmail({
  previewLine,
  heading,
  greeting,
  body,
  openButtonLabel,
  footer,
  reviewUrl,
  platformName,
}: Props) {
  return (
    <Html lang="de">
      <Head />
      <Preview>{previewLine}</Preview>
      <Body style={{ backgroundColor: "#f6f9fc", fontFamily: "Helvetica, Arial, sans-serif", margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: "600px", margin: "40px auto", backgroundColor: "#ffffff", borderRadius: "8px", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
          <Section style={{ backgroundColor: "#111827", padding: "32px 40px" }}>
            <Text style={{ color: "#ffffff", fontSize: "20px", fontWeight: "bold", margin: 0 }}>
              {platformName}
            </Text>
          </Section>
          <Section style={{ padding: "40px" }}>
            <Heading as="h1" style={{ fontSize: "20px", color: "#111827", margin: "0 0 16px" }}>
              {heading}
            </Heading>
            <Text style={{ fontSize: "15px", color: "#374151", lineHeight: 1.6, margin: "0 0 16px" }}>
              {greeting}
            </Text>
            <Text style={{ fontSize: "15px", color: "#374151", lineHeight: 1.6, margin: "0 0 16px" }}>
              {body}
            </Text>
            <Section style={{ margin: "24px 0" }}>
              <a
                href={reviewUrl}
                style={{
                  backgroundColor: "#111827",
                  color: "#ffffff",
                  padding: "12px 20px",
                  borderRadius: "6px",
                  fontSize: "14px",
                  fontWeight: 600,
                  textDecoration: "none",
                  display: "inline-block",
                }}
              >
                {openButtonLabel}
              </a>
            </Section>
            <Hr style={{ borderColor: "#e5e7eb", margin: "32px 0 16px" }} />
            <Text style={{ fontSize: "12px", color: "#9ca3af", margin: 0 }}>{footer}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
