/**
 * App-Konfiguration — alle Werte kommen aus Environment Variables.
 * Für jeden Kunden einfach die .env anpassen, kein Code ändern nötig.
 */
export const appConfig = {
  /** Anzeigename der Plattform im UI */
  name: process.env.NEXT_PUBLIC_APP_NAME ?? "accounting-app",

  /** Öffentliche URL (für Auth-Redirects etc.) */
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001",
} as const;
