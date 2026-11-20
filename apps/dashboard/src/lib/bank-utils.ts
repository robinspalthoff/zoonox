/** Bank-related utility functions — IBAN formatting/validation, balance calculation. */

/**
 * Format an IBAN with spaces every 4 characters.
 * "DE89370400440532013000" → "DE89 3704 0044 0532 0130 00"
 */
export function formatIban(iban: string): string {
  const clean = iban.replace(/\s/g, "").toUpperCase();
  return clean.replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Mask an IBAN, showing only country code and last 4 digits.
 * "DE89370400440532013000" → "DE** **** **** **** **30 00"
 */
export function maskIban(iban: string): string {
  const clean = iban.replace(/\s/g, "").toUpperCase();
  if (clean.length < 6) return clean;
  const prefix = clean.slice(0, 2);
  const suffix = clean.slice(-4);
  const masked = prefix + "*".repeat(clean.length - 6) + suffix;
  return masked.replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Validate a DE IBAN using length check + MOD-97 (ISO 13616).
 * Supports any country but enforces DE = 22 characters.
 */
export function isValidIban(iban: string): boolean {
  const clean = iban.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(clean)) return false;

  // Country-specific length check (DE = 22)
  const countryLengths: Record<string, number> = {
    DE: 22, AT: 20, CH: 21, LI: 21, LU: 20, NL: 18, BE: 16, FR: 27,
  };
  const country = clean.slice(0, 2);
  const expected = countryLengths[country];
  if (expected && clean.length !== expected) return false;

  // MOD-97 validation (ISO 13616)
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const numericStr = rearranged
    .split("")
    .map((c) => {
      const code = c.charCodeAt(0);
      return code >= 65 ? (code - 55).toString() : c;
    })
    .join("");

  // Process in chunks to avoid BigInt for older environments
  let remainder = 0;
  for (let i = 0; i < numericStr.length; i += 7) {
    const chunk = String(remainder) + numericStr.slice(i, i + 7);
    remainder = parseInt(chunk, 10) % 97;
  }

  return remainder === 1;
}

/**
 * Calculate the current balance for a bank account.
 * balance = openingBalance + sum(transaction amounts)
 */
export function calculateBalance(
  openingBalance: number,
  transactionAmounts: number[],
): number {
  return transactionAmounts.reduce((sum, amt) => sum + amt, openingBalance);
}
