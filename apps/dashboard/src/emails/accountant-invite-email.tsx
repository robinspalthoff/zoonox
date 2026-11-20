import {
  Body, Container, Head, Heading, Hr, Html, Img, Preview, Section, Text,
} from "@react-email/components";
import * as React from "react";

type Salutation = "MR" | "MRS" | "DIVERSE" | "NONE";

interface Props {
  recipientName: string;
  salutation: Salutation;
  inviterName: string;
  workspaceName: string;
  customMessage: string;
  loginUrl: string;
  tempPassword: string | null;
  /** Vollständiger Plattformname für Subject/Header-Alt-Text. */
  platformName: string;
  /** Kurzer Brand-Name (z. B. "zoonox") für Footer-Disclaimer. */
  brandName: string;
  /** Absolute URL zum Logo (PNG). Wird im Header der Mail eingebunden. */
  logoUrl: string;
}

function germanGreeting(salutation: Salutation, recipientName: string): string {
  // Best-effort: ohne Nachname (z.B. nur Vorname angegeben) fallen wir auf
  // ein neutrales "Sehr geehrte Damen und Herren" zurück, damit es nicht
  // sprachlich seltsam wirkt.
  const hasName = recipientName.trim().length > 0;
  if (!hasName) return "Sehr geehrte Damen und Herren,";
  switch (salutation) {
    case "MR":      return `Sehr geehrter Herr ${recipientName},`;
    case "MRS":     return `Sehr geehrte Frau ${recipientName},`;
    case "DIVERSE": return `Guten Tag ${recipientName},`;
    case "NONE":
    default:        return `Guten Tag ${recipientName},`;
  }
}

/**
 * Steuerberater-Einladung. Der Mandant verfasst einen Begleittext, der
 * unverändert übernommen wird. Login-URL und Initialpasswort sind in einer
 * separaten Footer-Box klar getrennt vom Mandanten-Text — keine Platzhalter,
 * die in der Vorlage kaputtgehen können.
 */
export function AccountantInviteEmail({
  recipientName,
  salutation,
  inviterName,
  workspaceName,
  customMessage,
  loginUrl,
  tempPassword,
  platformName,
  brandName,
  logoUrl,
}: Props) {
  const greeting = germanGreeting(salutation, recipientName);
  const trimmed = customMessage.trim();
  const lines = trimmed.length > 0 ? trimmed.split(/\n/) : [];

  return (
    <Html lang="de">
      <Head />
      <Preview>{`Steuerberater-Zugang zu ${workspaceName}`}</Preview>
      <Body style={{ backgroundColor: "#f6f9fc", fontFamily: "Helvetica, Arial, sans-serif", margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: "600px", margin: "40px auto", backgroundColor: "#ffffff", borderRadius: "8px", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
          <Section style={{ backgroundColor: "#111827", padding: "24px 40px" }}>
            <Img
              src={logoUrl}
              alt={platformName}
              width="40"
              height="40"
              style={{ display: "block", borderRadius: "8px" }}
            />
          </Section>

          <Section style={{ padding: "40px" }}>
            <Heading as="h1" style={{ fontSize: "20px", color: "#111827", margin: "0 0 16px" }}>
              Einladung als Steuerberater für {workspaceName}
            </Heading>

            <Text style={{ fontSize: "15px", color: "#374151", lineHeight: 1.6, margin: "0 0 16px" }}>
              {greeting}
            </Text>

            {/* ─── Mandanten-Text (Custom Message) ─────────────────────────── */}
            {lines.length > 0 ? (
              lines.map((line, i) => (
                <Text
                  key={i}
                  style={{ fontSize: "15px", color: "#374151", lineHeight: 1.6, margin: "0 0 12px" }}
                >
                  {line || " "}
                </Text>
              ))
            ) : (
              <Text style={{ fontSize: "15px", color: "#374151", lineHeight: 1.6, margin: "0 0 16px" }}>
                {inviterName} hat dich als Steuerberater für {workspaceName} eingeladen. Mit den
                folgenden Zugangsdaten kannst du Belege, Buchungen und Bankbewegungen
                prüfen, kommentieren und Monatsabschlüsse freigeben.
              </Text>
            )}

            {/* ─── Footer: Zugangsdaten ──────────────────────────────────── */}
            <Hr style={{ borderColor: "#e5e7eb", margin: "32px 0 16px" }} />

            <Heading as="h2" style={{ fontSize: "16px", color: "#111827", margin: "0 0 12px" }}>
              Zugang zum Dashboard
            </Heading>
            <Text style={{ fontSize: "14px", color: "#374151", lineHeight: 1.6, margin: "0 0 8px" }}>
              <strong>Login:</strong>{" "}
              <a href={loginUrl} style={{ color: "#111827" }}>{loginUrl}</a>
            </Text>

            {tempPassword && (
              <>
                <Text style={{ fontSize: "14px", color: "#374151", lineHeight: 1.6, margin: "0 0 8px" }}>
                  <strong>Initialpasswort:</strong>{" "}
                  <code style={{ background: "#f3f4f6", padding: "2px 6px", borderRadius: "4px", fontFamily: "monospace" }}>
                    {tempPassword}
                  </code>
                </Text>
                <Text style={{ fontSize: "12px", color: "#6b7280", lineHeight: 1.5, margin: "0 0 8px" }}>
                  Beim ersten Login wirst du aufgefordert, das Passwort zu ändern.
                </Text>
              </>
            )}

            <Section style={{ margin: "24px 0 0" }}>
              <a
                href={loginUrl}
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
                Jetzt anmelden
              </a>
            </Section>

            <Hr style={{ borderColor: "#e5e7eb", margin: "32px 0 16px" }} />
            <Text style={{ fontSize: "12px", color: "#9ca3af", margin: 0 }}>
              Diese E-Mail wurde automatisch von {brandName} versendet im Auftrag von {inviterName}.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
