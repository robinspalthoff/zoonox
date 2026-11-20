"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  Building2,
  Users,
  FileText,
  ReceiptText,
  Check,
  ArrowRight,
  X,
  Rocket,
  PartyPopper,
} from "lucide-react";
import {
  CHECKLIST_TOTAL,
  checklistProgress,
  type ChecklistData,
} from "@/lib/onboarding";
import { useOnboarding } from "./onboarding-provider";

type ItemHref =
  | "/dashboard/settings/company"
  | "/dashboard/contacts"
  | "/dashboard/invoices/new"
  | "/dashboard/documents";

const ITEMS: {
  key: string;
  href: ItemHref;
  icon: typeof Building2;
  done: (d: ChecklistData) => boolean;
}[] = [
  { key: "company", href: "/dashboard/settings/company", icon: Building2, done: (d) => d.companyComplete },
  { key: "contact", href: "/dashboard/contacts", icon: Users, done: (d) => d.hasContact },
  { key: "invoice", href: "/dashboard/invoices/new", icon: FileText, done: (d) => d.hasInvoice },
  { key: "document", href: "/dashboard/documents", icon: ReceiptText, done: (d) => d.hasDocument },
];

/**
 * Data-driven setup checklist. Item completion is derived from real
 * tenant data (passed in as `ChecklistData`) — not stored flags — so the
 * progress always reflects reality and ticks itself off as the user
 * works. Surfaces the *incomplete* steps prominently (Zeigarnik effect)
 * and stays fully dismissible.
 */
export function SetupChecklist({ data }: { data: ChecklistData }) {
  const t = useTranslations("onboarding.checklist");
  const { state, dismissChecklist } = useOnboarding();

  if (state.checklistDismissed) return null;

  const done = checklistProgress(data);
  const allDone = done >= CHECKLIST_TOTAL;
  const pct = Math.round((done / CHECKLIST_TOTAL) * 100);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 motion-safe:animate-[fadeUp_.45s_cubic-bezier(.22,1,.36,1)_both]">
      <div
        className="pointer-events-none absolute -top-16 -right-10 h-44 w-44 rounded-full"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--color-primary) 16%, transparent), transparent 70%)",
        }}
      />

      {/* Header */}
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            {allDone ? (
              <PartyPopper className="h-4 w-4 text-primary" />
            ) : (
              <Rocket className="h-4 w-4 text-primary" />
            )}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {allDone ? t("allDone.title") : t("title")}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {allDone ? t("allDone.body") : t("subtitle")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={dismissChecklist}
          aria-label={t("dismiss")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Progress */}
      <div className="relative mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium">
          <span className="text-muted-foreground">
            {t("progress", { done, total: CHECKLIST_TOTAL })}
          </span>
          <span className="tabular-nums text-primary">{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Items / completed state */}
      {allDone ? (
        <button
          type="button"
          onClick={dismissChecklist}
          className="relative mt-4 inline-flex items-center gap-2 rounded-lg bg-primary/10 px-3.5 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/15"
        >
          <Check className="h-3.5 w-3.5" />
          {t("allDone.cta")}
        </button>
      ) : (
        <ul className="relative mt-4 space-y-1.5">
          {ITEMS.map(({ key, href, icon: Icon, done: isDone }) => {
            const complete = isDone(data);
            const body = (
              <>
                <span
                  className={
                    complete
                      ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"
                      : "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 text-muted-foreground"
                  }
                >
                  {complete ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={
                      complete
                        ? "block text-sm font-medium text-muted-foreground line-through"
                        : "block text-sm font-medium text-foreground"
                    }
                  >
                    {t(`items.${key}.title`)}
                  </span>
                  {!complete && (
                    <span className="block text-xs text-muted-foreground">
                      {t(`items.${key}.desc`)}
                    </span>
                  )}
                </span>
                {!complete && (
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                )}
              </>
            );

            return (
              <li key={key}>
                {complete ? (
                  <div className="flex items-center gap-3 rounded-xl px-2.5 py-2">
                    {body}
                  </div>
                ) : (
                  <Link
                    href={href}
                    className="group flex items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 transition-colors hover:border-border hover:bg-muted/50"
                  >
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
