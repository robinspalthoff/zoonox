"use client";

/**
 * Shared "Per E-Mail versenden"-Modal for Angebote + Auftragsbestätigungen.
 *
 * Parallel to the invoice send modal — same UX (TO field locked to the
 * contact's email, free-form message, BCC-to-self default on) — but talks
 * to whichever server action the caller passes in. Wrapping it once here
 * avoids two near-identical modal components in the quotes and OC
 * detail pages.
 */

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Mail, X } from "lucide-react";

type SendFn = (
  docId: string,
  customMessage: string | null,
  sendCopyToSelf: boolean,
) => Promise<{ success: boolean; error?: string }>;

export function BusinessDocSendEmailModal({
  docId,
  docNumber,
  clientEmail,
  i18nNamespace,
  sendFn,
  onClose,
}: {
  docId: string;
  docNumber: string;
  clientEmail: string | null;
  /** Namespace for translated labels — "quotes" or "orderConfirmations". */
  i18nNamespace: "quotes" | "orderConfirmations";
  sendFn: SendFn;
  onClose: () => void;
}) {
  const t = useTranslations(i18nNamespace);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  // Default BCC-to-self ON — matches invoice flow + how most small
  // businesses want a paper trail.
  const [sendCopyToSelf, setSendCopyToSelf] = useState(true);
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !isPending) onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, isPending]);

  const INPUT = "w-full px-3 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors";

  function handleSend() {
    startTransition(async () => {
      const res = await sendFn(docId, message || null, sendCopyToSelf);
      setResult(res);
      if (res.success) {
        // Brief success state, then close + refresh so the status flip
        // (DRAFT → SENT) is visible.
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
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Mail className="w-4 h-4 text-primary" />
            </div>
            <h2 className="text-base font-semibold text-foreground">
              {t("sendEmail.title", { number: docNumber })}
            </h2>
          </div>
          <button onClick={onClose} disabled={isPending} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-foreground mb-1.5">{t("sendEmail.recipient")}</label>
          <input value={clientEmail ?? ""} readOnly className={`${INPUT} opacity-60 cursor-not-allowed`} />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-foreground mb-1.5">{t("sendEmail.message")}</label>
          <textarea
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={isPending}
            placeholder={t("sendEmail.messagePlaceholder")}
            className={INPUT}
          />
        </div>

        <label className="flex items-start gap-2.5 mb-5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={sendCopyToSelf}
            onChange={(e) => setSendCopyToSelf(e.target.checked)}
            disabled={isPending}
            className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
          />
          <div className="text-xs">
            <div className="font-medium text-foreground">{t("sendEmail.copyToSelf")}</div>
          </div>
        </label>

        {result && (
          <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${result.success ? "bg-success/10 text-success" : "bg-red-500/10 text-red-400"}`}>
            {result.success ? t("sendEmail.success") : (result.error ?? t("sendEmail.error"))}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-foreground hover:bg-accent transition-colors disabled:opacity-50">
            {t("sendEmail.cancel")}
          </button>
          <button onClick={handleSend} disabled={isPending || !clientEmail || !!result?.success}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50">
            <Mail className="w-4 h-4" />
            {isPending ? t("sendEmail.sending") : t("sendEmail.send")}
          </button>
        </div>
      </div>
    </div>
  );
}
