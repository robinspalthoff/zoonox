/**
 * SKR 03 & SKR 04 — Kontenrahmen für die Belegkategorisierung.
 *
 * Account numbers and group keys are loaded from JSON data files.
 * All display names are resolved via i18n (keys: skrAccounts.groups.* and skrAccounts.accounts.*).
 */

import skr03Data from "@/data/skr03.json";
import skr04Data from "@/data/skr04.json";

export interface SkrAccountEntry {
  number: string;
  group: string; // i18n key suffix: "assets", "purchasing", etc.
}

interface SkrData {
  accounts: SkrAccountEntry[];
  light: string[];
}

const data: Record<string, SkrData> = {
  SKR03: skr03Data as SkrData,
  SKR04: skr04Data as SkrData,
};

/**
 * Get all accounts for a given SKR type.
 */
export function getSkrAccounts(
  skrType: "SKR03" | "SKR04",
  variant: "full" | "light" = "full"
): SkrAccountEntry[] {
  const skr = data[skrType];
  if (variant === "light") {
    const lightSet = new Set(skr.light);
    return skr.accounts.filter((a) => lightSet.has(a.number));
  }
  return skr.accounts;
}

/**
 * Find a single account entry by number.
 */
export function getSkrAccount(
  accountNumber: string,
  skrType: "SKR03" | "SKR04" = "SKR03"
): SkrAccountEntry | undefined {
  return data[skrType].accounts.find((a) => a.number === accountNumber);
}

/**
 * Build a formatted label using the i18n translation function.
 * Example: "4920 – Telefon"
 *
 * Usage in components:
 *   const label = getSkrAccountLabel("4920", "SKR03", t);
 *   // where t = useTranslations("skrAccounts") or getTranslations("skrAccounts")
 */
export function getSkrAccountLabel(
  accountNumber: string,
  skrType: "SKR03" | "SKR04",
  t: (key: string) => string
): string {
  const account = getSkrAccount(accountNumber, skrType);
  if (!account) return accountNumber;
  const name = t(`accounts.${skrType}.${accountNumber}`);
  return `${accountNumber} – ${name}`;
}
