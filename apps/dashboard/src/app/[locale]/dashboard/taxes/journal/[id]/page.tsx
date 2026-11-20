import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import { ChevronLeft } from "lucide-react";
import { listComments } from "@/lib/comments/queries";
import { can } from "@/lib/permissions";
import { CommentSection } from "@/components/comments/comment-section";
import { getMonthCloseStatus } from "@/lib/month-close/queries";
import { MonthCloseBanner } from "@/components/month-close/month-close-banner";
import { monthLabelFromDate } from "@/components/month-close/month-label";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taxes.journal");
  return { title: t("detail.pageTitle") };
}

function fmtCurrency(n: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
}

function fmtDate(d: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export default async function JournalEntryDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const tenant = await requireTenant();
  const { tenantId, tenantRole, userId } = tenant;

  const t = await getTranslations("taxes.journal");

  const entry = await db.journalEntry.findUnique({
    where: { id, tenantId },
    include: {
      lines: { orderBy: { position: "asc" } },
      createdBy: { select: { firstName: true, lastName: true, email: true } },
      reversedBy: { select: { id: true, number: true } },
      reverses: { select: { id: true, number: true } },
    },
  });

  if (!entry) notFound();

  const journalComments = await listComments(tenantId, "JOURNAL_ENTRY", entry.id);
  const journalMonthInfo = monthLabelFromDate(entry.date, locale);
  const journalMonthStatus = await getMonthCloseStatus(tenantId, entry.date);

  const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);

  const sourceHref = (() => {
    if (!entry.sourceId) return null;
    if (entry.sourceType === "INVOICE" || entry.sourceType === "INVOICE_PAYMENT") {
      return `/dashboard/invoices/${entry.sourceId}`;
    }
    if (entry.sourceType === "DOCUMENT" || entry.sourceType === "DOCUMENT_PAYMENT") {
      return `/dashboard/documents/${entry.sourceId}`;
    }
    return null;
  })();

  return (
    <div className="space-y-6">
      <Link
        href={"/dashboard/taxes/journal" as never}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="w-4 h-4" />
        {t("detail.back")}
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {t("detail.title", { number: entry.number })}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">{entry.description}</p>
        </div>
        <span
          className={
            entry.status === "REVERSED"
              ? "inline-block px-2 py-1 rounded text-xs bg-destructive/10 text-destructive"
              : "inline-block px-2 py-1 rounded text-xs bg-emerald-500/10 text-emerald-700"
          }
        >
          {t(`status.${entry.status}`)}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label={t("detail.date")} value={fmtDate(entry.date, locale)} />
        <Field label={t("detail.sourceType")} value={t(`sourceType.${entry.sourceType}`)} />
        <Field
          label={t("detail.source")}
          value={
            sourceHref && entry.sourceId ? (
              <Link href={sourceHref as never} className="text-primary hover:underline">
                {entry.sourceId}
              </Link>
            ) : (
              entry.sourceId ?? "—"
            )
          }
        />
        <Field
          label={t("detail.createdBy")}
          value={
            entry.createdBy
              ? `${entry.createdBy.firstName ?? ""} ${entry.createdBy.lastName ?? ""}`.trim() ||
                entry.createdBy.email ||
                "—"
              : t("detail.system")
          }
        />
        <Field label={t("detail.createdAt")} value={fmtDate(entry.createdAt, locale)} />
        {entry.reversedAt && (
          <Field label={t("detail.reversedAt")} value={fmtDate(entry.reversedAt, locale)} />
        )}
        {entry.reversedBy && (
          <Field
            label={t("detail.reversedBy")}
            value={
              <Link
                href={`/dashboard/taxes/journal/${entry.reversedBy.id}` as never}
                className="text-primary hover:underline"
              >
                #{entry.reversedBy.number}
              </Link>
            }
          />
        )}
        {entry.reverses.length > 0 && (
          <Field
            label={t("detail.reverses")}
            value={entry.reverses
              .map((r) => `#${r.number}`)
              .join(", ")}
          />
        )}
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">{t("detail.linesTitle")}</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">{t("detail.lines.account")}</th>
              <th className="px-4 py-2 font-medium">{t("detail.lines.description")}</th>
              <th className="px-4 py-2 font-medium">{t("detail.lines.vatCode")}</th>
              <th className="px-4 py-2 font-medium text-right">{t("detail.lines.debit")}</th>
              <th className="px-4 py-2 font-medium text-right">{t("detail.lines.credit")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entry.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2 font-mono text-xs text-foreground">{l.accountCode}</td>
                <td className="px-4 py-2 text-foreground">{l.description ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground font-mono text-xs">
                  {l.vatCode ?? "—"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-foreground">
                  {Number(l.debit) > 0 ? fmtCurrency(Number(l.debit), locale) : ""}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-foreground">
                  {Number(l.credit) > 0 ? fmtCurrency(Number(l.credit), locale) : ""}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/20">
              <td className="px-4 py-2 font-semibold text-foreground" colSpan={3}>
                {t("detail.lines.totals")}
              </td>
              <td className="px-4 py-2 text-right tabular-nums font-semibold text-foreground">
                {fmtCurrency(totalDebit, locale)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums font-semibold text-foreground">
                {fmtCurrency(totalCredit, locale)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <MonthCloseBanner
        status={journalMonthStatus}
        monthLabel={journalMonthInfo.monthLabel}
        year={journalMonthInfo.year}
      />

      <CommentSection
        entityType="JOURNAL_ENTRY"
        entityId={entry.id}
        comments={journalComments}
        currentUserId={userId}
        canWrite={can(tenantRole, "comments.write")}
        canResolve={can(tenantRole, "comments.resolve")}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}
