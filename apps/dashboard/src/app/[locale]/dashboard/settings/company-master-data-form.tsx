"use client";

import { useState, useTransition, useRef } from "react";
import { useTranslations } from "next-intl";
import { Upload, X, Check, Info } from "lucide-react";
import { saveCompanySettings } from "./actions";
import { CountrySelect } from "@/components/ui/country-select";

interface CompanyMasterData {
  name: string | null;
  nameSuffix: string | null;
  ownerName: string | null;
  managingDirector: string | null;
  legalForm: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  taxId: string | null;
  vatId: string | null;
  registerCourt: string | null;
  registerNumber: string | null;
  bankName: string | null;
  iban: string | null;
  bic: string | null;
  logoBase64: string | null;
}

// Stabile Codes für die Rechtsform-Kategorie. Die Anzeige-Labels kommen
// aus den Übersetzungen — der gespeicherte Wert bleibt sprachunabhängig.
const LEGAL_FORM_CODES = [
  "SELF_EMPLOYED",
  "SOLE_PROPRIETOR",
  "PARTNERSHIP",
  "NON_PROFIT",
  "PRIVATE_COMPANY",
  "CORPORATION",
] as const;

// Bei diesen Rechtsformen heißt die verantwortliche Person "Inhaber",
// bei allen anderen (inkl. "keine Auswahl") "Geschäftsführer".
const OWNER_LEGAL_FORMS = ["SELF_EMPLOYED", "SOLE_PROPRIETOR"];

const INPUT =
  "w-full px-3 py-2.5 bg-muted border rounded-lg text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors";
const INPUT_BASE = `${INPUT} border-border`;
const LABEL = "block text-sm font-medium text-foreground mb-1.5";

function Req() {
  return <span className="text-destructive"> *</span>;
}

/** Eine Settings-Sektion: Titel + Beschreibung links, Eingabe-Karte rechts. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-3 py-8">
      <div className="lg:col-span-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{description}</p>
      </div>
      <div className="lg:col-span-2">
        <div className="bg-card border border-border rounded-xl p-5">{children}</div>
      </div>
    </div>
  );
}

export function CompanyMasterDataForm({ settings }: { settings: CompanyMasterData | null }) {
  const t = useTranslations("settings.company");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [logo, setLogo] = useState<string | null>(settings?.logoBase64 ?? null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Rechtsform steuert das Label des verantwortliche-Person-Feldes.
  const [legalForm, setLegalForm] = useState<string>(settings?.legalForm ?? "");
  const isOwner = OWNER_LEGAL_FORMS.includes(legalForm);
  // Startwert: bevorzugt die zur Rechtsform passende Spalte, sonst die andere
  // (für Altdaten, bei denen nur eine der beiden Spalten gefüllt ist).
  const [person, setPerson] = useState<string>(
    (OWNER_LEGAL_FORMS.includes(settings?.legalForm ?? "")
      ? settings?.ownerName ?? settings?.managingDirector
      : settings?.managingDirector ?? settings?.ownerName) ?? "",
  );

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_024 * 1_024) { alert("Logo max. 1 MB"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setLogo(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function handleSubmit(formData: FormData) {
    // Logo immer mitsenden (leerer String = entfernt), damit das
    // Teilformular es per partial-update löschen statt erhalten kann.
    formData.set("logoBase64", logo ?? "");
    // Verantwortliche Person in die zur Rechtsform passende Spalte
    // schreiben, die andere leeren — es bleibt genau ein Wert bestehen.
    formData.set("ownerName", isOwner ? person : "");
    formData.set("managingDirector", isOwner ? "" : person);
    startTransition(async () => {
      await saveCompanySettings(formData);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  }

  return (
    <form action={handleSubmit}>
      {/* Hinweis zu Pflichtangaben */}
      <div
        data-onboarding="company-form"
        className="flex gap-3 bg-muted/40 border border-border rounded-xl p-4"
      >
        <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-sm text-muted-foreground leading-relaxed">{t("requiredNotice")}</p>
      </div>

      <div className="divide-y divide-border">
        {/* ── Firma ── */}
        <Section title={t("sections.company")} description={t("sectionsHint.company")}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>{t("name")}<Req /></label>
              <input name="name" required defaultValue={settings?.name ?? ""} className={INPUT_BASE} placeholder={t("name")} />
            </div>
            <div>
              <label className={LABEL}>{t("nameSuffix")}</label>
              <input name="nameSuffix" defaultValue={settings?.nameSuffix ?? ""} className={INPUT_BASE} placeholder={t("nameSuffixPlaceholder")} />
              <p className="text-xs text-muted-foreground mt-1">{t("nameSuffixHint")}</p>
            </div>
            <div>
              <label className={LABEL}>{t("legalForm")}</label>
              <select
                name="legalForm"
                value={legalForm}
                onChange={(e) => setLegalForm(e.target.value)}
                className={INPUT_BASE}
              >
                <option value="">{t("legalForms.none")}</option>
                {LEGAL_FORM_CODES.map((code) => (
                  <option key={code} value={code}>{t(`legalForms.${code}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>
                {isOwner ? t("ownerName") : t("managingDirector")}<Req />
              </label>
              <input
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                required
                className={INPUT_BASE}
                placeholder={t("ownerNamePlaceholder")}
              />
            </div>
          </div>
        </Section>

        {/* ── Adresse ── */}
        <Section title={t("sections.address")} description={t("sectionsHint.address")}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={LABEL}>{t("address")}<Req /></label>
              <input name="address" required defaultValue={settings?.address ?? ""} className={INPUT_BASE} placeholder="Musterstraße 1" />
            </div>
            <div>
              <label className={LABEL}>{t("zip")}</label>
              <input name="zip" defaultValue={settings?.zip ?? ""} className={INPUT_BASE} placeholder="10115" />
            </div>
            <div>
              <label className={LABEL}>{t("city")}</label>
              <input name="city" defaultValue={settings?.city ?? ""} className={INPUT_BASE} placeholder="Berlin" />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL}>{t("country")}</label>
              <CountrySelect name="country" defaultValue={settings?.country ?? "DE"} />
            </div>
          </div>
        </Section>

        {/* ── Steuer- und Registernummern ── */}
        <Section title={t("sections.taxes")} description={t("sectionsHint.taxes")}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>{t("vatId")}</label>
              <input name="vatId" defaultValue={settings?.vatId ?? ""} className={INPUT_BASE} placeholder="DE123456789" />
            </div>
            <div>
              <label className={LABEL}>{t("taxId")}</label>
              <input name="taxId" defaultValue={settings?.taxId ?? ""} className={INPUT_BASE} placeholder="12/345/67890" />
            </div>
            <div>
              <label className={LABEL}>{t("registerCourt")}</label>
              <input name="registerCourt" defaultValue={settings?.registerCourt ?? ""} className={INPUT_BASE} placeholder="Amtsgericht Berlin-Charlottenburg" />
            </div>
            <div>
              <label className={LABEL}>{t("registerNumber")}</label>
              <input name="registerNumber" defaultValue={settings?.registerNumber ?? ""} className={INPUT_BASE} placeholder="HRB 12345" />
            </div>
          </div>
        </Section>

        {/* ── Kontaktinformationen ── */}
        <Section title={t("sections.contact")} description={t("sectionsHint.contact")}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>{t("email")}</label>
              <input name="email" type="email" defaultValue={settings?.email ?? ""} className={INPUT_BASE} placeholder="info@firma.de" />
            </div>
            <div>
              <label className={LABEL}>{t("phone")}</label>
              <input name="phone" defaultValue={settings?.phone ?? ""} className={INPUT_BASE} placeholder="+49 30 12345678" />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL}>{t("website")}</label>
              <input name="website" defaultValue={settings?.website ?? ""} className={INPUT_BASE} placeholder="https://firma.de" />
            </div>
          </div>
        </Section>

        {/* ── Zahlungsinformationen ── */}
        <Section title={t("sections.bank")} description={t("sectionsHint.bank")}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-3">
              <label className={LABEL}>{t("bankName")}</label>
              <input name="bankName" defaultValue={settings?.bankName ?? ""} className={INPUT_BASE} placeholder="Deutsche Bank" />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL}>{t("iban")}</label>
              <input name="iban" defaultValue={settings?.iban ?? ""} className={INPUT_BASE} placeholder="DE89 3704 0044 0532 0130 00" />
            </div>
            <div>
              <label className={LABEL}>{t("bic")}</label>
              <input name="bic" defaultValue={settings?.bic ?? ""} className={INPUT_BASE} placeholder="DEUTDEDB" />
            </div>
          </div>
        </Section>

        {/* ── Logo ── */}
        <Section title={t("sections.logo")} description={t("sectionsHint.logo")}>
          <div className="flex items-start gap-4">
            {logo ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logo}
                  alt="Logo"
                  className="h-16 w-auto max-w-[160px] object-contain rounded-lg border border-border bg-muted"
                />
                <button
                  type="button"
                  onClick={() => { setLogo(null); if (fileRef.current) fileRef.current.value = ""; }}
                  className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2.5 bg-muted border border-dashed border-border rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Upload className="w-4 h-4" />
                {t("logoUpload")}
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" onChange={handleLogoChange} className="hidden" />
            {logo && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                {t("logoReplace")}
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-3">{t("logoHint")}</p>
        </Section>
      </div>

      {/* Speichern */}
      <div className="flex items-center gap-4 pt-6 border-t border-border">
        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {isPending ? t("saving") : t("save")}
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-success">
            <Check className="w-4 h-4" />
            {t("saved")}
          </span>
        )}
      </div>
    </form>
  );
}
