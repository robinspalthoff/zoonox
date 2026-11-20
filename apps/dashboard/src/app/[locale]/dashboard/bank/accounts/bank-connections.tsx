"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations, useFormatter, useNow } from "next-intl";
import {
  Landmark,
  RefreshCw,
  Link2Off,
  RotateCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
} from "lucide-react";
import {
  syncConnectionNow,
  reconnectConnection,
  disconnectConnection,
} from "../enable-banking-actions";
import { cn } from "@/lib/utils";

export type ConnectionStatus =
  | "PENDING"
  | "ACTIVE"
  | "EXPIRED"
  | "REVOKED"
  | "ERROR";

export interface BankConnectionRow {
  id: string;
  aspspName: string;
  status: ConnectionStatus;
  psuType: string;
  validUntil: string | null;
  authorizedAt: string | null;
  lastSyncedAt: string | null;
  accountCount: number;
}

export function BankConnectionsSection({
  connections,
}: {
  connections: BankConnectionRow[];
}) {
  const t = useTranslations("bank.connect");
  // Don't show revoked connections — they're just tombstones.
  const visible = connections.filter((c) => c.status !== "REVOKED");
  if (visible.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {t("connections.title")}
      </h2>
      <div className="flex flex-col gap-2">
        {visible.map((c) => (
          <ConnectionRow key={c.id} connection={c} />
        ))}
      </div>
    </section>
  );
}

function ConnectionRow({ connection }: { connection: BankConnectionRow }) {
  const t = useTranslations("bank.connect");
  const format = useFormatter();
  // Reference "now" for relativeTime — avoids the ENVIRONMENT_FALLBACK warning
  // and keeps the "synced X ago" label stable across server/client render.
  const now = useNow();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<null | "sync" | "reconnect" | "disconnect">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showConsent, setShowConsent] = useState(false);

  const isActive = connection.status === "ACTIVE";
  const needsReconnect =
    connection.status === "EXPIRED" || connection.status === "ERROR";

  function runSync() {
    setBusy("sync");
    setMessage(null);
    startTransition(async () => {
      const res = await syncConnectionNow(connection.id);
      setBusy(null);
      if (res.success) {
        setMessage(t("connections.synced", { imported: res.imported }));
        router.refresh();
      } else {
        setMessage(res.error);
      }
    });
  }

  async function runReconnect() {
    setBusy("reconnect");
    setMessage(null);
    const res = await reconnectConnection(connection.id);
    if (res.success) {
      window.location.href = res.url;
    } else {
      setBusy(null);
      setMessage(res.error);
    }
  }

  function runDisconnect() {
    if (!confirm(t("connections.disconnectConfirm"))) return;
    setBusy("disconnect");
    setMessage(null);
    startTransition(async () => {
      const res = await disconnectConnection(connection.id);
      setBusy(null);
      if (res.success) router.refresh();
      else setMessage(res.error);
    });
  }

  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="flex items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-3 min-w-0">
          <Landmark className="w-5 h-5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">
                {connection.aspspName}
              </span>
              <StatusBadge status={connection.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("connections.accountCount", { count: connection.accountCount })}
              {connection.lastSyncedAt && (
                <>
                  {" · "}
                  {t("connections.lastSync", {
                    when: format.relativeTime(new Date(connection.lastSyncedAt), now),
                  })}
                </>
              )}
              {isActive && connection.validUntil && (
                <>
                  {" · "}
                  {t("connections.validUntil", {
                    date: format.dateTime(new Date(connection.validUntil), {
                      dateStyle: "medium",
                    }),
                  })}
                </>
              )}
            </p>
            {message && (
              <p className="text-xs text-muted-foreground mt-1">{message}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <IconAction
            onClick={() => setShowConsent((v) => !v)}
            title={t("connections.consent.title")}
            icon={<ShieldCheck className="w-4 h-4" />}
          />
          {isActive && (
            <IconAction
              onClick={runSync}
              disabled={isPending}
              busy={busy === "sync"}
              title={t("connections.sync")}
              icon={<RefreshCw className="w-4 h-4" />}
            />
          )}
          {needsReconnect && (
            <button
              type="button"
              onClick={runReconnect}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {busy === "reconnect" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCw className="w-3.5 h-3.5" />
              )}
              {t("connections.reconnect")}
            </button>
          )}
          <IconAction
            onClick={runDisconnect}
            disabled={isPending}
            busy={busy === "disconnect"}
            title={t("connections.disconnect")}
            icon={<Link2Off className="w-4 h-4" />}
          />
        </div>
      </div>

      {showConsent && (
        <dl className="border-t border-border px-3 py-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">{t("connections.consent.scope")}</dt>
          <dd className="text-foreground">{t("connections.consent.scopeValue")}</dd>
          <dt className="text-muted-foreground">{t("connections.consent.psuType")}</dt>
          <dd className="text-foreground">
            {t(`psuType.${connection.psuType === "personal" ? "personal" : "business"}`)}
          </dd>
          {connection.authorizedAt && (
            <>
              <dt className="text-muted-foreground">
                {t("connections.consent.authorizedAt")}
              </dt>
              <dd className="text-foreground">
                {format.dateTime(new Date(connection.authorizedAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </dd>
            </>
          )}
          {connection.validUntil && (
            <>
              <dt className="text-muted-foreground">
                {t("connections.consent.validUntil")}
              </dt>
              <dd className="text-foreground">
                {format.dateTime(new Date(connection.validUntil), { dateStyle: "medium" })}
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

function IconAction({
  onClick,
  disabled,
  busy,
  title,
  icon,
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
    </button>
  );
}

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const t = useTranslations("bank.connect");
  const map: Record<
    ConnectionStatus,
    { cls: string; icon: React.ReactNode }
  > = {
    ACTIVE: {
      cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    EXPIRED: {
      cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
      icon: <Clock className="w-3 h-3" />,
    },
    ERROR: {
      cls: "bg-destructive/10 text-destructive",
      icon: <AlertTriangle className="w-3 h-3" />,
    },
    PENDING: {
      cls: "bg-muted text-muted-foreground",
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
    },
    REVOKED: { cls: "bg-muted text-muted-foreground", icon: null },
  };
  const s = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium",
        s.cls,
      )}
    >
      {s.icon}
      {t(`connections.status.${status}`)}
    </span>
  );
}
