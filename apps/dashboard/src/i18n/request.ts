import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as "de" | "en")) {
    locale = routing.defaultLocale;
  }

  // Dynamic import statt fs.readFileSync: Webpack/Turbopack traced die Dateien
  // statisch und bundlet sie mit — funktioniert in Docker standalone korrekt.
  // fs.readFileSync(process.cwd()) schlägt im Container fehl, da CWD=/app
  // aber Messages unter apps/dashboard/messages/ liegen.
  const messages = (await import(`../../messages/${locale}.json`)).default;

  return { locale, messages };
});
