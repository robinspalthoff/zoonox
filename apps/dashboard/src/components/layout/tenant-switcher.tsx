"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Building2, Check, ChevronsUpDown, Loader2, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateWorkspace } from "@/app/[locale]/dashboard/settings/actions";

// Wird im Header-Bar angezeigt. Bei nur einem Tenant: nicht-interaktives Label,
// damit Single-Tenant-User die UI nicht aufgebläht sehen. Bei mehreren Tenants
// (typisch für Steuerberater): Dropdown, das beim Wechsel via NextAuth
// `update({ tenantId })` das JWT neu schreibt und dann hart auf /dashboard
// navigiert, damit alle Server-Components mit dem neuen Tenant-Kontext laden.
export function TenantSwitcher() {
  const { data: session, update, status } = useSession();
  const t = useTranslations("common.tenantSwitcher");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (status !== "authenticated" || !session?.user) return null;

  const tenants = session.user.tenants ?? [];
  const activeId = session.user.tenantId;
  const active = tenants.find((x) => x.id === activeId) ?? null;

  // Kein Tenant: Layout würde eh auf /auth/no-tenant redirecten — defensiv null.
  if (tenants.length === 0 || !active) return null;

  // Bearbeiten dürfen Plattform-Admins und Tenant-Owner/Admins. Der
  // eigentliche Server-Action-Call prüft das nochmal autoritativ — hier
  // geht es nur darum, den Pencil-Icon nicht für Read-Only-Member zu zeigen.
  const userRole = session.user.role;
  const canEdit =
    userRole === "SUPER_ADMIN" ||
    userRole === "ADMIN" ||
    active.role === "OWNER" ||
    active.role === "ADMIN";

  async function handleSwitch(targetId: string) {
    if (targetId === activeId || pendingId) return;
    setPendingId(targetId);
    try {
      await update({ tenantId: targetId });
      // Auf das Dashboard-Root navigieren, damit detail-routes mit IDs aus
      // dem alten Tenant nicht 404'en. router.refresh() reicht nicht, weil
      // wir den Pfad-Kontext bewusst neu setzen wollen.
      router.push("/dashboard");
      router.refresh();
      setOpen(false);
    } finally {
      setPendingId(null);
    }
  }

  // Single-Tenant: nur Label + Inline-Editor. Bearbeiten-Icon erscheint
  // inline daneben für Admins/Owner.
  if (tenants.length === 1) {
    return (
      <div className="flex items-center gap-1 px-1 py-1.5 text-sm text-muted-foreground group">
        <Building2 className="w-4 h-4 shrink-0 ml-1.5" />
        <InlineNameEditor
          name={active.name}
          canEdit={canEdit}
          variant="plain"
          onSaved={async () => {
            await update({});
            router.refresh();
          }}
        />
      </div>
    );
  }

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-background hover:bg-accent transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Building2 className="w-4 h-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground truncate max-w-[180px]">
          {active.name}
        </span>
        <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
      {canEdit && (
        <InlineRenameButton
          name={active.name}
          onSaved={async () => {
            await update({});
            router.refresh();
          }}
        />
      )}

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-2 w-64 bg-card border border-border rounded-xl shadow-xl shadow-black/20 overflow-hidden z-50"
        >
          <div className="px-3 py-2 border-b border-border">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
              {t("label")}
            </p>
          </div>
          <ul className="p-1.5 max-h-72 overflow-y-auto">
            {tenants.map((tenant) => {
              const isActive = tenant.id === activeId;
              const isPending = pendingId === tenant.id;
              return (
                <li key={tenant.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    disabled={!!pendingId}
                    onClick={() => handleSwitch(tenant.id)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent",
                      pendingId && !isPending && "opacity-50"
                    )}
                  >
                    <Building2 className="w-4 h-4 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium">{tenant.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {tenant.role.toLowerCase()}
                      </p>
                    </div>
                    {isPending ? (
                      <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                    ) : isActive ? (
                      <Check className="w-4 h-4 shrink-0" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Multi-Tenant-Variante: nur ein Pencil-Button, der ein Mini-Popover mit
 * Inline-Input öffnet — der Switcher-Button daneben bleibt unverändert
 * (damit der Workspace-Name auch beim Bearbeiten lesbar bleibt).
 */
function InlineRenameButton({
  name,
  onSaved,
}: {
  name: string;
  onSaved: () => Promise<void> | void;
}) {
  const t = useTranslations("common.tenantSwitcher");
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={t("edit")}
        aria-label={t("edit")}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
    );
  }

  return (
    <InlineNameEditor
      name={name}
      canEdit
      variant="popover"
      autoStart
      onClose={() => setEditing(false)}
      onSaved={onSaved}
    />
  );
}

/**
 * Inline-Editor für den Workspace-Namen.
 *
 * `variant: "plain"` rendert das Label direkt im Flow — Pencil-Icon erscheint
 * hover-only, beim Klick wird das Label durch ein Input ersetzt und das
 * Pencil wird zum grünen Check. Enter speichert, Escape verwirft. Wird im
 * Single-Tenant-Pfad genutzt, wo der Name freistehend im Header sitzt.
 *
 * `variant: "popover"` rendert das Input absolut unter dem aktuellen
 * Eltern-Container — wird im Multi-Tenant-Pfad benutzt, damit der
 * Switcher-Button daneben sichtbar bleibt. Mit `autoStart` startet der
 * Editor direkt im Bearbeiten-Modus.
 */
function InlineNameEditor({
  name,
  canEdit,
  variant,
  autoStart = false,
  onSaved,
  onClose,
}: {
  name: string;
  canEdit: boolean;
  variant: "plain" | "popover";
  autoStart?: boolean;
  onSaved: () => Promise<void> | void;
  onClose?: () => void;
}) {
  const t = useTranslations("common.tenantSwitcher");
  const [editing, setEditing] = useState(autoStart);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Wenn der Name sich von außen ändert (z. B. nach Save + Session-Refresh),
  // den Editor-Eingabewert synchronisieren — verhindert, dass beim nächsten
  // Edit der alte Wert wieder auftaucht.
  useEffect(() => {
    if (!editing) setValue(name);
  }, [name, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // Outside-click im Popover-Mode schließt den Editor (ohne speichern).
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editing || variant !== "popover") return;
    function onDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        cancel();
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, variant]);

  function startEdit() {
    setValue(name);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setError(null);
    setValue(name);
    setEditing(false);
    onClose?.();
  }

  function save() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(t("errorEmpty"));
      return;
    }
    if (trimmed === name) {
      setEditing(false);
      onClose?.();
      return;
    }
    startTransition(async () => {
      const res = await updateWorkspace(trimmed);
      if (!res.success) {
        setError(res.error || t("errorGeneric"));
        return;
      }
      await onSaved();
      setEditing(false);
      onClose?.();
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

  if (variant === "plain") {
    if (!editing) {
      return (
        <>
          <span className="font-medium text-foreground truncate max-w-[180px] px-1.5">
            {name}
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={startEdit}
              title={t("edit")}
              aria-label={t("edit")}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </>
      );
    }
    return (
      <div className="flex items-center gap-1">
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
          aria-label={t("nameLabel")}
          aria-invalid={!!error}
          maxLength={80}
          className={cn(
            "px-2 py-1 bg-background border rounded-md text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring max-w-[200px]",
            error ? "border-destructive" : "border-input",
          )}
        />
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          title={t("save")}
          aria-label={t("save")}
          className="p-1 rounded-md text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
        >
          {isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={isPending}
          title={t("cancel")}
          aria-label={t("cancel")}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        {error && (
          <span className="text-[11px] text-destructive ml-1">{error}</span>
        )}
      </div>
    );
  }

  // popover variant — wird über dem ursprünglichen Pencil-Button gerendert.
  return (
    <div
      ref={wrapperRef}
      className="absolute right-0 top-full mt-2 z-50 bg-card border border-border rounded-lg shadow-xl p-2 flex items-center gap-1"
    >
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
        aria-label={t("nameLabel")}
        aria-invalid={!!error}
        maxLength={80}
        className={cn(
          "px-2 py-1 bg-background border rounded-md text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring w-56",
          error ? "border-destructive" : "border-input",
        )}
      />
      <button
        type="button"
        onClick={save}
        disabled={isPending}
        title={t("save")}
        aria-label={t("save")}
        className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
      >
        {isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
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
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
      {error && (
        <span className="absolute left-0 -bottom-5 text-[11px] text-destructive whitespace-nowrap">
          {error}
        </span>
      )}
    </div>
  );
}
