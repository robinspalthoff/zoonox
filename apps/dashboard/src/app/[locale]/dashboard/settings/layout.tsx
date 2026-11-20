import { SettingsNav } from "./settings-nav";

/**
 * SettingsLayout
 * ──────────────
 * Eigener Bereich mit sekundärer Navigation: links die Settings-Bereiche
 * (SettingsNav), rechts der Inhalt der jeweiligen Unterseite. „Einstellungen"
 * selbst ist ein angepinnter Eintrag am unteren Rand der Hauptsidebar.
 * Jede Unterseite bringt ihre eigene H1 mit.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="flex flex-col gap-6 md:flex-row md:gap-8">
        <SettingsNav />
        <div className="min-w-0 flex-1 space-y-6">{children}</div>
      </div>
    </div>
  );
}
