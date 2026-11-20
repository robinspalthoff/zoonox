"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { QrCode } from "lucide-react";
import { setInvoicePaymentQr } from "../actions";

// Sidebar row on the invoice detail page that toggles the EPC payment
// QR-Code. Interactive only while the invoice is a DRAFT — once finalized the
// PDF is GoBD-immutable, so the switch is shown disabled (state still visible).
export function PaymentQrToggle({
  invoiceId,
  enabled,
  editable,
}: {
  invoiceId: string;
  enabled: boolean;
  editable: boolean;
}) {
  const t = useTranslations("invoices");
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    if (!editable || isPending) return;
    const next = !on;
    setOn(next); // optimistic
    startTransition(async () => {
      const res = await setInvoicePaymentQr(invoiceId, next);
      if (res.success) {
        router.refresh();
      } else {
        setOn(!next); // revert on failure
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
        <QrCode className="w-3.5 h-3.5" />
        {t("form.paymentQr.label")}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={toggle}
        disabled={!editable || isPending}
        title={editable ? undefined : t("form.paymentQr.lockedHint")}
        className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${
          on ? "bg-primary" : "bg-muted-foreground/30"
        } ${editable ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
            on ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
