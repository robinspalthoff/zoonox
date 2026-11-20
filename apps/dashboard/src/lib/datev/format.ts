// DATEV CSV format helpers.
//
// DATEV "EXTF" CSV files use Windows-1252 encoding, semicolon delimiter,
// and double-quote string escaping (internal " doubled). Decimal separator
// is comma. Dates are TTMM (4-digit) for Belegdatum and YYYYMMDD for
// Wirtschaftsjahr/Zeitraum fields in the header.

const WIN1252_OVERRIDES: Record<number, number> = {
  0x20ac: 0x80, // €
  0x201a: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201e: 0x84, // „
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02c6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8a, // Š
  0x2039: 0x8b, // ‹
  0x0152: 0x8c, // Œ
  0x017d: 0x8e, // Ž
  0x2018: 0x91, // '
  0x2019: 0x92, // '
  0x201c: 0x93, // "
  0x201d: 0x94, // "
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02dc: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9a, // š
  0x203a: 0x9b, // ›
  0x0153: 0x9c, // œ
  0x017e: 0x9e, // ž
  0x0178: 0x9f, // Ÿ
};

export function encodeWin1252(str: string): Buffer {
  const out = Buffer.alloc(str.length * 2); // upper bound
  let pos = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xff && !(cp >= 0x80 && cp <= 0x9f)) {
      out[pos++] = cp;
    } else if (cp in WIN1252_OVERRIDES) {
      out[pos++] = WIN1252_OVERRIDES[cp];
    } else {
      out[pos++] = 0x3f; // "?"
    }
  }
  return out.subarray(0, pos);
}

// CSV cell formatters ───────────────────────────────────────────────────────

export function csvText(value: string | null | undefined, maxLen?: number): string {
  if (value == null) return "";
  let v = value.replace(/[\r\n]+/g, " ").trim();
  if (maxLen && v.length > maxLen) v = v.slice(0, maxLen);
  // Always quote text fields per DATEV spec; double internal quotes.
  return `"${v.replace(/"/g, '""')}"`;
}

export function csvNum(value: number): string {
  // DATEV expects German decimal format with comma, no thousands separator,
  // 2 fractional digits for monetary values.
  return value.toFixed(2).replace(".", ",");
}

export function csvInt(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

// Date helpers ──────────────────────────────────────────────────────────────

// All date formatters use UTC accessors so that calendar-date inputs from
// the export form (parsed as UTC midnight) render unchanged regardless of
// the server's local timezone.
export function fmtYYYYMMDD(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}${m}${day}`;
}

export function fmtTTMM(d: Date): string {
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${day}${m}`;
}

export function fmtTimestamp17(d: Date): string {
  // YYYYMMDDhhmmssfff (17 digits) for header field "Erzeugt am".
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const mo = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const da = d.getUTCDate().toString().padStart(2, "0");
  const h = d.getUTCHours().toString().padStart(2, "0");
  const mi = d.getUTCMinutes().toString().padStart(2, "0");
  const s = d.getUTCSeconds().toString().padStart(2, "0");
  const ms = d.getUTCMilliseconds().toString().padStart(3, "0");
  return `${y}${mo}${da}${h}${mi}${s}${ms}`;
}

// Build a CSV row joining cells with semicolons, ending with CRLF (DATEV).
export function csvRow(cells: string[]): string {
  return cells.join(";") + "\r\n";
}
