import type { Metadata } from "next";
import { LegalFooterNav, OPERATOR } from "../_shared";

export const metadata: Metadata = {
  title: "Impressum / Imprint",
  robots: { index: false, follow: false },
};

export default async function ImprintPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const de = locale === "de";
  return (
    <>
      {de ? <ImprintDe /> : <ImprintEn />}
      <LegalFooterNav locale={locale} />
    </>
  );
}

function ImprintDe() {
  return (
    <>
      <h1>Impressum</h1>
      <p>Angaben gemäß § 5 DDG (Digitale-Dienste-Gesetz).</p>

      <h2>Diensteanbieter</h2>
      <p>
        {OPERATOR.name}
        <br />
        {OPERATOR.address}
      </p>

      <h2>Vertreten durch</h2>
      <p>{OPERATOR.represented}</p>

      <h2>Kontakt</h2>
      <p>E-Mail: {OPERATOR.email}</p>

      <h2>Registereintrag</h2>
      <p>{OPERATOR.register.de}</p>

      <h2>Umsatzsteuer-ID</h2>
      <p>{OPERATOR.vatId}</p>

      <h2>Verantwortlich für den Inhalt</h2>
      <p>{OPERATOR.represented}, Anschrift wie oben.</p>

      <p>
        <em>
          Hinweis: Dies ist das Impressum der App app.zoonox.de. Es ist getrennt
          vom Impressum der Website zoonox.de zu führen.
        </em>
      </p>
    </>
  );
}

function ImprintEn() {
  return (
    <>
      <h1>Imprint</h1>
      <p>Information pursuant to § 5 DDG (German Digital Services Act).</p>

      <h2>Service provider</h2>
      <p>
        {OPERATOR.name}
        <br />
        {OPERATOR.address}
      </p>

      <h2>Represented by</h2>
      <p>{OPERATOR.represented}</p>

      <h2>Contact</h2>
      <p>Email: {OPERATOR.email}</p>

      <h2>Register entry</h2>
      <p>{OPERATOR.register.en}</p>

      <h2>VAT ID</h2>
      <p>{OPERATOR.vatId}</p>

      <p>
        <em>
          Note: This is the imprint of the App at app.zoonox.de, separate from
          the imprint of the zoonox.de website.
        </em>
      </p>
    </>
  );
}
