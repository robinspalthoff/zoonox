import type { ReactNode } from "react";
import AuthThemeGuard from "./auth-theme-guard";
import { AuthLegalFooter } from "./auth-legal-footer";

/**
 * Auth-Routen (/auth/login, /auth/change-password, /auth/signup, /auth/no-tenant)
 * werden bewusst nur im Light-Theme angeboten. Grund: helle Marken-Assets
 * (Google-Sign-In-Button, Logo-PNG) und Erfolg-/Hinweis-Banner sind im
 * Dark-Theme schwer lesbar bzw. wirken "schmutzig" (heller Grünton auf
 * dunklem Hintergrund).
 *
 * Der Inline-Script läuft synchron VOR dem ersten Paint — direkt nach
 * dem Layout-Script im Root-Layout, der den Dark/Light-Wert aus
 * localStorage setzt. Wir überschreiben hier hart auf `light`, ohne
 * localStorage zu berühren, damit das vom User gewählte Theme nach dem
 * Login intakt bleibt. Beim Verlassen der Auth-Routen restored der
 * Client-Guard das ursprünglich gespeicherte Theme.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var r=document.documentElement;r.classList.remove('dark');r.classList.add('light');}catch(e){}})();`,
        }}
      />
      <AuthThemeGuard>
        {children}
        <AuthLegalFooter />
      </AuthThemeGuard>
    </>
  );
}
