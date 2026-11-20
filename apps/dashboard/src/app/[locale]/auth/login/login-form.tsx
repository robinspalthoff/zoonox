"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { appConfig } from "@/config/app";
import Image from "next/image";
import Link from "next/link";
import { useLocale } from "next-intl";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { preLogin } from "./actions";

const FIELD =
  "w-full px-3 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors";

export default function LoginForm({ signupEnabled = true }: { signupEnabled?: boolean }) {
  const t = useTranslations("auth.login");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const setupComplete = searchParams.get("setup") === "complete";
  const passwordChanged = searchParams.get("changed") === "1";
  const [step, setStep] = useState<"credentials" | "totp">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  function handleGoogle() {
    setGoogleLoading(true);
    signIn("google", { callbackUrl: `/${locale}` });
  }

  async function finishSignIn(code?: string) {
    // Copy/Paste aus Einladungs-Mails schleppt schnell ein \n oder
    // Leerzeichen ein — case- und whitespace-empfindlicher Bcrypt-Compare
    // schlägt dann mit "ungültig" fehl, obwohl Passwort/Email stimmen.
    const res = await signIn("credentials", {
      email: email.trim().toLowerCase(),
      password: password.trim(),
      totp: code ?? "",
      redirect: false,
    });
    if (res?.error) {
      setError(code !== undefined ? t("errorCodeInvalid") : t("errorInvalid"));
      setLoading(false);
      return;
    }
    router.push("/dashboard");
  }

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const check = await preLogin(email.trim().toLowerCase(), password.trim());
    if (!check.ok) {
      setError(t("errorInvalid"));
      setLoading(false);
      return;
    }
    if (check.twoFactorRequired) {
      setStep("totp");
      setLoading(false);
      return;
    }
    await finishSignIn();
  }

  async function handleTotp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    await finishSignIn(totp);
  }

  function backToCredentials() {
    setStep("credentials");
    setTotp("");
    setError("");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="flex justify-center mb-3">
            <Image
              src="/logo.png"
              alt={appConfig.name}
              width={48}
              height={48}
              quality={75}
              className="rounded-xl"
            />
          </div>
          <p className="font-semibold text-foreground">{appConfig.name}</p>
          <p className="text-muted-foreground text-sm mt-1">
            {step === "totp" ? t("twoFactorSubtitle") : t("subtitle")}
          </p>
        </div>

        {setupComplete && step === "credentials" && (
          <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-center dark:text-green-400 dark:bg-green-950/30 dark:border-green-900">
            {t("setupComplete")}
          </div>
        )}

        {passwordChanged && step === "credentials" && (
          <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-center dark:text-green-400 dark:bg-green-950/30 dark:border-green-900">
            {t("passwordChanged")}
          </div>
        )}

        <div className="bg-card border border-border rounded-xl p-6">
          {step === "credentials" && (
            <>
              <div className="group relative">
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={!signupEnabled || googleLoading || loading}
                  aria-disabled={!signupEnabled}
                  className="w-full h-11 px-4 bg-white hover:bg-[#F8F9FC] disabled:opacity-60 disabled:cursor-not-allowed text-foreground font-medium text-sm rounded-full transition-colors border-[1.5px] border-border flex items-center justify-center gap-2.5"
                >
                  <GoogleLogo />
                  <span>
                    {googleLoading ? t("googleLoading") : t("googleCta")}
                  </span>
                </button>
                {!signupEnabled && (
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 w-64 rounded-lg bg-popover text-popover-foreground border border-border shadow-lg text-xs leading-relaxed p-2.5 text-center opacity-0 invisible translate-y-1 group-hover:opacity-100 group-hover:visible group-hover:translate-y-0 transition-all duration-150 z-10"
                  >
                    {t("signupDisabled")}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {t("or")}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
            </>
          )}
          {step === "credentials" ? (
            <form onSubmit={handleCredentials} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                  {t("email")}
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("emailPlaceholder")}
                  className={FIELD}
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
                  {t("password")}
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("passwordPlaceholder")}
                  className={FIELD}
                />
              </div>

              {error && (
                <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white font-medium text-sm rounded-lg transition-colors"
              >
                {loading ? t("submitting") : t("submit")}
              </button>
            </form>
          ) : (
            <form onSubmit={handleTotp} className="space-y-4">
              <div>
                <label htmlFor="totp" className="block text-sm font-medium text-foreground mb-1.5">
                  {t("code")}
                </label>
                <input
                  id="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  maxLength={6}
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className={`${FIELD} tracking-[0.3em] text-center`}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">{t("codeHint")}</p>
              </div>

              {error && (
                <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white font-medium text-sm rounded-lg transition-colors"
              >
                {loading ? t("verifying") : t("verify")}
              </button>
              <button
                type="button"
                onClick={backToCredentials}
                className="w-full text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("back")}
              </button>
            </form>
          )}
        </div>

        {step === "credentials" && (
          <p className="text-center text-sm text-muted-foreground mt-6">
            {t("noAccount")}{" "}
            {signupEnabled ? (
              <Link
                href={`/${locale}/auth/signup`}
                className="text-primary hover:underline font-medium"
              >
                {t("signupCta")} →
              </Link>
            ) : (
              <span className="group relative inline-block">
                <span className="text-muted-foreground/60 font-medium cursor-not-allowed">
                  {t("signupCta")}
                </span>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 rounded-lg bg-popover text-popover-foreground border border-border shadow-lg text-xs leading-relaxed p-2.5 text-center opacity-0 invisible translate-y-1 group-hover:opacity-100 group-hover:visible group-hover:translate-y-0 transition-all duration-150 z-10"
                >
                  {t("signupDisabled")}
                </span>
              </span>
            )}
          </p>
        )}

        <div className="flex justify-center mt-4">
          <LocaleSwitcher />
        </div>
      </div>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 48 48"
      aria-hidden
      className="shrink-0"
    >
      <path
        fill="#FFC107"
        d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
      />
      <path
        fill="#FF3D00"
        d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
      />
      <path
        fill="#1976D2"
        d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
      />
    </svg>
  );
}
