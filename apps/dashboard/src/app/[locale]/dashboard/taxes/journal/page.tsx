import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import type { Prisma, JournalSourceType, JournalEntryStatus } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { JournalFilters } from "./filters";
import { countOpenCommentsByEntity } from "@/lib/comments/queries";
import { MessageCircle } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taxes.journal");
  return { title: t("pageTitle") };
}

const ALL_SOURCE_TYPES: JournalSourceType[] = [
  "INVOICE",
  "INVOICE_PAYMENT",
  "DOCUMENT",
  "DOCUMENT_PAYMENT",
  "BANK_TRANSACTION",
  "MANUAL",
];

const ALL_STATUSES: JournalEntryStatus[] = ["POSTED", "REVERSED"];

function parseParams(sp: Record<string, string | string[] | undefined>) {
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const fromStr = typeof sp.from === "string" ? sp.from : "";
  const toStr = typeof sp.to === "string" ? sp.to : "";
  const source =
    typeof sp.source === "string" && ALL_SOURCE_TYPES.includes(sp.source as JournalSourceType)
      ? (sp.source as JournalSourceType)
      : null;
  const status =
    typeof sp.status === "string" && ALL_STATUSES.includes(sp.status as JournalEntryStatus)
      ? (sp.status as JournalEntryStatus)
      : null;
  return { q, fromStr, toStr, source, status };
}

function fmtCurrency(n: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
}

function fmtDate(d: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d);
}

export default async function JournalPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const { tenantId } = await requireTenant();

  const t = await getTranslations("taxes.journal");
  const tComments = await getTranslations("comments");
  const { q, fromStr, toStr, source, status } = parseParams(sp);

  const where: Prisma.JournalEntryWhereInput = { tenantId };
  if (source) where.sourceType = source;
  if (status) where.status = status;
  if (fromStr || toStr) {
    where.date = {};
    if (fromStr) (where.date as Prisma.DateTimeFilter).gte = new Date(`${fromStr}T00:00:00.000Z`);
    if (toStr) (where.date as Prisma.DateTimeFilter).lte = new Date(`${toStr}T23:59:59.999Z`);
  }
  if (q) {
    const num = Number(q);
    where.OR = [
      { description: { contains: q, mode: "insensitive" } },
      { sourceId: q },
      ...(Number.isFinite(num) && num > 0 ? [{ number: num }] : []),
    ];
  }

  const entries = await db.journalEntry.findMany({
    where,
    include: {
      lines: { orderBy: { position: "asc" } },
    },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    take: 200,
  });

  function totalFor(lines: typeof entries[number]["lines"]): number {
    return lines.reduce((s, l) => s + Number(l.debit), 0);
  }

  const openCommentCounts = await countOpenCommentsByEntity(
    tenantId,
    "JOURNAL_ENTRY",
    entries.map((e) => e.id),
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <JournalFilters q={q} fromStr={fromStr} toStr={toStr} source={source} status={status} />

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {entries.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">{t("table.number")}</th>
                <th className="px-4 py-2 font-medium">{t("table.date")}</th>
                <th className="px-4 py-2 font-medium">{t("table.description")}</th>
                <th className="px-4 py-2 font-medium">{t("table.source")}</th>
                <th className="px-4 py-2 font-medium">{t("table.status")}</th>
                <th className="px-4 py-2 font-medium text-right">{t("table.total")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-accent/40">
                  <td className="px-4 py-2 tabular-nums text-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Link
                        href={`/dashboard/taxes/journal/${e.id}` as never}
                        className="text-primary hover:underline"
                      >
                        #{e.number}
                      </Link>
                      {(openCommentCounts.get(e.id) ?? 0) > 0 && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold"
                          title={tComments("openBadge", { count: openCommentCounts.get(e.id) ?? 0 })}
                        >
                          <MessageCircle className="w-3 h-3" />
                          {openCommentCounts.get(e.id)}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-foreground">{fmtDate(e.date, locale)}</td>
                  <td className="px-4 py-2 text-foreground">{e.description}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {t(`sourceType.${e.sourceType}`)}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        e.status === "REVERSED"
                          ? "inline-block px-2 py-0.5 rounded text-xs bg-destructive/10 text-destructive"
                          : "inline-block px-2 py-0.5 rounded text-xs bg-emerald-500/10 text-emerald-700"
                      }
                    >
                      {t(`status.${e.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-foreground">
                    {fmtCurrency(totalFor(e.lines), locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {entries.length === 200 && (
        <div className="text-xs text-muted-foreground text-center">{t("truncated")}</div>
      )}
    </div>
  );
}
