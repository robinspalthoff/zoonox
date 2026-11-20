"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { UserRound, Check } from "lucide-react";
import { updateProfile, type UpdateProfileResult } from "./actions";

const INPUT =
  "w-full px-3 py-2.5 bg-muted border rounded-lg text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors";
const LABEL = "block text-sm font-medium text-foreground mb-1.5";

interface ProfileSettingsFormProps {
  firstName: string | null;
  lastName: string | null;
  email: string;
}

export function ProfileSettingsForm({ firstName, lastName, email }: ProfileSettingsFormProps) {
  const t = useTranslations("settings.profile");
  const { update } = useSession();
  const router = useRouter();
  const [state, action, pending] = useActionState<UpdateProfileResult | null, FormData>(
    updateProfile,
    null,
  );
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (state?.success) {
      setShowSuccess(true);
      // Token (Name/E-Mail) auffrischen, damit Header & Menü sofort stimmen.
      update();
      router.refresh();
      const timer = setTimeout(() => setShowSuccess(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [state, update, router]);

  const fieldError = (field: "firstName" | "lastName" | "email") =>
    state && !state.success && state.field === field ? state.error : undefined;
  const globalError = state && !state.success && !state.field ? state.error : undefined;

  const borderFor = (field: "firstName" | "lastName" | "email") =>
    fieldError(field)
      ? "border-destructive focus:border-destructive"
      : "border-border focus:border-primary/50";

  return (
    <section className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <UserRound className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-5">{t("subtitle")}</p>

      <form action={action} className="space-y-4 max-w-md">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="firstName" className={LABEL}>{t("firstName")}</label>
            <input
              id="firstName"
              name="firstName"
              type="text"
              required
              defaultValue={firstName ?? ""}
              autoComplete="given-name"
              className={`${INPUT} ${borderFor("firstName")}`}
            />
            {fieldError("firstName") && (
              <p className="mt-1.5 text-xs text-destructive">{fieldError("firstName")}</p>
            )}
          </div>
          <div>
            <label htmlFor="lastName" className={LABEL}>{t("lastName")}</label>
            <input
              id="lastName"
              name="lastName"
              type="text"
              required
              defaultValue={lastName ?? ""}
              autoComplete="family-name"
              className={`${INPUT} ${borderFor("lastName")}`}
            />
            {fieldError("lastName") && (
              <p className="mt-1.5 text-xs text-destructive">{fieldError("lastName")}</p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="email" className={LABEL}>{t("email")}</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            defaultValue={email}
            autoComplete="email"
            className={`${INPUT} ${borderFor("email")}`}
          />
          {fieldError("email") && (
            <p className="mt-1.5 text-xs text-destructive">{fieldError("email")}</p>
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
