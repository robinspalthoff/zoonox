"use client";

// "Abschreibung" section rendered in the document detail sidebar.
//
// Three states:
//   1. Document is finalized (DONE / PAID)        → locked hint, no controls.
//   2. Document already linked to a FixedAsset    → link to the asset page.
//   3. Document is editable + no asset yet        → toggle "Als Anlage behandeln"
//      + Nutzungsdauer (Jahre) + Kategorie. Clicking submit calls the server
//      action which:
//        a) creates the FixedAsset (with PLANNED status)
//        b) posts the acquisition entry to the journal (replacing the would-be
//           expense booking the document booking would otherwise emit)
//        c) leaves the document in its current draft/pending state so the user
//           can still tweak fields before committing it.
//
// OCR hint banner: if no asset is linked yet and the recognised net amount
// exceeds ASSET_HINT_NET_THRESHOLD (250 €), surface a non-intrusive hint
// telling the user this *could* be an asset.

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { Boxes, Lock, ArrowRight, Info } from "lucide-react";
import type { FixedAssetCategory, TaxMode } from "@prisma/client";
import { createAssetAction } from "../assets/actions";

const ASSET_HINT_NET_THRESHOLD = 250;
const GWG_NET_THRESHOLD = 800;

const CATEGORIES: FixedAssetCategory[] = [
  "TANGIBLE",
  "IT_HARDWARE",
  "IT_SOFTWARE",
  "VEHICLE",
  "MACHINERY",
  "BUILDING",
  "INTANGIBLE",
  "OTHER",
];

const DEFAULT_YEARS_BY_CATEGORY: Record<FixedAssetCategory, number> = {
  TANGIBLE: 13,
  IT_HARDWARE: 3,
  IT_SOFTWARE: 3,
  VEHICLE: 6,
  MACHINERY: 8,
  BUILDING: 33,
  INTANGIBLE: 5,
  OTHER: 10,
};

export interface AssetTogglePanelProps {
  documentId: string;
  isFinalized: boolean;
  linkedAsset: { id: string; assetNumber: string; name: string } | null;
  recognizedAmount: string | null;
  recognizedDate: string | null;
  recognizedSupplier: string | null;
  vatRate: string | null;
  /**
   * Steuerstatus des Tenants. Bei Kleinunternehmer (§19 UStG) gibt es keinen
   * VSt-Abzug — die AfA-Basis ist der Bruttobetrag. Wir ziehen daher den
   * VAT-Anteil im Netto-Cap nicht ab.
   */
  taxMode: TaxMode;
}

export function AssetTogglePanel(props: AssetTogglePanelProps) {
  const t = useTranslations("assets.documentToggle");
  const tcat = useTranslations("assets.category");
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [category, setCategory] = useState<FixedAssetCategory>("IT_HARDWARE");
  const [years, setYears] = useState<string>(String(DEFAULT_YEARS_BY_CATEGORY.IT_HARDWARE));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isSmallBusiness = props.taxMode === "SMALL_BUSINESS";
  const gross = props.recognizedAmount ? parseFloat(props.recognizedAmount) : 0;
  const rate = isSmallBusiness ? 0 : (props.vatRate ? parseFloat(props.vatRate) : 0);
  // Kleinunternehmer: AfA-Basis = brutto, kein VSt-Abzug.
  const net = gross > 0 ? (isSmallBusiness ? gross : gross / (1 + rate / 100)) : 0;
  const showOcrHint = !props.linkedAsset && !props.isFinalized && net > ASSET_HINT_NET_THRESHOLD;
  const isGwg = net > 0 && net <= GWG_NET_THRESHOLD;

  const monthsForSubmit = useMemo(() => {
    const y = parseInt(years, 10) || 0;
    return Math.max(y * 12, 1);
  }, [years]);

  function onCategory(c: FixedAssetCategory) {
    setCategory(c);
    setYears(String(DEFAULT_YEARS_BY_CATEGORY[c]));
  }

  function submit() {
    setError(null);
    if (!(gross > 0)) {
      setError("Bruttobetrag fehlt — Beleg-Betrag eintragen.");
      return;
    }
    startTransition(async () => {
      const res = await createAssetAction({
        name: props.recognizedSupplier?.trim() || "Anlage",
        description: null,
        category,
        method: isGwg ? "IMMEDIATE" : "LINEAR",
        acquisitionDate: props.recognizedDate ?? new Date().toISOString(),
        acquisitionCost: gross,
        vatRate: rate,
        usefulLifeMonths: isGwg ? 1 : monthsForSubmit,
        scrapValue: 0,
        documentId: props.documentId,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  // ── Render ────────────────────────────────────────────────────────────

  // State 2: already linked
  if (props.linkedAsset) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Boxes className="w-3.5 h-3.5" /> {t("title")}
        </div>
        <div className="text-xs text-muted-foreground">{t("linked")}</div>
        <Link
          href={`/dashboard/documents/assets/${props.linkedAsset.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <span className="font-mono text-xs">{props.linkedAsset.assetNumber}</span>
          <span>·</span>
          <span>{props.linkedAsset.name}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    );
  }

  // State 1: finalized — locked
  if (props.isFinalized) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Boxes className="w-3.5 h-3.5" /> {t("title")}
        </div>
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{t("lockedHint")}</span>
        </div>
      </div>
    );
  }

  // State 3: editable, can be toggled
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Boxes className="w-3.5 h-3.5" /> {t("title")}
      </div>

      {showOcrHint && !enabled && (
        <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-2 text-xs text-foreground">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
          <span>{t("ocrHint")}</span>
        </div>
      )}

      <label className="flex items-center justify-between gap-3 cursor-pointer">
        <div>
          <div className="text-sm font-medium text-foreground">{t("treatAsAsset")}</div>
          <div className="text-[11px] text-muted-foreground leading-snug">
            {t("treatAsAssetHint")}
          </div>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-border accent-primary"
        />
      </label>

      {enabled && (
        <div className="space-y-2.5 pt-1 border-t border-border/60">
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">
              {t("category")}
            </label>
            <select
              value={category}
              onChange={(e) => onCategory(e.target.value as FixedAssetCategory)}
              className="w-full px-2.5 py-1.5 bg-muted border border-border rounded-lg text-xs"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {tcat(c.toLowerCase())}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">
              {t("usefulLifeYears")}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                value={years}
                onChange={(e) => setYears(e.target.value)}
                disabled={isGwg}
                className="w-20 px-2.5 py-1.5 bg-muted border border-border rounded-lg text-xs"
              />
              <span className="text-xs text-muted-foreground">{t("yearsUnit")}</span>
              {isGwg && (
                <span className="text-[11px] text-muted-foreground italic">
                  GWG · Sofortabschreibung
                </span>
              )}
            </div>
          </div>
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
              {error}
            </div>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="w-full px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {pending ? "…" : t("createOnSave")}
          </button>
        </div>
      )}
    </div>
  );
}
