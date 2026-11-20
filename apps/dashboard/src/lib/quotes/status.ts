// Shared quote-status badge styles. Mirrors lib/invoice-status.ts.

import type { QuoteStatus } from "@prisma/client";

export const QUOTE_STATUS_CLASSES: Record<QuoteStatus, string> = {
  DRAFT:    "bg-muted text-muted-foreground",
  SENT:     "bg-blue-500/10 text-blue-500",
  ACCEPTED: "bg-success/10 text-success",
  REJECTED: "bg-destructive/10 text-destructive",
  EXPIRED:  "bg-amber-500/10 text-amber-500",
};

export const QUOTE_STATUS_DOT: Record<QuoteStatus, string> = {
  DRAFT:    "bg-zinc-400",
  SENT:     "bg-blue-400",
  ACCEPTED: "bg-emerald-400",
  REJECTED: "bg-red-400",
  EXPIRED:  "bg-amber-400",
};

/**
 * Whether a quote whose validUntil has passed should be *displayed* as
 * EXPIRED, even when its DB row still says SENT. (A background job flips
 * the row eventually; the UI doesn't wait.)
 */
export function isQuoteEffectivelyExpired(
  status: QuoteStatus,
  validUntil: Date | string | null | undefined,
): boolean {
  if (status === "EXPIRED") return true;
  if (status !== "SENT") return false;
  if (!validUntil) return false;
  return new Date(validUntil).getTime() < Date.now();
}
