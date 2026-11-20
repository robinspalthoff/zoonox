"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";
import { Building2, Check, CheckCircle2, Clock, Loader2, Receipt, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TenantRole } from "@prisma/client";

export type ClientCard = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: TenantRole;
  isActive: boolean;
  lastUploadAt: string | null;
  monthStatus: "OPEN" | "SUBMITTED" | "CLOSED";
  openTransactionCount: number;
};

export function ClientsList({ cards }: { cards: ClientCard[] }) {
  const t = useTranslations("firm.clients");
  const locale = useLocale();
  const { update } = useSession();
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function switchTo(card: ClientCard) {
    if (card.isActive || pendingId) return;
    setPendingId(card.id);
    try {
      await update({ tenantId: card.id });
      router.push("/dashboard");
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  function monthLabel(status: ClientCard["monthStatus"]): string {
    if (status === "CLOSED") return t("monthStatusClosed");
    if (status === "SUBMITTED") return t("monthStatusSubmitted");
    return t("monthStatusOpen");
  }

  function monthClass(status: ClientCard["monthStatus"]): string | undefined {
    if (status === "CLOSED") return "text-emerald-700 dark:text-emerald-400 font-medium";
    if (status === "SUBMITTED") return "text-amber-700 dark:text-amber-400 font-medium";
    return undefined;
  }

  function fmtRelative(iso: string): string {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (days === 0) return t("today");
    if (days === 1) return t("yesterday");
    if (days < 7) return t("daysAgo", { count: days });
    if (days < 30) return t("weeksAgo", { count: Math.floor(days / 7) });
    return d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          onClick={() => switchTo(card)}
          disabled={!!pendingId}
          className={cn(
            "text-left rounded-lg border bg-card p-4 transition-all hover:shadow-md disabled:opacity-60",
            card.isActive ? "border-primary ring-1 ring-primary/30" : "border-border hover:border-primary/40",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Building2 className="w-4 h-4 shrink-0 text-muted-foreground" />
              <p className="font-medium text-foreground truncate">{card.name}</p>
            </div>
            {card.isActive ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-medium">
                <Check className="w-3 h-3" /> {t("active")}
              </span>
            ) : pendingId === card.id ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : null}
          </div>

          <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-wide">
            {card.role.toLowerCase()} · {card.plan}
          </p>

          <div className="mt-4 space-y-2 text-[12px]">
            <Stat
              icon={<MonthStatusIcon status={card.monthStatus} />}
              label={t("currentMonth")}
              value={monthLabel(card.monthStatus)}
              valueClass={monthClass(card.monthStatus)}
            />
            <Stat
              icon={<Upload className="w-3.5 h-3.5 text-muted-foreground" />}
              label={t("lastUpload")}
              value={card.lastUploadAt ? fmtRelative(card.lastUploadAt) : t("lastUploadNone")}
            />
            <Stat
              icon={<Receipt className="w-3.5 h-3.5 text-muted-foreground" />}
              label={t("openTransactions")}
              value={
                card.openTransactionCount === 0
                  ? t("openTransactionsNone")
                  : t("openTransactionsCount", { count: card.openTransactionCount })
              }
              valueClass={card.openTransactionCount > 0 ? "text-amber-700 dark:text-amber-400 font-medium" : undefined}
            />
          </div>
        </button>
      ))}
    </div>
  );
}

function Stat({
  icon, label, value, valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className={cn("text-foreground tabular-nums", valueClass)}>{value}</span>
    </div>
  );
}

function MonthStatusIcon({ status }: { status: ClientCard["monthStatus"] }) {
  if (status === "CLOSED") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />;
  if (status === "SUBMITTED") return <Loader2 className="w-3.5 h-3.5 text-amber-600" />;
  return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
}
