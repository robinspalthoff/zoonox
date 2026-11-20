"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Play, Pause, Trash2, Zap, CheckCircle2 } from "lucide-react";
import type { RecurringStatus } from "@prisma/client";
import {
  deleteRecurringInvoice,
  setRecurringAutoGenerate,
  runRecurringNow,
} from "../actions";

export function RecurringDetailActions({
  id,
  status,
  autoGenerate,
}: {
  id: string;
  status: RecurringStatus;
  autoGenerate: boolean;
}) {
  const t = useTranslations("invoices.recurring.detailActions");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flash = (msg: string, kind: "ok" | "err") => {
    if (kind === "ok") setSuccess(msg);
    else setError(msg);
    setTimeout(() => {
      setSuccess(null);
      setError(null);
    }, 4000);
  };

  const onToggle = () => {
    if (status === "COMPLETED") return;
    startTransition(async () => {
      const res = await setRecurringAutoGenerate(id, !autoGenerate);
      if (!res.success) flash(res.error, "err");
      else router.refresh();
    });
  };

  const onRunNow = () => {
    startTransition(async () => {
      const res = await runRecurringNow(id);
      if (!res.success) {
        flash(res.error, "err");
        return;
      }
      flash(t("runNowSuccess", { number: res.invoiceNumber }), "ok");
      router.refresh();
    });
  };

  const onDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    startTransition(async () => {
      const res = await deleteRecurringInvoice(id);
      if (!res.success) {
        flash(res.error, "err");
        return;
      }
      router.push("/dashboard/invoices/recurring");
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        {status !== "COMPLETED" && (
          <>
            <button
              type="button"
              onClick={onRunNow}
              disabled={pending}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-border hover:bg-muted disabled:opacity-50 transition-colors"
            >
              <Zap className="w-3.5 h-3.5 text-primary" />
              {t("runNow")}
            </button>
            <button
              type="button"
              onClick={onToggle}
              disabled={pending}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-border hover:bg-muted disabled:opacity-50 transition-colors"
            >
              {autoGenerate ? (
                <>
                  <Pause className="w-3.5 h-3.5 text-amber-600" />
                  {t("pause")}
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 text-emerald-600" />
                  {t("resume")}
                </>
              )}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50 ${
            confirmDelete
              ? "border-destructive bg-destructive text-white hover:bg-destructive/90"
              : "border-border text-muted-foreground hover:text-destructive hover:border-destructive/40"
          }`}
        >
          <Trash2 className="w-3.5 h-3.5" />
          {confirmDelete ? t("deleteConfirm") : t("delete")}
        </button>
      </div>
      {success && (
        <p className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {success}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
