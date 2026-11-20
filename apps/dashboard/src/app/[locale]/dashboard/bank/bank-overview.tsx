"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatCurrency, fmtDateShort } from "@/lib/format";
import { Landmark, AlertCircle, TrendingUp, TrendingDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatIban } from "@/lib/bank-utils";

interface AccountSummary {
  id: string;
  name: string;
  bankName: string | null;
  iban: string | null;
  isDefault: boolean;
  balance: number;
  unmatched: number;
  monthlyIncome: number;
  monthlyExpense: number;
  transactionCount: number;
}

interface RecentTransaction {
  id: string;
  date: string;
  amount: number;
  counterpartName: string | null;
  purpose: string | null;
  status: "UNMATCHED" | "MATCHED" | "IGNORED";
  accountName: string;
}

interface BankOverviewProps {
  accounts: AccountSummary[];
  recentTransactions: RecentTransaction[];
}

export function BankOverview({ accounts, recentTransactions }: BankOverviewProps) {
  const t = useTranslations("bank");

  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);
  const totalUnmatched = accounts.reduce((s, a) => s + a.unmatched, 0);
  const totalMonthlyIncome = accounts.reduce((s, a) => s + a.monthlyIncome, 0);
  const totalMonthlyExpense = accounts.reduce((s, a) => s + a.monthlyExpense, 0);

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Landmark className="w-12 h-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground mb-4">{t("overview.noAccounts")}</p>
        <Link
          href="/dashboard/bank/accounts"
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t("overview.addFirstAccount")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/*
        Page header — matches the app-wide convention (clients, settings,
        invoices): a `text-2xl font-semibold` H1 + a muted subtitle. The
        old layout-level header was removed when the bank tabs moved into
        the sidebar, so each sub-page now owns its own title.
      */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          {t("overview.title")}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t("overview.subtitle")}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label={t("overview.totalBalance")}
          value={formatCurrency(totalBalance)}
          icon={<Landmark className="w-4 h-4" />}
        />
        <SummaryCard
          label={t("overview.unmatchedTransactions")}
          value={String(totalUnmatched)}
          icon={<AlertCircle className="w-4 h-4" />}
          highlight={totalUnmatched > 0}
        />
        <SummaryCard
          label={t("overview.monthlyIncome")}
          value={formatCurrency(totalMonthlyIncome)}
          icon={<TrendingUp className="w-4 h-4" />}
          positive
        />
        <SummaryCard
          label={t("overview.monthlyExpense")}
          value={formatCurrency(totalMonthlyExpense)}
          icon={<TrendingDown className="w-4 h-4" />}
          negative
        />
      </div>

      {/* Account List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {accounts.map((acc) => (
          <Link
            key={acc.id}
            href={`/dashboard/bank/${acc.id}`}
            className="block p-4 bg-card border border-border rounded-lg hover:border-primary/30 transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="font-medium text-sm">{acc.name}</h3>
                {acc.bankName && (
                  <p className="text-xs text-muted-foreground">{acc.bankName}</p>
                )}
              </div>
              {acc.isDefault && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                  Standard
                </span>
              )}
            </div>
            {acc.iban && (
              <p className="text-xs text-muted-foreground font-mono mb-2">
                {formatIban(acc.iban)}
              </p>
            )}
            <p className="text-lg font-semibold">{formatCurrency(acc.balance)}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span>{acc.transactionCount} Transaktionen</span>
              {acc.unmatched > 0 && (
                <span className="text-amber-600">{acc.unmatched} offen</span>
              )}
            </div>
          </Link>
        ))}
      </div>

      {/* Recent Transactions */}
      {recentTransactions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-3">{t("overview.recentTransactions")}</h2>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {recentTransactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                      {fmtDateShort(tx.date)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium truncate max-w-[200px]">
                        {tx.counterpartName || "—"}
                      </div>
                      {tx.purpose && (
                        <div className="text-xs text-muted-foreground truncate max-w-[300px]">
                          {tx.purpose}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {tx.accountName}
                    </td>
                    <td className={cn(
                      "px-4 py-2.5 text-right font-mono whitespace-nowrap",
                      tx.amount >= 0 ? "text-emerald-600" : "text-foreground"
                    )}>
                      {tx.amount >= 0 ? "+" : ""}{formatCurrency(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  highlight,
  positive,
  negative,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  highlight?: boolean;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="p-4 bg-card border border-border rounded-lg">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className={cn(
        "text-xl font-semibold",
        highlight && "text-amber-600",
        positive && "text-emerald-600",
        negative && "text-foreground",
      )}>
        {value}
      </p>
    </div>
  );
}
