"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CircleCheckBig, CircleX, Pencil, Trash2, FileSignature, Receipt, Mail, MailCheck } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { updateQuoteStatus, deleteQuote, sendQuoteEmail } from "../actions";
import { BusinessDocSendEmailModal } from "@/components/business-doc/send-email-modal";
import { ConvertToOCModal } from "./convert-to-oc-modal";
import type { QuoteStatus } from "@prisma/client";

export function QuoteActions({
  quoteId, quoteNumber, currentStatus, converted, clientEmail, vertical = false,
}: {
  quoteId: string;
  quoteNumber: string;
  currentStatus: QuoteStatus;
  converted: boolean;
  /** Client email — drives the disabled state of the "Send" button. */
  clientEmail: string | null;
  vertical?: boolean;
}) {
  const t = useTranslations("quotes");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showDelete, setShowDelete] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showConvertOC, setShowConvertOC] = useState(false);

  const canEdit = !converted && currentStatus === "DRAFT";
  // Send is available as long as the quote is alive: DRAFT (first send) or
  // SENT (resend). REJECTED/EXPIRED/converted block it.
  const canSend = !converted && (currentStatus === "DRAFT" || currentStatus === "SENT");
  const isResend = currentStatus === "SENT";
  const canAccept = !converted && (currentStatus === "SENT" || currentStatus === "DRAFT");
  const canReject = !converted && (currentStatus === "SENT" || currentStatus === "DRAFT" || currentStatus === "ACCEPTED");
  const canConvert = !converted && currentStatus !== "REJECTED";
  const canDelete = !converted;

  async function setStatus(status: QuoteStatus) {
    await updateQuoteStatus(quoteId, status);
    startTransition(() => router.refresh());
  }
  async function doDelete() {
    await deleteQuote(quoteId);
    setShowDelete(false);
    startTransition(() => router.push("/dashboard/quotes"));
  }
  // Conversion now goes through the partial-conversion modal where the
  // user can de-select positions and adjust quantities. The modal calls
  // convertQuoteToOrderConfirmation on confirm and routes onward itself.
  function openConvertToOC() {
    setShowConvertOC(true);
  }
  function convertToInvoice() {
    router.push(`/dashboard/invoices/new?fromQuote=${quoteId}`);
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
            <p className="text-xs text-muted-foreground mb-4 font-mono">{quoteNumber}</p>
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
          docId={quoteId}
          docNumber={quoteNumber}
          clientEmail={clientEmail}
          i18nNamespace="quotes"
          sendFn={sendQuoteEmail}
          onClose={() => setShowSend(false)}
        />
      )}

      {showConvertOC && (
        <ConvertToOCModal
          quoteId={quoteId}
          quoteNumber={quoteNumber}
          onClose={() => setShowConvertOC(false)}
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
          <Link href={`/dashboard/quotes/${quoteId}/edit`}
            className={cls("flex items-center gap-2 px-4 py-2 bg-muted text-foreground hover:bg-accent text-sm font-medium rounded-lg transition-colors")}>
            <Pencil className="w-4 h-4" />{t("actions.edit")}
          </Link>
        )}

        {canAccept && (
          <button onClick={() => setStatus("ACCEPTED")} disabled={isPending}
            className={cls("flex items-center gap-2 px-4 py-2 bg-success/10 text-success hover:bg-success/20 text-sm font-medium rounded-lg transition-colors disabled:opacity-50")}>
            <CircleCheckBig className="w-4 h-4" />{t("actions.markAsAccepted")}
          </button>
        )}
        {canReject && (
          <button onClick={() => setStatus("REJECTED")} disabled={isPending}
            className={cls("flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-500 hover:bg-red-500/20 text-sm font-medium rounded-lg transition-colors disabled:opacity-50")}>
            <CircleX className="w-4 h-4" />{t("actions.markAsRejected")}
          </button>
        )}

        {canConvert && (
          <>
            <button onClick={openConvertToOC} disabled={isPending}
              className={cls("flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 text-sm font-medium rounded-lg transition-colors disabled:opacity-50")}>
              <FileSignature className="w-4 h-4" />{t("actions.createOrderConfirmation")}
            </button>
            <button onClick={convertToInvoice} disabled={isPending}
              className={cls("flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 text-sm font-medium rounded-lg transition-colors disabled:opacity-50")}>
              <Receipt className="w-4 h-4" />{t("actions.createInvoice")}
            </button>
          </>
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
