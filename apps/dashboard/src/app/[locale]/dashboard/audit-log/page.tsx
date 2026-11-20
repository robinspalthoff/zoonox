import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import type { AuditAction } from "@prisma/client";
import { AuditLogFilters } from "./audit-log-filters";
import { fullName } from "@/lib/user-name";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auditLog");
  return { title: t("pageTitle") };
}

const PAGE_SIZE = 50;

export default async function AuditLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ action?: string; user?: string; from?: string; to?: string; page?: string }>;
}) {
  const { locale } = await params;
  const { tenantId, role } = await requireTenant();

  if (!["SUPER_ADMIN", "ADMIN"].includes(role)) {
    redirect(`/${locale}/dashboard`);
  }

  const t = await getTranslations("auditLog");
  const sp = await searchParams;

  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  // Build filter
  const where: Record<string, unknown> = { tenantId };
  if (sp.action && sp.action !== "ALL") where.action = sp.action as AuditAction;
  if (sp.user && sp.user !== "ALL") where.userId = sp.user;
  if (sp.from || sp.to) {
    const dateFilter: Record<string, Date> = {};
    if (sp.from) dateFilter.gte = new Date(`${sp.from}T00:00:00`);
    if (sp.to) dateFilter.lte = new Date(`${sp.to}T23:59:59`);
    where.createdAt = dateFilter;
  }

  const [entries, total, users] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.auditLog.count({ where }),
    db.tenantUser.findMany({
      where: { tenantId },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }).then((tus) => tus.map((tu) => tu.user)),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const actionOptions: AuditAction[] = [
    "LOGIN", "LOGOUT", "USER_CREATED", "USER_UPDATED", "USER_DEACTIVATED", "USER_REACTIVATED",
    "PASSWORD_CHANGED", "SETTINGS_CHANGED",
    "CLIENT_CREATED", "CLIENT_UPDATED", "CLIENT_DELETED",
    "CONTACT_CREATED", "CONTACT_UPDATED", "CONTACT_DELETED",
    "INVOICE_CREATED", "INVOICE_UPDATED", "INVOICE_SENT", "INVOICE_PAID", "INVOICE_CANCELLED",
    // Quote / Auftragsbestätigung — full lifecycle for both.
    "QUOTE_CREATED", "QUOTE_UPDATED", "QUOTE_SENT",
    "QUOTE_ACCEPTED", "QUOTE_REJECTED", "QUOTE_EXPIRED",
    "QUOTE_CONVERTED", "QUOTE_DELETED",
    "ORDER_CONFIRMATION_CREATED", "ORDER_CONFIRMATION_UPDATED",
    "ORDER_CONFIRMATION_SENT", "ORDER_CONFIRMATION_INVOICED",
    "ORDER_CONFIRMATION_CANCELLED", "ORDER_CONFIRMATION_DELETED",
    "DOCUMENT_VIEWED", "DOCUMENT_DOWNLOADED", "DOCUMENT_DELETED",
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
      </div>

      <AuditLogFilters
        locale={locale}
        users={users}
        actionOptions={actionOptions}
        current={{
          action: sp.action,
          user: sp.user,
          from: sp.from,
          to: sp.to,
        }}
      />

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.date")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.user")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.action")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.entity")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.ip")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    {t("empty")}
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleString(locale, {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {entry.user ? (fullName(entry.user) ?? entry.user.email) : (
                        <span className="text-muted-foreground italic">{t("system")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-muted text-foreground">
                        {t(`actions.${entry.action}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs font-mono">
                      {entry.entityType ?? ""}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs font-mono">
                      {entry.ipAddress ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <a
              key={p}
              href={`/${locale}/dashboard/audit-log?action=${sp.action ?? "ALL"}&user=${sp.user ?? "ALL"}&from=${sp.from ?? ""}&to=${sp.to ?? ""}&page=${p}`}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                p === page
                  ? "bg-primary text-white"
                  : "bg-muted text-foreground hover:bg-accent"
              }`}
            >
              {p}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
