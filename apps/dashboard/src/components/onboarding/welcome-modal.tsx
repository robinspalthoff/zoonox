"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  Sparkles,
  FileText,
  ReceiptText,
  Calculator,
  ArrowRight,
  X,
} from "lucide-react";
import { useOnboarding } from "./onboarding-provider";

const FEATURES = [
  { key: "invoices", icon: FileText },
  { key: "documents", icon: ReceiptText },
  { key: "taxes", icon: Calculator },
] as const;

/**
 * First-run welcome modal. A single, skimmable screen — deliberately not
 * a multi-step tour: it conveys the value, hands the user a clear next
 * action (the setup checklist) and gets out of the way. Renders only
 * while the welcome has not yet been dismissed.
 */
export function WelcomeModal({ firstName }: { firstName: string | null }) {
  const t = useTranslations("onboarding.welcome");
  const { state, dismissWelcome, skipAll } = useOnboarding();
  const [mounted, setMounted] = useState(false);

  const open = !state.welcomeDismissed;

  useEffect(() => setMounted(true), []);

  // Lock body scroll + close on Escape while the modal is open.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismissWelcome();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, dismissWelcome]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/70 backdrop-blur-sm motion-safe:animate-[onbFade_.2s_ease-out_both]"
      onClick={dismissWelcome}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onb-welcome-title"
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-border bg-card shadow-2xl motion-safe:animate-[onbPop_.32s_cubic-bezier(.22,1,.36,1)_both]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Decorative glow — mirrors the dashboard hero treatment. */}
        <div
          className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full"
          style={{
            background:
              "radial-gradient(circle, color-mix(in oklab, var(--color-primary) 26%, transparent), transparent 70%)",
          }}
        />

        <button
          type="button"
          onClick={dismissWelcome}
          aria-label={t("close")}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative px-8 pt-9 pb-7">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[.1em] text-primary">
            <Sparkles className="h-3 w-3" />
            {t("eyebrow")}
          </div>

          <h2
            id="onb-welcome-title"
            className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-foreground"
          >
            {t("title")},
            {firstName ? <span className="text-brand"> {firstName}</span> : null}
          </h2>

          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {t("body")}
          </p>

          <ul className="mt-6 space-y-2.5">
            {FEATURES.map(({ key, icon: Icon }) => (
              <li key={key} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {t(`features.${key}.title`)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(`features.${key}.desc`)}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-7 flex flex-col gap-3">
            <button
              type="button"
              onClick={dismissWelcome}
              className="group inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/30 transition-all hover:-translate-y-0.5 hover:bg-primary/90"
            >
              {t("cta")}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <button
              type="button"
              onClick={skipAll}
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("skip")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
