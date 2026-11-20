// Shared invoice status badge styles — single source of truth for the whole app.
// Used in: invoice list page, invoice detail page.

export const INVOICE_STATUS_CLASSES: Record<string, string> = {
  DRAFT:     "bg-muted text-muted-foreground",
  SENT:      "bg-blue-500/10 text-blue-500",
  PAID:      "bg-success/10 text-success",
  OVERDUE:   "bg-destructive/10 text-destructive",
  CANCELLED: "bg-muted text-muted-foreground",
};

// Dot color used alongside the badge on the detail page
export const INVOICE_STATUS_DOT: Record<string, string> = {
  DRAFT:     "bg-zinc-400",
  SENT:      "bg-blue-400",
  PAID:      "bg-emerald-400",
  OVERDUE:   "bg-red-400",
  CANCELLED: "bg-zinc-400",
};
