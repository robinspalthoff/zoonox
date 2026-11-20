import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AlertTriangle, ArrowLeft, Info } from "lucide-react";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { loadUstvaReport } from "@/lib/taxes/ustva/query";
import { PeriodSelector } from "../period-selector";
import { UstvaFormView, type FormSection } from "./form-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taxes.vatReturn.elster");
  return { title: t("title") };
}

type Period = "monthly" | "quarterly";

function parseSearchParams(sp: Record<string, string | string[] | undefined>) {
  const now = new Date();
  const period: Period = sp.period === "monthly" ? "monthly" : "quarterly";
  const year = Number(sp.year) || now.getFullYear();
  const month = Math.min(12, Math.max(1, Number(sp.month) || now.getMonth() + 1));
  const quarter = Math.min(4, Math.max(1, Number(sp.quarter) || Math.floor(now.getMonth() / 3) + 1));
  return { period, year, month, quarter };
}

function periodRange(period: Period, year: number, month: number, quarter: number) {
  if (period === "monthly") {
    return { from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 1)) };
  }
  const startMonth = (quarter - 1) * 3;
  return {
    from: new Date(Date.UTC(year, startMonth, 1)),
    to: new Date(Date.UTC(year, startMonth + 3, 1)),
  };
}

function fmtCurrency(n: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
}

export default async function UstvaElsterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const { tenantId } = await requireTenant();
  const t = await getTranslations("taxes.vatReturn.elster");
  const tv = await getTranslations("taxes.vatReturn");

  const { period, year, month, quarter } = parseSearchParams(sp);
  const range = periodRange(period, year, month, quarter);

  const settings = await db.companySettings.findUnique({ where: { tenantId } });

  // Kleinunternehmer geben keine Voranmeldung ab — die Formularansicht wäre
  // hier irreführend. Wir zeigen denselben Hinweis wie die Übersicht.
  if (settings?.taxMode === "SMALL_BUSINESS") {
    return (
      <div className="space-y-6">
        <Header t={t} />
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex gap-3">
          <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-foreground">
            <p className="font-medium">{tv("smallBusinessTitle")}</p>
            <p className="text-muted-foreground mt-1">{tv("smallBusinessHint")}</p>
          </div>
        </div>
      </div>
    );
  }

  const { form, requestedYear, isFallback, result } = await loadUstvaReport(
    tenantId,
    range,
    year,
  );

  // Für die Client-Komponente flach machen — sie braucht keine
  // Formularmodell-Typen, nur die darzustellenden Werte.
  const formSections: FormSection[] = result.sections.map((s) => ({
    id: s.section.id,
    title: s.section.title,
    elsterNumber: s.section.elster.number,
    elsterTitle: s.section.elster.title,
    rows: s.rows.map((r) => ({
      zeile: r.field.zeile,
      kz: r.field.kz,
      label: r.field.label,
      hint: r.field.hint,
      value: r.value,
      rounding: r.field.rounding,
      kind: r.field.kind,
      notFilled: r.notFilled,
      sources: r.sources,
    })),
  }));

  const payable = result.payable;
  const state: "payable" | "refund" | "neutral" =
    payable > 0.005 ? "payable" : payable < -0.005 ? "refund" : "neutral";

  const theme =
    state === "payable"
      ? {
          container:
            "bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent border-rose-500/30",
          text: "text-rose-700 dark:text-rose-400",
        }
      : state === "refund"
        ? {
            container:
              "bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border-emerald-500/30",
            text: "text-emerald-700 dark:text-emerald-400",
          }
        : { container: "bg-card border-border", text: "text-foreground" };

  return (
    <div className="space-y-6">
      <Header t={t} />

      <PeriodSelector period={period} year={year} month={month} quarter={quarter} />

      {isFallback && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-foreground">
            <p className="font-medium">
              {t("fallbackTitle", { formYear: form.year, requestedYear })}
            </p>
            <p className="text-muted-foreground mt-1">
              {t("fallbackHint", { formYear: form.year, requestedYear })}
            </p>
          </div>
        </div>
      )}

      {/* Kz 83 — das Ergebnis, das der Nutzer in ELSTER erwartet. */}
      <div className={`rounded-xl border p-6 ${theme.container}`}>
        <div className={`text-xs font-medium uppercase tracking-wide ${theme.text}`}>
          {state === "refund" ? t("refundTitle") : t("payableTitle")}
        </div>
        <div className={`mt-2 text-4xl font-semibold tabular-nums ${theme.text}`}>
          {fmtCurrency(Math.abs(payable), locale)}
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          {state === "refund"
            ? t("refundHint")
            : state === "payable"
              ? t("payableHint")
              : t("balancedHint")}
        </div>
      </div>

      {!result.hasData && (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("emptyHint")}</p>
        </div>
      )}

      {result.unmapped.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-500/20 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-foreground">{t("unmappedTitle")}</p>
              <p className="text-muted-foreground mt-1">{t("unmappedHint")}</p>
            </div>
          </div>
          <div className="divide-y divide-amber-500/15">
            {result.unmapped.map((u) => (
              <div key={u.vatCode} className="px-4 py-3 text-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <code className="text-xs font-medium text-foreground">{u.vatCode}</code>
                  <span className="tabular-nums text-muted-foreground shrink-0">
                    {t("unmappedNet")} {fmtCurrency(u.net, locale)} · {t("unmappedVat")}{" "}
                    {fmtCurrency(u.vat, locale)}
                  </span>
                </div>
                {u.reason && (
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                    {u.reason}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {Math.abs(result.roundingDelta) >= 0.005 && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 flex gap-3">
          <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="font-medium text-foreground">
              {t("roundingTitle", { amount: fmtCurrency(result.roundingDelta, locale) })}
            </p>
            <p className="text-muted-foreground mt-1">{t("roundingHint")}</p>
          </div>
        </div>
      )}

      {/* Die Abschnitte A–J in der Reihenfolge des Vordrucks. */}
      <UstvaFormView sections={formSections} locale={locale} />

      {/* Kz 39 befüllen wir nicht — der festgesetzte Betrag liegt uns nicht
          vor. Wer eine Dauerfristverlängerung hat, muss ihn selbst ergänzen,
          sonst stimmt die Zahllast im Dezember nicht. */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 flex gap-3">
        <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs">
          <p className="font-medium text-foreground">{t("dauerfristTitle")}</p>
          <p className="text-muted-foreground mt-1">{t("dauerfristHint")}</p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t("disclaimer")}</p>
    </div>
  );
}

function Header({ t }: { t: Awaited<ReturnType<typeof getTranslations>> }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>
      <Link
        href="/dashboard/taxes/vat-return"
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {t("backToOverview")}
      </Link>
    </div>
  );
}
