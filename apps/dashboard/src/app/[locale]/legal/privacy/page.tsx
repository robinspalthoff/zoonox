import type { Metadata } from "next";
import { LegalFooterNav, OPERATOR } from "../_shared";

export const metadata: Metadata = {
  title: "Datenschutz / Privacy",
  robots: { index: false, follow: false },
};

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const de = locale === "de";
  return (
    <>
      {de ? <PrivacyDe /> : <PrivacyEn />}
      <LegalFooterNav locale={locale} />
    </>
  );
}

function PrivacyDe() {
  return (
    <>
      <h1>Datenschutzerklärung</h1>
      <p>
        Diese Datenschutzerklärung gilt für die Web-Anwendung unter
        app.zoonox.de (nachfolgend „App“). Sie ist getrennt von der
        Datenschutzerklärung der Website zoonox.de.
      </p>

      <h2>1. Verantwortlicher</h2>
      <p>
        {OPERATOR.name}, {OPERATOR.address}. Vertreten durch{" "}
        {OPERATOR.represented}. Kontakt: {OPERATOR.email}.
      </p>

      <h2>2. Verarbeitete Daten</h2>
      <ul>
        <li>Konto- und Nutzungsdaten (Name, E-Mail, Workspace, Login/2FA).</li>
        <li>Von dir erfasste Geschäftsdaten (Rechnungen, Belege, Kontakte).</li>
        <li>
          Bankkontodaten (Konten, Salden, Umsätze) bei Nutzung der optionalen
          Bankanbindung – siehe Abschnitt 4.
        </li>
        <li>Technische Daten (Server-Logs, IP-Adresse) zur Betriebssicherheit.</li>
      </ul>

      <h2>3. Zwecke &amp; Rechtsgrundlagen</h2>
      <p>
        Bereitstellung der App und Vertragserfüllung (Art. 6 Abs. 1 lit. b
        DSGVO), Erfüllung gesetzlicher Aufbewahrungspflichten (lit. c i. V. m.
        GoBD/HGB/AO) sowie berechtigtes Interesse an Sicherheit und
        Verbesserung (lit. f).
      </p>

      <h2>4. Bankanbindung über Enable Banking (PSD2)</h2>
      <p>
        Wenn du ein Bankkonto verbindest, erfolgt dies read-only über den
        lizenzierten Kontoinformationsdienst (AISP){" "}
        <strong>Enable Banking Oy</strong> (Otakaari 5, 02150 Espoo, Finnland),
        beaufsichtigt durch die finnische Finanzaufsicht (FIN-FSA). Grundlage ist
        deine ausdrückliche Einwilligung (PSD2-Consent). Wir rufen ausschließlich
        Konten, Salden und Umsätze ab; es werden keine Zahlungen ausgelöst. Deine
        Zustimmung und ihr Gültigkeitszeitraum werden dokumentiert und können
        jederzeit durch Trennen der Verbindung widerrufen werden.
      </p>

      <h2>5. Empfänger</h2>
      <p>
        Hosting in Deutschland (Hetzner). Weitere Auftragsverarbeiter
        (z. B. E-Mail-Versand, KI-gestützte Belegerkennung, Enable Banking)
        werden auf Grundlage von Auftragsverarbeitungsverträgen eingesetzt.
        [Liste der Auftragsverarbeiter ergänzen.]
      </p>

      <h2>6. Speicherdauer</h2>
      <p>
        Buchungsrelevante Daten (u. a. importierte Bankumsätze) unterliegen den
        gesetzlichen Aufbewahrungsfristen (i. d. R. 6–10 Jahre nach GoBD/HGB/AO)
        und werden bis zu deren Ablauf gespeichert. Übrige Daten werden gelöscht,
        sobald sie für die genannten Zwecke nicht mehr erforderlich sind.
      </p>

      <h2>7. Deine Rechte</h2>
      <p>
        Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit
        und Widerspruch (Art. 15–21 DSGVO) sowie Beschwerde bei einer
        Aufsichtsbehörde. Für buchungsrelevante Daten kann das Löschrecht durch
        gesetzliche Aufbewahrungspflichten eingeschränkt sein.
      </p>

      <h2>8. Kontakt</h2>
      <p>Datenschutzanfragen: {OPERATOR.email}.</p>
      <p>
        <em>Stand: Juli 2026.</em>
      </p>
    </>
  );
}

function PrivacyEn() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>
        This privacy policy applies to the web application at app.zoonox.de
        (the “App”). It is separate from the privacy policy of the zoonox.de
        website.
      </p>

      <h2>1. Controller</h2>
      <p>
        {OPERATOR.name}, {OPERATOR.address}. Represented by{" "}
        {OPERATOR.represented}. Contact: {OPERATOR.email}.
      </p>

      <h2>2. Data we process</h2>
      <ul>
        <li>Account and usage data (name, email, workspace, login/2FA).</li>
        <li>Business data you enter (invoices, receipts, contacts).</li>
        <li>
          Bank account data (accounts, balances, transactions) when you use the
          optional bank connection – see section 4.
        </li>
        <li>Technical data (server logs, IP address) for security.</li>
      </ul>

      <h2>3. Purposes &amp; legal bases</h2>
      <p>
        Providing the App and performing the contract (Art. 6(1)(b) GDPR),
        statutory retention obligations (Art. 6(1)(c) with German GoBD/HGB/AO)
        and legitimate interests in security and improvement (Art. 6(1)(f)).
      </p>

      <h2>4. Bank connection via Enable Banking (PSD2)</h2>
      <p>
        When you connect a bank account this is done read-only through the
        licensed account information service provider (AISP){" "}
        <strong>Enable Banking Oy</strong> (Otakaari 5, 02150 Espoo, Finland),
        supervised by the Finnish FSA. The basis is your explicit consent (PSD2).
        We only retrieve accounts, balances and transactions; no payments are
        initiated. Your consent and its validity period are recorded and can be
        revoked at any time by disconnecting.
      </p>

      <h2>5. Recipients</h2>
      <p>
        Hosting in Germany (Hetzner). Further processors (e.g. email delivery,
        AI-assisted document recognition, Enable Banking) are engaged under data
        processing agreements. [Add processor list.]
      </p>

      <h2>6. Retention</h2>
      <p>
        Accounting-relevant data (including imported bank transactions) is
        subject to statutory retention periods (typically 6–10 years under German
        law) and is stored until they expire. Other data is deleted once no
        longer needed for the stated purposes.
      </p>

      <h2>7. Your rights</h2>
      <p>
        Access, rectification, erasure, restriction, portability and objection
        (Art. 15–21 GDPR), and the right to lodge a complaint with a supervisory
        authority. For accounting-relevant data, erasure may be limited by
        statutory retention obligations.
      </p>

      <h2>8. Contact</h2>
      <p>Privacy requests: {OPERATOR.email}.</p>
      <p>
        <em>Last updated: July 2026.</em>
      </p>
    </>
  );
}
