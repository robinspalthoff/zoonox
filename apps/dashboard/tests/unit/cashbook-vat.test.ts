import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCashbookEntry } from "../../src/lib/journal/posting-rules";
import type { PostingContext } from "../../src/lib/journal/types";
import { computeUstva, type UstvaSourceLine } from "../../src/lib/taxes/ustva/compute";
import { FORM_2026 } from "../../src/lib/taxes/ustva/forms";
import { toNetAndVat } from "../../src/lib/taxes/ustva/line-mapping";

const ctx: PostingContext = {
  tenantId: "t1",
  skrType: "SKR03",
  accountingMode: "DOUBLE_ENTRY",
  taxMode: "STANDARD",
};

function entry(o: {
  amount: number;
  entryType?: "INCOME" | "EXPENSE";
  vatRate?: number | null;
  vatAmount?: number | null;
  category?: string | null;
}) {
  return {
    id: "c1",
    tenantId: "t1",
    date: new Date("2026-03-15"),
    amount: o.amount,
    entryType: o.entryType ?? "INCOME",
    description: "Barverkauf",
    category: o.category ?? null,
    vatRate: o.vatRate ?? null,
    vatAmount: o.vatAmount ?? null,
    documentId: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function sum(lines: { debit: number; credit: number }[], side: "debit" | "credit") {
  return Math.round(lines.reduce((s, l) => s + l[side], 0) * 100) / 100;
}

/**
 * Buchungszeilen so übersetzen, wie es die Abfrage in Produktion tut —
 * nicht nachbauen. Bei USt19 trägt die Zeile den Steuerbetrag, das Netto
 * wird über den Satz zurückgerechnet.
 */
function toUstvaLines(
  lines: { vatCode?: string | null; vatAmount?: number | null; debit: number; credit: number }[],
): UstvaSourceLine[] {
  return lines
    .filter((l) => l.vatCode)
    .map((l) => ({
      vatCode: l.vatCode as string,
      ...toNetAndVat(l.vatCode as string, l.debit, l.credit, Number(l.vatAmount ?? 0)),
    }));
}

// ── Ohne Steuersatz bleibt alles wie bisher ────────────────────────────────

test("ein Vorgang ohne Steuersatz erzeugt keine Steuerzeile", () => {
  const e = buildCashbookEntry(entry({ amount: 100 }), ctx);
  assert.ok(e);
  assert.equal(e.lines.length, 2);
  assert.equal(e.lines.find((l) => l.vatCode), undefined);
});

test("ohne Steuersatz taucht der Vorgang nicht in der Voranmeldung auf", () => {
  const e = buildCashbookEntry(entry({ amount: 100 }), ctx);
  assert.ok(e);
  assert.equal(toUstvaLines(e.lines).length, 0);
});

// ── Bareinnahme mit Umsatzsteuer — die eigentliche Lücke ───────────────────

test("eine Bareinnahme mit 19 % spaltet Netto und Umsatzsteuer auf", () => {
  const e = buildCashbookEntry(entry({ amount: 119, vatRate: 19 }), ctx);
  assert.ok(e);
  assert.equal(e.lines.find((l) => l.accountCode === "1000")?.debit, 119, "Kasse brutto");
  assert.equal(e.lines.find((l) => l.accountCode === "8400")?.credit, 100, "Erlös netto");
  assert.equal(e.lines.find((l) => l.accountCode === "1776")?.credit, 19, "USt 19 %");
});

test("die Buchung ist ausgeglichen", () => {
  const e = buildCashbookEntry(entry({ amount: 119, vatRate: 19 }), ctx);
  assert.ok(e);
  assert.equal(sum(e.lines, "debit"), sum(e.lines, "credit"));
});

test("die Bareinnahme landet jetzt in Kz 81 der Voranmeldung", () => {
  const e = buildCashbookEntry(entry({ amount: 119, vatRate: 19 }), ctx);
  assert.ok(e);
  const r = computeUstva(FORM_2026, toUstvaLines(e.lines));
  assert.equal(r.byKz.get("81")?.value, 100);
  assert.equal(r.totalVat, 19);
});

test("der ermäßigte Satz geht nach Kz 86", () => {
  const e = buildCashbookEntry(entry({ amount: 107, vatRate: 7 }), ctx);
  assert.ok(e);
  const r = computeUstva(FORM_2026, toUstvaLines(e.lines));
  assert.equal(r.byKz.get("86")?.value, 100);
});

// ── Barausgabe ─────────────────────────────────────────────────────────────

test("eine Barausgabe mit Steuer erzeugt Vorsteuer nach Kz 66", () => {
  const e = buildCashbookEntry(entry({ amount: 119, entryType: "EXPENSE", vatRate: 19 }), ctx);
  assert.ok(e);
  assert.equal(e.lines.find((l) => l.accountCode === "1576")?.debit, 19, "Vorsteuer im Soll");
  assert.equal(e.lines.find((l) => l.accountCode === "1000")?.credit, 119, "Kasse brutto");
  assert.equal(sum(e.lines, "debit"), sum(e.lines, "credit"));

  const r = computeUstva(FORM_2026, toUstvaLines(e.lines));
  assert.equal(r.byKz.get("66")?.value, 19);
});

// ── Sonderfälle ────────────────────────────────────────────────────────────

test("Kleinunternehmer bekommen keine Steuerzeile, auch wenn ein Satz gesetzt ist", () => {
  const e = buildCashbookEntry(entry({ amount: 119, vatRate: 19 }), {
    ...ctx,
    taxMode: "SMALL_BUSINESS",
  });
  assert.ok(e);
  assert.equal(e.lines.find((l) => l.vatCode), undefined);
  assert.equal(e.lines.find((l) => l.accountCode === "1000")?.debit, 119);
});

test("ein eigenes Erlöskonto überschreibt das Standardkonto, die Steuer bleibt", () => {
  const e = buildCashbookEntry(entry({ amount: 119, vatRate: 19, category: "8300" }), ctx);
  assert.ok(e);
  assert.equal(e.lines.find((l) => l.accountCode === "8300")?.credit, 100);
  assert.equal(e.lines.find((l) => l.accountCode === "1776")?.credit, 19);
});

test("ein abweichender Steuerbetrag laut Beleg hat Vorrang", () => {
  const e = buildCashbookEntry(entry({ amount: 12.6, vatRate: 19, vatAmount: 2.02 }), ctx);
  assert.ok(e);
  assert.equal(e.lines.find((l) => l.accountCode === "1776")?.credit, 2.02);
  assert.equal(e.lines.find((l) => l.accountCode === "8400")?.credit, 10.58);
  assert.equal(sum(e.lines, "debit"), sum(e.lines, "credit"));
});

test("im Einzelbuchungsmodus trägt die Kassenzeile den Steuerschlüssel", () => {
  const e = buildCashbookEntry(entry({ amount: 119, vatRate: 19 }), {
    ...ctx,
    accountingMode: "SINGLE_ENTRY",
  });
  assert.ok(e);
  assert.equal(e.lines.length, 1);
  assert.equal(e.lines[0].vatCode, "USt19");
  assert.equal(e.lines[0].vatAmount, 19);
});

test("ein Betrag von null erzeugt keine Buchung", () => {
  assert.equal(buildCashbookEntry(entry({ amount: 0, vatRate: 19 }), ctx), null);
});
