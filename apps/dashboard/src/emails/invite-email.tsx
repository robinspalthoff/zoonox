import {
  Body, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from "@react-email/components";
import * as React from "react";

interface InviteEmailProps {
  recipientName: string;
  inviterName: string;
  workspaceName: string;
  loginUrl: string;
  tempPassword: string | null; // null wenn der User schon existiert
  platformName: string;
}

export function InviteEmail({
  recipientName,
  inviterName,
  workspaceName,
  loginUrl,
  tempPassword,
  platformName,
}: InviteEmailProps) {
  return (
    <Html lang="de">
      <Head />
      <Preview>{`Du wurdest zu ${workspaceName} eingeladen`}</Preview>
      <Body style={{ backgroundColor: "#f6f9fc", fontFamily: "Helvetica, Arial, sans-serif", margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: "600px", margin: "40px auto", backgroundColor: "#ffffff", borderRadius: "8px", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
          <Section style={{ backgroundColor: "#111827", padding: "32px 40px" }}>
            <Text style={{ color: "#ffffff", fontSize: "20px", fontWeight: "bold", margin: 0 }}>{platformName}</Text>
          </Section>

          <Section style={{ padding: "40px" }}>
            <Heading as="h1" style={{ fontSize: "22px", color: "#111827", margin: "0 0 16px" }}>
              Willkommen bei {workspaceName}
            </Heading>

            <Text style={{ fontSize: "15px", color: "#374151", lineHeight: "1.6", margin: "0 0 16px" }}>
              Hallo {recipientName},
            </Text>

            <Text style={{ fontSize: "15px", color: "#374151", lineHeight: "1.6", margin: "0 0 24px" }}>
              {inviterName} hat dich zum Workspace <strong>{workspaceName}</strong> auf {platformName} eingeladen.
            </Text>

            {tempPassword ? (
              <>
                <Text style={{ fontSize: "15px", color: "#374151", lineHeight: "1.6", margin: "0 0 12px" }}>
                  Wir haben für dich einen Zugang erstellt. Du kannst dich mit folgendem temporären Passwort anmelden:
                </Text>
                <Section style={{ backgroundColor: "#f3f4f6", borderRadius: "6px", padding: "16px", margin: "0 0 16px" }}>
                  <Text style={{ fontFamily: "monospace", fontSize: "15px", color: "#111827", margin: 0, wordBreak: "break-all" }}>
                    {tempPassword}
                  </Text>
                </Section>
                <Text style={{ fontSize: "13px", color: "#b91c1c", lineHeight: "1.5", margin: "0 0 24px" }}>
                  Bitte ändere dein Passwort direkt nach dem ersten Login.
                </Text>
              </>
            ) : (
              <Text style={{ fontSize: "15px", color: "#374151", lineHeight: "1.6", margin: "0 0 24px" }}>
                Du kannst dich mit deinen bestehenden Zugangsdaten anmelden — der neue Workspace erscheint dann im Workspace-Switcher oben in der Navigation.
              </Text>
            )}

            <Section style={{ textAlign: "center", margin: "8px 0 24px" }}>
              <a
                href={loginUrl}
                style={{
                  display: "inline-block",
                  backgroundColor: "#111827",
                  color: "#ffffff",
                  textDecoration: "none",
                  padding: "12px 28px",
                  borderRadius: "6px",
                  fontSize: "15px",
                  fontWeight: 600,
                }}
              >
                Jetzt anmelden
              </a>
            </Section>

            <Hr style={{ borderColor: "#e5e7eb", margin: "24px 0" }} />

            <Text style={{ fontSize: "12px", color: "#6b7280", lineHeight: "1.5", margin: 0 }}>
              Falls du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
