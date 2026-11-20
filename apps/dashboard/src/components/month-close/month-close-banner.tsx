"use client";

import { useTranslations } from "next-intl";
import { Lock, Send } from "lucide-react";
import type { MonthCloseStatus } from "@prisma/client";

interface Props {
  status: MonthCloseStatus;
  monthLabel: string;
  year: number;
}

/**
 * Soft-Hinweis an Detail-Seiten (Belege, Rechnungen, Buchungen), deren
 * wirtschaftliches Datum in einem Monat liegt, der schon eingereicht
 * oder bereits abgeschlossen ist.
 */
export function MonthCloseBanner({ status, monthLabel, year }: Props) {
  const t = useTranslations("monthClose.banner");
  if (status === "OPEN") return null;

  if (status === "SUBMITTED") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[12px]">
        <Send className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-amber-700 dark:text-amber-400">
            {t("submittedTitle", { month: monthLabel, year })}
          </p>
          <p className="text-muted-foreground mt-0.5">{t("submittedDescription")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px]">
      <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
      <div>
        <p className="font-medium text-foreground">{t("closedTitle", { month: monthLabel, year })}</p>
        <p className="text-muted-foreground mt-0.5">{t("closedDescription")}</p>
      </div>
    </div>
  );
}

// `monthLabelFromDate` lebt jetzt in ./month-label, weil Next.js 16
// keinen Server-Aufruf einer aus einem "use client"-Modul exportierten
// Funktion mehr erlaubt. Importer ziehen sich den Helper direkt aus
// "@/components/month-close/month-label".
