/**
 * Auto-match scoring for bank transactions ↔ documents/invoices.
 *
 * Pure functions only — server actions consume `scoreCandidate` to rank
 * a transaction against a candidate list, and the client uses the same
 * scorer inside the MatchPicker so the "Vorschlag" highlight stays in
 * sync with the auto-match routine.
 *
 * Score breakdown (max 100):
 *   - amount (0..45)    — exact / near / partial / off
 *   - sign     (gate)   — wrong sign → null (incompatible, not scored)
 *   - reference (0..35) — invoice / document number contained in purpose
 *   - name      (0..15) — counterpartName ↔ candidate label/supplier
 *   - date      (0..5)  — proximity within 30 days
 *
 * Decision rules (used by the routine, not the UI):
 *   - AUTO_THRESHOLD = 80  → auto-match if (a) score >= 80 AND
 *                            (b) gap to second-best >= 15
 *   - SUGGEST_THRESHOLD = 50 → show "Vorschlag" badge in picker
 */

export const AUTO_THRESHOLD = 80;
export const SUGGEST_THRESHOLD = 50;
export const AUTO_GAP = 15;

const AMOUNT_EPSILON = 0.01;

export interface ScoreInputTx {
  amount: number;
  counterpartName: string | null;
  purpose: string | null;
  date: Date | string;
}

export interface ScoreInputCandidate {
  kind: "document" | "invoice";
  amount: number | null;
  label: string;           // invoice number or supplier
  sublabel: string | null; // contact name or category
  date: string | null;
  invoiceType: "INVOICE" | "CREDIT_NOTE" | "CORRECTION" | null;
  documentType: "INCOME" | "EXPENSE" | null;
  documentNumber?: string | null;
}

/**
 * Return null when sign is incompatible (candidate cannot be matched at
 * all). Otherwise a 0..100 numeric score.
 */
export function scoreCandidate(
  tx: ScoreInputTx,
  c: ScoreInputCandidate,
): number | null {
  if (isSignIncompatible(tx.amount, c)) return null;

  let score = 0;
  score += amountScore(tx.amount, c.amount);
  score += referenceScore(tx.purpose, c);
  score += nameScore(tx.counterpartName, c);
  score += dateScore(tx.date, c.date);
  return Math.round(score);
}

export function isSignIncompatible(
  txAmount: number,
  c: ScoreInputCandidate,
): boolean {
  if (txAmount === 0) return false;
  const isIncoming = txAmount > 0;
  if (c.kind === "invoice") {
    if (c.invoiceType === "INVOICE" || c.invoiceType === "CORRECTION") return !isIncoming;
    if (c.invoiceType === "CREDIT_NOTE") return isIncoming;
    return false;
  }
  if (c.documentType === "INCOME") return !isIncoming;
  if (c.documentType === "EXPENSE") return isIncoming;
  return false;
}

function amountScore(txAmount: number, candAmount: number | null): number {
  if (candAmount == null) return 0;
  const a = Math.abs(txAmount);
  const b = Math.abs(candAmount);
  const diff = Math.abs(a - b);
  if (diff < AMOUNT_EPSILON) return 45;
  if (b === 0) return 0;
  const rel = diff / b;
  if (rel < 0.01) return 40;   // <1% off (rounding/fees)
  if (rel < 0.05) return 25;   // <5% off (e.g. partial payment, fees)
  if (rel < 0.15) return 10;   // loose match
  return 0;
}

function referenceScore(purpose: string | null, c: ScoreInputCandidate): number {
  if (!purpose) return 0;
  const p = purpose.toLowerCase();
  const tokens: string[] = [];
  if (c.kind === "invoice") tokens.push(c.label); // invoice number
  if (c.documentNumber) tokens.push(c.documentNumber);
  for (const raw of tokens) {
    if (!raw) continue;
    const tok = raw.toLowerCase().trim();
    if (tok.length < 3) continue;
    if (p.includes(tok)) return 35;
    // Loose match: strip non-alphanumeric and compare. Helps with
    // "RE-2025-001" vs "RE2025001" or "Rechnung Nr 2025/001" vs "2025-001".
    const stripped = tok.replace(/[^a-z0-9]/g, "");
    const pStripped = p.replace(/[^a-z0-9]/g, "");
    if (stripped.length >= 4 && pStripped.includes(stripped)) return 30;
  }
  return 0;
}

function nameScore(txName: string | null, c: ScoreInputCandidate): number {
  if (!txName) return 0;
  const n = normalize(txName);
  if (!n) return 0;
  const candidates = [c.label, c.sublabel].filter(Boolean) as string[];
  for (const raw of candidates) {
    const cn = normalize(raw);
    if (!cn) continue;
    if (cn === n) return 15;
    if (cn.includes(n) || n.includes(cn)) return 12;
    if (tokenOverlap(n, cn) >= 0.5) return 8;
  }
  return 0;
}

function dateScore(txDate: Date | string, candDate: string | null): number {
  if (!candDate) return 0;
  const a = txDate instanceof Date ? txDate : new Date(txDate);
  const b = new Date(candDate);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  const days = Math.abs(a.getTime() - b.getTime()) / 86_400_000;
  if (days <= 3) return 5;
  if (days <= 14) return 3;
  if (days <= 30) return 1;
  return 0;
}

function normalize(s: string): string {
  // Lowercase + strip common legal-form suffixes + collapse whitespace.
  // We deliberately don't strip punctuation because counterpart names
  // like "Müller-Schmidt" should keep their hyphen for tokenOverlap.
  return s
    .toLowerCase()
    .replace(/\b(gmbh|ag|kg|ohg|ug|e\.k\.|ek|gbr|llc|ltd|inc|co\.?)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(/[\s\-_/]+/).filter((t) => t.length >= 3));
  const tb = new Set(b.split(/[\s\-_/]+/).filter((t) => t.length >= 3));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits++;
  return hits / Math.min(ta.size, tb.size);
}

/**
 * Decide which candidate (if any) should be auto-linked. Returns the
 * top candidate ONLY when score >= AUTO_THRESHOLD and gap to runner-up
 * is >= AUTO_GAP. Otherwise returns null (ambiguous → user picks).
 */
export function pickAutoMatch<T extends { score: number }>(
  scored: T[],
): T | null {
  if (scored.length === 0) return null;
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  if (top.score < AUTO_THRESHOLD) return null;
  const second = sorted[1]?.score ?? 0;
  if (top.score - second < AUTO_GAP) return null;
  return top;
}
