"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { UserPlus, Pencil, ShieldOff, ShieldCheck } from "lucide-react";
import type { Role } from "@prisma/client";
import { inviteUser, updateUser, toggleUserActive, type InviteResult, type UpdateResult } from "./actions";
import { fullName } from "@/lib/user-name";

interface UserRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

interface Props {
  users: UserRow[];
  currentUserId: string;
  currentUserRole: Role;
}

export function TeamClient({ users, currentUserId, currentUserRole }: Props) {
  const t = useTranslations("team");
  const router = useRouter();
  const [showInvite, setShowInvite] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<boolean | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const isSuperAdmin = currentUserRole === "SUPER_ADMIN";

  async function handleInvite(formData: FormData) {
    setError("");
    const result: InviteResult = await inviteUser(formData);
    if (result.success) {
      setShowInvite(false);
      setEmailSent(result.emailSent);
      if (result.tempPassword) {
        // Neuer User: temporäres Passwort anzeigen (Fallback falls Email nicht zugestellt).
        setTempPassword(result.tempPassword);
      } else {
        // Bestehender User: nur kurze Notice, da kein Passwort weiterzugeben.
        setInviteNotice(
          result.emailSent
            ? t("inviteNotice.existingEmailed")
            : t("inviteNotice.existingNoEmail")
        );
        setTimeout(() => setInviteNotice(null), 5000);
      }
      startTransition(() => router.refresh());
    } else {
      setError(result.error);
    }
  }

  async function handleUpdate(formData: FormData) {
    setError("");
    const result: UpdateResult = await updateUser(formData);
    if (result.success) {
      setEditUser(null);
      startTransition(() => router.refresh());
    } else {
      setError(result.error);
    }
  }

  async function handleToggleActive(userId: string) {
    const result = await toggleUserActive(userId);
    if (result.success) {
      startTransition(() => router.refresh());
    }
  }

  function copyPassword() {
    if (tempPassword) {
      navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const roleOptions: { value: Role; canSelect: boolean }[] = [
    { value: "SUPER_ADMIN", canSelect: isSuperAdmin },
    { value: "ADMIN", canSelect: isSuperAdmin },
    { value: "USER", canSelect: true },
  ];

  return (
    <div className="space-y-6 p-6">
      {inviteNotice && (
        <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          {inviteNotice}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
        </div>
        <button
          onClick={() => { setShowInvite(true); setError(""); }}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          {t("invite")}
        </button>
      </div>

      {/* User-Tabelle */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.name")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.email")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.role")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.status")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.created")}</th>
                {isSuperAdmin && (
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">{t("table.actions")}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={isSuperAdmin ? 6 : 5} className="px-4 py-8 text-center text-muted-foreground">
                    {t("empty")}
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-foreground font-medium">{fullName(user) ?? "—"}</td>
                    <td className="px-4 py-3 text-foreground">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-muted text-foreground">
                        {t(`roles.${user.role}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ${
                        user.isActive
                          ? "bg-success/10 text-success"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${user.isActive ? "bg-emerald-400" : "bg-zinc-400"}`} />
                        {user.isActive ? t("status.active") : t("status.inactive")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {new Date(user.createdAt).toLocaleDateString("de")}
                    </td>
                    {isSuperAdmin && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => { setEditUser(user); setError(""); }}
                            title={t("actions.edit")}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {user.id !== currentUserId && (
                            <button
                              onClick={() => handleToggleActive(user.id)}
                              title={user.isActive ? t("actions.deactivate") : t("actions.activate")}
                              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            >
                              {user.isActive ? <ShieldOff className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Invite Modal ────────────────────────────────────────────────── */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowInvite(false)}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-foreground mb-4">{t("inviteUser")}</h2>
            <form action={handleInvite} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">{t("form.firstName")}</label>
                  <input name="firstName" type="text" required placeholder={t("form.firstNamePlaceholder")}
                    className="w-full px-3 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">{t("form.lastName")}</label>
                  <input name="lastName" type="text" placeholder={t("form.lastNamePlaceholder")}
                    className="w-full px-3 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t("form.email")}</label>
                <input name="email" type="email" required placeholder={t("form.emailPlaceholder")}
                  className="w-full px-3 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t("form.role")}</label>
                <select name="role" defaultValue="USER"
                  className="w-full px-3 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                  {roleOptions.filter((r) => r.canSelect).map((r) => (
                    <option key={r.value} value={r.value}>{t(`roles.${r.value}`)}</option>
                  ))}
                </select>
              </div>
              {error && (
                <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</p>
              )}
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowInvite(false)}
                  className="px-4 py-2 text-sm font-medium text-foreground bg-muted rounded-lg hover:bg-accent transition-colors">
                  {t("form.cancel")}
                </button>
                <button type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors">
                  {t("form.submit")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Edit Modal ──────────────────────────────────────────────────── */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditUser(null)}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-foreground mb-4">{t("editUser")}</h2>
            <form action={handleUpdate} className="space-y-4">
              <input type="hidden" name="userId" value={editUser.id} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">{t("form.firstName")}</label>
                  <input name="firstName" type="text" required defaultValue={editUser.firstName ?? ""}
                    className="w-full px-3 py-2.5 bg-muted border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">{t("form.lastName")}</label>
                  <input name="lastName" type="text" defaultValue={editUser.lastName ?? ""}
                    className="w-full px-3 py-2.5 bg-muted border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t("form.email")}</label>
                <input name="email" type="email" required defaultValue={editUser.email}
                  className="w-full px-3 py-2.5 bg-muted border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t("form.role")}</label>
                <select name="role" defaultValue={editUser.role}
                  className="w-full px-3 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                  {roleOptions.filter((r) => r.canSelect).map((r) => (
                    <option key={r.value} value={r.value}>{t(`roles.${r.value}`)}</option>
                  ))}
                </select>
              </div>
              {error && (
                <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</p>
              )}
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setEditUser(null)}
                  className="px-4 py-2 text-sm font-medium text-foreground bg-muted rounded-lg hover:bg-accent transition-colors">
                  {t("form.cancel")}
                </button>
                <button type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors">
                  {t("form.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Temp Password Modal ─────────────────────────────────────────── */}
      {tempPassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
            <h2 className="text-lg font-semibold text-foreground mb-2">{t("tempPassword.title")}</h2>
            <p className="text-sm text-muted-foreground mb-4">{t("tempPassword.description")}</p>

            <div className="flex items-center gap-2 bg-muted border border-border rounded-lg p-3 mb-3">
              <code className="flex-1 text-sm font-mono text-foreground break-all">{tempPassword}</code>
              <button onClick={copyPassword}
                className="shrink-0 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors">
                {copied ? t("tempPassword.copied") : t("tempPassword.copy")}
              </button>
            </div>

            <p className="text-xs text-destructive mb-2">{t("tempPassword.warning")}</p>
            <p className="text-xs text-muted-foreground mb-4">
              {emailSent ? t("tempPassword.emailSent") : t("tempPassword.emailNotSent")}
            </p>

            <button
              onClick={() => { setTempPassword(null); setEmailSent(null); }}
              className="w-full py-2.5 px-4 bg-muted hover:bg-accent text-foreground font-medium text-sm rounded-lg transition-colors"
            >
              {t("tempPassword.close")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
