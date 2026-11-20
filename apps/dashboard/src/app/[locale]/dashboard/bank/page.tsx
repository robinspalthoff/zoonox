import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { BankOverview } from "./bank-overview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("bank.overview");
  return { title: t("title") };
}

export default async function BankPage() {
  const { tenantId } = await requireTenant();

  const accounts = await db.bankAccount.findMany({
    where: { tenantId, isActive: true },
    include: {
      transactions: {
        select: { amount: true, status: true, date: true, isPrivate: true },
      },
      _count: { select: { transactions: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Calculate aggregates
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const accountSummaries = accounts.map((acc) => {
    // Ignored transactions must not affect balances or income/expense aggregates.
    const activeTxs = acc.transactions.filter((t) => t.status !== "IGNORED");
    const txAmounts = activeTxs.map((t) => Number(t.amount));
    const balance = txAmounts.reduce((s, a) => s + a, Number(acc.openingBalance));
    const unmatched = activeTxs.filter((t) => t.status === "UNMATCHED").length;
    // Private ("Privatentnahme/-einlage") transactions affect balance but not P&L.
    const monthlyTxs = activeTxs.filter((t) => t.date >= monthStart && !t.isPrivate);
    const monthlyIncome = monthlyTxs
      .filter((t) => Number(t.amount) > 0)
      .reduce((s, t) => s + Number(t.amount), 0);
    const monthlyExpense = monthlyTxs
      .filter((t) => Number(t.amount) < 0)
      .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

    return {
      id: acc.id,
      name: acc.name,
      bankName: acc.bankName,
      iban: acc.iban,
      isDefault: acc.isDefault,
      balance,
      unmatched,
      monthlyIncome,
      monthlyExpense,
      transactionCount: activeTxs.length,
    };
  });

  const recentTransactions = await db.bankTransaction.findMany({
    where: { tenantId, status: { not: "IGNORED" } },
    orderBy: { date: "desc" },
    take: 10,
    select: {
      id: true,
      date: true,
      amount: true,
      counterpartName: true,
      purpose: true,
      status: true,
      bankAccount: { select: { name: true } },
    },
  });

  return (
    <BankOverview
      accounts={accountSummaries}
      recentTransactions={recentTransactions.map((tx) => ({
        id: tx.id,
        date: tx.date.toISOString(),
        amount: Number(tx.amount),
        counterpartName: tx.counterpartName,
        purpose: tx.purpose,
        status: tx.status,
        accountName: tx.bankAccount.name,
      }))}
    />
  );
}
