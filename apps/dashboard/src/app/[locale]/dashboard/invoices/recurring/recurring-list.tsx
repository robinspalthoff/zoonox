"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Repeat, AlertCircle, Mail, Pause, Check } from "lucide-react";
import type { RecurringInterval, RecurringStatus } from "@prisma/client";
import { INTERVAL_I18N_KEY } from "@/lib/recurring/interval";

export interface RecurringRow {
  id: string;
  title: string | null;
  clientName: string;
  interval: RecurringInterval;
  status: RecurringStatus;
  autoSend: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  endDate: string | null;
  generatedCount: number;
  lineItemCount: number;
  hasError: boolean;
}

function fmtDate(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));
}

const STATUS_STYLES: Record<RecurringStatus, string> = {
  ACTIVE: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  PAUSED: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  COMPLETED: "bg-muted text-muted-foreground border-border",
};

export function RecurringList({ rows }: { rows: RecurringRow[] }) {
  const t = useTranslations("invoices.recurring");

  if (rows.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center">
        <div className="inline-flex w-12 h-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-4">
          <Repeat className="w-5 h-5" />
        </div>
        <h2 className="text-base font-medium text-foreground">{t("empty.title")}</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          {t("empty.subtitle")}
        </p>
        <Link
          href="/dashboard/invoices/recurring/new"
          className="inline-flex items-center gap-2 mt-6 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {t("empty.cta")}
        </Link>
      </div>
    );
  }

  // Use the browser locale for date formatting (the page is i18n-routed so
  // this matches the request locale via the document <html lang> attribute).
  const locale = typeof navigator !== "undefined" ? navigator.language : "de-DE";

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">{t("table.title")}</th>
            <th className="px-4 py-2.5 font-medium">{t("table.client")}</th>
            <th className="px-4 py-2.5 font-medium">{t("table.interval")}</th>
            <th className="px-4 py-2.5 font-medium">{t("table.nextRun")}</th>
            <th className="px-4 py-2.5 font-medium text-right">{t("table.generated")}</th>
            <th className="px-4 py-2.5 font-medium">{t("table.status")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3">
                <Link
                  href={`/dashboard/invoices/recurring/${r.id}`}
                  className="font-medium text-foreground hover:text-primary transition-colors inline-flex items-center gap-2"
                >
                  {r.title ?? t("table.untitled")}
                  {r.hasError && (
                    <span
                      className="text-destructive"
                      title={t("table.hasErrorTooltip")}
                    >
                      <AlertCircle className="w-3.5 h-3.5" />
                    </span>
                  )}
                </Link>
              </td>
              <td className="px-4 py-3 text-foreground">{r.clientName}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {t(`intervals.${INTERVAL_I18N_KEY[r.interval]}`)}
              </td>
              <td className="px-4 py-3 text-muted-foreground tabular-nums">
                {r.status === "COMPLETED" ? "—" : fmtDate(r.nextRunAt, locale)}
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                {r.generatedCount}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border ${STATUS_STYLES[r.status]}`}
                  >
                    {r.status === "ACTIVE" && <Check className="w-3 h-3" />}
                    {r.status === "PAUSED" && <Pause className="w-3 h-3" />}
                    {t(`status.${r.status.toLowerCase()}`)}
                  </span>
                  {r.autoSend && (
                    <span
                      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary"
                      title={t("table.autoSendTooltip")}
                    >
                      <Mail className="w-3 h-3" />
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
