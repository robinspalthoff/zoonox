"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { changePassword, type ChangePasswordResult } from "./actions";

export default function ChangePasswordForm() {
  const t = useTranslations("auth.changePassword");
  const [state, action, pending] = useActionState<ChangePasswordResult | null, FormData>(
    changePassword,
    null
  );

  // Bei Erfolg läuft der Redirect serverseitig in der Action (signOut →
  // /auth/login?changed=1). Hier gibt es bewusst keine Post-Success-Logik
  // mehr — der User landet nach dem Roundtrip auf der Login-Seite mit
  // einer Erfolgs-Notiz. Verhindert die Race-Conditions, die wir bei
  // useSession().update() + router.push hatten.

  const fieldError = (field: string) =>
    state && !state.success && state.field === field ? state.error : undefined;

  const globalError =
    state && !state.success && !state.field ? state.error : undefined;

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <form action={action} className="space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
            {t("newPassword")}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            placeholder={t("passwordPlaceholder")}
            className={`w-full px-3 py-2.5 bg-muted border rounded-lg text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors ${
              fieldError("password")
                ? "border-destructive focus:border-destructive"
                : "border-border focus:border-primary/50"
            }`}
          />
          {fieldError("password") && (
            <p className="mt-1.5 text-xs text-destructive">{fieldError("password")}</p>
          )}
          <p className="mt-1.5 text-xs text-muted-foreground">{t("passwordHint")}</p>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1.5">
            {t("confirmNewPassword")}
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            placeholder={t("passwordPlaceholder")}
            className={`w-full px-3 py-2.5 bg-muted border rounded-lg text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors ${
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

        <button
          type="submit"
          disabled={pending}
          className="w-full py-2.5 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white font-medium text-sm rounded-lg transition-colors"
        >
          {pending ? t("submitting") : t("submit")}
        </button>
      </form>
    </div>
  );
}
