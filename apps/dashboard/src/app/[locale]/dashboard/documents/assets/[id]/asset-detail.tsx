"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { FileText, AlertCircle, Trash2, X, Loader2 } from "lucide-react";
import type {
  FixedAssetCategory,
  FixedAssetMethod,
  FixedAssetStatus,
} from "@prisma/client";
import { formatCurrency, fmtDateShort } from "@/lib/format";
import {
  postPeriodAction,
  postAllDueAction,
  disposeAssetAction,
  deleteAssetAction,
} from "../actions";
import { AssetReceiptUpload } from "../asset-receipt-upload";
import { detachDocumentFromAssetAction } from "../actions";

export interface AssetDetailData {
  id: string;
  assetNumber: string;
  name: string;
  description: string | null;
  category: FixedAssetCategory;
  method: FixedAssetMethod;
  status: FixedAssetStatus;
  acquisitionDate: string;
  acquisitionCost: string;
  netAmount: string;
  vatAmount: string;
  vatRate: string | null;
  usefulLifeMonths: number;
  depreciationStart: string;
  monthlyAmount: string;
  scrapValue: string;
  bookValue: string;
  totalDepreciated: string;
  skrAssetAccount: string;
  skrDepreciationAccount: string;
  disposalDate: string | null;
  disposalProceeds: string | null;
  disposalReason: string | null;
  lastError: string | null;
  document: { id: string; fileName: string } | null;
  depreciations: Array<{
    id: string;
    periodYear: number;
    periodMonth: number;
    amount: string;
    bookValueBefore: string;
    bookValueAfter: string;
    postedAt: string | null;
  }>;
}

const STATUS_STYLES: Record<FixedAssetStatus, string> = {
  // PLANNED ist ein technischer Zwischenstatus zwischen Anlage-Erstellung und
  // erster gebuchter AfA-Periode. Aus User-Sicht identisch zu ACTIVE.
  PLANNED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  ACTIVE: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  FULLY_DEPRECIATED: "bg-muted text-muted-foreground border-border",
  DISPOSED: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
};

export function AssetDetail({ data }: { data: AssetDetailData }) {
  const t = useTranslations("assets");
  const td = useTranslations("assets.detail");
  const tcat = useTranslations("assets.category");
  const tmeth = useTranslations("assets.method");
  const tstat = useTranslations("assets.status");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showDispose, setShowDispose] = useState(false);
  const [disposalDate, setDisposalDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [disposalProceeds, setDisposalProceeds] = useState("0");
  const [disposalReason, setDisposalReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const remaining = data.depreciations.filter((d) => !d.postedAt).length;

  // "Due" = period (year, month) is in the past or current. The user can post
  // these now via the catch-up button. Future periods are picked up by the
  // monthly worker tick automatically.
  const now = new Date();
  const ny = now.getUTCFullYear();
  const nm = now.getUTCMonth() + 1;
  const dueCount = data.depreciations.filter(
    (d) => !d.postedAt && (d.periodYear < ny || (d.periodYear === ny && d.periodMonth <= nm)),
  ).length;

  function handlePostPeriod(year: number, month: number) {
    setError(null);
    startTransition(async () => {
      const res = await postPeriodAction(data.id, year, month);
      if (!res.success) setError(res.error);
      else router.refresh();
    });
  }

  function handlePostAllDue() {
    setError(null);
    startTransition(async () => {
      const res = await postAllDueAction(data.id);
      if (!res.success) setError(res.error);
      else router.refresh();
    });
  }

  function handleDispose(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await disposeAssetAction(
        data.id,
        disposalDate,
        parseFloat(disposalProceeds) || 0,
        disposalReason.trim() || null,
      );
      if (!res.success) setError(res.error);
      else {
        setShowDispose(false);
        router.refresh();
      }
    });
  }

  function handleDelete() {
    if (!confirm("Asset löschen?")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteAssetAction(data.id);
      if (!res.success) setError(res.error);
      else router.push("/dashboard/documents/assets");
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold text-foreground">{data.name}</h1>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border ${STATUS_STYLES[data.status]}`}
            >
              {tstat(data.status === "PLANNED" ? "active" : data.status.toLowerCase())}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-mono">{data.assetNumber}</span>
            <span>·</span>
            <span>{tcat(data.category.toLowerCase())}</span>
            <span>·</span>
            <span>{tmeth(data.method.toLowerCase())}</span>
          </div>
          {data.description && (
            <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{data.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data.status === "PLANNED" && (
            <button
              onClick={handleDelete}
              disabled={pending}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {td("deleteButton")}
            </button>
          )}
          {(data.status === "ACTIVE" || data.status === "PLANNED") && (
            <button
              onClick={() => setShowDispose((v) => !v)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-foreground hover:bg-secondary/80 text-sm font-medium rounded-lg transition-colors"
            >
              {td("disposeButton")}
            </button>
          )}
        </div>
      </div>

      {data.lastError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive inline-flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" />
          {data.lastError}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label={t("table.acquisitionCost")} value={formatCurrency(data.acquisitionCost)} />
        <Stat label={t("form.netAmount")} value={formatCurrency(data.netAmount)} />
        <Stat label={td("monthlyAmountLabel")} value={formatCurrency(data.monthlyAmount)} />
        <Stat
          label={t("table.totalDepreciated")}
          value={formatCurrency(data.totalDepreciated)}
        />
        <Stat
          label={t("table.bookValue")}
          value={formatCurrency(data.bookValue)}
          emphasize
        />
      </div>

      {/* Linked document — show file + detach control, or an upload slot */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-2.5">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {td("linkedDocument")}
        </div>
        {data.document ? (
          <div className="flex items-center gap-3 px-3 py-2 bg-muted/60 border border-border rounded-lg">
            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
            <Link
              href={`/dashboard/documents/${data.document.id}`}
              className="flex-1 text-sm font-medium text-foreground hover:text-primary truncate"
            >
              {data.document.fileName}
            </Link>
            {/* Detach via the same instant-mode widget — passing `current`
                makes the click on X call detachDocumentFromAssetAction. */}
            <AssetReceiptUploadDetach
              assetId={data.id}
              documentId={data.document.id}
              onDone={() => router.refresh()}
            />
          </div>
        ) : (
          <AssetReceiptUpload
            mode="instant"
            assetId={data.id}
            current={null}
            onAttached={() => router.refresh()}
          />
        )}
      </div>

      {/* Dispose form */}
      {showDispose && (
        <form
          onSubmit={handleDispose}
          className="bg-card border border-border rounded-xl p-5 space-y-4"
        >
          <h2 className="text-sm font-semibold text-foreground">{td("disposeTitle")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {td("disposalDate")}
              </label>
              <input
                type="date"
                value={disposalDate}
                onChange={(e) => setDisposalDate(e.target.value)}
                className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {td("disposalProceeds")}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={disposalProceeds}
                onChange={(e) => setDisposalProceeds(e.target.value)}
                className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {td("disposalReason")}
              </label>
              <input
                type="text"
                value={disposalReason}
                onChange={(e) => setDisposalReason(e.target.value)}
                className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg disabled:opacity-60"
          >
            {td("disposeSubmit")}
          </button>
        </form>
      )}

      {/* Catch-up banner */}
      {dueCount > 0 && data.status !== "DISPOSED" && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div className="text-sm">
              <div className="font-medium text-foreground">
                {td("duePending", { count: dueCount })}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {td("dueHint")}
              </div>
            </div>
          </div>
          <button
            onClick={handlePostAllDue}
            disabled={pending}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg disabled:opacity-60 whitespace-nowrap"
          >
            {pending ? td("posting") : td("postAllDue", { count: dueCount })}
          </button>
        </div>
      )}

      {/* Schedule */}
      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-5 border-b border-border">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{td("scheduleTitle")}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{td("scheduleSubtitle")}</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {td("remainingMonths")}: {remaining}
              </span>
              {remaining > 0 && data.status !== "DISPOSED" && (
                <span className="text-[11px] italic" title={td("autoPostHint")}>
                  · {td("autoPostInfo")}
                </span>
              )}
            </div>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">{td("period")}</th>
              <th className="px-4 py-2.5 font-medium text-right">{td("amount")}</th>
              <th className="px-4 py-2.5 font-medium text-right">{td("bookValueBefore")}</th>
              <th className="px-4 py-2.5 font-medium text-right">{td("bookValueAfter")}</th>
              <th className="px-4 py-2.5 font-medium">{td("postedAt")}</th>
              <th className="px-4 py-2.5 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.depreciations.map((d) => (
              <tr key={d.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 tabular-nums">
                  {String(d.periodMonth).padStart(2, "0")}/{d.periodYear}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatCurrency(d.amount)}
                </td>
                <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
                  {formatCurrency(d.bookValueBefore)}
                </td>
                <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
                  {formatCurrency(d.bookValueAfter)}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {d.postedAt ? (
                    fmtDateShort(d.postedAt)
                  ) : (
                    <span className="italic">{td("notPosted")}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {!d.postedAt && data.status !== "DISPOSED" && (
                    <button
                      onClick={() => handlePostPeriod(d.periodYear, d.periodMonth)}
                      disabled={pending}
                      className="text-xs text-primary hover:underline disabled:opacity-60"
                    >
                      {pending ? td("posting") : td("postNow")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function AssetReceiptUploadDetach({
  assetId,
  documentId,
  onDone,
}: {
  assetId: string;
  documentId: string;
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  // documentId is intentionally unused server-side (the relation is unique
  // per asset, so we only need assetId). Kept in the props for callsite
  // clarity / future-proofing if we ever support multiple receipts.
  void documentId;
  return (
    <button
      type="button"
      onClick={() => {
        setPending(true);
        void (async () => {
          try {
            await detachDocumentFromAssetAction(assetId);
            onDone();
          } finally {
            setPending(false);
          }
        })();
      }}
      disabled={pending}
      className="text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded disabled:opacity-60"
      title="Beleg entfernen"
    >
      {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
    </button>
  );
}

function Stat({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-1 tabular-nums ${emphasize ? "text-lg font-semibold text-foreground" : "text-sm text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );
}
