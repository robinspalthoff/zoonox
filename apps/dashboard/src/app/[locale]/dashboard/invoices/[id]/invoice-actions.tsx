"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Mail, X, FileX2, MailCheck, CircleCheckBig, Trash2, Undo2, Pencil, FilePenLine } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { updateInvoiceStatus, sendInvoiceEmail, createCreditNote, deleteDraftInvoice, revertInvoicePayment } from "../actions";
import type { InvoiceStatus } from "@prisma/client";
import { MarkPaidDialog } from "./mark-paid-dialog";

// ── Cancel confirmation modal (DRAFT only) ────────────────────────────────────

function CancelConfirmModal({
  onConfirm, onAbort, isPending,
}: { onConfirm: () => void; onAbort: () => void; isPending: boolean }) {
  const t = useTranslations("invoices");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onAbort} />
      <div className="relative z-10 bg-card border border-border rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-foreground">{t("cancelConfirmTitle")}</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-5">{t("cancelConfirmMessage")}</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onAbort} disabled={isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-foreground hover:bg-accent transition-colors disabled:opacity-50">
            {t("cancelConfirmAbort")}
          </button>
          <button onClick={onConfirm} disabled={isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50">
            {isPending ? "…" : t("cancelConfirmAction")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete draft confirmation modal ───────────────────────────────────────────

function DeleteDraftModal({
  onConfirm, onAbort, isPending,
}: { onConfirm: () => void; onAbort: () => void; isPending: boolean }) {
  const t = useTranslations("invoices");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onAbort} />
      <div className="relative z-10 bg-card border border-border rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-red-400" />
          </div>
          <h2 className="text-base font-semibold text-foreground">{t("deleteDraft.title")}</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-5">{t("deleteDraft.message")}</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onAbort} disabled={isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-foreground hover:bg-accent transition-colors disabled:opacity-50">
            {t("cancelConfirmAbort")}
          </button>
          <button onClick={onConfirm} disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50">
            <Trash2 className="w-4 h-4" />
            {isPending ? "…" : t("deleteDraft.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Credit note confirmation modal (SENT/PAID) ────────────────────────────────

function CreditNoteConfirmModal({
  invoiceNumber, onConfirm, onAbort, isPending,
}: {
  invoiceNumber: string;
  onConfirm: (markAsRefunded: boolean) => void;
  onAbort: () => void;
  isPending: boolean;
}) {
  const t = useTranslations("invoices");
  const [markAsRefunded, setMarkAsRefunded] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onAbort} />
      <div className="relative z-10 bg-card border border-border rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center">
            <FileX2 className="w-5 h-5 text-amber-400" />
          </div>
          <h2 className="text-base font-semibold text-foreground">{t("creditNoteConfirmTitle")}</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-2">{t("creditNoteConfirmMessage", { number: invoiceNumber })}</p>
        <p className="text-xs text-muted-foreground mb-4 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
          {t("creditNoteGoBDNote")}
        </p>

        {/* Mark as refunded toggle */}
        <label className="flex items-center gap-3 mb-5 cursor-pointer select-none group">
          <div
            onClick={() => setMarkAsRefunded(!markAsRefunded)}
            className={`w-9 h-5 rounded-full flex items-center transition-colors duration-200 px-0.5 ${markAsRefunded ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
          >
            <span className={`w-4 h-4 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${markAsRefunded ? "translate-x-4" : "translate-x-0"}`} />
          </div>
          <span className="text-sm text-foreground">{t("creditNoteMarkRefunded")}</span>
        </label>

        <div className="flex gap-2 justify-end">
          <button onClick={onAbort} disabled={isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-foreground hover:bg-accent transition-colors disabled:opacity-50">
            {t("cancelConfirmAbort")}
          </button>
          <button onClick={() => onConfirm(markAsRefunded)} disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50">
            <FileX2 className="w-4 h-4" />
            {isPending ? "…" : t("creditNoteConfirmAction")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Storno confirmation modal (SENT/OVERDUE, unpaid) ─────────────────────────
//
// Storno = "Rechnung zurückziehen, bevor sie bezahlt wurde". Es wird eine
// Stornorechnung (CREDIT_NOTE mit negativem Betrag) angelegt, die das
// Original neutralisiert. Original-Status → CANCELLED. Die Stornorechnung
// wird direkt abgeschlossen (Status PAID) — ein sauberer Abschluss ohne
// manuellen "Versenden"-Schritt. Sie ist komplett erfolgsneutral: das
// Dashboard verrechnet eine Gutschrift nur, wenn deren Original selbst
// bezahlt war — hier ist es das nicht. Der Refund-Toggle der Gutschrift-
// Variante entfällt deshalb.
function StornoConfirmModal({
  invoiceNumber, onConfirm, onAbort, isPending,
}: {
  invoiceNumber: string;
  onConfirm: () => void;
  onAbort: () => void;
  isPending: boolean;
}) {
  const t = useTranslations("invoices");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onAbort} />
      <div className="relative z-10 bg-card border border-border rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center">
            <FileX2 className="w-5 h-5 text-red-400" />
          </div>
          <h2 className="text-base font-semibold text-foreground">{t("stornoConfirmTitle")}</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-2">
          {t("stornoConfirmMessage", { number: invoiceNumber })}
        </p>
        <p className="text-xs text-muted-foreground mb-5 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
          {t("stornoGoBDNote")}
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onAbort} disabled={isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-foreground hover:bg-accent transition-colors disabled:opacity-50">
            {t("cancelConfirmAbort")}
          </button>
          <button onClick={onConfirm} disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50">
            <FileX2 className="w-4 h-4" />
            {isPending ? "…" : t("stornoConfirmAction")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Send email modal ──────────────────────────────────────────────────────────

function SendEmailModal({
  invoiceId, clientEmail, isCreditNote, onClose,
}: { invoiceId: string; clientEmail: string | null; isCreditNote: boolean; onClose: () => void }) {
  const t = useTranslations("invoices");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  // Default the BCC-to-self toggle to true — the vast majority of small
  // businesses want a paper trail of every invoice they sent. They can untick
  // per-send when they don't.
  const [sendCopyToSelf, setSendCopyToSelf] = useState(true);
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null);

  const INPUT = "w-full px-3 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors";

  async function handleSend() {
    startTransition(async () => {
      const res = await sendInvoiceEmail(invoiceId, message || null, sendCopyToSelf);
      setResult(res);
      if (res.success) {
        setTimeout(() => {
          router.refresh();
          onClose();
        }, 1500);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={!isPending ? onClose : undefined} />
      <div className="relative z-10 bg-card border border-border rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Mail className="w-4 h-4 text-primary" />
            </div>
            <h2 className="text-base font-semibold text-foreground">
              {isCreditNote ? t("sendCreditNoteEmailTitle") : t("sendEmailTitle")}
            </h2>
          </div>
          <button onClick={onClose} disabled={isPending} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Recipient */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-foreground mb-1.5">{t("sendEmailRecipient")}</label>
          <input value={clientEmail ?? ""} readOnly className={`${INPUT} opacity-60 cursor-not-allowed`} />
        </div>

        {/* Custom message */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-foreground mb-1.5">{t("sendEmailMessage")}</label>
          <textarea
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={isPending}
            className={INPUT}
          />
        </div>

        {/* BCC: send a copy to the acting user — invisible to the recipient.
            Uses BCC (not CC) so the customer can't see other addressees. */}
        <label className="flex items-start gap-2.5 mb-5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={sendCopyToSelf}
            onChange={(e) => setSendCopyToSelf(e.target.checked)}
            disabled={isPending}
            className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
          />
          <div className="text-xs">
            <div className="font-medium text-foreground">{t("sendEmailCopyToSelf")}</div>
          </div>
        </label>

        {/* Feedback */}
        {result && (
          <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${result.success ? "bg-success/10 text-success" : "bg-red-500/10 text-red-400"}`}>
            {result.success ? t("sendEmailSuccess") : (result.error ?? "Fehler beim Senden.")}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-foreground hover:bg-accent transition-colors disabled:opacity-50">
            {t("cancelConfirmAbort")}
          </button>
          <button onClick={handleSend} disabled={isPending || !clientEmail || !!result?.success}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50">
            <Mail className="w-4 h-4" />
            {isPending ? "Wird gesendet…" : t("sendEmailAction")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function InvoiceActions({
  invoiceId,
  invoiceNumber,
  invoiceTotal,
  currentStatus,
  clientEmail,
  isCreditNote = false,
  isCorrection = false,
  autoOpenSend = false,
  autoOpenPay = false,
  autoOpenCreditNote = false,
  vertical = false,
}: {
  invoiceId: string;
  invoiceNumber: string;
  invoiceTotal: number;
  currentStatus: InvoiceStatus;
  clientEmail: string | null;
  isCreditNote?: boolean;
  /** True when the invoice is itself a Rechnungskorrektur — no further adjustment actions. */
  isCorrection?: boolean;
  autoOpenSend?: boolean;
  autoOpenPay?: boolean;
  autoOpenCreditNote?: boolean;
  vertical?: boolean;
}) {
  // Convenience: any document that itself adjusts another invoice — neither
  // Gutschriften nor Rechnungskorrekturen can themselves be corrected/storno'd.
  const isAdjustmentDoc = isCreditNote || isCorrection;
  const t = useTranslations("invoices");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showCreditNoteModal, setShowCreditNoteModal] = useState(false);
  const [showStornoModal, setShowStornoModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showPaidModal, setShowPaidModal] = useState(false);

  // The previous behaviour auto-opened the send modal on arrival, which hid
  // the invoice preview behind the modal's backdrop blur — defeating the
  // whole point of "Überprüfen & Versenden". We now only listen for an
  // explicit open request:
  //   - a custom DOM event fired by the "Bereit zum Versenden"-banner
  //     (so the banner's CTA can trigger the modal from outside this tree)
  //   - the user clicking the regular "Per Mail senden" button in this card
  //
  // The `autoOpenSend` prop is retained for backwards-compat but only used
  // to wire a one-time pulse highlight on the send button (see below).
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ invoiceId?: string }>;
      if (!ce.detail || ce.detail.invoiceId === invoiceId) {
        setShowSendModal(true);
      }
    };
    window.addEventListener("invoice:open-send-modal", handler);
    return () => window.removeEventListener("invoice:open-send-modal", handler);
  }, [invoiceId]);

  // Auto-open mark-as-paid or credit-note modals when navigated from the
  // invoice list's quick-actions menu.
  useEffect(() => {
    if (autoOpenPay && (currentStatus === "SENT" || currentStatus === "OVERDUE")) {
      setShowPaidModal(true);
    }
  }, [autoOpenPay, currentStatus]);

  // The list-page "Storno/Gutschrift" quick action passes `?cn=1`. Route it
  // to the right modal depending on payment status: Storno for unpaid
  // (SENT/OVERDUE), Gutschrift for already-paid invoices.
  useEffect(() => {
    if (!autoOpenCreditNote) return;
    if (currentStatus === "SENT" || currentStatus === "OVERDUE") {
      setShowStornoModal(true);
    } else if (currentStatus === "PAID") {
      setShowCreditNoteModal(true);
    }
  }, [autoOpenCreditNote, currentStatus]);

  async function handle(status: "SENT" | "PAID") {
    await updateInvoiceStatus(invoiceId, status);
    startTransition(() => router.refresh());
  }

  async function handleRevertPayment() {
    await revertInvoicePayment(invoiceId);
    startTransition(() => router.refresh());
  }

  async function confirmDelete() {
    await deleteDraftInvoice(invoiceId);
    setShowDeleteModal(false);
    startTransition(() => router.push("/dashboard/invoices"));
  }

  async function confirmCancel() {
    await updateInvoiceStatus(invoiceId, "CANCELLED");
    setShowCancelModal(false);
    startTransition(() => router.refresh());
  }

  async function confirmCreditNote(markAsRefunded: boolean) {
    const result = await createCreditNote(invoiceId, { markAsRefunded });
    setShowCreditNoteModal(false);
    if (result.success) {
      startTransition(() => router.push(`/dashboard/invoices/${result.id}`));
    }
  }

  // Storno for SENT/OVERDUE (unpaid) invoices. Same server endpoint as a
  // credit note. markAsRefunded stays false: the customer never paid, so
  // there is nothing to refund — the credit note must NOT be booked as a
  // paid cash event. The server also enforces this regardless of the flag.
  async function confirmStorno() {
    const result = await createCreditNote(invoiceId, { markAsRefunded: false });
    setShowStornoModal(false);
    if (result.success) {
      startTransition(() => router.push(`/dashboard/invoices/${result.id}`));
    }
  }

  const cls = (base: string) => `${base}${vertical ? " justify-center" : ""}`;

  return (
    <>
      {showDeleteModal && (
        <DeleteDraftModal
          onConfirm={confirmDelete}
          onAbort={() => setShowDeleteModal(false)}
          isPending={isPending}
        />
      )}
      {showCancelModal && (
        <CancelConfirmModal
          onConfirm={confirmCancel}
          onAbort={() => setShowCancelModal(false)}
          isPending={isPending}
        />
      )}
      {showCreditNoteModal && (
        <CreditNoteConfirmModal
          invoiceNumber={invoiceNumber}
          onConfirm={confirmCreditNote}
          onAbort={() => setShowCreditNoteModal(false)}
          isPending={isPending}
        />
      )}
      {showStornoModal && (
        <StornoConfirmModal
          invoiceNumber={invoiceNumber}
          onConfirm={confirmStorno}
          onAbort={() => setShowStornoModal(false)}
          isPending={isPending}
        />
      )}
      {showSendModal && (
        <SendEmailModal
          invoiceId={invoiceId}
          clientEmail={clientEmail}
          isCreditNote={isCreditNote}
          onClose={() => setShowSendModal(false)}
        />
      )}
      {showPaidModal && (
        <MarkPaidDialog
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          invoiceTotal={invoiceTotal}
          onClose={() => setShowPaidModal(false)}
        />
      )}
      <div className={vertical ? "flex flex-col gap-2" : "flex items-center gap-2"}>

        {/* Send / Resend email — available for DRAFT and SENT.
            When `autoOpenSend` is set (i.e. user arrived from the "Überprüfen
            & Versenden" flow), give the button a soft pulsing ring so it's
            easy to spot after reviewing the preview. */}
        {(currentStatus === "DRAFT" || currentStatus === "SENT") && (
          <button onClick={() => setShowSendModal(true)} disabled={isPending}
            className={cls(`flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
              autoOpenSend && currentStatus === "DRAFT" ? "ring-2 ring-primary/40 animate-pulse" : ""
            }`)}>
            {currentStatus === "SENT" ? <MailCheck className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
            {currentStatus === "SENT"
              ? (isCreditNote ? t("resendCreditNoteEmail") : t("resendEmail"))
              : (isCreditNote ? t("sendCreditNoteEmail") : t("sendEmail"))}
          </button>
        )}

        {/* Edit draft — DRAFT only. Once finalized, the GoBD immutability
            rule kicks in and corrections must go through a credit note. */}
        {currentStatus === "DRAFT" && (
          <Link
            href={`/dashboard/invoices/${invoiceId}/edit`}
            className={cls(`flex items-center gap-2 px-4 py-2 bg-muted text-foreground hover:bg-accent text-sm font-medium rounded-lg transition-colors`)}
          >
            <Pencil className="w-4 h-4" />
            {t("edit")}
          </Link>
        )}

        {/* Mark as Sent — DRAFT only */}
        {currentStatus === "DRAFT" && (
          <button onClick={() => handle("SENT")} disabled={isPending}
            className={cls(`px-4 py-2 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 text-sm font-medium rounded-lg transition-colors disabled:opacity-50`)}>
            {t("markAsSent")}
          </button>
        )}

        {/* Mark as Paid / Refunded — SENT/OVERDUE */}
        {(currentStatus === "SENT" || currentStatus === "OVERDUE") && (
          <button
            onClick={() => (isCreditNote ? handle("PAID") : setShowPaidModal(true))}
            disabled={isPending}
            className={cls(`flex items-center gap-2 px-4 py-2 bg-success/10 text-success hover:bg-success/20 text-sm font-medium rounded-lg transition-colors disabled:opacity-50`)}>
            <CircleCheckBig className="w-4 h-4" />
            {isCreditNote ? t("markAsRefunded") : t("markAsPaid")}
          </button>
        )}

        {/* Revert payment — PAID regular invoices only */}
        {!isCreditNote && currentStatus === "PAID" && (
          <button onClick={handleRevertPayment} disabled={isPending}
            className={cls(`flex items-center gap-2 px-4 py-2 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 text-sm font-medium rounded-lg transition-colors disabled:opacity-50`)}>
            <Undo2 className="w-4 h-4" />
            {t("revertPayment")}
          </button>
        )}

        {/* GoBD Cancel: DRAFT → direct cancel */}
        {currentStatus === "DRAFT" && (
          <button onClick={() => setShowCancelModal(true)} disabled={isPending}
            className={cls(`px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 text-sm font-medium rounded-lg transition-colors disabled:opacity-50`)}>
            {t("cancel")}
          </button>
        )}

        {/* Hard delete — DRAFT only */}
        {currentStatus === "DRAFT" && (
          <button onClick={() => setShowDeleteModal(true)} disabled={isPending}
            className={cls(`flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 text-sm font-medium rounded-lg transition-colors disabled:opacity-50`)}>
            <Trash2 className="w-4 h-4" />
            {t("deleteDraft.button")}
          </button>
        )}

        {/* Rechnungskorrektur — for finalised invoices (SENT/OVERDUE/PAID).
            §31 Abs. 5 UStDV: only individual line items get corrected, the
            original keeps its status. Distinct from Storno/Gutschrift which
            reverse the whole document. */}
        {!isAdjustmentDoc &&
          (currentStatus === "SENT" || currentStatus === "OVERDUE" || currentStatus === "PAID") && (
            <Link
              href={`/dashboard/invoices/${invoiceId}/correct`}
              className={cls(`flex items-center gap-2 px-4 py-2 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 text-sm font-medium rounded-lg transition-colors`)}
            >
              <FilePenLine className="w-4 h-4" />
              {t("correctInvoice")}
            </Link>
          )}

        {/* Storno — SENT/OVERDUE (unpaid). Technically also a CREDIT_NOTE
            under the hood, but UX-wise distinct from a refund-style Gutschrift:
            no money flowed yet, so the storno is fully settled on issue and
            we don't ask the user about a refund. */}
        {!isAdjustmentDoc && (currentStatus === "SENT" || currentStatus === "OVERDUE") && (
          <button onClick={() => setShowStornoModal(true)} disabled={isPending}
            className={cls(`flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 text-sm font-medium rounded-lg transition-colors disabled:opacity-50`)}>
            <FileX2 className="w-4 h-4" />
            {t("storno")}
          </button>
        )}

        {/* Gutschrift — only when the invoice has already been PAID. The
            modal asks whether the refund has been issued, because here money
            actually has to move back to the customer. */}
        {!isAdjustmentDoc && currentStatus === "PAID" && (
          <button onClick={() => setShowCreditNoteModal(true)} disabled={isPending}
            className={cls(`flex items-center gap-2 px-4 py-2 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 text-sm font-medium rounded-lg transition-colors disabled:opacity-50`)}>
            <FileX2 className="w-4 h-4" />
            {t("createCreditNote")}
          </button>
        )}
      </div>
    </>
  );
}
