// Shared order-confirmation status badge styles.

import type { OrderConfirmationStatus } from "@prisma/client";

export const OC_STATUS_CLASSES: Record<OrderConfirmationStatus, string> = {
  DRAFT:     "bg-muted text-muted-foreground",
  SENT:      "bg-blue-500/10 text-blue-500",
  INVOICED:  "bg-success/10 text-success",
  CANCELLED: "bg-muted text-muted-foreground",
};

export const OC_STATUS_DOT: Record<OrderConfirmationStatus, string> = {
  DRAFT:     "bg-zinc-400",
  SENT:      "bg-blue-400",
  INVOICED:  "bg-emerald-400",
  CANCELLED: "bg-zinc-400",
};
