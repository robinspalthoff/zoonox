"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Mail,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import {
  setInboundActive,
  rotateInboundToken,
  saveAllowedSenders,
} from "./actions";

type LogRow = {
  id: string;
  fromAddress: string;
  subject: string | null;
  status: string;
  rejectReason: string | null;
  documentCount: number;
  createdAt: string;
};

interface Props {
  configured: boolean;
  aliasAddress: string | null;
  active: boolean;
  allowedSenders: string[];
  logs: LogRow[];
}

const CARD = "bg-card border border-border rounded-xl p-6";

function statusClass(status: string): string {
  switch (status) {
    case "PROCESSED":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "REJECTED":
      return "bg-destructive/10 text-destructive";
    case "NO_ATTACHMENT":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function EmailInboundForm({
  configured,
  aliasAddress,
  active,
  allowedSenders,
  logs,
}: Props) {
  const t = useTranslations("settings.emailInbound");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [sendersText, setSendersText] = useState(allowedSenders.join("\n"));
  const [sendersSaved, setSendersSaved] = useState(false);

  const copyAlias = async () => {
    if (!aliasAddress) return;
    await navigator.clipboard.writeText(aliasAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onToggle = () => {
    startTransition(async () => {
      await setInboundActive(!active);
      router.refresh();
    });
  };

  const onRotate = () => {
    if (!confirm(t("rotateConfirm"))) return;
    startTransition(async () => {
      await rotateInboundToken();
      router.refresh();
    });
  };

  const onSaveSenders = () => {
    startTransition(async () => {
      await saveAllowedSenders(sendersText);
      setSendersSaved(true);
      setTimeout(() => setSendersSaved(false), 3000);
      router.refresh();
    });
  };

  if (!configured) {
    return (
      <section className={CARD}>
        <div className="flex items-center gap-2 mb-1">
          <Mail className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">{t("cardTitle")}</h2>
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>{t("notConfigured")}</p>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* Alias + Aktiv-Toggle */}
      <section className={CARD}>
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">{t("cardTitle")}</h2>
          </div>
          <button
            type="button"
            onClick={onToggle}
            disabled={pending}
            aria-pressed={active}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              active ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                active ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-5">{t("help")}</p>

        <label className="block text-sm font-medium text-foreground mb-1.5">
          {t("aliasLabel")}
        </label>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground font-mono truncate">
            {aliasAddress}
          </code>
          <button
            type="button"
            onClick={copyAlias}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            {copied ? t("copied") : t("copy")}
          </button>
        </div>

        {!active && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{t("inactiveHint")}</p>
        )}

        <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-muted-foreground max-w-md">{t("rotateHelp")}</p>
          <button
            type="button"
            onClick={onRotate}
            disabled={pending}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" />
            {t("rotate")}
          </button>
        </div>
      </section>

      {/* Absender-Allowlist */}
      <section className={CARD}>
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">{t("allowlistTitle")}</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">{t("allowlistHelp")}</p>
        <textarea
          value={sendersText}
          onChange={(e) => setSendersText(e.target.value)}
          rows={4}
          placeholder={t("allowlistPlaceholder")}
          className="w-full px-3 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={onSaveSenders}
            disabled={pending}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {t("save")}
          </button>
          {sendersSaved && (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
              <Check className="w-4 h-4" />
              {t("saved")}
            </span>
          )}
        </div>
      </section>

      {/* Eingangs-Log */}
      <section className={CARD}>
        <h2 className="text-lg font-semibold text-foreground mb-1">{t("logTitle")}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t("logHelp")}</p>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground/70 py-4 text-center">{t("logEmpty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {logs.map((log) => (
              <li key={log.id} className="py-3 flex items-center gap-3 text-sm">
                <span
                  className={`px-2 py-0.5 rounded-md text-xs font-medium shrink-0 ${statusClass(log.status)}`}
                >
                  {t(`status.${log.status}` as never)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate">
                    {log.subject || t("noSubject")}
                  </p>
                  <p className="text-muted-foreground text-xs truncate">
                    {log.fromAddress}
                    {log.rejectReason ? ` · ${log.rejectReason}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {log.documentCount > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {t("docCount", { count: log.documentCount })}
                    </span>
                  )}
                  <p className="text-muted-foreground/70 text-xs">
                    {new Date(log.createdAt).toLocaleString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
