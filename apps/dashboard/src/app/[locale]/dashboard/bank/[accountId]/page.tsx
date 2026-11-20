import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { AccountDetail } from "./account-detail";
import { countOpenCommentsByEntity, listCommentsByEntityIds, type CommentDTO } from "@/lib/comments/queries";
import { can } from "@/lib/permissions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("bank.transactions");
  return { title: t("title") };
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ locale: string; accountId: string }>;
}) {
  const { accountId } = await params;
  const tenant = await requireTenant();
  const { tenantId } = tenant;

  const account = await db.bankAccount.findUnique({
    where: { id: accountId, tenantId },
    include: {
      transactions: {
        orderBy: { date: "desc" },
        include: {
          document: {
            select: { id: true, fileName: true, recognizedSupplier: true, recognizedAmount: true },
          },
          invoice: {
            select: { id: true, number: true, contact: { select: { name: true } } },
          },
        },
      },
    },
  });

  if (!account) notFound();

  const txIds = account.transactions.map((tx) => tx.id);
  const [openCommentCounts, commentsByTxId] = await Promise.all([
    countOpenCommentsByEntity(tenantId, "BANK_TRANSACTION", txIds),
    listCommentsByEntityIds(tenantId, "BANK_TRANSACTION", txIds),
  ]);
  const commentsJson: Record<string, CommentDTO[]> = {};
  for (const [id, list] of commentsByTxId.entries()) commentsJson[id] = list;

  return (
    <AccountDetail
      currentUserId={tenant.userId}
      canWriteComments={can(tenant.tenantRole, "comments.write")}
      canResolveComments={can(tenant.tenantRole, "comments.resolve")}
      commentsByTxId={commentsJson}
      account={{
        id: account.id,
        name: account.name,
        type: account.type,
        bankName: account.bankName,
        iban: account.iban,
        bic: account.bic,
        openingBalance: Number(account.openingBalance),
        bookingAccount: account.bookingAccount,
        isDefault: account.isDefault,
        // Raw JSON. The CSV import dialog parses + validates it
        // client-side via parseCsvMappingPreset so the schema-
        // validation logic stays in one place.
        csvMapping: account.csvMapping,
      }}
      transactions={account.transactions.map((tx) => ({
        id: tx.id,
        date: tx.date.toISOString(),
        valueDate: tx.valueDate?.toISOString() ?? null,
        amount: Number(tx.amount),
        counterpartName: tx.counterpartName,
        counterpartIban: tx.counterpartIban,
        purpose: tx.purpose,
        category: tx.category,
        status: tx.status,
        importSource: tx.importSource,
        documentId: tx.documentId,
        documentName: tx.document?.recognizedSupplier || tx.document?.fileName || null,
        invoiceId: tx.invoiceId,
        invoiceLabel: tx.invoice
          ? `${tx.invoice.number}${tx.invoice.contact?.name ? " · " + tx.invoice.contact.name : ""}`
          : null,
        isPrivate: tx.isPrivate,
        autoMatched: tx.autoMatched,
        openCommentCount: openCommentCounts.get(tx.id) ?? 0,
      }))}
    />
  );
}
