"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CircleX, Pencil, Trash2, Receipt, Mail, MailCheck } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { updateOrderConfirmationStatus, deleteOrderConfirmation, sendOrderConfirmationEmail } from "../actions";
import { BusinessDocSendEmailModal } from "@/components/business-doc/send-email-modal";
import type { OrderConfirmationStatus } from "@prisma/client";

export function OCActions({
  ocId, ocNumber, currentStatus, hasInvoice, clientEmail, vertical = false,
}: {
  ocId: string;
  ocNumber: string;
  currentStatus: OrderConfirmationStatus;
  hasInvoice: boolean;
  clientEmail: string | null;
  vertical?: boolean;
}) {
  const t = useTranslations("orderConfirmations");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showDelete, setShowDelete] = useState(false);
  const [showSend, setShowSend] = useState(false);

  const canEdit = currentStatus !== "INVOICED" && currentStatus !== "CANCELLED";
  const canSend = currentStatus === "DRAFT" || currentStatus === "SENT";
  const isResend = currentStatus === "SENT";
  const canCancel = (currentStatus === "DRAFT" || currentStatus === "SENT") && !hasInvoice;
  const canInvoice = currentStatus !== "CANCELLED" && currentStatus !== "INVOICED";
  const canDelete = currentStatus === "DRAFT" && !hasInvoice;

  async function setStatus(status: OrderConfirmationStatus) {
    await updateOrderConfirmationStatus(ocId, status);
    startTransition(() => router.refresh());
  }
  async function doDelete() {
    await deleteOrderConfirmation(ocId);
    setShowDelete(false);
    startTransition(() => router.push("/dashboard/order-confirmations"));
  }
  function convertToInvoice() {
    router.push(`/dashboard/invoices/new?fromOrderConfirmation=${ocId}`);
  }

  const cls = (base: string) => `${base}${vertical ? " justify-center" : ""}`;

  return (
    <>
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowDelete(false)} />
          <div className="relative z-10 bg-card border border-border rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <h2 className="text-base font-semibold text-foreground">{t("deleteConfirm.title")}</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-2">{t("deleteConfirm.message")}</p>
            <p className="text-xs text-muted-foreground mb-4 font-mono">{ocNumber}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowDelete(false)} disabled={isPending}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-foreground hover:bg-accent transition-colors disabled:opacity-50">
                {t("deleteConfirm.cancel")}
              </button>
              <button onClick={doDelete} disabled={isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50">
                <Trash2 className="w-4 h-4" />
                {isPending ? "…" : t("deleteConfirm.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSend && (
        <BusinessDocSendEmailModal
          docId={ocId}
          docNumber={ocNumber}
          clientEmail={clientEmail}
          i18nNamespace="orderConfirmations"
          sendFn={sendOrderConfirmationEmail}
          onClose={() => setShowSend(false)}
        />
      )}

      <div className={vertical ? "flex flex-col gap-2" : "flex items-center gap-2"}>
        {canSend && (
          <button onClick={() => setShowSend(true)} disabled={isPending}
            className={cls(`flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 text-sm font-medium rounded-lg transition-colors disabled:opacity-50`)}>
            {isResend ? <MailCheck className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
            {isResend ? t("sendEmail.resend") : t("actions.markAsSent")}
          </button>
        )}
        {canEdit && (
          <Link href={`/dashboard/order-confirmations/${ocId}/edit`}
            className={cls("flex items-center gap-2 px-4 py-2 bg-muted text-foreground hover:bg-accent text-sm font-medium rounded-lg transition-colors")}>
            <Pencil className="w-4 h-4" />{t("actions.edit")}
          </Link>
        )}
        {canInvoice && (
          <button onClick={convertToInvoice} disabled={isPending}
            className={cls("flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 text-sm font-medium rounded-lg transition-colors disabled:opacity-50")}>
            <Receipt className="w-4 h-4" />{t("actions.createInvoice")}
          </button>
        )}
        {canCancel && (
          <button onClick={() => setStatus("CANCELLED")} disabled={isPending}
            className={cls("flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-500 hover:bg-red-500/20 text-sm font-medium rounded-lg transition-colors disabled:opacity-50")}>
            <CircleX className="w-4 h-4" />{t("actions.markAsCancelled")}
          </button>
        )}
        {canDelete && (
          <button onClick={() => setShowDelete(true)} disabled={isPending}
            className={cls("flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 text-sm font-medium rounded-lg transition-colors disabled:opacity-50")}>
            <Trash2 className="w-4 h-4" />{t("actions.delete")}
          </button>
        )}
      </div>
    </>
  );
}
