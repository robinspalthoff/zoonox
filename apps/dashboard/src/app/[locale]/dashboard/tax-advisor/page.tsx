import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Link } from "@/i18n/navigation";
import { ArrowRight, CalendarCheck2, CheckCircle2, Clock, Loader2 } from "lucide-react";
import type { MonthCloseStatus } from "@prisma/client";
import { InfoTooltip } from "@/components/info-tooltip";
import { AccountantInvitePanel } from "./accountant-invite-panel";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taxes.taxAdvisor");
  return { title: t("pageTitle") };
}

export default async function TaxAdvisorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/auth/login`);

  const t = await getTranslations("taxes.taxAdvisor");
  const tCard = await getTranslations("taxes.taxAdvisor.monthCloseCard");
  const tenant = await requireTenant();

  // Für den Berater ist diese Page komplett inhaltsleer: DATEV liegt
  // unter /taxes/datev-export, der Monatsabschluss-Workflow unter
  // /firm/closing, und die Einladung ergibt für ihn keinen Sinn — er
  // IST ja der Eingeladene. Direkt-URL führt ihn zu seinem Hub.
  if (tenant.tenantRole === "ACCOUNTANT") {
    redirect(`/${locale}/dashboard/firm/closing`);
  }

  const today = new Date();
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);

  const targetYear = prevMonthStart.getFullYear();
  const targetMonth = prevMonthStart.getMonth() + 1;
  const targetMonthLabel = new Intl.DateTimeFormat(locale, { month: "long" })
    .format(new Date(targetYear, targetMonth - 1, 1));

  const [linkedAccountants, monthCloseRow, companySettings] = await Promise.all([
    db.tenantUser.findMany({
      where: { tenantId: tenant.tenantId, role: "ACCOUNTANT" },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, mustChangePassword: true },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.monthClose.findUnique({
      where: { tenantId_year_month: { tenantId: tenant.tenantId, year: targetYear, month: targetMonth } },
      select: { status: true },
    }),
    db.companySettings.findUnique({
      where: { tenantId: tenant.tenantId },
      select: { name: true },
    }),
  ]);

  const canInvite = can(tenant.tenantRole, "team.write");
  const monthStatus: MonthCloseStatus = monthCloseRow?.status ?? "OPEN";

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AccountantInvitePanel
          canInvite={canInvite}
          workspaceName={companySettings?.name ?? null}
          linkedAccountants={linkedAccountants.map((m) => ({
            id: m.user.id,
            name: [m.user.firstName, m.user.lastName].filter(Boolean).join(" ") || null,
            email: m.user.email,
            pending: m.user.mustChangePassword,
          }))}
        />

        <MonthCloseCard
          monthLabel={targetMonthLabel}
          year={targetYear}
          status={monthStatus}
          title={tCard("title")}
          description={tCard("description")}
          lastBookableMonthLabel={tCard("lastBookableMonth")}
          statusLabels={{
            OPEN: tCard("statusOpen"),
            SUBMITTED: tCard("statusSubmitted"),
            CLOSED: tCard("statusClosed"),
          }}
          openButtonLabel={tCard("openButton")}
        />
      </div>
    </div>
  );
}

function MonthCloseCard({
  monthLabel,
  year,
  status,
  title,
  description,
  lastBookableMonthLabel,
  statusLabels,
  openButtonLabel,
}: {
  monthLabel: string;
  year: number;
  status: MonthCloseStatus;
  title: string;
  description: string;
  lastBookableMonthLabel: string;
  statusLabels: Record<MonthCloseStatus, string>;
  openButtonLabel: string;
}) {
  const statusInfo = (() => {
    if (status === "CLOSED") {
      return {
        Icon: CheckCircle2,
        className: "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10",
        label: statusLabels.CLOSED,
      };
    }
    if (status === "SUBMITTED") {
      return {
        Icon: Loader2,
        className: "text-amber-700 dark:text-amber-400 bg-amber-500/10",
        label: statusLabels.SUBMITTED,
      };
    }
    return {
      Icon: Clock,
      className: "text-muted-foreground bg-muted",
      label: statusLabels.OPEN,
    };
  })();
  const StatusIcon = statusInfo.Icon;

  return (
    <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary">
          <CalendarCheck2 className="w-5 h-5" />
        </span>
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          {title}
          <InfoTooltip content={description} />
        </h3>
      </div>

      <div className="rounded-md border border-border bg-background px-3 py-2.5">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
          {lastBookableMonthLabel}
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="font-medium text-foreground">{monthLabel} {year}</p>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${statusInfo.className}`}>
            <StatusIcon className="w-3 h-3" />
            {statusInfo.label}
          </span>
        </div>
      </div>

      <Link
        href="/dashboard/firm/closing"
        className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 self-start"
      >
        {openButtonLabel}
        <ArrowRight className="w-4 h-4" />
      </Link>

    </div>
  );
}
