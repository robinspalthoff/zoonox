"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";
import { Building2, Check, Loader2, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateWorkspace } from "../actions";

/**
 * Card on the Company settings page that surfaces the workspace name
 * with an inline rename affordance — same UX as the header. Server-side
 * already gated by the parent page on `canEdit`. Slug is intentionally
 * not shown; it's auto-derived and an internal detail.
 */
export function WorkspaceCard({ name }: { name: string }) {
  const t = useTranslations("common.tenantSwitcher");
  const { update } = useSession();
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setValue(name);
  }, [name, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function cancel() {
    setError(null);
    setValue(name);
    setEditing(false);
  }

  function save() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(t("errorEmpty"));
      return;
    }
    if (trimmed === name) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const res = await updateWorkspace(trimmed);
      if (!res.success) {
        setError(res.error || t("errorGeneric"));
        return;
      }
      await update({});
      router.refresh();
      setEditing(false);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  return (
    <section className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="p-2 rounded-md bg-primary/10 text-primary shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-base">{t("editTitle")}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t("editDescription")}
            </p>
            <div className="mt-4">
              <label className="text-xs text-muted-foreground block mb-1">
                {t("nameLabel")}
              </label>
              {editing ? (
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => {
                      setValue(e.target.value);
                      if (error) setError(null);
                    }}
                    onKeyDown={onKeyDown}
                    disabled={isPending}
                    maxLength={80}
                    aria-invalid={!!error}
                    className={cn(
                      "flex-1 max-w-sm px-3 py-2 bg-background border rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring",
                      error ? "border-destructive" : "border-input",
                    )}
                  />
                  <button
                    type="button"
                    onClick={save}
                    disabled={isPending}
                    title={t("save")}
                    aria-label={t("save")}
                    className="p-2 rounded-md text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
                  >
                    {isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={cancel}
                    disabled={isPending}
                    title={t("cancel")}
                    aria-label={t("cancel")}
                    className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <p className="font-medium text-foreground truncate text-sm">
                  {name}
                </p>
              )}
              {error && (
                <p className="text-xs text-destructive mt-1">{error}</p>
              )}
            </div>
          </div>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-input rounded-lg hover:bg-accent transition-colors shrink-0"
          >
            <Pencil className="w-3.5 h-3.5" />
            {t("edit")}
          </button>
        )}
      </div>
    </section>
  );
}
