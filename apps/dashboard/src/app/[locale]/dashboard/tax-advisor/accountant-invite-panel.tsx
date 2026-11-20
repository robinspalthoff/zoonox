"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";
import { Check, ClipboardCopy, Loader2, Mail, Unlink, UserCheck, UserPlus, X } from "lucide-react";
import { InfoTooltip } from "@/components/info-tooltip";
import { inviteAccountant, removeAccountant, type Salutation } from "@/lib/accountant-invite/actions";

type LinkedAccountant = {
  id: string;
  name: string | null;
  email: string;
  pending: boolean;
};

interface Props {
  canInvite: boolean;
  workspaceName: string | null;
  linkedAccountants: LinkedAccountant[];
}

export function AccountantInvitePanel({ canInvite, workspaceName, linkedAccountants }: Props) {
  const tPanel = useTranslations("taxes.taxAdvisor.invitePanel");
  const tDialog = useTranslations("taxes.taxAdvisor.inviteDialog");
  const router = useRouter();
  const { data: session } = useSession();

  const [open, setOpen] = useState(false);
  const [salutation, setSalutation] = useState<Salutation>("NONE");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");

  const inviterName = useMemo(() => {
    const name = session?.user?.name?.trim();
    if (name) return name;
    return session?.user?.email ?? "";
  }, [session]);
  const safeWorkspaceName = workspaceName?.trim() || "—";

  /** Vorlage frisch interpolieren — wird auch beim Reset benutzt. */
  function buildDefaultMessage(): string {
    return tDialog("defaultMessage", { workspace: safeWorkspaceName, inviter: inviterName });
  }

  const [customMessage, setCustomMessage] = useState<string>(() => buildDefaultMessage());
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Sobald ein Berater verknüpft ist, hat das Einladen weiterer keinen
  // Sinn — typische Mandanten-Setups haben genau einen Steuerberater.
  // Statt eines weiteren Einladen-Buttons zeigen wir die Trennen-Aktion.
  const hasAccountant = linkedAccountants.length > 0;

  function disconnectAccountant(userId: string, displayName: string) {
    if (!canInvite) return;
    if (!window.confirm(tPanel("removeConfirm", { name: displayName }))) return;
    setRemoveError(null);
    setRemovingId(userId);
    startTransition(async () => {
      const res = await removeAccountant(userId);
      setRemovingId(null);
      if (!res.success) {
        setRemoveError(translateError(res.errorCode));
        return;
      }
      router.refresh();
    });
  }

  function translateError(code: string): string {
    try {
      return tDialog(`errors.${code}` as never);
    } catch {
      return tDialog("errors.UNKNOWN");
    }
  }

  function reset() {
    setSalutation("NONE");
    setFirstName("");
    setLastName("");
    setEmail("");
    setCustomMessage(buildDefaultMessage());
    setError(null);
    setTempPassword(null);
    setEmailSent(false);
    setCopied(false);
  }

  function close() {
    setOpen(false);
    reset();
  }

  function openDialog() {
    setCustomMessage(buildDefaultMessage());
    setOpen(true);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const fd = new FormData();
    fd.set("salutation", salutation);
    fd.set("firstName", firstName.trim());
    fd.set("lastName", lastName.trim());
    fd.set("email", email.trim());
    fd.set("customMessage", customMessage);
    startTransition(async () => {
      const res = await inviteAccountant(fd);
      setPending(false);
      if (!res.success) {
        setError(translateError(res.errorCode));
        return;
      }
      setTempPassword(res.tempPassword || null);
      setEmailSent(res.emailSent);
      router.refresh();
    });
  }

  async function copyPassword() {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard kann scheitern; Passwort bleibt im UI sichtbar.
    }
  }

  const salutationOptions: Salutation[] = ["MR", "MRS", "DIVERSE", "NONE"];
  const salutationLabels: Record<Salutation, string> = {
    MR: tDialog("salutationMr"),
    MRS: tDialog("salutationMrs"),
    DIVERSE: tDialog("salutationDiverse"),
    NONE: tDialog("salutationNone"),
  };

  return (
    <>
      <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary">
            <UserCheck className="w-5 h-5" />
          </span>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            {tPanel("title")}
            <InfoTooltip content={tPanel("description")} />
          </h3>
        </div>

        {hasAccountant && (
          <ul className="text-sm border border-border rounded-md divide-y divide-border">
            {linkedAccountants.map((a) => {
              const displayName = a.name ?? a.email;
              const isRemoving = removingId === a.id;
              return (
                <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{displayName}</p>
                    {a.name && (
                      <p className="text-[12px] text-muted-foreground truncate">{a.email}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {a.pending ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[11px] font-medium">
                        <Mail className="w-3 h-3" /> {tPanel("statusPending")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[11px] font-medium">
                        <Check className="w-3 h-3" /> {tPanel("statusActive")}
                      </span>
                    )}
                    {canInvite && (
                      <button
                        type="button"
                        onClick={() => disconnectAccountant(a.id, displayName)}
                        disabled={isRemoving}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-input bg-background text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 disabled:opacity-50"
                        title={tPanel("removeButton")}
                      >
                        {isRemoving ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Unlink className="w-3 h-3" />
                        )}
                        {tPanel("removeButton")}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {removeError && (
          <p className="text-[12px] text-destructive">{removeError}</p>
        )}

        {!hasAccountant && (
          <button
            type="button"
            disabled={!canInvite}
            onClick={openDialog}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50 self-start"
            title={!canInvite ? tPanel("inviteDisabledHint") : undefined}
          >
            <UserPlus className="w-4 h-4" />
            {tPanel("inviteButton")}
          </button>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="bg-card rounded-lg shadow-xl border border-border max-w-xl w-full p-5 my-auto">
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground">{tDialog("title")}</h2>
              <button
                type="button"
                onClick={close}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                aria-label={tDialog("close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {tempPassword !== null || emailSent ? (
              <div className="space-y-3">
                <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm">
                  <p className="font-medium text-emerald-700 dark:text-emerald-400">
                    {tDialog("successTitle")}
                  </p>
                  <p className="text-muted-foreground mt-1">
                    {emailSent ? tDialog("successEmailSent") : tDialog("successEmailFailed")}
                  </p>
                </div>
                {tempPassword && (
                  <div>
                    <p className="text-[12px] text-muted-foreground mb-1">{tDialog("initialPassword")}</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-2 py-1.5 text-sm font-mono bg-muted rounded-md break-all">
                        {tempPassword}
                      </code>
                      <button
                        type="button"
                        onClick={copyPassword}
                        className="inline-flex items-center gap-1 px-2 py-1.5 text-[12px] font-medium rounded-md border border-input bg-background hover:bg-accent"
                      >
                        {copied ? <Check className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
                        {copied ? tDialog("copied") : tDialog("copy")}
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">{tDialog("initialPasswordHint")}</p>
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={close}
                    className="px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {tDialog("done")}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="text-[12px] font-medium text-foreground">{tDialog("salutation")}</label>
                    <select
                      value={salutation}
                      onChange={(e) => setSalutation(e.target.value as Salutation)}
                      className="mt-1 w-full px-2 py-1.5 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {salutationOptions.map((key) => (
                        <option key={key} value={key}>
                          {salutationLabels[key]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-foreground">{tDialog("firstName")}</label>
                    <input
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="mt-1 w-full px-2 py-1.5 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-foreground">{tDialog("lastName")}</label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="mt-1 w-full px-2 py-1.5 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[12px] font-medium text-foreground">{tDialog("email")}</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full px-2 py-1.5 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div>
                  <label className="text-[12px] font-medium text-foreground flex items-center justify-between">
                    <span>{tDialog("customMessage")}</span>
                    <button
                      type="button"
                      onClick={() => setCustomMessage(buildDefaultMessage())}
                      className="text-[11px] text-muted-foreground hover:text-foreground underline"
                    >
                      {tDialog("resetTemplate")}
                    </button>
                  </label>
                  <textarea
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    rows={8}
                    maxLength={4000}
                    className="mt-1 w-full px-2 py-1.5 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring font-sans leading-relaxed"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">{tDialog("messageHint")}</p>
                </div>

                {error && <p className="text-[12px] text-destructive">{error}</p>}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="px-3 py-1.5 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent text-foreground"
                  >
                    {tDialog("cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={pending || !firstName.trim() || !email.trim()}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                    {tDialog("submit")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
