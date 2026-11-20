"use client";

// Top-of-page banner shown after the user lands on the invoice detail page
// via the "Überprüfen & Versenden" CTA (URL: `?send=1`).
//
// The banner replaces the previous behaviour of auto-opening the send-email
// modal on mount — which hid the invoice preview behind a blurred backdrop
// and made the "review" half of "Überprüfen & Versenden" meaningless.
//
// Now the user sees the preview cleanly and can either:
//   - Read the preview, then click "Per Mail senden" right inside the banner,
//   - Or scroll to the Actions card and click the (pulsing) Send button there.
//
// Communication with InvoiceActions: we dispatch a window CustomEvent that
// InvoiceActions listens to. Keeps the modal state co-located with the
// component that owns the rest of the send flow — no state lifting needed.

import { Mail, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";

export function ReadyToSendBanner({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations("invoices.readyToSend");

  function openModal() {
    window.dispatchEvent(
      new CustomEvent("invoice:open-send-modal", { detail: { invoiceId } }),
    );
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 mt-0.5 text-primary shrink-0" />
        <div className="text-sm">
          <div className="font-medium text-foreground">{t("title")}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{t("subtitle")}</div>
        </div>
      </div>
      <button
        onClick={openModal}
        className="inline-flex items-center gap-2 px-3.5 py-2 bg-primary hover:bg-primary/90 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
      >
        <Mail className="w-3.5 h-3.5" />
        {t("cta")}
      </button>
    </div>
  );
}
