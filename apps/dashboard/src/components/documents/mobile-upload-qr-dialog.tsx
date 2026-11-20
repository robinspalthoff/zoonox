"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { X, Smartphone, Copy, CheckCircle2, Loader2, AlertCircle } from "lucide-react";

type SessionInfo = { token: string; url: string; expiresAt: string };

type StatusResponse = {
  status: "pending" | "active" | "expired" | "revoked";
  expiresAt: string;
  documentCount: number;
  documents: Array<{
    id: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    status: string;
    recognizedAmount: string | null;
    recognizedDate: string | null;
    recognizedSupplier: string | null;
    createdAt: string;
    uploadedBy: { firstName: string | null; lastName: string | null } | null;
  }>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  // Wird beim Polling für jedes neu hinzugekommene Dokument einmal aufgerufen,
  // damit die übergeordnete Liste ohne Reload aktualisiert wird.
  onDocumentArrived?: (doc: StatusResponse["documents"][number]) => void;
};

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MobileUploadQrDialog({ open, onClose, onDocumentArrived }: Props) {
  const t = useTranslations("documents.mobileUpload");
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receivedCount, setReceivedCount] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [copied, setCopied] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => setMounted(true), []);

  // Session beim Öffnen erzeugen, beim Schließen revoken.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(null);
    setSession(null);
    setQrDataUrl(null);
    setReceivedCount(0);
    seenIds.current = new Set();

    (async () => {
      try {
        const res = await fetch("/api/mobile-upload/session", { method: "POST" });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Fehler beim Erstellen der Session");
        }
        const data = (await res.json()) as SessionInfo;
        if (!active) return;
        setSession(data);
        const qr = await QRCode.toDataURL(data.url, {
          width: 320,
          margin: 1,
          errorCorrectionLevel: "M",
        });
        if (!active) return;
        setQrDataUrl(qr);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Unbekannter Fehler");
      }
    })();

    return () => {
      active = false;
    };
  }, [open]);

  // Revoke on close.
  const handleClose = useCallback(() => {
    if (session) {
      void fetch(`/api/mobile-upload/session?token=${encodeURIComponent(session.token)}`, {
        method: "DELETE",
      }).catch(() => {});
    }
    onClose();
  }, [session, onClose]);

  // Lock body scroll + Escape close.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, handleClose]);

  // Countdown.
  useEffect(() => {
    if (!session) return;
    const tick = () => setRemaining(new Date(session.expiresAt).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session]);

  // Polling.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function poll() {
      if (cancelled || !session) return;
      try {
        const res = await fetch(
          `/api/mobile-upload/${encodeURIComponent(session.token)}/status`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const data = (await res.json()) as StatusResponse;
          if (cancelled) return;
          setReceivedCount(data.documentCount);
          for (const doc of data.documents) {
            if (!seenIds.current.has(doc.id)) {
              seenIds.current.add(doc.id);
              onDocumentArrived?.(doc);
            }
          }
          if (data.status === "expired" || data.status === "revoked") return;
        }
      } catch {
        // ignore transient errors
      }
      if (!cancelled) setTimeout(poll, 2500);
    }
    const id = setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [session, onDocumentArrived]);

  if (!mounted || !open) return null;

  const isExpired = session ? remaining <= 0 : false;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("close")}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4 flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold">{t("title")}</h2>
            <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {!error && !qrDataUrl && (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {qrDataUrl && session && (
          <div className="flex flex-col items-center gap-3">
            <div
              className={`relative rounded-xl bg-white p-3 ${isExpired ? "opacity-40" : ""}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR-Code" className="h-64 w-64" />
            </div>
            <p className="text-center text-xs text-muted-foreground">
              {isExpired ? t("expired") : t("scanHint")}
            </p>

            <div className="flex w-full items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
              <span className="truncate text-xs text-muted-foreground">{session.url}</span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(session.url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
                title={t("copyLink")}
              >
                {copied ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            <div className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                {isExpired ? t("expiredShort") : t("validFor", { time: formatRemaining(remaining) })}
              </span>
              <span
                className={`font-medium ${receivedCount > 0 ? "text-emerald-600" : "text-muted-foreground"}`}
              >
                {receivedCount === 0
                  ? t("waiting")
                  : t("received", { count: receivedCount })}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
