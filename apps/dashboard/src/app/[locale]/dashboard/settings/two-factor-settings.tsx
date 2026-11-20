"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ShieldCheck, X, Loader2 } from "lucide-react";
import {
  generate2faSecret,
  enable2fa,
  disable2fa,
  type Generate2faResult,
  type Toggle2faResult,
} from "./actions";

const INPUT =
  "w-full px-3 py-2.5 bg-muted border rounded-lg text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors";
const LABEL = "block text-sm font-medium text-foreground mb-1.5";

export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const t = useTranslations("settings.twoFactor");
  const router = useRouter();
  const [mode, setMode] = useState<null | "enable" | "disable">(null);

  const close = () => setMode(null);
  const done = () => {
    setMode(null);
    router.refresh();
  };

  return (
    <section className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          <p className={`text-xs mt-2 font-medium ${enabled ? "text-success" : "text-muted-foreground"}`}>
            {enabled ? t("statusOn") : t("statusOff")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t("title")}
          onClick={() => setMode(enabled ? "disable" : "enable")}
          className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
            enabled ? "bg-primary" : "bg-muted-foreground/30"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>

      {mode === "enable" && <EnableDialog onClose={close} onDone={done} />}
      {mode === "disable" && <DisableDialog onClose={close} onDone={done} />}
    </section>
  );
}

function Shell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-sm text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Aktivieren ──────────────────────────────────────────────────────────────

function EnableDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useTranslations("settings.twoFactor");
  const [setup, setSetup] = useState<Generate2faResult | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [state, action, pending] = useActionState<Toggle2faResult | null, FormData>(
    enable2fa,
    null,
  );

  useEffect(() => {
    let cancelled = false;
    generate2faSecret()
      .then((s) => { if (!cancelled) setSetup(s); })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (state?.success) onDone();
  }, [state, onDone]);

  const fieldError = (field: "password" | "code") =>
    state && !state.success && state.field === field ? state.error : undefined;
  const globalError = state && !state.success && !state.field ? state.error : undefined;

  return (
    <Shell title={t("enableTitle")} onClose={onClose}>
      {loadError ? (
        <p className="text-sm text-destructive">{t("loadError")}</p>
      ) : !setup ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("loading")}
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">{t("enableIntro")}</p>

          <div className="flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={setup.qrDataUrl}
              alt="QR-Code"
              className="rounded-lg border border-border bg-white p-2"
              width={180}
              height={180}
            />
            <div className="w-full">
              <p className="text-xs text-muted-foreground mb-1 text-center">{t("manualKey")}</p>
              <p className="font-mono text-xs text-foreground break-all text-center bg-muted rounded-lg px-3 py-2 select-all">
                {setup.secret}
              </p>
            </div>
          </div>

          <form action={action} className="space-y-4">
            <input type="hidden" name="secret" value={setup.secret} />

            <div>
              <label htmlFor="2fa-code" className={LABEL}>{t("code")}</label>
              <input
                id="2fa-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                required
                className={`${INPUT} tracking-[0.3em] text-center ${
                  fieldError("code")
                    ? "border-destructive focus:border-destructive"
                    : "border-border focus:border-primary/50"
                }`}
              />
              {fieldError("code") && (
                <p className="mt-1.5 text-xs text-destructive">{fieldError("code")}</p>
              )}
            </div>

            <div>
              <label htmlFor="2fa-password" className={LABEL}>{t("confirmPassword")}</label>
              <input
                id="2fa-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className={`${INPUT} ${
                  fieldError("password")
                    ? "border-destructive focus:border-destructive"
                    : "border-border focus:border-primary/50"
                }`}
              />
              {fieldError("password") && (
                <p className="mt-1.5 text-xs text-destructive">{fieldError("password")}</p>
              )}
            </div>

            {globalError && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                {globalError}
              </p>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={pending}
                className="inline-flex items-center justify-center px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white font-medium text-sm rounded-lg transition-colors"
              >
                {pending ? t("submitting") : t("enableSubmit")}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("cancel")}
              </button>
            </div>
          </form>
        </div>
      )}
    </Shell>
  );
}

// ─── Deaktivieren ────────────────────────────────────────────────────────────

function DisableDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useTranslations("settings.twoFactor");
  const [state, action, pending] = useActionState<Toggle2faResult | null, FormData>(
    disable2fa,
    null,
  );

  useEffect(() => {
    if (state?.success) onDone();
  }, [state, onDone]);

  const passwordError = state && !state.success && state.field === "password" ? state.error : undefined;
  const globalError = state && !state.success && !state.field ? state.error : undefined;

  return (
    <Shell title={t("disableTitle")} onClose={onClose}>
      <form action={action} className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("disableIntro")}</p>

        <div>
          <label htmlFor="2fa-disable-password" className={LABEL}>{t("confirmPassword")}</label>
          <input
            id="2fa-disable-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={`${INPUT} ${
              passwordError
                ? "border-destructive focus:border-destructive"
                : "border-border focus:border-primary/50"
            }`}
          />
          {passwordError && (
            <p className="mt-1.5 text-xs text-destructive">{passwordError}</p>
          )}
        </div>

        {globalError && (
          <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            {globalError}
          </p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center justify-center px-4 py-2.5 bg-destructive hover:bg-destructive/90 disabled:opacity-50 text-white font-medium text-sm rounded-lg transition-colors"
          >
            {pending ? t("submitting") : t("disableSubmit")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("cancel")}
          </button>
        </div>
      </form>
    </Shell>
  );
}
