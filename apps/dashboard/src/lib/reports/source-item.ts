// Shared shape for "what document/invoice/journal entry contributed to this
// number?" — used by the VAT return breakdown popup and the P/L breakdown
// popup so both screens speak the same vocabulary and can reuse rendering.

export type SourceItem = {
  kind: "invoice" | "document" | "journal";
  id: string;
  label: string;
  secondary: string | null;
  date: string; // ISO
  net: number;
  vat: number;
  href: string;
};