// Server-side sync: turn an authorized Enable Banking session into linked
// BankAccounts + imported BankTransactions. Shared by the OAuth callback and
// any future "re-sync" action so the linking/dedup rules live in one place.

import { db } from "@/lib/db";
import { ImportSource, TransactionStatus } from "@prisma/client";
import { createAuditLog } from "@/lib/audit";
import { bankAccount as defaultBankLedger } from "@/lib/journal/accounts";
import { getAccountDetails, getAllTransactions, EnableBankingError } from "./client";
import {
  mapAccountDetails,
  mapTransaction,
  normalizeSessionAccountUids,
} from "./map";
import type { SessionResponse, Transaction } from "./types";

/** How far back we pull transactions on first sync (days). */
const INITIAL_TX_WINDOW_DAYS = 90;

export interface SyncResult {
  accountsLinked: number;
  imported: number;
  skipped: number;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Links every account in the session to a BankAccount (creating or matching by
 * IBAN) and imports its transactions with dedup. Idempotent: safe to re-run.
 */
export async function syncSessionAccounts(params: {
  tenantId: string;
  userId: string;
  connectionId: string;
  aspspName: string;
  session: SessionResponse;
}): Promise<SyncResult> {
  const { tenantId, userId, connectionId, aspspName, session } = params;
  const uids = normalizeSessionAccountUids(session);

  // Sensible default ledger account for freshly created bank accounts, based
  // on the tenant's chart of accounts (SKR03 1200 / SKR04 1800). The user can
  // change it later in the account edit dialog.
  const settings = await db.companySettings.findUnique({
    where: { tenantId },
    select: { skrType: true },
  });
  const defaultBookingAccount = defaultBankLedger(settings?.skrType ?? "SKR03");

  let accountsLinked = 0;
  let imported = 0;
  let skipped = 0;

  for (const uid of uids) {
    const details = await getAccountDetails(uid).catch(() => null);
    const acc = details ? mapAccountDetails(details) : null;

    const bankAccountId = await linkBankAccount({
      tenantId,
      connectionId,
      aspspName,
      uid,
      iban: acc?.iban ?? null,
      name: acc?.name ?? null,
      currency: acc?.currency ?? "EUR",
      defaultBookingAccount,
    });
    accountsLinked++;

    const res = await importAccountTransactions({
      tenantId,
      bankAccountId,
      uid,
      dateFrom: isoDaysAgo(INITIAL_TX_WINDOW_DAYS),
    });
    imported += res.imported;
    skipped += res.skipped;
  }

  await db.bankConnection.update({
    where: { id: connectionId },
    data: { lastSyncedAt: new Date() },
  });

  await createAuditLog({
    action: "BANK_TRANSACTION_IMPORTED",
    tenantId,
    userId,
    entityType: "BankConnection",
    entityId: connectionId,
    details: { source: "ENABLE_BANKING", accountsLinked, imported, skipped },
  });

  return { accountsLinked, imported, skipped };
}

/**
 * Incrementally re-sync an already-authorized connection: pulls new
 * transactions for each linked account since the last successful sync. Does
 * NOT re-link accounts (the session's account uids are stored on BankAccount).
 * Marks the connection EXPIRED (and rethrows) if the consent is no longer valid.
 */
export async function resyncConnection(params: {
  tenantId: string;
  userId?: string;
  connectionId: string;
}): Promise<SyncResult> {
  const { tenantId, userId, connectionId } = params;

  const connection = await db.bankConnection.findFirst({
    where: { id: connectionId, tenantId },
    select: { id: true, status: true, lastSyncedAt: true },
  });
  if (!connection) throw new Error("BankConnection not found");

  const accounts = await db.bankAccount.findMany({
    where: { tenantId, bankConnectionId: connectionId, externalAccountId: { not: null } },
    select: { id: true, externalAccountId: true },
  });

  // Overlap the window by a couple of days so late-booked items aren't missed;
  // dedup makes the overlap harmless. First-ever resync falls back to 90 days.
  const dateFrom = connection.lastSyncedAt
    ? isoDaysAgo(daysSince(connection.lastSyncedAt) + 3)
    : isoDaysAgo(INITIAL_TX_WINDOW_DAYS);

  let imported = 0;
  let skipped = 0;
  try {
    for (const acc of accounts) {
      const res = await importAccountTransactions({
        tenantId,
        bankAccountId: acc.id,
        uid: acc.externalAccountId as string,
        dateFrom,
      });
      imported += res.imported;
      skipped += res.skipped;
    }
  } catch (err) {
    if (err instanceof EnableBankingError && err.isConsentExpired) {
      await db.bankConnection.update({
        where: { id: connectionId },
        data: { status: "EXPIRED", error: "consent_expired" },
      });
      await createAuditLog({
        action: "BANK_CONNECTION_EXPIRED",
        tenantId,
        userId,
        entityType: "BankConnection",
        entityId: connectionId,
        details: { reason: "consent_expired_on_resync" },
      });
    }
    throw err;
  }

  await db.bankConnection.update({
    where: { id: connectionId },
    data: { lastSyncedAt: new Date() },
  });

  if (imported > 0) {
    await createAuditLog({
      action: "BANK_CONNECTION_SYNCED",
      tenantId,
      userId,
      entityType: "BankConnection",
      entityId: connectionId,
      details: { imported, skipped },
    });
  }

  return { accountsLinked: accounts.length, imported, skipped };
}

function daysSince(date: Date): number {
  const ms = Date.now() - date.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/** True for booked transactions (or when the ASPSP omits the status). */
function isBooked(raw: Transaction): boolean {
  if (!raw.status) return true;
  return raw.status.toUpperCase().startsWith("BOOK");
}

/** Fetch + dedup-insert transactions for one linked account. */
async function importAccountTransactions(params: {
  tenantId: string;
  bankAccountId: string;
  uid: string;
  dateFrom: string;
}): Promise<{ imported: number; skipped: number }> {
  const { tenantId, bankAccountId, uid, dateFrom } = params;

  const rawTxns = await getAllTransactions(uid, { dateFrom });

  let imported = 0;
  let skipped = 0;

  for (const raw of rawTxns) {
    // Only import booked transactions. Pending (PDNG) items still change —
    // amount, date and even their id can shift when they finally book — so
    // importing them risks duplicates and churn in the ledger. A missing
    // status is treated as booked (some ASPSPs/sandbox omit it).
    if (!isBooked(raw)) {
      skipped++;
      continue;
    }

    const tx = mapTransaction(raw);
    const txDate = new Date(tx.date);
    if (!tx.date || isNaN(txDate.getTime())) {
      skipped++;
      continue;
    }

    // Dedup against the composite unique (bankAccountId, externalId).
    if (tx.externalId) {
      const existing = await db.bankTransaction.findUnique({
        where: {
          bankAccountId_externalId: { bankAccountId, externalId: tx.externalId },
        },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }
    }

    await db.bankTransaction.create({
      data: {
        tenantId,
        bankAccountId,
        date: txDate,
        valueDate: tx.valueDate ? new Date(tx.valueDate) : null,
        amount: tx.amount,
        currency: raw.transaction_amount?.currency ?? "EUR",
        counterpartName: tx.counterpartName,
        counterpartIban: tx.counterpartIban,
        purpose: tx.purpose,
        importSource: ImportSource.ENABLE_BANKING,
        externalId: tx.externalId ?? null,
        status: TransactionStatus.UNMATCHED,
      },
    });
    imported++;
  }

  return { imported, skipped };
}

/**
 * Resolve the BankAccount for an Enable Banking account uid:
 *  1. already linked (tenantId + externalAccountId) → reuse
 *  2. matches an existing account by IBAN → adopt (attach link)
 *  3. otherwise → create a fresh BANK account
 * Returns the BankAccount id.
 */
async function linkBankAccount(params: {
  tenantId: string;
  connectionId: string;
  aspspName: string;
  uid: string;
  iban: string | null;
  name: string | null;
  currency: string;
  defaultBookingAccount: string;
}): Promise<string> {
  const { tenantId, connectionId, aspspName, uid, iban, name, currency, defaultBookingAccount } =
    params;

  const existingByUid = await db.bankAccount.findFirst({
    where: { tenantId, externalAccountId: uid },
    select: { id: true },
  });
  if (existingByUid) {
    await db.bankAccount.update({
      where: { id: existingByUid.id },
      data: { bankConnectionId: connectionId },
    });
    return existingByUid.id;
  }

  if (iban) {
    const existingByIban = await db.bankAccount.findFirst({
      where: { tenantId, iban, externalAccountId: null },
      select: { id: true },
    });
    if (existingByIban) {
      await db.bankAccount.update({
        where: { id: existingByIban.id },
        data: { externalAccountId: uid, bankConnectionId: connectionId },
      });
      return existingByIban.id;
    }
  }

  const created = await db.bankAccount.create({
    data: {
      tenantId,
      name: name || `${aspspName}${iban ? ` (${iban.slice(-4)})` : ""}`,
      bankName: aspspName,
      iban,
      currency,
      bookingAccount: defaultBookingAccount,
      externalAccountId: uid,
      bankConnectionId: connectionId,
    },
    select: { id: true },
  });
  return created.id;
}
