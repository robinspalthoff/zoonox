// Mapping helpers: Enable Banking API shapes → our domain shapes.
//
// Kept separate from the HTTP client so the sign/format conventions live in
// one auditable place (a wrong sign here would silently corrupt bookkeeping).

import { createHash } from "crypto";
import type { AccountResource, SessionResponse, Transaction } from "./types";

/** Our internal, provider-agnostic account descriptor. */
export interface MappedAccount {
  uid: string;
  iban: string | null;
  name: string | null;
  currency: string;
  product: string | null;
}

/**
 * Shape consumed by importTransactions() in bank/actions.ts. Kept structurally
 * identical on purpose so Enable Banking reuses the existing dedup + audit path.
 */
export interface MappedTransaction {
  date: string;
  valueDate?: string | null;
  amount: number;
  counterpartName?: string | null;
  counterpartIban?: string | null;
  purpose?: string | null;
  externalId?: string | null;
}

/** Normalize the /sessions `accounts` array (uid strings OR full resources). */
export function normalizeSessionAccountUids(session: SessionResponse): string[] {
  return (session.accounts ?? [])
    .map((a) => (typeof a === "string" ? a : a.uid))
    .filter((uid): uid is string => Boolean(uid));
}

export function mapAccountDetails(details: AccountResource): MappedAccount {
  const iban = details.account_id?.iban ?? null;
  return {
    uid: details.uid,
    iban: iban ? iban.replace(/\s/g, "").toUpperCase() : null,
    name: details.name ?? details.product ?? null,
    currency: details.currency ?? "EUR",
    product: details.product ?? null,
  };
}

/**
 * Map one Enable Banking transaction. Sign convention matches BankTransaction:
 * positive = income (CRDT), negative = expense (DBIT). The API always returns
 * a positive `transaction_amount.amount`; the direction is in the indicator.
 */
export function mapTransaction(tx: Transaction): MappedTransaction {
  const magnitude = Math.abs(Number(tx.transaction_amount?.amount ?? 0));
  const isCredit = tx.credit_debit_indicator === "CRDT";
  const amount = isCredit ? magnitude : -magnitude;

  // For incoming money the counterparty is the debtor (payer); for outgoing
  // money it is the creditor (payee).
  const counterpartName = isCredit ? tx.debtor?.name : tx.creditor?.name;
  const counterpartIbanRaw = isCredit
    ? tx.debtor_account?.iban
    : tx.creditor_account?.iban;

  const date = tx.booking_date ?? tx.value_date ?? tx.transaction_date ?? "";
  const purpose = (tx.remittance_information ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");

  return {
    date,
    valueDate: tx.value_date ?? null,
    amount,
    counterpartName: counterpartName?.trim() || null,
    counterpartIban: counterpartIbanRaw
      ? counterpartIbanRaw.replace(/\s/g, "").toUpperCase()
      : null,
    purpose: purpose || null,
    externalId: transactionExternalId(tx),
  };
}

/**
 * Stable per-transaction id for dedup on re-sync. Prefer the ASPSP's
 * `entry_reference`; when absent (common for sandbox/booked items) fall back
 * to a deterministic hash of the identifying fields so repeated syncs of the
 * same booking don't create duplicates.
 */
function transactionExternalId(tx: Transaction): string {
  if (tx.entry_reference) return tx.entry_reference;
  const basis = [
    tx.booking_date ?? tx.value_date ?? "",
    tx.transaction_amount?.amount ?? "",
    tx.transaction_amount?.currency ?? "",
    tx.credit_debit_indicator ?? "",
    (tx.remittance_information ?? []).join("|"),
    tx.creditor_account?.iban ?? tx.debtor_account?.iban ?? "",
  ].join("::");
  return "eb_" + createHash("sha1").update(basis).digest("hex").slice(0, 24);
}
