"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { KeyRound, Check } from "lucide-react";
import { changeOwnPassword, type ChangeOwnPasswordResult } from "./actions";

export function AccountSettingsForm() {
  const t = useTranslations("settings.account");
  const [state, action, pending] = useActionState<ChangeOwnPasswordResult | null, FormData>(
    changeOwnPassword,
    null
  );
  const [showSuccess, setShowSuccess] = useState(false);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (state?.success) {
      setShowSuccess(true);
      // Inputs leeren durch key-Bump (Form re-mount)
      setFormKey((k) => k + 1);
      const timer = setTimeout(() => setShowSuccess(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [state]);

  const fieldError = (field: "currentPassword" | "newPassword" | "confirmPassword") =>
    state && !state.success && state.field === field ? state.error : undefined;
  const globalError = state && !state.success && !state.field ? state.error : undefined;

  return (
    <section
      id="account"
      className="bg-card border border-border rounded-xl p-6 scroll-mt-6"
    >
      <div className="flex items-center gap-2 mb-1">
        <KeyRound className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-5">{t("subtitle")}</p>

      <form key={formKey} action={action} className="space-y-4 max-w-md">
        <div>
          <label htmlFor="currentPassword" className="block text-sm font-medium text-foreground mb-1.5">
            {t("currentPassword")}
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            className={`w-full px-3 py-2.5 bg-muted border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors ${
              fieldError("currentPassword")
                ? "border-destructive focus:border-destructive"
                : "border-border focus:border-primary/50"
            }`}
          />
          {fieldError("currentPassword") && (
            <p className="mt-1.5 text-xs text-destructive">{fieldError("currentPassword")}</p>
          )}
        </div>

        <div>
          <label htmlFor="newPassword" className="block text-sm font-medium text-foreground mb-1.5">
            {t("newPassword")}
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            required
            autoComplete="new-password"
            className={`w-full px-3 py-2.5 bg-muted border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors ${
              fieldError("newPassword")
                ? "border-destructive focus:border-destructive"
                : "border-border focus:border-primary/50"
            }`}
          />
          {fieldError("newPassword") && (
            <p className="mt-1.5 text-xs text-destructive">{fieldError("newPassword")}</p>
          )}
          <p className="mt-1.5 text-xs text-muted-foreground">{t("passwordHint")}</p>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1.5">
            {t("confirmPassword")}
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            className={`w-full px-3 py-2.5 bg-muted border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors ${
              fieldError("confirmPassword")
                ? "border-destructive focus:border-destructive"
                : "border-border focus:border-primary/50"
            }`}
          />
          {fieldError("confirmPassword") && (
            <p className="mt-1.5 text-xs text-destructive">{fieldError("confirmPassword")}</p>
          )}
        </div>

        {globalError && (
          <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            {globalError}
          </p>
        )}

        {showSuccess && (
          <p className="flex items-center gap-2 text-sm text-success bg-success/10 border border-success/20 rounded-lg px-3 py-2">
            <Check className="w-4 h-4" />
            {t("success")}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white font-medium text-sm rounded-lg transition-colors"
        >
          {pending ? t("submitting") : t("submit")}
        </button>
      </form>
    </section>
  );
}
