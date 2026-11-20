"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { InfoTooltip } from "@/components/info-tooltip";
import { DatevExportDialog } from "./datev-export-dialog";

type Props = {
  defaultFiscalYearStart: string;
  defaultDateFrom: string;
  defaultDateTo: string;
};

export function DatevExportCard({
  defaultFiscalYearStart,
  defaultDateFrom,
  defaultDateTo,
}: Props) {
  const t = useTranslations("taxes.taxAdvisor");
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary">
            <Download className="w-5 h-5" />
          </span>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            {t("datevTitle")}
            <InfoTooltip content={t("datevDescription")} />
          </h3>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 self-start"
        >
          <Download className="w-4 h-4" />
          {t("datevButton")}
        </button>
      </div>

      {open && (
        <DatevExportDialog
          defaultFiscalYearStart={defaultFiscalYearStart}
          defaultDateFrom={defaultDateFrom}
          defaultDateTo={defaultDateTo}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
