"use client";

/**
 * ContactFormDialog
 * ─────────────────
 * Modal dialog for creating or editing a Contact (customer / supplier /
 * partner / other). Single source of truth for the contact form — reused
 * by the Contacts page, the contact detail page and the dashboard quick
 * action.
 *
 * Grunddaten / Ansprechperson / Notizen sind immer offen; Adresse,
 * Kontaktdetails und Zahlungsinformationen sind zugeklappte Toggles, damit
 * das Formular beim Anlegen nicht erschlägt.
 *
 * The action call lives in dashboard/contacts/actions.ts; this is a thin
 * shell over `upsertContact`.
 */

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import type { ContactRole } from "@prisma/client";
import { upsertContact, getNextCustomerNumber, getNextSupplierNumber } from "@/app/[locale]/dashboard/contacts/actions";
import { CountrySelect } from "@/components/ui/country-select";

const INPUT =
  "w-full px-3 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors";
const LABEL = "block text-sm font-medium text-foreground mb-1.5";
const SECTION = "text-xs font-semibold text-muted-foreground uppercase tracking-wider";

const ROLES: ContactRole[] = ["CUSTOMER", "SUPPLIER", "PARTNER", "OTHER"];
const SALUTATIONS = ["MR", "MRS", "DIVERSE"] as const;

export interface EditableContact {
  id: string;
  name: string;
  customerNumber: string | null;
  supplierNumber: string | null;
  roles: ContactRole[];
  contactSalutation: string | null;
  contactTitle: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactPosition: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  iban: string | null;
  bic: string | null;
  vatId: string | null;
  taxId: string | null;
  notes: string | null;
  paymentTermDays: number | null;
  discountDays: number | null;
  // Decimal kommt aus Prisma serialisiert als string über JSON-Roundtrip
  discountPercent: number | string | null;
}

interface Props {
  open: boolean;
  /** Existing contact for edit mode; omit / null for create. */
  editContact?: EditableContact | null;
  onClose: () => void;
  /**
   * Called after a successful save with the saved contact's id. Aufrufer wie
   * der Beleg-Sidebar nutzen das, um sofort eine Verknüpfung herzustellen.
   */
  onSaved?: (savedId: string) => void;
  /** Im Anlegen-Modus die Rolle vorauswählen (z.B. SUPPLIER aus Belegmodul). */
  presetRole?: ContactRole;
  /** Im Anlegen-Modus den Namen vorausfüllen (z.B. aus OCR-Treffer). */
  presetName?: string;
}

/** Zugeklappte Sektion — Inhalt bleibt im DOM (Felder werden weiter abgesendet). */
function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="border border-border rounded-lg">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full px-4 py-3"
      >
        <span className={SECTION}>{title}</span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div className={open ? "px-4 pb-4 space-y-4" : "hidden"}>{children}</div>
    </section>
  );
}

export function ContactFormDialog({
  open, editContact, onClose, onSaved, presetRole, presetName,
}: Props) {
  const t = useTranslations("contacts");
  const router = useRouter();
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  // Rolle: Einzelauswahl. Beim Edit aus dem Kontakt, beim Anlegen aus preset
  // (z.B. SUPPLIER vom Belegmodul) — Default Kunde.
  const [role, setRole] = useState<ContactRole>(
    editContact?.roles?.[0] ?? presetRole ?? "CUSTOMER",
  );
  // Kunden-/Lieferantennummer werden im Anlegen-Modus automatisch vorbefüllt.
  const [customerNumber, setCustomerNumber] = useState(editContact?.customerNumber ?? "");
  const [supplierNumber, setSupplierNumber] = useState(editContact?.supplierNumber ?? "");
  // Bump → Form wird neu gemountet (setzt unkontrollierte Felder + Toggles zurück).
  const [formKey, setFormKey] = useState(0);
  // "Speichern & neu" vs. "Speichern" — synchron via Ref.
  const saveAndNewRef = useRef(false);

  // Beim Öffnen Initial-Rolle aus den aktuellen Props übernehmen — wichtig
  // wenn der Dialog wiederverwendet wird und die preset-Rolle wechselt.
  useEffect(() => {
    if (!open) return;
    setRole(editContact?.roles?.[0] ?? presetRole ?? "CUSTOMER");
  }, [open, editContact, presetRole]);

  // Beim Anlegen: nächste freie Kunden-/Lieferantennummer vorbefüllen.
  useEffect(() => {
    if (!open || editContact) return;
    let cancelled = false;
    if (role === "CUSTOMER") {
      getNextCustomerNumber()
        .then((n) => { if (!cancelled) setCustomerNumber(n); })
        .catch(() => {});
    } else if (role === "SUPPLIER") {
      getNextSupplierNumber()
        .then((n) => { if (!cancelled) setSupplierNumber(n); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [open, editContact, role]);

  // ESC schließt den Dialog.
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(formData: FormData) {
    setError("");
    formData.append("roles", role);
    const result = await upsertContact(formData);
    if (!result.success) {
      setError(result.error);
      return;
    }
    if (saveAndNewRef.current && !editContact) {
      // Formular leeren und für den nächsten Kontakt offen lassen.
      setRole("CUSTOMER");
      setCustomerNumber("");
      setSupplierNumber("");
      getNextCustomerNumber().then(setCustomerNumber).catch(() => {});
      setFormKey((k) => k + 1);
      startTransition(() => router.refresh());
      return;
    }
    startTransition(() => router.refresh());
    onSaved?.(result.id);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl w-full max-w-2xl shadow-xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            {editContact ? t("editTitle") : t("newTitle")}
          </h2>
        </div>

        <form key={formKey} action={handleSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="overflow-y-auto px-6 py-5 space-y-6">
            {editContact && <input type="hidden" name="id" value={editContact.id} />}

            {/* ── Grunddaten ── */}
            <section className="space-y-4">
              <p className={SECTION}>{t("sections.basics")}</p>

              <div>
                <label className={LABEL}>{t("fields.roles")}</label>
                <div className="flex flex-wrap gap-2">
                  {ROLES.map((r) => {
                    const active = role === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRole(r)}
                        aria-pressed={active}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                          active
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {t(`roles.${r}`)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>{t("fields.name")} *</label>
                  <input
                    name="name"
                    required
                    defaultValue={editContact?.name ?? presetName ?? ""}
                    className={INPUT}
                    placeholder="Mustermann GmbH"
                    autoFocus
                  />
                </div>
                {role === "SUPPLIER" ? (
                  <div>
                    <label className={LABEL}>{t("fields.supplierNumber")} *</label>
                    <input
                      name="supplierNumber"
                      required
                      inputMode="numeric"
                      maxLength={5}
                      value={supplierNumber}
                      onChange={(e) => setSupplierNumber(e.target.value)}
                      className={INPUT}
                      placeholder="70001"
                    />
                    {/* customerNumber bleibt erhalten, falls Kontakt früher Kunde war */}
                    {customerNumber && (
                      <input type="hidden" name="customerNumber" value={customerNumber} />
                    )}
                  </div>
                ) : (
                  <div>
                    <label className={LABEL}>{t("fields.customerNumber")} *</label>
                    <input
                      name="customerNumber"
                      required={role === "CUSTOMER"}
                      inputMode="numeric"
                      maxLength={4}
                      value={customerNumber}
                      onChange={(e) => setCustomerNumber(e.target.value)}
                      className={INPUT}
                      placeholder="1001"
                    />
                    {supplierNumber && (
                      <input type="hidden" name="supplierNumber" value={supplierNumber} />
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* ── Ansprechperson ── */}
            <section className="space-y-4">
              <p className={SECTION}>{t("sections.contactPerson")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>{t("fields.salutation")}</label>
                  <select
                    name="contactSalutation"
                    defaultValue={editContact?.contactSalutation ?? ""}
                    className={INPUT}
                  >
                    <option value="">—</option>
                    {SALUTATIONS.map((s) => (
                      <option key={s} value={s}>{t(`salutations.${s}`)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>{t("fields.contactTitle")}</label>
                  <input name="contactTitle" defaultValue={editContact?.contactTitle ?? ""} className={INPUT} placeholder="Dr." />
                </div>
                <div>
                  <label className={LABEL}>{t("fields.contactFirstName")}</label>
                  <input name="contactFirstName" defaultValue={editContact?.contactFirstName ?? ""} className={INPUT} placeholder="Max" />
                </div>
                <div>
                  <label className={LABEL}>{t("fields.contactLastName")}</label>
                  <input name="contactLastName" defaultValue={editContact?.contactLastName ?? ""} className={INPUT} placeholder="Mustermann" />
                </div>
                <div className="sm:col-span-2">
                  <label className={LABEL}>{t("fields.contactPosition")}</label>
                  <input name="contactPosition" defaultValue={editContact?.contactPosition ?? ""} className={INPUT} placeholder={t("fields.contactPositionPlaceholder")} />
                </div>
              </div>
            </section>

            {/* ── Adresse (zugeklappt) ── */}
            <CollapsibleSection title={t("sections.address")}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={LABEL}>{t("fields.address")}</label>
                  <input name="address" defaultValue={editContact?.address ?? ""} className={INPUT} placeholder="Musterstraße 1" />
                </div>
                <div>
                  <label className={LABEL}>{t("fields.zip")}</label>
                  <input name="zip" defaultValue={editContact?.zip ?? ""} className={INPUT} placeholder="10115" />
                </div>
                <div>
                  <label className={LABEL}>{t("fields.city")}</label>
                  <input name="city" defaultValue={editContact?.city ?? ""} className={INPUT} placeholder="Berlin" />
                </div>
                <div className="sm:col-span-2">
                  <label className={LABEL}>{t("fields.country")}</label>
                  <CountrySelect name="country" defaultValue={editContact?.country ?? "DE"} />
                </div>
              </div>
            </CollapsibleSection>

            {/* ── Kontaktdetails (zugeklappt) ── */}
            <CollapsibleSection title={t("sections.contactDetails")}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>{t("fields.email")}</label>
                  <input name="email" type="email" defaultValue={editContact?.email ?? ""} className={INPUT} placeholder="info@firma.de" />
                </div>
                <div>
                  <label className={LABEL}>{t("fields.phone")}</label>
                  <input name="phone" defaultValue={editContact?.phone ?? ""} className={INPUT} placeholder="+49 30 12345678" />
                </div>
                <div className="sm:col-span-2">
                  <label className={LABEL}>{t("fields.website")}</label>
                  <input name="website" defaultValue={editContact?.website ?? ""} className={INPUT} placeholder="https://firma.de" />
                </div>
              </div>
            </CollapsibleSection>

            {/* ── Zahlungsinformationen (zugeklappt) ── */}
            <CollapsibleSection title={t("sections.payment")}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={LABEL}>{t("fields.iban")}</label>
                  <input name="iban" defaultValue={editContact?.iban ?? ""} className={INPUT} placeholder="DE89 3704 0044 0532 0130 00" />
                </div>
                <div>
                  <label className={LABEL}>{t("fields.bic")}</label>
                  <input name="bic" defaultValue={editContact?.bic ?? ""} className={INPUT} placeholder="DEUTDEDB" />
                </div>
                <div />
                <div>
                  <label className={LABEL}>{t("fields.vatId")}</label>
                  <input name="vatId" defaultValue={editContact?.vatId ?? ""} className={INPUT} placeholder="DE123456789" />
                </div>
                <div>
                  <label className={LABEL}>{t("fields.taxId")}</label>
                  <input name="taxId" defaultValue={editContact?.taxId ?? ""} className={INPUT} placeholder="12/345/67890" />
                </div>
                {/* ── Zahlungskonditionen ─────────────────────────────── */}
                <div className="sm:col-span-2 pt-2 mt-2 border-t border-border/50">
                  <p className="text-xs text-muted-foreground mb-3">{t("paymentTerms.hint")}</p>
                </div>
                <div>
                  <label className={LABEL}>{t("fields.paymentTermDays")}</label>
                  <input
                    name="paymentTermDays"
                    type="number"
                    min={0}
                    max={365}
                    defaultValue={editContact?.paymentTermDays ?? ""}
                    className={INPUT}
                    placeholder="14"
                  />
                </div>
                <div />
                <div>
                  <label className={LABEL}>{t("fields.discountDays")}</label>
                  <input
                    name="discountDays"
                    type="number"
                    min={0}
                    max={365}
                    defaultValue={editContact?.discountDays ?? ""}
                    className={INPUT}
                    placeholder="7"
                  />
                </div>
                <div>
                  <label className={LABEL}>{t("fields.discountPercent")}</label>
                  <input
                    name="discountPercent"
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    defaultValue={editContact?.discountPercent ?? ""}
                    className={INPUT}
                    placeholder="2.00"
                  />
                </div>
              </div>
            </CollapsibleSection>

            {/* ── Notizen ── */}
            <section className="space-y-4">
              <p className={SECTION}>{t("sections.notes")}</p>
              <textarea name="notes" rows={3} defaultValue={editContact?.notes ?? ""} className={INPUT} />
            </section>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3 justify-end px-6 py-4 border-t border-border bg-muted/20">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-foreground bg-muted rounded-lg hover:bg-accent transition-colors"
            >
              {t("cancel")}
            </button>
            {!editContact && (
              <button
                type="submit"
                disabled={isPending}
                onClick={() => { saveAndNewRef.current = true; }}
                className="px-4 py-2 text-sm font-medium text-primary border border-primary/30 bg-primary/10 rounded-lg hover:bg-primary/15 transition-colors disabled:opacity-50"
              >
                {t("saveAndNew")}
              </button>
            )}
            <button
              type="submit"
              disabled={isPending}
              onClick={() => { saveAndNewRef.current = false; }}
              className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {t("save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
