"use client";

/**
 * SupplierLinkPanel
 * ─────────────────
 * Sichtbar nur wenn der Beleg bereits mit einem Lieferanten verknüpft ist.
 * Zeigt die Verknüpfungs-Karte (Name + Lieferantennummer + Detail-Link) mit
 * einem X-Button zum Aufheben. Die Anlage neuer Lieferanten passiert über
 * das UserPlus-Icon neben dem Lieferanten-Inputfeld oben im Sidebar — nicht
 * mehr hier unten, damit der User nicht zwei parallele Eingabewege hat.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link as LinkIcon, X, ExternalLink } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { linkDocumentContact } from "../actions";

interface Props {
  documentId: string;
  currentContact: { id: string; name: string; supplierNumber: string | null } | null;
}

export function SupplierLinkPanel({ documentId, currentContact }: Props) {
  const t = useTranslations("documents.supplierLink");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Ohne Verknüpfung blenden wir den Slot komplett aus — das vermeidet
  // OCR-Hint-Verwirrung. Anlegen geht über das Icon oben.
  if (!currentContact) return null;

  function handleUnlink() {
    startTransition(async () => {
      await linkDocumentContact(documentId, null);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20">
      <div className="flex items-center gap-2 min-w-0">
        <LinkIcon className="w-4 h-4 text-primary shrink-0" />
        <div className="min-w-0">
          <Link
            href={`/dashboard/contacts/${currentContact.id}`}
            className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate inline-flex items-center gap-1"
          >
            {currentContact.name}
            <ExternalLink className="w-3 h-3 opacity-60" />
          </Link>
          {currentContact.supplierNumber && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {t("supplierNo")} {currentContact.supplierNumber}
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={handleUnlink}
        title={t("unlink")}
        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
