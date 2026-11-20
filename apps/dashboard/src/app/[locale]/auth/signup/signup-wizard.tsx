"use client";

import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { appConfig } from "@/config/app";
import { LocaleSwitcher } from "@/components/locale-switcher";
import {
  checkEmailAvailable,
  createAccount,
  prepare2faSecret,
  type SignupField,
} from "./actions";

type Step = "welcome" | "name" | "email" | "company" | "security" | "done";

const FLOW_STEPS: Exclude<Step, "welcome" | "done">[] = [
  "name",
  "email",
  "company",
  "security",
];

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
  password: string;
  confirmPassword: string;
}

const initialState: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  companyName: "",
  password: "",
  confirmPassword: "",
};

/** Inline two-factor setup state for the security step. */
interface TwoFaState {
  enabled: boolean;
  loading: boolean;
  secret: string;
  qrDataUrl: string;
  code: string;
  error: string | null;
}

const initialTwoFa: TwoFaState = {
  enabled: false,
  loading: false,
  secret: "",
  qrDataUrl: "",
  code: "",
  error: null,
};

export function SignupWizard({ locale }: { locale: string }) {
  const t = useTranslations("auth.signup");
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogle = () => {
    setGoogleLoading(true);
    signIn("google", { callbackUrl: `/${locale}` });
  };
  const [data, setData] = useState<FormState>(initialState);
  const [twoFa, setTwoFa] = useState<TwoFaState>(initialTwoFa);
  const [errors, setErrors] = useState<Partial<Record<SignupField, string>>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setData((d) => ({ ...d, [key]: value }));
  };

  const clearFieldError = (field: SignupField) =>
    setErrors((e) => {
      if (!e[field]) return e;
      const rest = { ...e };
      delete rest[field];
      return rest;
    });

  // ── Two-factor (optional, set up inline in the security step) ──────────────

  const toggleTwoFa = () => {
    setGlobalError(null);
    if (twoFa.enabled) {
      setTwoFa(initialTwoFa);
      return;
    }
    setTwoFa({ ...initialTwoFa, enabled: true, loading: true });
    prepare2faSecret(data.email)
      .then((res) =>
        // Ignore the result if the user toggled 2FA back off while the
        // QR code was still being generated.
        setTwoFa((s) =>
          s.enabled
            ? { ...s, loading: false, secret: res.secret, qrDataUrl: res.qrDataUrl }
            : s,
        ),
      )
      .catch(() =>
        setTwoFa((s) =>
          s.enabled
            ? { ...s, loading: false, error: t("errors.twoFaSetupError") }
            : s,
        ),
      );
  };

  const setTwoFaCode = (code: string) =>
    setTwoFa((s) => ({ ...s, code, error: null }));

  const goTo = (next: Step) => {
    setGlobalError(null);
    setStep(next);
  };

  const flowIndex = FLOW_STEPS.indexOf(step as never);

  // ── Step handlers ───────────────────────────────────────────────────────────

  const submitName = () => {
    const next: Partial<Record<SignupField, string>> = {};
    if (!data.firstName.trim()) next.firstName = t("errors.firstNameRequired");
    if (!data.lastName.trim()) next.lastName = t("errors.lastNameRequired");
    setErrors(next);
    if (Object.keys(next).length === 0) goTo("email");
  };

  const submitEmail = () => {
    const email = data.email.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrors({ email: t("errors.emailInvalid") });
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await checkEmailAvailable(email);
      if (!res.available) {
        setErrors({
          email:
            res.reason === "taken"
              ? t("errors.emailTaken")
              : t("errors.emailInvalid"),
        });
        return;
      }
      setData((d) => ({ ...d, email }));
      goTo("company");
    });
  };

  const submitCompany = () => {
    setErrors({});
    goTo("security");
  };

  const submitSecurity = () => {
    const next: Partial<Record<SignupField, string>> = {};
    if (!data.password || data.password.length < 12) {
      next.password = t("errors.passwordTooShort");
    }
    if (data.password !== data.confirmPassword) {
      next.confirmPassword = t("errors.passwordMismatch");
    }
    setErrors(next);

    // When 2FA is opted in, a valid 6-digit code is required to proceed.
    let twoFaError: string | null = null;
    if (twoFa.enabled) {
      if (!twoFa.secret) twoFaError = t("errors.twoFaSetupError");
      else if (!/^\d{6}$/.test(twoFa.code.trim())) {
        twoFaError = t("errors.twoFaCodeInvalid");
      }
    }
    if (twoFaError) setTwoFa((s) => ({ ...s, error: twoFaError }));

    if (Object.keys(next).length > 0 || twoFaError) return;

    const totp = twoFa.enabled ? twoFa.code.trim() : undefined;

    startTransition(async () => {
      const res = await createAccount({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        password: data.password,
        confirmPassword: data.confirmPassword,
        companyName: data.companyName,
        twoFactorSecret: twoFa.enabled ? twoFa.secret : undefined,
        twoFactorCode: totp,
      });

      if (!res.ok) {
        if (res.field === "twoFactorCode") {
          setTwoFa((s) => ({ ...s, error: res.error }));
        } else if (res.field) {
          setErrors({ [res.field]: res.error });
          if (res.field === "firstName" || res.field === "lastName") goTo("name");
          else if (res.field === "email") goTo("email");
          else if (res.field === "companyName") goTo("company");
        } else {
          setGlobalError(res.error);
        }
        return;
      }

      // Pass the freshly verified TOTP so the auto sign-in clears the 2FA
      // gate — the same code is still inside its validity window.
      const signInRes = await signIn("credentials", {
        email: data.email,
        password: data.password,
        totp,
        redirect: false,
      });

      if (signInRes?.error) {
        goTo("done");
        return;
      }
      goTo("done");
    });
  };

  const goToDashboard = () => {
    router.push(`/${locale}`);
    router.refresh();
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (step === "welcome") {
    return (
      <WelcomeScreen
        onStart={() => goTo("name")}
        onGoogle={handleGoogle}
        googleLoading={googleLoading}
        t={t}
      />
    );
  }

  if (step === "done") {
    return (
      <DoneScreen firstName={data.firstName} onContinue={goToDashboard} t={t} />
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 md:p-8 relative overflow-hidden"
      style={{ background: "#F8F9FC" }}
    >
      {/* Ambient orange glows on canvas */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at top right, rgba(254,154,2,0.06) 0%, transparent 55%), radial-gradient(ellipse at bottom left, rgba(255,201,115,0.04) 0%, transparent 55%)",
        }}
      />

      {/* Inner card frame — same shape as welcome screen */}
      <div
        className="relative z-10 w-full max-w-5xl bg-background rounded-3xl overflow-hidden border border-black/5 flex flex-col"
        style={{
          minHeight: 520,
          boxShadow: "0 32px 96px rgba(0,0,0,0.55), 0 4px 24px rgba(0,0,0,0.3)",
        }}
      >
      {/* Decorative orange blob bottom-right */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-32 w-[420px] h-[420px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(254,154,2,0.18) 0%, transparent 68%)",
        }}
      />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-8 md:px-14 pt-7">
        <div className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt={appConfig.name}
            width={32}
            height={32}
            className="rounded-lg"
          />
          <span className="font-semibold text-foreground tracking-tight">
            {appConfig.name}
          </span>
        </div>
        <Link
          href={`/${locale}/auth/login`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("haveAccount")}
        </Link>
      </div>

      {/* Progress strip */}
      <div className="relative z-10 px-8 md:px-14 pt-6">
        <div className="grid grid-cols-4 gap-1.5 mb-2">
          {FLOW_STEPS.map((s, i) => {
            const reached = i <= flowIndex;
            return (
              <div
                key={s}
                className={`h-[3px] rounded-full transition-colors duration-500 ${
                  reached ? "bg-primary" : "bg-border"
                }`}
              />
            );
          })}
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {FLOW_STEPS.map((s, i) => {
            const active = i === flowIndex;
            const done = i < flowIndex;
            return (
              <span
                key={s}
                className={`text-[10px] font-bold uppercase tracking-[0.07em] transition-colors ${
                  active
                    ? "text-primary"
                    : done
                      ? "text-muted-foreground"
                      : "text-border"
                }`}
              >
                {t(`steps.${s}`)}
              </span>
            );
          })}
        </div>
      </div>

      {/* Step content */}
      <div className="relative z-10 flex-1 flex items-center px-8 md:px-14 pb-12">
        <div className="w-full max-w-xl">
          <p
            className="font-serif text-primary/70 leading-[0.9] tracking-[-0.04em] mb-1 select-none"
            style={{ fontSize: "80px" }}
          >
            {String(flowIndex + 1).padStart(2, "0")}
          </p>

          {step === "name" && (
            <StepName
              t={t}
              data={data}
              setField={setField}
              clearFieldError={clearFieldError}
              errors={errors}
              pending={pending}
              onNext={submitName}
              onBack={() => goTo("welcome")}
            />
          )}

          {step === "email" && (
            <StepEmail
              t={t}
              data={data}
              setField={setField}
              clearFieldError={clearFieldError}
              errors={errors}
              pending={pending}
              locale={locale}
              onNext={submitEmail}
              onBack={() => goTo("name")}
            />
          )}

          {step === "company" && (
            <StepCompany
              t={t}
              data={data}
              setField={setField}
              clearFieldError={clearFieldError}
              errors={errors}
              pending={pending}
              onNext={submitCompany}
              onBack={() => goTo("email")}
            />
          )}

          {step === "security" && (
            <StepSecurity
              t={t}
              data={data}
              setField={setField}
              clearFieldError={clearFieldError}
              errors={errors}
              pending={pending}
              globalError={globalError}
              twoFa={twoFa}
              onToggleTwoFa={toggleTwoFa}
              onTwoFaCodeChange={setTwoFaCode}
              onSubmit={submitSecurity}
              onBack={() => goTo("company")}
            />
          )}
        </div>
      </div>

      <div className="relative z-10 flex justify-center pb-8">
        <LocaleSwitcher />
      </div>
      </div>
    </div>
  );
}

// ─── Welcome ──────────────────────────────────────────────────────────────────

function WelcomeScreen({
  onStart,
  onGoogle,
  googleLoading,
  t,
}: {
  onStart: () => void;
  onGoogle: () => void;
  googleLoading: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 md:p-8 relative overflow-hidden"
      style={{ background: "#F8F9FC" }}
    >
      {/* Ambient orange glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at top right, rgba(254,154,2,0.06) 0%, transparent 55%), radial-gradient(ellipse at bottom left, rgba(255,201,115,0.04) 0%, transparent 55%)",
        }}
      />
      <div
        className="relative z-10 w-full max-w-5xl grid md:grid-cols-[420px_1fr] rounded-3xl overflow-hidden border border-black/5"
        style={{
          boxShadow:
            "0 32px 96px rgba(0,0,0,0.55), 0 4px 24px rgba(0,0,0,0.3)",
        }}
      >
        {/* ── Left: dark branded panel ── */}
        <div className="relative bg-[#111111] overflow-hidden flex flex-col justify-between p-10 md:p-12 min-h-[520px]">
          {/* Orange glow blobs */}
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              top: "-5%",
              right: "-20%",
              width: 340,
              height: 340,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(254,154,2,0.38) 0%, transparent 68%)",
              filter: "blur(36px)",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              bottom: "10%",
              left: "-15%",
              width: 260,
              height: 260,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(255,201,115,0.2) 0%, transparent 70%)",
              filter: "blur(48px)",
            }}
          />

          {/* Logo */}
          <div className="relative z-10 flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt={appConfig.name}
              width={30}
              height={30}
              className="rounded-lg"
            />
            <span className="font-semibold text-white tracking-tight">
              {appConfig.name}
            </span>
          </div>

          {/* Center hero */}
          <div className="relative z-10">
            <h1 className="font-serif text-4xl md:text-[40px] text-white leading-[1.1] tracking-[-0.01em]">
              {t("welcome.heroTitle")}
            </h1>
            <p className="text-white/50 mt-4 text-[15px] leading-relaxed max-w-[280px]">
              {t("welcome.heroSubtitle")}
            </p>
          </div>

          {/* Spacer */}
          <div className="relative z-10" />
        </div>

        {/* ── Right: CTA panel ── */}
        <div className="relative bg-background overflow-hidden p-10 md:p-16 flex items-center">
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              top: -60,
              right: -60,
              width: 320,
              height: 320,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(254,154,2,0.12) 0%, transparent 70%)",
            }}
          />

          <div className="relative z-10 w-full max-w-sm mx-auto">
            <span className="inline-flex items-center text-[11.5px] font-bold tracking-[0.06em] uppercase bg-primary/10 text-primary rounded-full px-3.5 py-1 mb-6">
              {t("welcome.eyebrow")}
            </span>

            <h2 className="font-serif text-[40px] text-foreground leading-[1.1] tracking-[-0.02em]">
              {t("welcome.title")}
            </h2>

            <p className="text-muted-foreground mt-4 text-[15.5px] leading-[1.7]">
              {t("welcome.subtitle")}
            </p>

            {/* Numbered step pills */}
            <ul className="space-y-2 mt-9 mb-10">
              {(["nameEmail", "company", "security"] as const).map((key, i) => (
                <li
                  key={key}
                  className="flex items-center gap-3 text-sm text-muted-foreground"
                >
                  <span
                    className="w-[26px] h-[26px] rounded-lg flex items-center justify-center flex-shrink-0 text-[10.5px] font-extrabold tracking-[0.03em] text-primary"
                    style={{
                      background: "rgba(254,154,2,0.12)",
                      border: "1.5px solid rgba(255,201,115,0.7)",
                    }}
                  >
                    0{i + 1}
                  </span>
                  {t(`welcome.bullets.${key}`)}
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={onStart}
              className="w-full h-14 px-8 bg-primary hover:bg-[#e88a00] text-white font-semibold text-base rounded-full transition-all hover:-translate-y-px"
              style={{ boxShadow: "0 2px 10px rgba(254,154,2,0.25)" }}
            >
              {t("welcome.cta")}
            </button>

            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {t("welcome.or")}
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <button
              type="button"
              onClick={onGoogle}
              disabled={googleLoading}
              className="w-full h-14 px-6 bg-white hover:bg-[#F8F9FC] disabled:opacity-60 text-foreground font-medium text-[15px] rounded-full transition-all hover:-translate-y-px disabled:hover:translate-y-0 border-[1.5px] border-border flex items-center justify-center gap-3"
            >
              <GoogleLogo />
              <span>
                {googleLoading ? t("welcome.googleLoading") : t("welcome.googleCta")}
              </span>
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}

function GoogleLogo() {
  return (
    <svg
      width="20"
      height="20"
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

// ─── Done ─────────────────────────────────────────────────────────────────────

function DoneScreen({
  firstName,
  onContinue,
  t,
}: {
  firstName: string;
  onContinue: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 md:p-8 relative overflow-hidden"
      style={{ background: "#F8F9FC" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at top right, rgba(254,154,2,0.06) 0%, transparent 55%), radial-gradient(ellipse at bottom left, rgba(255,201,115,0.04) 0%, transparent 55%)",
        }}
      />
      <div
        className="relative z-10 w-full max-w-5xl bg-background rounded-3xl overflow-hidden border border-black/5 flex items-center justify-center px-6"
        style={{
          minHeight: 520,
          boxShadow: "0 32px 96px rgba(0,0,0,0.55), 0 4px 24px rgba(0,0,0,0.3)",
        }}
      >
      {/* Pulsing orange ring backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2"
        style={{
          width: 560,
          height: 560,
          borderRadius: "50%",
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(circle, rgba(254,154,2,0.12) 0%, transparent 65%)",
          animation: "pulseRing 3s ease-in-out infinite",
        }}
      />

      <div className="relative z-10 w-full max-w-md text-center">
        <div className="flex justify-center mb-7">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-white"
            style={{
              background:
                "linear-gradient(135deg, #FFC973, #FE9A02)",
              boxShadow: "0 8px 32px rgba(254,154,2,0.38)",
              animation:
                "popIn 0.55s cubic-bezier(0.175,0.885,0.32,1.275) both",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-9 h-9"
              aria-hidden
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
        <h1 className="font-serif text-[40px] text-foreground tracking-[-0.02em] leading-[1.1]">
          {t("done.title", { firstName })}
        </h1>
        <p className="text-muted-foreground mt-4 text-[15.5px] leading-[1.7]">
          {t("done.subtitle")}
        </p>
        <button
          type="button"
          onClick={onContinue}
          className="mt-9 w-full h-14 px-8 bg-primary hover:bg-[#e88a00] text-white font-semibold text-base rounded-full transition-all hover:-translate-y-px"
          style={{ boxShadow: "0 2px 10px rgba(254,154,2,0.25)" }}
        >
          {t("done.cta")}
        </button>
      </div>

      </div>
      <style jsx>{`
        @keyframes pulseRing {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.6; }
          50% { transform: translate(-50%, -50%) scale(1.15); opacity: 0.25; }
        }
        @keyframes popIn {
          0% { transform: scale(0.5); opacity: 0; }
          72% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─── Step components ──────────────────────────────────────────────────────────

interface StepProps {
  t: ReturnType<typeof useTranslations>;
  data: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  clearFieldError: (field: SignupField) => void;
  errors: Partial<Record<SignupField, string>>;
  pending: boolean;
}

const inputBase =
  "w-full h-14 px-5 bg-card text-foreground placeholder:text-muted-foreground/60 text-[17px] rounded-[10px] outline-none transition-all";

const inputClass = (hasError: boolean) =>
  `${inputBase} border-[1.5px] ${
    hasError
      ? "border-destructive focus:border-destructive focus:ring-2 focus:ring-destructive/20"
      : "border-border focus:border-primary focus:ring-[3px] focus:ring-primary/20"
  }`;

const inputClassSm = (hasError: boolean) =>
  `w-full h-12 px-3.5 bg-card text-foreground placeholder:text-muted-foreground/60 text-[14.5px] rounded-[10px] outline-none transition-all border-[1.5px] ${
    hasError
      ? "border-destructive focus:border-destructive focus:ring-2 focus:ring-destructive/20"
      : "border-border focus:border-primary focus:ring-[3px] focus:ring-primary/20"
  }`;

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground mb-1.5"
    >
      {children}
    </label>
  );
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1.5 text-xs text-destructive">{msg}</p>;
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 text-[13px] text-muted-foreground/80 leading-[1.55]">
      {children}
    </p>
  );
}

function StepHeadline({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="font-serif text-[42px] md:text-[46px] text-foreground leading-[1.08] tracking-[-0.025em] mb-7"
    >
      {children}
    </h2>
  );
}

function NavButtons({
  t,
  primaryLabel,
  onBack,
  pending,
  primaryDisabled,
  showEnterHint = true,
}: {
  t: ReturnType<typeof useTranslations>;
  primaryLabel: string;
  onPrimary?: () => void;
  onBack: () => void;
  pending: boolean;
  primaryDisabled?: boolean;
  showEnterHint?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 mt-9 flex-wrap">
      <button
        type="submit"
        disabled={pending || primaryDisabled}
        className="h-[54px] px-8 bg-primary hover:bg-[#e88a00] disabled:opacity-50 disabled:hover:bg-primary text-white font-semibold text-[15.5px] rounded-full transition-all hover:-translate-y-px disabled:hover:translate-y-0"
        style={{ boxShadow: "0 2px 10px rgba(254,154,2,0.25)" }}
      >
        {pending ? t("submitting") : `${primaryLabel} →`}
      </button>
      <button
        type="button"
        onClick={onBack}
        disabled={pending}
        className="h-[52px] px-[22px] bg-transparent border-[1.5px] border-border hover:border-muted-foreground/40 hover:text-foreground disabled:opacity-50 text-muted-foreground font-medium text-sm rounded-full transition-all"
      >
        {t("back")}
      </button>
      {showEnterHint && (
        <span className="text-xs text-muted-foreground/70 ml-1 hidden sm:inline">
          {t.has?.("enterHint") ? t("enterHint") : "oder"}{" "}
          <kbd className="px-1.5 py-0.5 rounded border border-border bg-card text-[11px] text-muted-foreground">
            Enter ↵
          </kbd>
        </span>
      )}
    </div>
  );
}

function StepName({
  t, data, setField, clearFieldError, errors, pending, onNext, onBack,
}: StepProps & { onNext: () => void; onBack: () => void }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onNext();
      }}
    >
      <StepHeadline>{t("name.title")}</StepHeadline>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <FieldLabel htmlFor="firstName">{t("name.firstName")}</FieldLabel>
          <input
            id="firstName"
            type="text"
            autoFocus
            autoComplete="given-name"
            placeholder="Max"
            value={data.firstName}
            onChange={(e) => {
              setField("firstName", e.target.value);
              clearFieldError("firstName");
            }}
            className={inputClass(!!errors.firstName)}
          />
          <FieldError msg={errors.firstName} />
        </div>
        <div>
          <FieldLabel htmlFor="lastName">{t("name.lastName")}</FieldLabel>
          <input
            id="lastName"
            type="text"
            autoComplete="family-name"
            placeholder="Mustermann"
            value={data.lastName}
            onChange={(e) => {
              setField("lastName", e.target.value);
              clearFieldError("lastName");
            }}
            className={inputClass(!!errors.lastName)}
          />
          <FieldError msg={errors.lastName} />
        </div>
      </div>
      <FieldHint>{t("name.hint")}</FieldHint>
      <NavButtons
        t={t}
        primaryLabel={t("next")}
        onBack={onBack}
        pending={pending}
      />
    </form>
  );
}

function StepEmail({
  t, data, setField, clearFieldError, errors, pending, locale, onNext, onBack,
}: StepProps & { locale: string; onNext: () => void; onBack: () => void }) {
  const taken = errors.email === t("errors.emailTaken");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onNext();
      }}
    >
      <StepHeadline>{t("email.title")}</StepHeadline>
      <div>
        <FieldLabel htmlFor="email">{t("email.label")}</FieldLabel>
        <input
          id="email"
          type="email"
          autoFocus
          autoComplete="email"
          placeholder="max@mustermann.de"
          value={data.email}
          onChange={(e) => {
            setField("email", e.target.value);
            clearFieldError("email");
          }}
          className={inputClass(!!errors.email)}
        />
        <FieldError msg={errors.email} />
        {taken && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            <Link
              href={`/${locale}/auth/login`}
              className="text-primary hover:underline"
            >
              {t("email.toLogin")} →
            </Link>
          </p>
        )}
      </div>
      <FieldHint>{t("email.hint")}</FieldHint>
      <NavButtons
        t={t}
        primaryLabel={t("next")}
        onBack={onBack}
        pending={pending}
      />
    </form>
  );
}

function StepCompany({
  t, data, setField, clearFieldError, errors, pending, onNext, onBack,
}: StepProps & { onNext: () => void; onBack: () => void }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onNext();
      }}
    >
      <StepHeadline>{t("company.title")}</StepHeadline>
      <div className="space-y-4">
        <div>
          <FieldLabel htmlFor="companyName">{t("company.name")}</FieldLabel>
          <input
            id="companyName"
            type="text"
            autoFocus
            autoComplete="organization"
            placeholder={t("company.namePlaceholder", { firstName: data.firstName || "Max" })}
            value={data.companyName}
            onChange={(e) => {
              setField("companyName", e.target.value);
              clearFieldError("companyName");
            }}
            className={inputClass(!!errors.companyName)}
          />
          <FieldError msg={errors.companyName} />
          <FieldHint>{t("company.nameHint")}</FieldHint>
        </div>

        <div
          className="flex items-start gap-2.5 px-3.5 py-3 rounded-[10px] text-[13px] text-muted-foreground leading-[1.55]"
          style={{ background: "rgba(0,0,0,0.03)" }}
        >
          <span className="opacity-60 mt-0.5">→</span>
          <span>{t("company.settingsNote")}</span>
        </div>
      </div>
      <NavButtons
        t={t}
        primaryLabel={t("next")}
        onBack={onBack}
        pending={pending}
      />
    </form>
  );
}

function StepSecurity({
  t, data, setField, clearFieldError, errors, pending, globalError,
  twoFa, onToggleTwoFa, onTwoFaCodeChange, onSubmit, onBack,
}: StepProps & {
  globalError: string | null;
  twoFa: TwoFaState;
  onToggleTwoFa: () => void;
  onTwoFaCodeChange: (code: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <StepHeadline>{t("security.title")}</StepHeadline>

      <div className="space-y-4">
        <div>
          <FieldLabel htmlFor="password">{t("security.password")}</FieldLabel>
          <input
            id="password"
            type="password"
            autoFocus
            autoComplete="new-password"
            placeholder="••••••••••••"
            value={data.password}
            onChange={(e) => {
              setField("password", e.target.value);
              clearFieldError("password");
            }}
            className={inputClass(!!errors.password)}
          />
          <FieldError msg={errors.password} />
          <FieldHint>{t("security.passwordHint")}</FieldHint>
        </div>

        <div>
          <FieldLabel htmlFor="confirmPassword">{t("security.confirmPassword")}</FieldLabel>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••••••"
            value={data.confirmPassword}
            onChange={(e) => {
              setField("confirmPassword", e.target.value);
              clearFieldError("confirmPassword");
            }}
            className={inputClass(!!errors.confirmPassword)}
          />
          <FieldError msg={errors.confirmPassword} />
        </div>

        {/* Two-factor authentication — optional, set up inline */}
        <div
          className="rounded-[10px] overflow-hidden"
          style={{
            background: "rgba(0,0,0,0.03)",
            border: "1.5px solid var(--border, #E8E4DF)",
          }}
        >
          <div className="p-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {t("security.twoFa")}
              </p>
              <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed">
                {t("security.twoFaHint")}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={twoFa.enabled}
              aria-label={t("security.twoFa")}
              onClick={onToggleTwoFa}
              className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
                twoFa.enabled ? "bg-primary" : "bg-border"
              }`}
            >
              <span
                className={`absolute top-[3px] left-[3px] w-[18px] h-[18px] bg-white rounded-full transition-transform ${
                  twoFa.enabled ? "translate-x-5" : ""
                }`}
                style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }}
              />
            </button>
          </div>

          {twoFa.enabled && (
            <div className="px-4 pb-4 pt-4 border-t border-border/70">
              {twoFa.loading ? (
                <div className="flex items-center justify-center gap-2 py-5 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("security.twoFaLoading")}
                </div>
              ) : twoFa.secret ? (
                <div className="space-y-3.5">
                  <p className="text-[12.5px] text-muted-foreground leading-relaxed">
                    {t("security.twoFaSetupIntro")}
                  </p>
                  <div className="flex items-start gap-4 flex-wrap">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={twoFa.qrDataUrl}
                      alt="QR-Code"
                      width={132}
                      height={132}
                      className="rounded-lg border border-border bg-white p-1.5"
                    />
                    <div className="flex-1 min-w-[160px]">
                      <p className="text-[11px] text-muted-foreground mb-1">
                        {t("security.twoFaManualKey")}
                      </p>
                      <p className="font-mono text-[11px] text-foreground break-all bg-card border border-border rounded-lg px-2.5 py-2 select-all">
                        {twoFa.secret}
                      </p>
                    </div>
                  </div>
                  <div>
                    <FieldLabel htmlFor="twoFaCode">{t("security.twoFaCode")}</FieldLabel>
                    <input
                      id="twoFaCode"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="000000"
                      value={twoFa.code}
                      onChange={(e) => onTwoFaCodeChange(e.target.value.replace(/\D/g, ""))}
                      className={`${inputClassSm(!!twoFa.error)} tracking-[0.3em] text-center`}
                    />
                    <FieldError msg={twoFa.error ?? undefined} />
                  </div>
                </div>
              ) : (
                <FieldError msg={twoFa.error ?? t("errors.twoFaSetupError")} />
              )}
            </div>
          )}
        </div>
      </div>

      {globalError && (
        <p className="mt-4 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {globalError}
        </p>
      )}

      <NavButtons
        t={t}
        primaryLabel={t("security.submit")}
        onBack={onBack}
        pending={pending}
      />
    </form>
  );
}
