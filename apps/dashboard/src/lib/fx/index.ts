/**
 * FX-Wechselkurse — ECB-Referenzkurse via frankfurter.app.
 *
 * Hintergrund (HGB §244, GoBD): Eingangsrechnungen in Fremdwährung sind zum
 * Belegdatum in Euro umzurechnen — Stichtagskurs (i.d.R. ECB-Referenzkurs des
 * Tages, an dem die Rechnung ausgestellt wurde). Spätere Zahlungen können
 * einen anderen Kurs haben; die Differenz ist als Kursgewinn/-verlust zu
 * erfassen (siehe `differenceReason: FX`).
 *
 * Quelle: api.frankfurter.app spiegelt die ECB-Referenzkurse 1:1 (kostenlos,
 * keine API-Keys, historische Daten ab 1999). Ein simpler In-Memory-Cache
 * verhindert Mehrfachabrufe für denselben (Datum + Currency).
 */

export const SUPPORTED_FX_CURRENCIES = [
  "EUR", // Euro
  "USD", // US Dollar
  "GBP", // British Pound
  "CHF", // Swiss Franc
  "JPY", // Japanese Yen
  "AUD", // Australian Dollar
  "CAD", // Canadian Dollar
  "CNY", // Chinese Yuan
  "DKK", // Danish Krone
  "NOK", // Norwegian Krone
  "SEK", // Swedish Krona
  "PLN", // Polish Zloty
  "CZK", // Czech Koruna
  "TRY", // Turkish Lira
  "BRL", // Brazilian Real
  "INR", // Indian Rupee
  "HKD", // Hong Kong Dollar
  "SGD", // Singapore Dollar
  "ZAR", // South African Rand
  "NZD", // New Zealand Dollar
] as const;

export type SupportedCurrency = (typeof SUPPORTED_FX_CURRENCIES)[number];

/** Ist der Code in unserer Whitelist? */
export function isSupportedCurrency(code: string): code is SupportedCurrency {
  return (SUPPORTED_FX_CURRENCIES as readonly string[]).includes(code);
}

interface CacheEntry {
  rate: number;
  fetchedAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — Tageskurse ändern sich nicht.

function isoDate(d: Date): string {
  // YYYY-MM-DD (lokal-Zeitzone okay, ECB-Kurse sind Tagesschlusskurse)
  return d.toISOString().slice(0, 10);
}

/**
 * Liefert den EUR-Kurs für `1 from`. Beispiel: `getExchangeRate(today, "USD")`
 * → 0.923 bedeutet 1 USD = 0,923 EUR. Für `from === "EUR"` immer 1.
 *
 * frankfurter.app fällt auf den letzten Bankarbeitstag zurück, wenn das
 * angefragte Datum ein Wochenende/Feiertag ist (das ist die ECB-Konvention).
 *
 * Wirft, wenn der Abruf fehlschlägt — Aufrufer sollte das fangen und dem
 * Nutzer eine manuelle Eingabe ermöglichen.
 */
export async function getExchangeRate(
  date: Date,
  from: string,
): Promise<number> {
  if (from === "EUR") return 1;
  if (!isSupportedCurrency(from)) {
    throw new Error(`Unsupported currency: ${from}`);
  }

  const key = `${isoDate(date)}|${from}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rate;
  }

  const url = `https://api.frankfurter.app/${isoDate(date)}?from=${from}&to=EUR`;
  const res = await fetch(url, { next: { revalidate: 21600 } });
  if (!res.ok) {
    throw new Error(`FX lookup failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { rates?: { EUR?: number } };
  const rate = data.rates?.EUR;
  if (typeof rate !== "number" || !Number.isFinite(rate)) {
    throw new Error("FX lookup returned no EUR rate");
  }
  cache.set(key, { rate, fetchedAt: Date.now() });
  return rate;
}

/** Konvertiert einen Betrag zur angegebenen Rate in EUR. */
export function toEUR(amount: number, rate: number): number {
  return Math.round(amount * rate * 100) / 100;
}
