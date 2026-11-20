import { Link } from "@/i18n/navigation";

// Operating entity behind the app — fill in before running this publicly.
// German law (§ 5 TMG, § 18 MStV) requires a complete imprint on a commercial
// site: legal name, postal address, contact, representative and VAT ID.
// The city here is also the Gerichtsstand referenced in terms/page.tsx — keep
// the two in sync with the operator's actual place of business.
//
// Placeholders in the published repository: the original values identified a
// specific person and address and were removed.
export const OPERATOR = {
  name: "Your Company Name",
  address: "Street 1, 12345 City",
  city: "City",
  email: "hello@example.com",
  represented: "Your Name",
  register: {
    de: "Einzelunternehmen – nicht im Handelsregister eingetragen.",
    en: "Sole proprietorship – not entered in the commercial register.",
  },
  vatId: "DE000000000",
} as const;

export function LegalFooterNav({ locale }: { locale: string }) {
  const de = locale === "de";
  return (
    <nav className="not-prose mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-6 text-sm text-muted-foreground">
      <Link href="/legal/privacy" className="hover:text-foreground">
        {de ? "Datenschutz" : "Privacy"}
      </Link>
      <Link href="/legal/terms" className="hover:text-foreground">
        {de ? "AGB" : "Terms"}
      </Link>
      <Link href="/legal/imprint" className="hover:text-foreground">
        {de ? "Impressum" : "Imprint"}
      </Link>
      <a href="https://zoonox.de" className="hover:text-foreground ml-auto">
        zoonox.de →
      </a>
    </nav>
  );
}
