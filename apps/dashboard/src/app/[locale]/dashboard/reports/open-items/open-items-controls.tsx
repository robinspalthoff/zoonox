"use client";

/**
 * Filter- und Druckleiste für die OPOS-Auswertung.
 *
 * Beide Filter (Modus + Kontakt) werden direkt als Query-Parameter in die URL
 * geschrieben — die Server-Page liest sie und rendert neu. Drucken nutzt
 * window.print(); die @media-print Regeln in der Page blenden alles aus, was
 * nicht zum Bericht gehört.
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { useTransition } from "react";

export type OposMode = "RECEIVABLES" | "PAYABLES" | "BOTH";

export interface ContactOption {
  id: string;
  name: string;
  identifier: string | null; // customerNumber or supplierNumber
}

interface Props {
  mode: OposMode;
  contactId: string | null;
  contactOptions: ContactOption[];
}

export function OpenItemsControls({ mode, contactId, contactOptions }: Props) {
  const t = useTranslations("reports.openItems");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (value && value.length > 0) next.set(key, value);
    else next.delete(key);
    // Wechsel des Modus invalidiert den Kontaktfilter, weil sich die Liste
    // möglicher Kontakte sonst nicht mehr deckt.
    if (key === "mode") next.delete("contactId");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  const SELECT =
    "h-9 px-2.5 rounded-lg border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors";

  return (
    <div className="flex flex-wrap items-end gap-3 no-print">
      <div className="space-y-1">
        <label className="block text-xs font-medium text-muted-foreground">
          {t("mode.label")}
        </label>
        <select
          value={mode}
          onChange={(e) => setParam("mode", e.target.value)}
          disabled={pending}
          className={SELECT}
        >
          <option value="RECEIVABLES">{t("mode.RECEIVABLES")}</option>
          <option value="PAYABLES">{t("mode.PAYABLES")}</option>
          <option value="BOTH">{t("mode.BOTH")}</option>
        </select>
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-muted-foreground">
          {t("contactFilter.label")}
        </label>
        <select
          value={contactId ?? ""}
          onChange={(e) => setParam("contactId", e.target.value || null)}
          disabled={pending || contactOptions.length === 0}
          className={SELECT}
        >
          <option value="">{t("contactFilter.all")}</option>
          {contactOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.identifier ? `${c.identifier} — ${c.name}` : c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="ml-auto">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-card hover:bg-muted text-sm text-foreground transition-colors"
        >
          <Printer className="w-4 h-4" />
          {t("print")}
        </button>
      </div>
    </div>
  );
}
