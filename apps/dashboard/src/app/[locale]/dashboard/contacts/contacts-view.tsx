"use client";

import { useState, useMemo, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { UserPlus, Pencil, ShieldOff, ShieldCheck, Users, MoreHorizontal, Trash2, AlertTriangle } from "lucide-react";
import type { ContactRole } from "@prisma/client";
import { toggleContactActive, deleteContact } from "./actions";
import { ContactFormDialog, type EditableContact } from "@/components/contacts/contact-form-dialog";

interface ContactRow extends EditableContact {
  isActive: boolean;
  _count: { invoices: number };
}

const ROLE_BADGE: Record<ContactRole, string> = {
  CUSTOMER: "bg-primary/10 text-primary",
  SUPPLIER: "bg-amber-500/10 text-amber-500",
  PARTNER: "bg-violet-500/10 text-violet-400",
  OTHER: "bg-slate-500/10 text-slate-400",
};

const FILTERS: (ContactRole | "ALL")[] = ["ALL", "CUSTOMER", "SUPPLIER", "PARTNER", "OTHER"];

export function ContactsView({ contacts }: { contacts: ContactRow[] }) {
  const t = useTranslations("contacts");
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editContact, setEditContact] = useState<ContactRow | null>(null);
  const [filter, setFilter] = useState<ContactRole | "ALL">("ALL");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ContactRow | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const visible = useMemo(
    () => (filter === "ALL" ? contacts : contacts.filter((c) => c.roles.includes(filter))),
    [contacts, filter],
  );

  function openNew() { setEditContact(null); setShowForm(true); }
  function openEdit(c: ContactRow) { setEditContact(c); setShowForm(true); }
  function closeForm() { setShowForm(false); setEditContact(null); }

  function closeMenu() {
    setOpenMenuId(null);
    setMenuPosition(null);
  }

  async function handleToggle(id: string) {
    await toggleContactActive(id);
    startTransition(() => router.refresh());
  }

  function requestDelete(c: ContactRow) {
    closeMenu();
    setConfirmDelete(c);
  }

  async function confirmDeleteAction() {
    if (!confirmDelete) return;
    const c = confirmDelete;
    setConfirmDelete(null);
    const res = await deleteContact(c.id);
    if (!res.success) {
      setErrorMessage(
        res.error === "HAS_INVOICES" ? t("delete.hasInvoices") : (res.error ?? "")
      );
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
        </div>
        <button onClick={openNew}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors">
          <UserPlus className="w-4 h-4" />
          {t("new")}
        </button>
      </div>

      {/* Rollen-Filter */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              filter === f
                ? "bg-primary/10 border-primary/30 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {f === "ALL" ? t("filter.all") : t(`roles.${f}`)}
          </button>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.name")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.customerNumber")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.supplierNumber")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.roles")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.email")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.phone")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.city")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.invoices")}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t("table.status")}</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  {t("empty")}
                </td></tr>
              ) : visible.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <a href={`/dashboard/contacts/${c.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                      {c.name}
                    </a>
                    {[c.contactFirstName, c.contactLastName].filter(Boolean).length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {[c.contactFirstName, c.contactLastName].filter(Boolean).join(" ")}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground tabular-nums">{c.customerNumber ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground tabular-nums">{c.supplierNumber ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.roles.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : c.roles.map((r) => (
                        <span key={r} className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${ROLE_BADGE[r]}`}>
                          {t(`roles.${r}`)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-foreground">{c.email ?? "—"}</td>
                  <td className="px-4 py-3 text-foreground">{c.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.city ? `${c.zip ? c.zip + " " : ""}${c.city}` : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c._count.invoices}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${c.isActive ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                      {c.isActive ? t("status.active") : t("status.inactive")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="relative flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(c)} title={t("actions.edit")}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleToggle(c.id)}
                        title={c.isActive ? t("actions.deactivate") : t("actions.activate")}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        {c.isActive ? <ShieldOff className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={(e) => {
                          if (openMenuId === c.id) {
                            closeMenu();
                          } else {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setMenuPosition({
                              top: rect.bottom + window.scrollY + 4,
                              right: window.innerWidth - rect.right,
                            });
                            setOpenMenuId(c.id);
                          }
                        }}
                        title={t("table.actions")}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dropdown-Menü: fixed positioniert, außerhalb jedes overflow-Containers */}
      {openMenuId && menuPosition && (() => {
        const c = visible.find((x) => x.id === openMenuId);
        if (!c) return null;
        return (
          <>
            <div className="fixed inset-0 z-10" onClick={closeMenu} />
            <div
              className="fixed z-20 min-w-[150px] bg-card border border-border rounded-lg shadow-lg py-1"
              style={{ top: menuPosition.top, right: menuPosition.right }}
            >
              <button
                onClick={() => requestDelete(c)}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-destructive hover:bg-muted transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t("actions.delete")}
              </button>
            </div>
          </>
        );
      })()}

      {/* Bestätigungs-Dialog: Löschen */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} />
          <div className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-destructive/10">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-foreground">
                  {t("delete.title")}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("delete.confirm", { name: confirmDelete.name })}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
              >
                {t("actions.cancel")}
              </button>
              <button
                onClick={confirmDeleteAction}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-destructive hover:bg-destructive/90 text-white transition-colors"
              >
                {t("actions.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fehler-Dialog (z. B. HAS_INVOICES) */}
      {errorMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setErrorMessage(null)} />
          <div className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-destructive/10">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-foreground">
                  {t("delete.errorTitle")}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{errorMessage}</p>
              </div>
            </div>
            <div className="flex justify-end mt-6">
              <button
                onClick={() => setErrorMessage(null)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
              >
                {t("actions.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      <ContactFormDialog
        open={showForm}
        editContact={editContact}
        onClose={closeForm}
      />
    </div>
  );
}
