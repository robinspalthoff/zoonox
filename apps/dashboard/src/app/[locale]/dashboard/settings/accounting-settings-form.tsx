"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, Info } from "lucide-react";
import { saveCompanySettings } from "./actions";

interface AccountingData {
  senderName: string | null;
  senderEmail: string | null;
  defaultNotes: string | null;
  defaultIntroText: string | null;
  taxMode: string;
  skrType: string;
  profitLossMethod: string;
}

const INPUT =
  "w-full px-3 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors";
const LABEL = "block text-sm font-medium text-foreground mb-1.5";
const SECTION = "text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4";

export function AccountingSettingsForm({ settings }: { settings: AccountingData | null }) {
  const t = useTranslations("settings.company");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [taxMode, setTaxMode] = useState<string>(settings?.taxMode ?? "STANDARD");
  const [skrType, setSkrType] = useState<string>(settings?.skrType ?? "SKR03");
  const [profitLossMethod, setProfitLossMethod] = useState<string>(
    settings?.profitLossMethod ?? "EUR",
  );

  function handleSubmit(formData: FormData) {
    formData.set("taxMode", taxMode);
    formData.set("skrType", skrType);
    formData.set("profitLossMethod", profitLossMethod);
    startTransition(async () => {
      await saveCompanySettings(formData);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  }

  return (
    <form action={handleSubmit} className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-6 space-y-8">
        {/* ── Besteuerungsart ── */}
        <section>
          <p className={SECTION}>{t("sections.taxMode")}</p>
          <div className="space-y-2 max-w-lg">
            {(["STANDARD", "SMALL_BUSINESS"] as const).map((mode) => (
              <div
                key={mode}
                onClick={() => setTaxMode(mode)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-colors border ${
                  taxMode === mode ? "bg-primary/10 border-primary/30" : "border-border hover:bg-muted"
                }`}
              >
                <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                  taxMode === mode ? "border-primary" : "border-muted-foreground/40"
                }`}>
                  {taxMode === mode && <span className="w-2 h-2 rounded-full bg-primary" />}
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">{t(`taxMode.${mode}`)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t(`taxModeHint.${mode}`)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Kontenrahmen ── */}
        <section>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            {t("skrType")}
          </p>
          <p className="text-sm text-muted-foreground mb-4">{t("skrTypeHint")}</p>
          <div className="space-y-2 max-w-lg">
            {(["SKR03", "SKR04"] as const).map((type) => (
              <div
                key={type}
                onClick={() => setSkrType(type)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-colors border ${
                  skrType === type ? "bg-primary/10 border-primary/30" : "border-border hover:bg-muted"
                }`}
              >
                <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                  skrType === type ? "border-primary" : "border-muted-foreground/40"
                }`}>
                  {skrType === type && <span className="w-2 h-2 rounded-full bg-primary" />}
                </span>
                <p className="text-sm font-medium text-foreground">{t(`skr.${type}`)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Berechnungsart der Auswertung (EÜR / GuV) ── */}
        <section>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 inline-flex items-center gap-1.5">
            {t("profitLossMethod.title")}
            <MethodInfoTooltip text={t("profitLossMethod.info")} />
          </p>
          <p className="text-sm text-muted-foreground mb-4">{t("profitLossMethod.hint")}</p>
          <div className="space-y-2 max-w-lg">
            {(["EUR", "GUV"] as const).map((method) => (
              <div
                key={method}
                onClick={() => setProfitLossMethod(method)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-colors border ${
                  profitLossMethod === method ? "bg-primary/10 border-primary/30" : "border-border hover:bg-muted"
                }`}
              >
                <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                  profitLossMethod === method ? "border-primary" : "border-muted-foreground/40"
                }`}>
                  {profitLossMethod === method && <span className="w-2 h-2 rounded-full bg-primary" />}
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">{t(`profitLossMethod.${method}`)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t(`profitLossMethod.desc.${method}`)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Rechnungseinstellungen ── */}
        <section>
          <p className={SECTION}>{t("sections.invoices")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={LABEL}>{t("senderName")}</label>
              <input name="senderName" defaultValue={settings?.senderName ?? ""} className={INPUT} placeholder="Accounting Team | Zoonox" />
              <p className="text-xs text-muted-foreground mt-1">{t("senderNameHint")}</p>
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL}>{t("senderEmail")}</label>
              <input name="senderEmail" type="email" defaultValue={settings?.senderEmail ?? ""} className={INPUT} placeholder="rechnungen@firma.de" />
              <p className="text-xs text-muted-foreground mt-1">{t("senderEmailHint")}</p>
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL}>{t("defaultIntroText")}</label>
              <textarea
                name="defaultIntroText"
                rows={4}
                defaultValue={settings?.defaultIntroText ?? ""}
                className={INPUT}
                placeholder={t("defaultIntroTextPlaceholder")}
              />
              <p className="text-xs text-muted-foreground mt-1">{t("defaultIntroTextHint")}</p>
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL}>{t("defaultNotes")}</label>
              <textarea
                name="defaultNotes"
                rows={3}
                defaultValue={settings?.defaultNotes ?? ""}
                className={INPUT}
                placeholder={t("defaultNotesPlaceholder")}
              />
            </div>
          </div>
        </section>
      </div>

      <div className="px-6 py-4 border-t border-border bg-muted/20 flex items-center gap-4">
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

function MethodInfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  function handleEnter() {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setStyle({
      position: "fixed",
      top: r.top - 8,
      left: Math.min(r.left + r.width / 2, window.innerWidth - 200),
      transform: "translate(-50%, -100%)",
    });
    setShow(true);
  }

  return (
    <span
      ref={ref}
      className="inline-flex align-middle shrink-0 normal-case"
      onMouseEnter={handleEnter}
      onMouseLeave={() => setShow(false)}
    >
      <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
      {show && (
        <span
          className="w-96 rounded-lg bg-card border border-border text-xs text-muted-foreground px-3 py-2.5 shadow-xl leading-relaxed pointer-events-none whitespace-pre-line tracking-normal font-normal"
          style={{ ...style, zIndex: 9999 }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
