/**
 * Liefert das wirtschaftliche Datum als lokalisiertes "Month Year"-Label.
 * Bewusst in einem eigenen Modul ohne `"use client"`-Direktive, damit
 * Server Components (Belege/Rechnungen/Journal-Detail-Pages) den Helper
 * aufrufen können — der Banner selbst bleibt eine Client Component und
 * re-exportiert hier nichts mehr.
 */
export function monthLabelFromDate(
  date: Date | string,
  locale: string = "de",
): { monthLabel: string; year: number; month: number } {
  const d = typeof date === "string" ? new Date(date) : date;
  const month = d.getMonth() + 1;
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long" }).format(d);
  return { monthLabel, year: d.getFullYear(), month };
}
