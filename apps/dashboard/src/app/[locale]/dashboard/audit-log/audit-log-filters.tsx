"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RefreshCw, Download } from "lucide-react";
import { useTransition } from "react";
import type { AuditAction } from "@prisma/client";
import { fullName } from "@/lib/user-name";

interface Props {
  locale: string;
  users: { id: string; firstName: string | null; lastName: string | null; email: string }[];
  actionOptions: AuditAction[];
  current: {
    action?: string;
    user?: string;
    from?: string;
    to?: string;
  };
}

export function AuditLogFilters({ locale, users, actionOptions, current }: Props) {
  const t = useTranslations("auditLog");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleRefresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  // Build export URL with current filter params
  const exportParams = new URLSearchParams();
  if (current.action && current.action !== "ALL") exportParams.set("action", current.action);
  if (current.user && current.user !== "ALL") exportParams.set("user", current.user);
  if (current.from) exportParams.set("from", current.from);
  if (current.to) exportParams.set("to", current.to);
  const exportHref = `/api/audit-log/export?${exportParams.toString()}`;

  return (
    <div className="flex flex-wrap gap-3 items-end justify-between">
      <form className="flex flex-wrap gap-3 items-end">
        {/* Date from */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            {t("filters.from")}
          </label>
          <input
            type="date"
            name="from"
            defaultValue={current.from ?? ""}
            max={current.to ?? undefined}
            className="px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground [color-scheme:dark] dark:[color-scheme:dark] light:[color-scheme:light]"
          />
        </div>

        {/* Date to */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            {t("filters.to")}
          </label>
          <input
            type="date"
            name="to"
            defaultValue={current.to ?? ""}
            min={current.from ?? undefined}
            className="px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground [color-scheme:dark] dark:[color-scheme:dark] light:[color-scheme:light]"
          />
        </div>

        {/* Action */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            {t("filters.action")}
          </label>
          <select
            name="action"
            defaultValue={current.action ?? "ALL"}
            className="px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground"
          >
            <option value="ALL">{t("filters.all")}</option>
            {actionOptions.map((a) => (
              <option key={a} value={a}>{t(`actions.${a}`)}</option>
            ))}
          </select>
        </div>

        {/* User */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            {t("filters.user")}
          </label>
          <select
            name="user"
            defaultValue={current.user ?? "ALL"}
            className="px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground"
          >
            <option value="ALL">{t("filters.all")}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{fullName(u) ?? u.email}</option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
        >
          {t("filters.apply")}
        </button>
        <a
          href={`/${locale}/dashboard/audit-log`}
          className="px-4 py-2 bg-muted text-foreground text-sm font-medium rounded-lg hover:bg-accent transition-colors"
        >
          {t("filters.reset")}
        </a>
      </form>

      {/* Right side: refresh + export */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isPending}
          className="flex items-center gap-2 px-4 py-2 bg-muted text-foreground text-sm font-medium rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isPending ? "animate-spin" : ""}`} />
          {t("filters.refresh")}
        </button>
        <a
          href={exportHref}
          download
          className="flex items-center gap-2 px-4 py-2 bg-muted text-foreground text-sm font-medium rounded-lg hover:bg-accent transition-colors"
        >
          <Download className="w-4 h-4" />
          {t("filters.export")}
        </a>
      </div>
    </div>
  );
}
