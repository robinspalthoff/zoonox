"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Plus, Trash2, FileText } from "lucide-react";
import { formatCurrency, fmtDateShort } from "@/lib/format";
import { upsertCashbookEntry, deleteCashbookEntry } from "../actions";
import { cn } from "@/lib/utils";

/** Brutto in Netto und Steuer zerlegen — nur für die Vorschau im Formular. */
function splitVat(gross: number, rate: number): { net: number; vat: number } {
  if (!gross || !rate) return { net: gross, vat: 0 };
  const vat = Math.round((gross - gross / (1 + rate / 100)) * 100) / 100;
  return { net: Math.round((gross - vat) * 100) / 100, vat };
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
}

interface CashbookRow {
  id: string;
  date: string;
  amount: number;
  entryType: "INCOME" | "EXPENSE";
  description: string;
  category: string | null;
  vatRate: number | null;
  documentId: string | null;
  documentName: string | null;
}

export function CashbookView({ entries }: { entries: CashbookRow[] }) {
  const t = useTranslations("bank.cashbook");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CashbookRow | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form state
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [entryType, setEntryType] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [vatRate, setVatRate] = useState("");

  // Calculate running totals
  let runningBalance = 0;
  const entriesWithBalance = entries.map((e) => {
    runningBalance += e.entryType === "INCOME" ? e.amount : -e.amount;
    return { ...e, runningBalance };
  });

  function openForm(entry?: CashbookRow) {
    if (entry) {
      setEditingEntry(entry);
      setDate(entry.date.slice(0, 10));
      setAmount(String(entry.amount));
      setEntryType(entry.entryType);
      setDescription(entry.description);
      setCategory(entry.category || "");
      setVatRate(entry.vatRate != null ? String(entry.vatRate) : "");
    } else {
      setEditingEntry(null);
      setDate(new Date().toISOString().slice(0, 10));
      setAmount("");
      setEntryType("EXPENSE");
      setDescription("");
      setCategory("");
      setVatRate("");
    }
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await upsertCashbookEntry({
        id: editingEntry?.id,
        date,
        amount: parseFloat(amount),
        entryType,
        description,
        category: category || null,
        vatRate: vatRate ? parseFloat(vatRate) : null,
      });
      if (result.success) {
        setShowForm(false);
        setEditingEntry(null);
        router.refresh();
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteCashbookEntry(id);
      setDeleteConfirmId(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/*
        Page header — matches the app-wide convention used on clients,
        settings, invoices etc. `text-2xl font-semibold` H1 + muted
        subtitle on the left, primary CTA on the right.
      */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
        </div>
        <button
          onClick={() => openForm()}
          className="inline-flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t("add")}
        </button>
      </div>

      {/* Cashbook Table */}
      {entries.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <FileText className="w-10 h-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-2 font-medium">{t("date")}</th>
                <th className="text-left px-4 py-2 font-medium">{t("description")}</th>
                <th className="text-right px-4 py-2 font-medium">{t("income")}</th>
                <th className="text-right px-4 py-2 font-medium">{t("expense")}</th>
                <th className="text-right px-4 py-2 font-medium">{t("runningTotal")}</th>
                <th className="px-4 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {entriesWithBalance.map((entry) => (
                <tr key={entry.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                    {fmtDateShort(entry.date)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{entry.description}</span>
                    {entry.documentName && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({entry.documentName})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-emerald-600">
                    {entry.entryType === "INCOME" ? formatCurrency(entry.amount) : ""}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {entry.entryType === "EXPENSE" ? formatCurrency(entry.amount) : ""}
                  </td>
                  <td className={cn(
                    "px-4 py-2.5 text-right font-mono font-medium",
                    entry.runningBalance < 0 && "text-destructive"
                  )}>
                    {formatCurrency(entry.runningBalance)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openForm(entry)}
                        className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </button>
                      {deleteConfirmId === entry.id ? (
                        <button
                          onClick={() => handleDelete(entry.id)}
                          disabled={isPending}
                          className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirmId(entry.id)}
                          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/50 font-medium">
                <td className="px-4 py-2" colSpan={2}>{t("closingBalance")}</td>
                <td className="px-4 py-2 text-right font-mono text-emerald-600">
                  {formatCurrency(
                    entries.filter((e) => e.entryType === "INCOME").reduce((s, e) => s + e.amount, 0)
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatCurrency(
                    entries.filter((e) => e.entryType === "EXPENSE").reduce((s, e) => s + e.amount, 0)
                  )}
                </td>
                <td className={cn(
                  "px-4 py-2 text-right font-mono font-semibold",
                  runningBalance < 0 && "text-destructive"
                )}>
                  {formatCurrency(runningBalance)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-xl shadow-lg w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold mb-4">
              {editingEntry ? t("edit") : t("add")}
            </h3>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="text-sm font-medium">{t("date")}</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="w-full mt-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <label className="text-sm font-medium">{t("type")}</label>
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setEntryType("INCOME")}
                    className={cn(
                      "flex-1 px-3 py-2 text-sm rounded-lg border transition-colors",
                      entryType === "INCOME"
                        ? "bg-emerald-500/10 border-emerald-500 text-emerald-600"
                        : "border-input hover:bg-accent"
                    )}
                  >
                    {t("income")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryType("EXPENSE")}
                    className={cn(
                      "flex-1 px-3 py-2 text-sm rounded-lg border transition-colors",
                      entryType === "EXPENSE"
                        ? "bg-primary/10 border-primary text-primary"
                        : "border-input hover:bg-accent"
                    )}
                  >
                    {t("expense")}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">{t("description")}</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("descriptionPlaceholder")}
                  required
                  className="w-full mt-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <label className="text-sm font-medium">{t("amount")}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  className="w-full mt-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Umsatzsteuer. Der Betrag oben ist brutto — ohne Satz bleibt
                  der Vorgang steuerfrei und taucht nicht in der Voranmeldung
                  auf. Das ist richtig für Privateinlagen und durchlaufende
                  Posten, aber falsch für Bareinnahmen aus dem Verkauf. */}
              <div>
                <label className="text-sm font-medium">{t("vatRate")}</label>
                <select
                  value={vatRate}
                  onChange={(e) => setVatRate(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">{t("vatRateNone")}</option>
                  <option value="19">19 %</option>
                  <option value="7">7 %</option>
                </select>
                {vatRate !== "" && amount !== "" && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("vatRateSplit", {
                      net: fmtEur(splitVat(parseFloat(amount) || 0, parseFloat(vatRate)).net),
                      vat: fmtEur(splitVat(parseFloat(amount) || 0, parseFloat(vatRate)).vat),
                    })}
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setEditingEntry(null); }}
                  className="px-4 py-2 text-sm rounded-lg hover:bg-accent transition-colors"
                >
                  {t("title") === "Kassenbuch" ? "Abbrechen" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isPending ? "…" : t("title") === "Kassenbuch" ? "Speichern" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
