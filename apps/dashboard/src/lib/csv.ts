/**
 * Lightweight CSV parser with RFC-4180 quoting support.
 * Keeps empty fields; handles CRLF and bare LF line endings.
 * Quoted fields may contain newlines (SEPA Verwendungszweck can span lines).
 */
export function parseCsv(input: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  while (rows.length && rows[rows.length - 1].every((f) => f === "")) {
    rows.pop();
  }

  return rows;
}

/**
 * Auto-detect delimiter by trying a set of candidates.
 * Picks the delimiter whose most common row-column count is highest and > 1.
 */
export function detectDelimiter(input: string): string {
  const candidates = [";", ",", "\t", "|"];
  let best: { delim: string; cols: number } = { delim: ",", cols: 1 };

  for (const delim of candidates) {
    const rows = parseCsv(input, delim).slice(0, 20);
    if (!rows.length) continue;

    // Compute the mode (most frequent column count) via a frequency map.
    const freq = new Map<number, number>();
    for (const r of rows) {
      freq.set(r.length, (freq.get(r.length) ?? 0) + 1);
    }
    let mode = 1;
    let modeFreq = 0;
    for (const [cols, count] of freq) {
      if (count > modeFreq || (count === modeFreq && cols > mode)) {
        mode = cols;
        modeFreq = count;
      }
    }

    if (mode > best.cols) {
      best = { delim, cols: mode };
    }
  }

  return best.delim;
}

/**
 * Separator convention for amount parsing.
 *   - "dot":     decimal = "." ; thousands = "," ; US/UK style (1,234.56)
 *   - "comma":   decimal = "," ; thousands = "." ; European style (1.234,56)
 *   - "unknown": single-separator cells are ambiguous without column context.
 */
export type DecimalConvention = "dot" | "comma" | "unknown";

/**
 * User-facing number format labels. Maps onto DecimalConvention:
 *   - "1,000.00"  → "dot"   (US/UK: dot decimal, comma thousands)
 *   - "1.000,00"  → "comma" (European: comma decimal, dot thousands)
 *   - "1'000.00"  → "dot"   (Swiss: dot decimal, apostrophe thousands;
 *                            apostrophes are stripped in parseAmount,
 *                            so this collapses to dot-convention)
 *   - "auto"      → detected per-column via detectDecimalConvention
 */
export type NumberFormat = "auto" | "1,000.00" | "1.000,00" | "1'000.00";

export function numberFormatToConvention(f: NumberFormat | undefined): DecimalConvention {
  switch (f) {
    case "1,000.00":
    case "1'000.00":
      return "dot";
    case "1.000,00":
      return "comma";
    default:
      return "unknown";
  }
}

/**
 * Inspect every cell in an amount column and infer the decimal convention.
 *   - If any cell has BOTH "." and "," → whichever comes last is the decimal.
 *   - Else if any cell has a single separator with 1–2 trailing digits (cents),
 *     that's the decimal. Bank CSVs always carry cents, so this tiebreaker
 *     reliably separates "1.000" (thousands, no decimal) from "1.00" (decimal).
 *   - Else "unknown" — caller falls back to per-cell best effort.
 */
export function detectDecimalConvention(cells: string[]): DecimalConvention {
  let dotVotes = 0;
  let commaVotes = 0;

  for (const raw of cells) {
    if (!raw) continue;
    const s = raw.replace(/\s|€|EUR|\u00a0|'/gi, "").replace(/^[-(]|[-)]$/g, "");
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");

    if (lastDot !== -1 && lastComma !== -1) {
      // Both present → last one is the decimal. Strong vote.
      if (lastDot > lastComma) dotVotes += 10;
      else commaVotes += 10;
      continue;
    }
    const m = /[.,](\d+)$/.exec(s);
    if (m) {
      const tail = m[1];
      if (tail.length === 1 || tail.length === 2) {
        if (s.includes(".")) dotVotes++;
        else commaVotes++;
      }
      // 3-digit tail is ambiguous (could be thousands or decimal) → no vote.
    }
  }

  if (dotVotes === 0 && commaVotes === 0) return "unknown";
  return dotVotes > commaVotes ? "dot" : "comma";
}

/**
 * Parse a numeric amount. Pass the column convention detected via
 * `detectDecimalConvention` for reliable disambiguation of `1.000` vs `1,000`
 * vs `1000`. When convention is "unknown", falls back to a best-effort
 * heuristic (last separator wins).
 * Returns NaN if not parseable.
 */
export function parseAmount(
  raw: string,
  convention: DecimalConvention = "unknown",
): number {
  if (!raw) return NaN;
  let s = raw.trim().replace(/\s|€|EUR|\u00a0|'/gi, "");

  let negative = false;
  // Parenthesised negative: (12,34) → -12.34
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Trailing minus: "12,34-" → "-12,34"
  if (/-$/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (/^-/.test(s)) {
    negative = true;
    s = s.slice(1);
  }
  if (/^\+/.test(s)) s = s.slice(1);

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    if (convention === "dot") {
      s = s.replace(/,/g, ""); // "," is thousands
    } else {
      s = s.replace(",", "."); // European default: "," is decimal
    }
  } else if (hasDot) {
    if (convention === "comma") {
      s = s.replace(/\./g, ""); // "." is thousands
    }
    // else: dot is decimal (or unknown) — parseFloat handles it.
  }

  const n = parseFloat(s);
  if (isNaN(n)) return NaN;
  return negative ? -Math.abs(n) : n;
}

/**
 * Parse a date in common formats (ISO, DD.MM.YYYY, DD.MM.YY, DD/MM/YYYY, DD/MM/YY).
 * Two-digit years are pivoted: 00–69 → 20xx, 70–99 → 19xx. This pivot is
 * needed because real-world bank exports (notably DKB) ship DD.MM.YY.
 * Returns an ISO date string (YYYY-MM-DD) or null.
 */
export function parseDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();

  // ISO 8601
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // DD.MM.YYYY / DD.MM.YY
  const dmy = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(s);
  if (dmy) {
    const d = dmy[1].padStart(2, "0");
    const m = dmy[2].padStart(2, "0");
    const y = expandYear(dmy[3]);
    if (y === null) return null;
    return `${y}-${m}-${d}`;
  }

  // DD/MM/YYYY / DD/MM/YY (European convention — assume day-first)
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (slash) {
    const d = slash[1].padStart(2, "0");
    const m = slash[2].padStart(2, "0");
    const y = expandYear(slash[3]);
    if (y === null) return null;
    return `${y}-${m}-${d}`;
  }

  // Fallback: only for unambiguous ISO-ish strings with explicit time component
  // (e.g. "2026-05-18T10:00:00Z"). We deliberately do NOT pass arbitrary input
  // to Date.parse — V8 silently swaps month/day for ambiguous DD.MM.YY input
  // (e.g. "07.04.26" → July 4), producing wrong dates rather than nulls.
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) {
    const t = Date.parse(s);
    if (!isNaN(t)) {
      const d = new Date(t);
      const yyyy = d.getFullYear();
      if (yyyy < 1990 || yyyy > 2100) return null;
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  return null;
}

/**
 * Explicit date formats the user can pick from the Importoptionen panel.
 * "auto" defers to the heuristic `parseDate` above.
 */
export type DateFormat =
  | "auto"
  | "DD.MM.YYYY"
  | "DD.MM.YY"
  | "DD/MM/YYYY"
  | "DD/MM/YY"
  | "MM/DD/YYYY"
  | "MM/DD/YY"
  | "YYYY-MM-DD"
  | "YYYY/MM/DD";

/**
 * Parse a date using an explicit format. The format dictates exactly
 * how the cell is interpreted — no fallback to other shapes — so a
 * misconfigured format surfaces as null instead of silently misparsing.
 * Two-digit years are pivoted via `expandYear` (00–69 → 20xx, 70–99 → 19xx).
 */
export function parseDateWithFormat(raw: string, format: DateFormat): string | null {
  if (format === "auto") return parseDate(raw);
  if (!raw) return null;
  const s = raw.trim();

  const tryParts = (re: RegExp, order: "DMY" | "MDY" | "YMD"): string | null => {
    const m = re.exec(s);
    if (!m) return null;
    let dStr: string, mStr: string, yStr: string;
    if (order === "DMY") {
      dStr = m[1];
      mStr = m[2];
      yStr = m[3];
    } else if (order === "MDY") {
      mStr = m[1];
      dStr = m[2];
      yStr = m[3];
    } else {
      yStr = m[1];
      mStr = m[2];
      dStr = m[3];
    }
    const y = expandYear(yStr);
    if (y === null) return null;
    const mm = mStr.padStart(2, "0");
    const dd = dStr.padStart(2, "0");
    const mi = Number(mm);
    const di = Number(dd);
    if (mi < 1 || mi > 12 || di < 1 || di > 31) return null;
    // Calendar validity: reject 31.02, 31.04, 30.02, leap-year mistakes.
    // Cheaper than Date() round-tripping and doesn't silently roll over.
    const yi = Number(y);
    const daysInMonth = [
      31,
      yi % 4 === 0 && (yi % 100 !== 0 || yi % 400 === 0) ? 29 : 28,
      31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ];
    if (di > daysInMonth[mi - 1]) return null;
    return `${y}-${mm}-${dd}`;
  };

  switch (format) {
    case "DD.MM.YYYY":
      return tryParts(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, "DMY");
    case "DD.MM.YY":
      return tryParts(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/, "DMY");
    case "DD/MM/YYYY":
      return tryParts(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, "DMY");
    case "DD/MM/YY":
      return tryParts(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, "DMY");
    case "MM/DD/YYYY":
      return tryParts(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, "MDY");
    case "MM/DD/YY":
      return tryParts(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, "MDY");
    case "YYYY-MM-DD":
      return tryParts(/^(\d{4})-(\d{1,2})-(\d{1,2})$/, "YMD");
    case "YYYY/MM/DD":
      return tryParts(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, "YMD");
    default:
      return null;
  }
}

/**
 * Supported text encodings for CSV uploads. UTF-8 is the default and
 * works for any modern bank export; the legacy options cover older
 * German bank exports (DKB, Sparkasse) that still ship Windows-1252 or
 * ISO-8859-15 with Umlaute that would otherwise render as mojibake.
 */
export type TextEncoding =
  | "utf-8"
  | "utf-16"
  | "windows-1252"
  | "iso-8859-15"
  | "iso-8859-1"
  | "macintosh";

export function decodeBytes(bytes: ArrayBuffer, encoding: TextEncoding | string): string {
  // `fatal: false` (default) lets us keep going on invalid byte sequences
  // rather than throwing — the user can fix the encoding choice in the UI.
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function expandYear(y: string): string | null {
  if (y.length === 4) {
    const n = Number(y);
    if (n < 1990 || n > 2100) return null;
    return y;
  }
  // Two-digit pivot: 00–69 → 20xx, 70–99 → 19xx.
  const n = Number(y);
  if (isNaN(n)) return null;
  return n < 70 ? `20${y.padStart(2, "0")}` : `19${y.padStart(2, "0")}`;
}

/**
 * Stable content hash for a transaction row — used as `externalId` fallback
 * when the CSV does not provide a real end-to-end ID. Deterministic across
 * reimports, so overlapping exports deduplicate against the unique constraint.
 */
export function contentHash(parts: {
  date: string;
  amount: number;
  counterpartIban?: string | null;
  counterpartName?: string | null;
  purpose?: string | null;
}): string {
  const key = [
    parts.date,
    parts.amount.toFixed(2),
    (parts.counterpartIban || parts.counterpartName || "").toLowerCase().trim(),
    (parts.purpose || "").toLowerCase().replace(/\s+/g, " ").trim(),
  ].join("|");

  // djb2 hash — deterministic, no crypto dependency.
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  }
  return "csv-" + (h >>> 0).toString(36);
}
