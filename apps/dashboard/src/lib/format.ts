/** Shared formatting utilities used across dashboard pages. */

export function formatCurrency(amount: number | string | { toString(): string } | null | undefined): string {
  if (amount == null || amount === "") return "—";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(amount));
}

/**
 * Wie `formatCurrency`, aber mit explizit übergebenem ISO-Code. Wird auf
 * Belegen verwendet, deren Währung von EUR abweichen kann. Bei unbekannten
 * Codes fällt Intl auf den Code als Suffix zurück (z.B. "100,00 XXX").
 */
export function formatAmount(
  amount: number | string | { toString(): string } | null | undefined,
  currency: string = "EUR",
): string {
  if (amount == null || amount === "") return "—";
  const cur = (currency || "EUR").toUpperCase();
  try {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: cur }).format(Number(amount));
  } catch {
    // Falls Intl die Währung ablehnt, fallback auf manuelle Darstellung.
    return `${Number(amount).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fmtDateShort(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function toInputDate(d: string | null | undefined): string {
  if (!d) return "";
  try { return new Date(d).toISOString().slice(0, 10); } catch { return ""; }
}
