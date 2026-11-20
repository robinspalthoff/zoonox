import type { Metadata } from "next";
import { LegalFooterNav, OPERATOR } from "../_shared";

export const metadata: Metadata = {
  title: "AGB / Terms",
  robots: { index: false, follow: false },
};

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const de = locale === "de";
  return (
    <>
      {de ? <TermsDe /> : <TermsEn />}
      <LegalFooterNav locale={locale} />
    </>
  );
}

function TermsDe() {
  return (
    <>
      <h1>Allgemeine Geschäftsbedingungen (AGB)</h1>

      <h2>1. Anbieter &amp; Geltungsbereich</h2>
      <p>
        Anbieter der App app.zoonox.de ist {OPERATOR.name}, {OPERATOR.address}.
        Diese AGB gelten für die Nutzung der App.
      </p>

      <h2>2. Leistungsbeschreibung</h2>
      <p>
        Die App ist eine Buchhaltungs-Software (u. a. Rechnungen, Belege,
        Bankabgleich). Die optionale Bankanbindung erfolgt read-only über einen
        lizenzierten Kontoinformationsdienst (Enable Banking); es werden keine
        Zahlungen ausgelöst.
      </p>

      <h2>3. Registrierung &amp; Konto</h2>
      <p>
        Für die Nutzung ist ein Konto erforderlich. Zugangsdaten sind vertraulich
        zu behandeln. [Ggf. Voraussetzungen, Unternehmereigenschaft.]
      </p>

      <h2>4. Pflichten der Nutzer</h2>
      <p>
        Keine rechtswidrige Nutzung; Richtigkeit der eingegebenen Daten;
        Beachtung steuer- und handelsrechtlicher Pflichten liegt beim Nutzer.
      </p>

      <h2>5. Verfügbarkeit</h2>
      <p>
        Es besteht kein Anspruch auf ununterbrochene Verfügbarkeit;
        Wartungsfenster und Störungen können auftreten.
      </p>

      <h2>6. Haftung</h2>
      <p>
        [Haftungsregelung durch Anwalt zu prüfen.] Die App ersetzt keine
        steuerliche oder rechtliche Beratung.
      </p>

      <h2>7. Laufzeit &amp; Kündigung</h2>
      <p>[Vertragslaufzeit, Kündigung, Datenexport bei Beendigung.]</p>

      <h2>8. Preise</h2>
      <p>[Aktuell in Entwicklung / Preismodell ergänzen.]</p>

      <h2>9. Schlussbestimmungen</h2>
      <p>Es gilt deutsches Recht. Gerichtsstand: {OPERATOR.city}, soweit zulässig.</p>
      <p>
        <em>
          Stand: Juli 2026. Einzelne Abschnitte (Preise, Haftung) werden vor dem
          öffentlichen Start finalisiert.
        </em>
      </p>
    </>
  );
}

function TermsEn() {
  return (
    <>
      <h1>Terms of Service</h1>

      <h2>1. Provider &amp; scope</h2>
      <p>
        The App at app.zoonox.de is provided by {OPERATOR.name},{" "}
        {OPERATOR.address}. These terms govern the use of the App.
      </p>

      <h2>2. Service description</h2>
      <p>
        The App is accounting software (invoices, receipts, bank reconciliation).
        The optional bank connection is read-only via a licensed account
        information service provider (Enable Banking); no payments are initiated.
      </p>

      <h2>3. Registration &amp; account</h2>
      <p>
        An account is required. Credentials must be kept confidential.
        [Eligibility / business-user requirement as applicable.]
      </p>

      <h2>4. User obligations</h2>
      <p>
        No unlawful use; accuracy of entered data; compliance with tax and
        commercial-law obligations rests with the user.
      </p>

      <h2>5. Availability</h2>
      <p>
        No guarantee of uninterrupted availability; maintenance windows and
        outages may occur.
      </p>

      <h2>6. Liability</h2>
      <p>
        [Liability clause to be reviewed by a lawyer.] The App does not replace
        tax or legal advice.
      </p>

      <h2>7. Term &amp; termination</h2>
      <p>[Contract term, termination, data export on termination.]</p>

      <h2>8. Pricing</h2>
      <p>[Currently in development / add pricing model.]</p>

      <h2>9. Final provisions</h2>
      <p>German law applies. Place of jurisdiction: {OPERATOR.city}, where permitted.</p>
      <p>
        <em>
          Last updated: July 2026. Some sections (pricing, liability) will be
          finalised before public launch.
        </em>
      </p>
    </>
  );
}
