"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import {
  AlertTriangle, CheckCircle2, Clock, Loader2, Lock, LockOpen, MessageCircle,
  Receipt, Send, UserPlus, Undo2, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MonthCloseDTO } from "@/lib/month-close/queries";
import {
  submitMonth, reopenMonth, finalizeMonth, unfinalizeMonth,
} from "@/lib/month-close/actions";

type Row = MonthCloseDTO & { monthLabel: string };

interface Props {
  months: Row[];
  canSubmit: boolean;
  canFinalize: boolean;
  canReopen: boolean;
  canUnfinalize: boolean;
  isAccountant: boolean;
  hasAccountantLinked: boolean;
  locale: string;
}

export function ClosingTable({
  months,
  canSubmit,
  canFinalize,
  canReopen,
  canUnfinalize,
  isAccountant,
  hasAccountantLinked,
}: Props) {
  const t = useTranslations("firm.closing");
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [reopenRow, setReopenRow] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [confirmAction, setConfirmAction] = useState<
    | { type: "finalize"; row: Row }
    | { type: "unfinalize"; row: Row }
    | null
  >(null);

  function key(r: Row) {
    return `${r.year}-${r.month}`;
  }

  function translateError(code: string): string {
    try {
      return t(`errors.${code}` as never);
    } catch {
      return t("errors.UNKNOWN");
    }
  }

  function run(
    label: string,
    fn: () => Promise<{ success: true } | { success: false; errorCode: string }>,
  ) {
    setBusy(label);
    setError(null);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.success) {
        setError(translateError(res.errorCode));
        return;
      }
      router.refresh();
    });
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  return (
    <>
      {!hasAccountantLinked && canSubmit && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-foreground">{t("noAccountantBanner.title")}</p>
            <p className="text-muted-foreground mt-0.5">{t("noAccountantBanner.description")}</p>
          </div>
          <Link
            href="/dashboard/tax-advisor"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700"
          >
            <UserPlus className="w-3.5 h-3.5" />
            {t("noAccountantBanner.cta")}
          </Link>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-[12px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">{t("table.month")}</th>
              <th className="px-4 py-2.5 font-medium">{t("table.status")}</th>
              <th className="px-4 py-2.5 font-medium">{t("table.readiness")}</th>
              <th className="px-4 py-2.5 font-medium">{t("table.history")}</th>
              <th className="px-4 py-2.5 font-medium text-right">{t("table.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {months.map((row) => {
              const k = key(row);
              const isBusyOnThisRow = busy?.startsWith(k);
              return (
                <tr key={k} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 align-top">
                    <p className="font-medium text-foreground">{row.monthLabel} {row.year}</p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3 align-top">
                    <ReadinessChecklist row={row} />
                  </td>
                  <td className="px-4 py-3 align-top text-[12px] text-muted-foreground space-y-0.5">
                    {row.submittedAt && (
                      <p>
                        {row.submittedBy?.name
                          ? t("history.submittedAtBy", { date: formatDate(row.submittedAt), name: row.submittedBy.name })
                          : t("history.submittedAt", { date: formatDate(row.submittedAt) })}
                      </p>
                    )}
                    {row.finalizedAt && (
                      <p>
                        {row.finalizedBy?.name
                          ? t("history.finalizedAtBy", { date: formatDate(row.finalizedAt), name: row.finalizedBy.name })
                          : t("history.finalizedAt", { date: formatDate(row.finalizedAt) })}
                      </p>
                    )}
                    {row.reviewNotes && (
                      <p className="flex items-start gap-1 text-amber-700 dark:text-amber-400 mt-1">
                        <MessageCircle className="w-3 h-3 mt-0.5 shrink-0" />
                        <span className="whitespace-pre-wrap">{row.reviewNotes}</span>
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {reopenRow === k ? (
                      <div className="flex flex-col gap-2 max-w-[280px] ml-auto">
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          rows={2}
                          placeholder={t("actions.reopenPlaceholder")}
                          className="px-2 py-1.5 text-[12px] bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setReopenRow(null);
                              setNotes("");
                            }}
                            className="px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground"
                          >
                            {t("actions.reopenCancel")}
                          </button>
                          <button
                            type="button"
                            disabled={!!busy}
                            onClick={() => {
                              run(`${k}:reopen`, () =>
                                reopenMonth({ year: row.year, month: row.month, reviewNotes: notes }),
                              );
                              setReopenRow(null);
                              setNotes("");
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[12px] font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                          >
                            <Undo2 className="w-3 h-3" /> {t("actions.reopenSubmit")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap justify-end gap-2">
                        {row.status === "OPEN" && canSubmit && (
                          <ActionButton
                            icon={<Send className="w-3.5 h-3.5" />}
                            label={t("actions.submit")}
                            loading={isBusyOnThisRow && busy?.endsWith(":submit")}
                            onClick={() =>
                              run(`${k}:submit`, () => submitMonth({ year: row.year, month: row.month }))
                            }
                            disabled={!!busy || !hasAccountantLinked}
                            title={!hasAccountantLinked ? t("actions.submitDisabledHint") : undefined}
                          />
                        )}
                        {row.status === "SUBMITTED" && canReopen && (
                          <ActionButton
                            icon={<Undo2 className="w-3.5 h-3.5" />}
                            label={t("actions.reopen")}
                            variant="warning"
                            onClick={() => {
                              setReopenRow(k);
                              setNotes("");
                            }}
                            disabled={!!busy}
                          />
                        )}
                        {row.status !== "CLOSED" && canFinalize && (!hasAccountantLinked || isAccountant) && (
                          <ActionButton
                            icon={<Lock className="w-3.5 h-3.5" />}
                            label={t("actions.finalize")}
                            variant="primary"
                            onClick={() => setConfirmAction({ type: "finalize", row })}
                            disabled={!!busy}
                          />
                        )}
                        {row.status === "CLOSED" && (
                          <>
                            <span className="inline-flex items-center gap-1 px-2 py-1 text-[12px] text-muted-foreground">
                              <Lock className="w-3 h-3" /> {t("actions.locked")}
                            </span>
                            {canUnfinalize && (
                              <ActionButton
                                icon={<LockOpen className="w-3.5 h-3.5" />}
                                label={t("actions.unfinalize")}
                                variant="default"
                                onClick={() => setConfirmAction({ type: "unfinalize", row })}
                                disabled={!!busy}
                              />
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {error && (
          <p className="px-4 py-2 text-[12px] text-destructive border-t border-border">{error}</p>
        )}
      </div>

      {confirmAction && (
        <ConfirmDialog
          title={
            confirmAction.type === "finalize"
              ? t("confirm.finalizeTitle")
              : t("confirm.unfinalizeTitle")
          }
          description={
            confirmAction.type === "finalize"
              ? t("confirm.finalizeDescription", { month: confirmAction.row.monthLabel, year: confirmAction.row.year })
              : t("confirm.unfinalizeDescription", { month: confirmAction.row.monthLabel, year: confirmAction.row.year })
          }
          confirmLabel={
            confirmAction.type === "finalize"
              ? t("confirm.finalizeConfirm")
              : t("confirm.unfinalizeConfirm")
          }
          cancelLabel={t("confirm.cancel")}
          confirmVariant={confirmAction.type === "finalize" ? "primary" : "default"}
          onConfirm={() => {
            const row = confirmAction.row;
            const k = key(row);
            if (confirmAction.type === "finalize") {
              run(`${k}:finalize`, () => finalizeMonth({ year: row.year, month: row.month }));
            } else {
              run(`${k}:unfinalize`, () => unfinalizeMonth({ year: row.year, month: row.month }));
            }
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </>
  );
}

function StatusBadge({ status }: { status: MonthCloseDTO["status"] }) {
  const t = useTranslations("firm.closing.status");
  if (status === "OPEN") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-foreground text-[11px] font-medium">
        <Clock className="w-3 h-3" /> {t("open")}
      </span>
    );
  }
  if (status === "SUBMITTED") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[11px] font-medium">
        <Loader2 className="w-3 h-3" /> {t("submitted")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[11px] font-medium">
      <CheckCircle2 className="w-3 h-3" /> {t("closed")}
    </span>
  );
}

function ActionButton({
  icon, label, onClick, disabled, loading, variant = "default", title,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "default" | "primary" | "warning";
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium rounded-md transition-colors disabled:opacity-50",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "warning" && "bg-amber-600 text-white hover:bg-amber-700",
        variant === "default" && "border border-input bg-background hover:bg-accent text-foreground",
      )}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      <span>{label}</span>
    </button>
  );
}

function ReadinessChecklist({ row }: { row: Row }) {
  const t = useTranslations("firm.closing.readiness");
  const items: { label: string; ok: boolean; detail?: string; icon: React.ReactNode }[] = [
    {
      label: t("documentsBooked"),
      ok: row.unbookedDocuments === 0,
      detail: row.unbookedDocuments > 0 ? t("openSuffix", { count: row.unbookedDocuments }) : undefined,
      icon: <Receipt className="w-3 h-3" />,
    },
    {
      label: t("bankCleared"),
      ok: row.unmatchedTransactions === 0,
      detail: row.unmatchedTransactions > 0 ? t("openSuffix", { count: row.unmatchedTransactions }) : undefined,
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    {
      label: t("commentsAnswered"),
      ok: row.openComments === 0,
      detail: row.openComments > 0 ? t("openSuffix", { count: row.openComments }) : undefined,
      icon: <MessageCircle className="w-3 h-3" />,
    },
  ];
  return (
    <ul className="space-y-1 text-[12px]">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          {it.ok ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          )}
          <span className={cn("text-foreground", !it.ok && "text-amber-700 dark:text-amber-400")}>
            {it.label}
            {it.detail && <span className="ml-1 text-muted-foreground">({it.detail})</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ConfirmDialog({
  title, description, confirmLabel, cancelLabel, confirmVariant = "primary", onConfirm, onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmVariant?: "primary" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-card rounded-lg shadow-xl border border-border max-w-md w-full p-5">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent text-foreground"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md",
              confirmVariant === "primary"
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "border border-input bg-background hover:bg-accent text-foreground",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
