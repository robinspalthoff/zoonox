"use client";

/**
 * Soft warning Banner für Beleg-Duplikate.
 *
 * Pollt /api/documents/[id]/duplicates und zeigt einen Banner, falls ein
 * potenzielles Duplikat existiert. Kein hartes Blocking — Buchung bleibt
 * möglich, z.B. bei wiederkehrenden Rechnungen mit identischem Betrag.
 *
 * Re-poll bei status-Wechsel: solange der Beleg PENDING/PROCESSING ist,
 * existiert der Fingerprint noch nicht. Sobald die OCR fertig ist (DONE),
 * lohnt sich ein erneuter Fetch — deshalb wird der Status als Trigger
 * mitgegeben.
 *
 * UI-Styling: opacity-basierte amber-Tokens (`bg-amber-500/10`,
 * `text-amber-700 dark:text-amber-400`), genauso wie die anderen
 * Status-Badges in der Sidebar — funktioniert in light und dark Theme.
 *
 * Link öffnet in neuem Tab (`target="_blank"`): der zu prüfende Beleg
 * bleibt offen, User muss nicht zurück-navigieren.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ExternalLink } from "lucide-react";

type DuplicateMatch = {
  id: string;
  fileName: string;
  status: string;
  category: string | null;
  recognizedSupplier: string | null;
  recognizedAmount: string | null;
  recognizedDate: string | null;
  createdAt: string;
  kind: "exact" | "semantic";
};

export function DuplicateWarningBanner({
  documentId,
  status,
  locale,
  onExactMatchChange,
}: {
  documentId: string;
  status: string;
  locale: string;
  /**
   * Wird gerufen wenn sich der „exact match"-Status ändert. Die Sidebar
   * nutzt das, um beim Fertigstellen/Speichern einen Confirm-Dialog
   * einzublenden — semantic matches bleiben passiv (false-positive-Rate).
   */
  onExactMatchChange?: (hasExact: boolean) => void;
}) {
  const t = useTranslations("documents.detail.duplicates");
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  // Pulse-Effekt beim ersten Erscheinen, damit der Banner nicht übersehen
  // wird. Wird nach ~3.5s automatisch beendet, sonst lenkt es bei längerer
  // Bearbeitung ab.
  const [pulsing, setPulsing] = useState(false);
  const hasAppearedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${documentId}/duplicates`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { matches: DuplicateMatch[] };
        if (!cancelled) setMatches(data.matches ?? []);
      } catch {
        // Soft warning — Fehler beim Fetch werden bewusst stillschweigend
        // verworfen, der Beleg bleibt nutzbar.
      }
    })();
    return () => {
      cancelled = true;
    };
    // status als Dependency: nach OCR-Abschluss neu prüfen
  }, [documentId, status]);

  // Sidebar über exact-match informieren — Confirm-Dialog beim Save.
  const hasExact = matches.some((m) => m.kind === "exact");
  useEffect(() => {
    onExactMatchChange?.(hasExact);
  }, [hasExact, onExactMatchChange]);

  // Pulse einmalig triggern, sobald der Banner zum ersten Mal sichtbar wird.
  useEffect(() => {
    if (matches.length === 0 || hasAppearedRef.current) return;
    hasAppearedRef.current = true;
    setPulsing(true);
    const id = setTimeout(() => setPulsing(false), 3500);
    return () => clearTimeout(id);
  }, [matches.length]);

  if (matches.length === 0) return null;

  // Exact zuerst, falls vorhanden — sonst semantic.
  const primaryKind: "exact" | "semantic" = matches.some((m) => m.kind === "exact")
    ? "exact"
    : "semantic";
  const primary = matches.find((m) => m.kind === primaryKind)!;
  const additionalCount = matches.length - 1;

  const title = primaryKind === "exact" ? t("exactTitle") : t("semanticTitle");
  const hint = primaryKind === "exact" ? t("exactHint") : t("semanticHint");

  return (
    <div
      className={`rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs transition-shadow duration-500 ${
        pulsing
          ? "ring-2 ring-amber-500/60 shadow-[0_0_0_4px_rgba(245,158,11,0.15)] animate-pulse"
          : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-foreground">{title}</div>
          <div className="mt-1 text-muted-foreground leading-relaxed">{hint}</div>

          <a
            href={`/${locale}/dashboard/documents/${primary.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400 hover:underline"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {t("openExisting")}
            {additionalCount > 0 && (
              <span className="text-muted-foreground font-normal">
                ({t("andMore", { count: additionalCount })})
              </span>
            )}
          </a>
        </div>
      </div>
    </div>
  );
}
