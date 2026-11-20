import { test } from "node:test";
import assert from "node:assert/strict";
import { mapTransaction } from "../../src/lib/enable-banking/map";
import type { Transaction } from "../../src/lib/enable-banking/types";

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    transaction_amount: { amount: "100.00", currency: "EUR" },
    credit_debit_indicator: "CRDT",
    ...overrides,
  };
}

test("CRDT (incoming) maps to a positive amount", () => {
  const m = mapTransaction(tx({ credit_debit_indicator: "CRDT" }));
  assert.equal(m.amount, 100);
});

test("DBIT (outgoing) maps to a negative amount", () => {
  const m = mapTransaction(tx({ credit_debit_indicator: "DBIT" }));
  assert.equal(m.amount, -100);
});

test("amount magnitude is always taken as absolute before signing", () => {
  const m = mapTransaction(
    tx({ transaction_amount: { amount: "-42.50", currency: "EUR" }, credit_debit_indicator: "DBIT" }),
  );
  assert.equal(m.amount, -42.5);
});

test("counterparty for incoming money is the debtor (payer)", () => {
  const m = mapTransaction(
    tx({
      credit_debit_indicator: "CRDT",
      debtor: { name: "  ACME GmbH " },
      debtor_account: { iban: "de89 3704 0044 0532 0130 00" },
      creditor: { name: "Us" },
    }),
  );
  assert.equal(m.counterpartName, "ACME GmbH");
  // IBAN normalized: spaces stripped + upper-cased.
  assert.equal(m.counterpartIban, "DE89370400440532013000");
});

test("counterparty for outgoing money is the creditor (payee)", () => {
  const m = mapTransaction(
    tx({
      credit_debit_indicator: "DBIT",
      creditor: { name: "Landlord" },
      creditor_account: { iban: "DE89370400440532013000" },
      debtor: { name: "Us" },
    }),
  );
  assert.equal(m.counterpartName, "Landlord");
});

test("remittance information lines are trimmed and joined into purpose", () => {
  const m = mapTransaction(tx({ remittance_information: [" Rechnung ", "RE-2025-001 "] }));
  assert.equal(m.purpose, "Rechnung RE-2025-001");
});

test("externalId prefers the ASPSP entry_reference", () => {
  const m = mapTransaction(tx({ entry_reference: "REF-XYZ-1" }));
  assert.equal(m.externalId, "REF-XYZ-1");
});

test("externalId falls back to a stable deterministic hash (dedup key)", () => {
  const base = tx({
    booking_date: "2026-01-15",
    transaction_amount: { amount: "12.34", currency: "EUR" },
    credit_debit_indicator: "DBIT",
    remittance_information: ["Coffee"],
  });
  const a = mapTransaction(base);
  const b = mapTransaction({ ...base });
  assert.ok(a.externalId?.startsWith("eb_"));
  assert.equal(a.externalId, b.externalId, "identical bookings must hash equal");

  const different = mapTransaction({ ...base, transaction_amount: { amount: "99.99", currency: "EUR" } });
  assert.notEqual(a.externalId, different.externalId, "different amount must hash differently");
});

test("empty/missing purpose becomes null, not empty string", () => {
  const m = mapTransaction(tx({ remittance_information: ["  ", ""] }));
  assert.equal(m.purpose, null);
});
