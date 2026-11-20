"use client";

import { Link } from "@/i18n/navigation";
import { useLocale } from "next-intl";

// Discreet legal links for the auth screens (login/signup). Fixed to the
// bottom of the viewport so it never disturbs the centered auth card. Modern
// SaaS convention: legal is reachable but not prominent inside the app.
export function AuthLegalFooter() {
  const de = useLocale() === "de";
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 flex justify-center">
      <nav className="pointer-events-auto flex items-center gap-3 text-xs text-muted-foreground">
        <Link href="/legal/privacy" className="hover:text-foreground transition-colors">
          {de ? "Datenschutz" : "Privacy"}
        </Link>
        <span aria-hidden>·</span>
        <Link href="/legal/terms" className="hover:text-foreground transition-colors">
          {de ? "AGB" : "Terms"}
        </Link>
        <span aria-hidden>·</span>
        <Link href="/legal/imprint" className="hover:text-foreground transition-colors">
          {de ? "Impressum" : "Imprint"}
        </Link>
      </nav>
    </div>
  );
}
