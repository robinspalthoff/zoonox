import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { BankAccountsView } from "./bank-accounts-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("bank.accounts");
  return { title: t("title") };
}

export default async function BankAccountsPage() {
  const { tenantId } = await requireTenant();

  const [accounts, connections] = await Promise.all([
    db.bankAccount.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { transactions: true } },
        transactions: { select: { amount: true } },
      },
    }),
    db.bankConnection.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { bankAccounts: true } } },
    }),
  ]);

  return (
    <BankAccountsView
      connections={connections.map((c) => ({
        id: c.id,
        aspspName: c.aspspName,
        status: c.status,
        psuType: c.psuType,
        validUntil: c.validUntil?.toISOString() ?? null,
        authorizedAt: c.authorizedAt?.toISOString() ?? null,
        lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
        accountCount: c._count.bankAccounts,
      }))}
      accounts={accounts.map((acc) => ({
        id: acc.id,
        name: acc.name,
        type: acc.type,
        bookingAccount: acc.bookingAccount,
        bankName: acc.bankName,
        iban: acc.iban,
        bic: acc.bic,
        currency: acc.currency,
        openingBalance: Number(acc.openingBalance),
        isDefault: acc.isDefault,
        isActive: acc.isActive,
        balance:
          acc.transactions.reduce((s, t) => s + Number(t.amount), 0) +
          Number(acc.openingBalance),
        transactionCount: acc._count.transactions,
      }))}
    />
  );
}
