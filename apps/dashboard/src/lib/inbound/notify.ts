// Hinweis-Mails an Absender, deren weitergeleitete Mail keinen verwertbaren
// Beleg enthielt. Bewusst eng gefasst (nur NO_ATTACHMENT bei gültig aufgelöster
// Mailbox), damit wir bei gefälschten Absendern nicht zur Backscatter-Quelle
// werden. Zusätzlich filtern wir automatische Adressen, um Mail-Schleifen zu
// vermeiden.

// Absender, an die wir grundsätzlich nicht automatisch antworten.
const NO_REPLY_PATTERNS = [
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "mailer-daemon",
  "postmaster",
  "bounce",
  "notifications@",
];

function isAutomatedSender(address: string): boolean {
  const a = address.toLowerCase();
  if (!a.includes("@")) return true;
  return NO_REPLY_PATTERNS.some((p) => a.includes(p));
}

/**
 * Sendet eine kurze Hinweis-Mail „kein Anhang gefunden". Best-effort; Fehler
 * werden geloggt, aber nie geworfen (darf den Webhook nie scheitern lassen).
 */
export async function sendNoAttachmentHint(toAddress: string): Promise<void> {
  const platformEmail = process.env.PLATFORM_SENDER_EMAIL;
  if (!platformEmail) return;
  if (!toAddress || isAutomatedSender(toAddress)) return;

  const platformName = process.env.PLATFORM_NAME ?? "Zoonox";
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1f2937;line-height:1.6;">
      <p>Hallo,</p>
      <p>danke für deine Weiterleitung an deine Beleg-Adresse. Leider konnten wir
      in dieser Nachricht <strong>keinen verwertbaren Beleg</strong> finden.</p>
      <p>Wir verarbeiten ausschließlich <strong>Datei-Anhänge</strong> in den
      Formaten <strong>PDF, PNG oder JPG</strong> (max. 10&nbsp;MB). Belege, die
      nur im Mail-Text stehen oder hinter einem Link in einem Kundenportal
      liegen, können wir nicht automatisch erfassen.</p>
      <p>Bitte hänge die Rechnung als Datei an und leite die Mail erneut weiter.</p>
      <p style="color:#6b7280;font-size:13px;margin-top:24px;">
        Dies ist eine automatische Nachricht von ${platformName}. Bitte antworte nicht darauf.
      </p>
    </div>`;

  try {
    const { brevo, Brevo } = await import("@/lib/email");
    const mail = new Brevo.SendSmtpEmail();
    mail.subject = "Kein Beleg gefunden – bitte Datei anhängen";
    mail.sender = { name: platformName, email: platformEmail };
    mail.to = [{ email: toAddress }];
    mail.htmlContent = html;
    await brevo.sendTransacEmail(mail);
  } catch (err) {
    console.error("[inbound] no-attachment hint send failed:", err);
  }
}
