"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Plus, ChevronDown, Repeat, FileText } from "lucide-react";

/**
 * Split-button: main click goes to /invoices/new; the chevron opens a popover
 * with extra options (currently: "Wiederkehrende Rechnung"). Keeps the most
 * common action one click away while making related actions discoverable.
 */
export function NewInvoiceSplitButton() {
  const t = useTranslations("invoices");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const closeEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeEsc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeEsc);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <Link
        href="/dashboard/invoices/new"
        className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-l-lg transition-colors"
      >
        <Plus className="w-4 h-4" />
        {t("new")}
      </Link>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("newMenu.label")}
        className="inline-flex items-center px-2 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-r-lg border-l border-white/20 transition-colors"
      >
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-72 bg-card border border-border rounded-lg shadow-lg overflow-hidden z-30"
        >
          <Link
            href="/dashboard/invoices/new"
            onClick={() => setOpen(false)}
            role="menuitem"
            className="flex items-start gap-3 px-3 py-2.5 hover:bg-muted transition-colors text-left"
          >
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 text-primary shrink-0">
              <FileText className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{t("newMenu.oneOff.title")}</p>
              <p className="text-xs text-muted-foreground">{t("newMenu.oneOff.description")}</p>
            </div>
          </Link>
          <Link
            href="/dashboard/invoices/recurring/new"
            onClick={() => setOpen(false)}
            role="menuitem"
            className="flex items-start gap-3 px-3 py-2.5 hover:bg-muted transition-colors text-left border-t border-border"
          >
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 text-primary shrink-0">
              <Repeat className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{t("newMenu.recurring.title")}</p>
              <p className="text-xs text-muted-foreground">
                {t("newMenu.recurring.description")}
              </p>
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}
