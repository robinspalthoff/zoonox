"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import type { FixedAssetCategory, FixedAssetMethod, SkrType, TaxMode } from "@prisma/client";
import { createAssetAction } from "../actions";
import { AssetReceiptUpload } from "../asset-receipt-upload";

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

const METHODS: FixedAssetMethod[] = ["LINEAR", "IMMEDIATE"];

// Default useful life per category (years) — kept in sync with the server-side
// DEFAULT_USEFUL_LIFE_MONTHS rules. Duplicated here so the form can pre-fill
// without an extra round-trip.
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

const GWG_NET_THRESHOLD = 800;

export interface AssetFormInitial {
  skrType: SkrType;
  taxMode: TaxMode;
  documentId?: string;
  documentLabel?: string;
  defaultName?: string;
  defaultAcquisitionDate?: string | null;
  defaultAcquisitionCost?: string | null;
  defaultVatRate?: string;
}

const INPUT = "w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors";
const LABEL = "block text-xs font-medium text-muted-foreground mb-1";

function toInputDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

export function AssetForm({ initial }: { initial: AssetFormInitial }) {
  const t = useTranslations("assets.form");
  const tc = useTranslations("assets.category");
  const tm = useTranslations("assets.method");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(initial.defaultName ?? "");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<FixedAssetCategory>("IT_HARDWARE");
  const [acquisitionDate, setAcquisitionDate] = useState(
    toInputDate(initial.defaultAcquisitionDate ?? new Date().toISOString()),
  );
  const [acquisitionCost, setAcquisitionCost] = useState(initial.defaultAcquisitionCost ?? "");
  // Kleinunternehmer: keine USt-Abzug → VAT-Picker entfällt, AfA-Basis ist
  // der Bruttobetrag. State bleibt der Form-Logik halber bestehen, wird aber
  // zwangsweise auf "0" gehalten.
  const isSmallBusiness = initial.taxMode === "SMALL_BUSINESS";
  const [vatRate, setVatRate] = useState(
    isSmallBusiness ? "0" : (initial.defaultVatRate ?? "19"),
  );
  const [usefulLifeYears, setUsefulLifeYears] = useState(
    String(DEFAULT_YEARS_BY_CATEGORY.IT_HARDWARE),
  );
  const [scrapValue, setScrapValue] = useState("0");
  const [method, setMethod] = useState<FixedAssetMethod>("LINEAR");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cost = parseFloat(acquisitionCost) || 0;
  const rate = isSmallBusiness ? 0 : parseFloat(vatRate) || 0;
  // Kleinunternehmer: AfA-Basis = brutto (R 9b EStR, nicht-abziehbare VSt
  // gehört zu den Anschaffungskosten). Sonst: netto aus brutto rückrechnen.
  const net = cost > 0 ? (isSmallBusiness ? cost : cost / (1 + rate / 100)) : 0;
  const isGwg = net > 0 && net <= GWG_NET_THRESHOLD;

  const years = parseInt(usefulLifeYears, 10) || 0;
  const months = method === "IMMEDIATE" ? 1 : Math.max(years * 12, 1);
  const scrap = parseFloat(scrapValue) || 0;
  const monthly = useMemo(() => {
    if (method === "IMMEDIATE") return Math.max(net - scrap, 0);
    if (months <= 0) return 0;
    return Math.max((net - scrap) / months, 0);
  }, [net, scrap, months, method]);

  function handleCategory(c: FixedAssetCategory) {
    setCategory(c);
    if (method === "LINEAR") {
      setUsefulLifeYears(String(Math.max(Math.round(DEFAULT_YEARS_BY_CATEGORY[c]), 1)));
    }
  }

  function handleMethod(m: FixedAssetMethod) {
    setMethod(m);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t("errors.nameRequired"));
      return;
    }
    if (!(cost > 0)) {
      setError(t("errors.costPositive"));
      return;
    }
    if (method === "LINEAR" && !(years > 0)) {
      setError(t("errors.usefulLifeRequired"));
      return;
    }

    startTransition(async () => {
      // 1) Upload a receipt first (if one was picked AND no existing document
      //    was pre-linked via ?document= query). Doing it before the asset
      //    create means we can pass documentId into createAssetAction in a
      //    single transaction from the user's POV. If upload fails, we abort
      //    without leaving a half-created asset behind.
      let uploadedDocumentId: string | null = null;
      if (receiptFile && !initial.documentId) {
        try {
          const fd = new FormData();
          fd.append("file", receiptFile);
          const up = await fetch("/api/documents/upload", { method: "POST", body: fd });
          if (!up.ok) {
            const body = await up.json().catch(() => ({}));
            setError(body.error ?? t("errors.failed"));
            return;
          }
          const doc = (await up.json()) as { id: string };
          uploadedDocumentId = doc.id;
        } catch {
          setError(t("errors.failed"));
          return;
        }
      }

      const documentId = initial.documentId ?? uploadedDocumentId ?? null;

      const res = await createAssetAction({
        name: name.trim(),
        description: description.trim() || null,
        category,
        method,
        acquisitionDate,
        acquisitionCost: cost,
        vatRate: rate,
        usefulLifeMonths: months,
        scrapValue: scrap,
        documentId,
      });
      if (!res.success) {
        setError(res.error || t("errors.failed"));
        return;
      }

      // If uploadedDocumentId existed and createAssetAction succeeded, the
      // document is already linked via the documentId we passed in — no
      // second attach call needed here.

      router.push(`/dashboard/documents/assets/${res.data.id}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {initial.documentId && initial.documentLabel ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
          {t("linkedDocument")}: <span className="font-medium">{initial.documentLabel}</span>
        </div>
      ) : (
        <section className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">{t("sectionReceipt")}</h2>
          <AssetReceiptUpload
            mode="deferred"
            current={receiptFile ? { fileName: receiptFile.name } : null}
            onChange={setReceiptFile}
          />
        </section>
      )}

      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">{t("sectionMaster")}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className={LABEL}>{t("name")}</label>
            <input
              className={INPUT}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              required
            />
          </div>
          <div className="md:col-span-2">
            <label className={LABEL}>{t("description")}</label>
            <textarea
              className={INPUT}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL}>{t("category")}</label>
            <select
              className={INPUT}
              value={category}
              onChange={(e) => handleCategory(e.target.value as FixedAssetCategory)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {tc(c.toLowerCase())}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL}>{t("method")}</label>
            <select
              className={INPUT}
              value={method}
              onChange={(e) => handleMethod(e.target.value as FixedAssetMethod)}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {tm(m.toLowerCase())}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">{t("sectionValues")}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={LABEL}>{t("acquisitionDate")}</label>
            <input
              type="date"
              className={INPUT}
              value={acquisitionDate}
              onChange={(e) => setAcquisitionDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className={LABEL}>{t("acquisitionCost")}</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className={INPUT}
              value={acquisitionCost}
              onChange={(e) => setAcquisitionCost(e.target.value)}
              required
            />
          </div>
          {!isSmallBusiness && (
            <div>
              <label className={LABEL}>{t("vatRate")}</label>
              <select className={INPUT} value={vatRate} onChange={(e) => setVatRate(e.target.value)}>
                <option value="0">0 %</option>
                <option value="7">7 %</option>
                <option value="19">19 %</option>
              </select>
            </div>
          )}
          <div>
            <label className={LABEL}>{t("netAmount")}</label>
            <input className={INPUT} value={net.toFixed(2)} readOnly />
          </div>
          <div>
            <label className={LABEL}>{t("scrapValue")}</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className={INPUT}
              value={scrapValue}
              onChange={(e) => setScrapValue(e.target.value)}
            />
          </div>
        </div>
        {isGwg && method === "LINEAR" && (
          <p className="text-xs text-muted-foreground">{t("gwgHint")}</p>
        )}
        {isSmallBusiness && (
          <p className="text-xs text-muted-foreground">{t("smallBusinessHint")}</p>
        )}
      </section>

      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">{t("sectionPlan")}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={LABEL}>{t("usefulLifeYears")}</label>
            <input
              type="number"
              min="1"
              className={INPUT}
              value={usefulLifeYears}
              onChange={(e) => setUsefulLifeYears(e.target.value)}
              disabled={method === "IMMEDIATE"}
            />
          </div>
          <div>
            <label className={LABEL}>{t("usefulLifeMonths")}</label>
            <input className={INPUT} value={months} readOnly />
          </div>
          <div>
            <label className={LABEL}>{t("monthlyAmount")}</label>
            <input className={INPUT} value={monthly.toFixed(2)} readOnly />
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg disabled:opacity-60"
        >
          {pending ? t("submitting") : t("submit")}
        </button>
        <Link
          href="/dashboard/documents/assets"
          className="px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground"
        >
          {t("cancel")}
        </Link>
      </div>
    </form>
  );
}
