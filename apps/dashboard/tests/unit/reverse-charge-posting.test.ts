import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDocumentBookedEntry } from "../../src/lib/journal/posting-rules";
import type { PostingContext } from "../../src/lib/journal/types";
import { computeUstva, type UstvaSourceLine } from "../../src/lib/taxes/ustva/compute";
import { FORM_2026 } from "../../src/lib/taxes/ustva/forms";

const ctx: PostingContext = {
  tenantId: "t1",
  skrType: "SKR03",
  accountingMode: "DOUBLE_ENTRY",
  taxMode: "STANDARD",
};

type DocArgs = {
  inputVatKind?: string | null;
  net?: number;
  rate?: number;
  taxMode?: "STANDARD" | "SMALL_BUSINESS";
};

// Minimaler Beleg — nur die Felder, die die Buchungsregel liest.
function doc({ inputVatKind = null, net = 1000, rate = 19 }: DocArgs = {}) {
  return {
    id: "d1",
    fileName: "aws-invoice.pdf",
    documentNumber: "AWS-2026-01",
    documentType: "EXPENSE",
    inputVatKind,
    vatRate: rate,
    bookingAccount: "4920",
    recognizedSupplier: "Amazon Web Services EMEA SARL",
    recognizedAmount: net,
    recognizedDate: new Date("2026-01-15"),
    deliveryDate: new Date("2026-01-15"),
    createdAt: new Date("2026-01-20"),
    lineItems: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function sum(lines: { debit: number; credit: number }[], side: "debit" | "credit") {
  return lines.reduce((s, l) => s + l[side], 0);
}

/** Buchungszeilen in die Form bringen, die die UStVA-Berechnung erwartet. */
function toUstvaLines(
  lines: { vatCode?: string | null; vatAmount?: number | null; debit: number; credit: number }[],
): UstvaSourceLine[] {
  return lines
    .filter((l) => l.vatCode)
    .map((l) => ({
      vatCode: l.vatCode as string,
      net: l.debit - l.credit,
      vat: Number(l.vatAmount ?? 0),
    }));
}

// ── Regelfall bleibt unverändert ───────────────────────────────────────────

test("eine inländische Rechnung bucht weiterhin brutto mit Vorsteuer nach Kz 66", () => {
  const entry = buildDocumentBookedEntry(doc({ net: 1190 }), ctx);
  assert.ok(entry);
  const vst = entry.lines.find((l) => l.vatCode === "VSt19");
  assert.ok(vst, "Vorsteuerzeile fehlt");
  assert.equal(vst.debit, 190);
  // Brutto 1190 → Netto 1000
  const expense = entry.lines.find((l) => l.accountCode === "4920");
  assert.equal(expense?.debit, 1000);
});

// ── § 13b — der Fall, der bisher komplett fehlte ───────────────────────────

test("§ 13b EU-Dienstleistung: der Rechnungsbetrag ist netto, nicht brutto", () => {
  const entry = buildDocumentBookedEntry(
    doc({ inputVatKind: "REVERSE_CHARGE_EU_SERVICE", net: 1000 }),
    ctx,
  );
  assert.ok(entry);
  const expense = entry.lines.find((l) => l.accountCode === "4920");
  assert.equal(expense?.debit, 1000, "Aufwand muss der volle Rechnungsbetrag sein");
});

test("§ 13b erzeugt geschuldete Steuer und Vorsteuer in gleicher Höhe", () => {
  const entry = buildDocumentBookedEntry(
    doc({ inputVatKind: "REVERSE_CHARGE_EU_SERVICE", net: 1000 }),
    ctx,
  );
  assert.ok(entry);
  const owed = entry.lines.find((l) => l.accountCode === "1787");
  const deductible = entry.lines.find((l) => l.vatCode === "VSt:13b");
  assert.equal(owed?.credit, 190);
  assert.equal(deductible?.debit, 190);
});

test("§ 13b: die Verbindlichkeit ist der Nettobetrag — so steht es auf der Rechnung", () => {
  const entry = buildDocumentBookedEntry(
    doc({ inputVatKind: "REVERSE_CHARGE_EU_SERVICE", net: 1000 }),
    ctx,
  );
  assert.ok(entry);
  const payable = entry.lines.find((l) => l.accountCode === "1600");
  assert.equal(payable?.credit, 1000);
});

test("§ 13b: die Buchung ist ausgeglichen", () => {
  const entry = buildDocumentBookedEntry(
    doc({ inputVatKind: "REVERSE_CHARGE_EU_SERVICE", net: 1000 }),
    ctx,
  );
  assert.ok(entry);
  assert.equal(sum(entry.lines, "debit"), sum(entry.lines, "credit"));
});

test("§ 13b: die Aufwandszeile trägt Bemessungsgrundlage und Steuer für die UStVA", () => {
  const entry = buildDocumentBookedEntry(
    doc({ inputVatKind: "REVERSE_CHARGE_EU_SERVICE", net: 1000 }),
    ctx,
  );
  assert.ok(entry);
  const expense = entry.lines.find((l) => l.vatCode === "RC13b19");
  assert.ok(expense, "Aufwandszeile braucht den Steuerschlüssel RC13b19");
  assert.equal(expense.vatAmount, 190);
});

// ── Durchstich bis in die Voranmeldung ─────────────────────────────────────

test("eine AWS-Rechnung landet am Ende in Kz 46/47 und 67 — und ist zahllastneutral", () => {
  const entry = buildDocumentBookedEntry(
    doc({ inputVatKind: "REVERSE_CHARGE_EU_SERVICE", net: 1000 }),
    ctx,
  );
  assert.ok(entry);
  const r = computeUstva(FORM_2026, toUstvaLines(entry.lines));

  assert.equal(r.byKz.get("46")?.value, 1000, "Bemessungsgrundlage gehört in Kz 46");
  assert.equal(r.byKz.get("47")?.value, 190, "geschuldete Steuer gehört in Kz 47");
  assert.equal(r.byKz.get("67")?.value, 190, "Vorsteuer gehört in Kz 67");
  assert.equal(r.byKz.get("66")?.value, 0, "sie darf gerade NICHT in Kz 66 landen");
  assert.equal(r.payable, 0, "§ 13b ist bei voller Abzugsberechtigung zahllastneutral");
});

test("die übrigen § 13b-Tatbestände gehen nach Kz 84/85", () => {
  const entry = buildDocumentBookedEntry(
    doc({ inputVatKind: "REVERSE_CHARGE_OTHER", net: 5000 }),
    ctx,
  );
  assert.ok(entry);
  const r = computeUstva(FORM_2026, toUstvaLines(entry.lines));
  assert.equal(r.byKz.get("84")?.value, 5000);
  assert.equal(r.byKz.get("85")?.value, 950);
});

test("innergemeinschaftlicher Erwerb geht nach Kz 89 mit Vorsteuer in Kz 61", () => {
  const entry = buildDocumentBookedEntry(
    doc({ inputVatKind: "INTRA_COMMUNITY_ACQUISITION", net: 2000 }),
    ctx,
  );
  assert.ok(entry);
  const r = computeUstva(FORM_2026, toUstvaLines(entry.lines));
  assert.equal(r.byKz.get("89")?.value, 2000);
  assert.equal(r.byKz.get("61")?.value, 380);
  assert.equal(r.payable, 0);
});

test("Einfuhrumsatzsteuer landet vollständig in Kz 62", () => {
  const entry = buildDocumentBookedEntry(doc({ inputVatKind: "IMPORT_VAT", net: 430.5 }), ctx);
  assert.ok(entry);
  const r = computeUstva(FORM_2026, toUstvaLines(entry.lines));
  assert.equal(r.byKz.get("62")?.value, 430.5);
  assert.equal(r.payable, -430.5);
});

// ── Kleinunternehmer ───────────────────────────────────────────────────────

test("Kleinunternehmer schulden die § 13b-Steuer, dürfen sie aber nicht abziehen", () => {
  const entry = buildDocumentBookedEntry(
    doc({ inputVatKind: "REVERSE_CHARGE_EU_SERVICE", net: 1000 }),
    { ...ctx, taxMode: "SMALL_BUSINESS" },
  );
  assert.ok(entry);
  assert.ok(
    entry.lines.some((l) => l.accountCode === "1787" && l.credit === 190),
    "die geschuldete Steuer muss trotzdem gebucht werden",
  );
  assert.equal(
    entry.lines.find((l) => l.vatCode === "VSt:13b"),
    undefined,
    "ein Vorsteuerabzug darf nicht entstehen",
  );
});

// ── Steuerbetrag laut Beleg ────────────────────────────────────────────────
// Lieferanten dürfen die Steuer je Position runden (§ 14 UStG). Die Summe
// weicht dann von der Rückrechnung aus dem Brutto ab. Für den Vorsteuerabzug
// zählt der ausgewiesene Betrag.

function docWithLines(
  lines: Array<{ total: number; vatRate: number; vatAmount?: number }>,
) {
  return {
    ...doc(),
    recognizedAmount: null,
    lineItems: lines.map((l, i) => ({
      id: `li${i}`,
      position: i,
      description: null,
      skrAccount: "4920",
      depreciation: null,
      amount: null,
      vatRule: null,
      vatRate: l.vatRate,
      vatAmount: l.vatAmount ?? null,
      total: l.total,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test("ohne Angabe wird die Steuer wie bisher aus Brutto und Satz abgeleitet", () => {
  const entry = buildDocumentBookedEntry(docWithLines([{ total: 12.6, vatRate: 19 }]), ctx);
  assert.ok(entry);
  const vst = entry.lines.find((l) => l.vatCode === "VSt19");
  assert.equal(vst?.debit, 2.01);
});

test("der Hetzner-Fall: die positionsweise gerundete Steuer laut Beleg gewinnt", () => {
  // 2 × 5,29 € netto → je 1,0051 € Steuer, gerundet je 1,01 €, in Summe 2,02 €.
  // Aus 12,60 € brutto zurückgerechnet käme 2,01 € heraus.
  const entry = buildDocumentBookedEntry(
    docWithLines([{ total: 12.6, vatRate: 19, vatAmount: 2.02 }]),
    ctx,
  );
  assert.ok(entry);
  const vst = entry.lines.find((l) => l.vatCode === "VSt19");
  assert.equal(vst?.debit, 2.02, "Vorsteuer muss dem Beleg entsprechen");
  const expense = entry.lines.find((l) => l.accountCode === "4920");
  assert.equal(expense?.debit, 10.58, "Netto ist Brutto minus ausgewiesene Steuer");
});

test("die Buchung bleibt mit abweichender Steuer ausgeglichen", () => {
  const entry = buildDocumentBookedEntry(
    docWithLines([{ total: 12.6, vatRate: 19, vatAmount: 2.02 }]),
    ctx,
  );
  assert.ok(entry);
  assert.equal(sum(entry.lines, "debit"), sum(entry.lines, "credit"));
  assert.equal(entry.lines.find((l) => l.accountCode === "1600")?.credit, 12.6);
});

// ── SKR03-Kontonummern ─────────────────────────────────────────────────────
// Geprüft gegen DATEV SKR 03, Art.-Nr. 11174, gültig für 2026. Benachbarte
// Nummern bedeuten etwas anderes (1573 = Dreiecksgeschäft, 1575/1773 = im
// Stand 2026 reserviert), deshalb festnageln.

test("§ 13b bucht auf die amtlichen SKR03-Konten 1787 und 1577", () => {
  const entry = buildDocumentBookedEntry(
    doc({ inputVatKind: "REVERSE_CHARGE_EU_SERVICE", net: 1000, rate: 19 }),
    ctx,
  );
  assert.ok(entry);
  assert.ok(entry.lines.some((l) => l.accountCode === "1787" && l.credit === 190));
  assert.ok(entry.lines.some((l) => l.accountCode === "1577" && l.debit === 190));
});

test("§ 13b zum ermäßigten Satz nutzt die generischen Konten 1785 und 1578", () => {
  const entry = buildDocumentBookedEntry(
    doc({ inputVatKind: "REVERSE_CHARGE_EU_SERVICE", net: 1000, rate: 7 }),
    ctx,
  );
  assert.ok(entry);
  assert.ok(entry.lines.some((l) => l.accountCode === "1785" && l.credit === 70));
  assert.ok(entry.lines.some((l) => l.accountCode === "1578" && l.debit === 70));
});

test("innergemeinschaftlicher Erwerb bucht auf 1774 und 1574 — nicht 1773/1573", () => {
  const entry = buildDocumentBookedEntry(
    doc({ inputVatKind: "INTRA_COMMUNITY_ACQUISITION", net: 2000, rate: 19 }),
    ctx,
  );
  assert.ok(entry);
  assert.ok(entry.lines.some((l) => l.accountCode === "1774" && l.credit === 380));
  assert.ok(entry.lines.some((l) => l.accountCode === "1574" && l.debit === 380));
  assert.equal(entry.lines.find((l) => l.accountCode === "1573"), undefined);
  assert.equal(entry.lines.find((l) => l.accountCode === "1773"), undefined);
});

test("Einfuhrumsatzsteuer bucht auf SKR03 1588", () => {
  const entry = buildDocumentBookedEntry(doc({ inputVatKind: "IMPORT_VAT", net: 430.5 }), ctx);
  assert.ok(entry);
  assert.ok(entry.lines.some((l) => l.accountCode === "1588" && l.debit === 430.5));
});

// ── SKR04-Kontonummern ─────────────────────────────────────────────────────
// Geprüft gegen DATEV SKR 04, Art.-Nr. 11175, gültig für 2026.
// 1405 und 3836 sind in diesem Stand reserviert.

const ctx04: PostingContext = { ...ctx, skrType: "SKR04" };

test("§ 13b bucht im SKR04 auf 3837 und 1407", () => {
  const entry = buildDocumentBookedEntry(
    doc({ inputVatKind: "REVERSE_CHARGE_EU_SERVICE", net: 1000, rate: 19 }),
    ctx04,
  );
  assert.ok(entry);
  assert.ok(entry.lines.some((l) => l.accountCode === "3837" && l.credit === 190));
  assert.ok(entry.lines.some((l) => l.accountCode === "1407" && l.debit === 190));
});

test("§ 13b zum ermäßigten Satz nutzt im SKR04 die generischen 3835 und 1408", () => {
  const entry = buildDocumentBookedEntry(
    doc({ inputVatKind: "REVERSE_CHARGE_EU_SERVICE", net: 1000, rate: 7 }),
    ctx04,
  );
  assert.ok(entry);
  assert.ok(entry.lines.some((l) => l.accountCode === "3835" && l.credit === 70));
  assert.ok(entry.lines.some((l) => l.accountCode === "1408" && l.debit === 70));
  assert.equal(
    entry.lines.find((l) => l.accountCode === "1405"),
    undefined,
    "1405 ist im Stand 2026 reserviert und darf nicht bebucht werden",
  );
});

test("innergemeinschaftlicher Erwerb bucht im SKR04 auf 3804 und 1404", () => {
  const entry = buildDocumentBookedEntry(
    doc({ inputVatKind: "INTRA_COMMUNITY_ACQUISITION", net: 2000, rate: 19 }),
    ctx04,
  );
  assert.ok(entry);
  assert.ok(entry.lines.some((l) => l.accountCode === "3804" && l.credit === 380));
  assert.ok(entry.lines.some((l) => l.accountCode === "1404" && l.debit === 380));
  assert.equal(
    entry.lines.find((l) => l.accountCode === "1436"),
    undefined,
    "1436 ist das Dreiecksgeschäft-Konto, nicht der innergemeinschaftliche Erwerb",
  );
});

test("Einfuhrumsatzsteuer bucht im SKR04 auf 1433", () => {
  const entry = buildDocumentBookedEntry(doc({ inputVatKind: "IMPORT_VAT", net: 430.5 }), ctx04);
  assert.ok(entry);
  assert.ok(entry.lines.some((l) => l.accountCode === "1433" && l.debit === 430.5));
});

test("die SKR04-Buchung ist ebenfalls ausgeglichen", () => {
  const entry = buildDocumentBookedEntry(
    doc({ inputVatKind: "REVERSE_CHARGE_EU_SERVICE", net: 1000 }),
    ctx04,
  );
  assert.ok(entry);
  assert.equal(sum(entry.lines, "debit"), sum(entry.lines, "credit"));
});

// ── Randfälle ──────────────────────────────────────────────────────────────

test("ein Beleg über 0 € erzeugt keine Buchung", () => {
  assert.equal(
    buildDocumentBookedEntry(doc({ inputVatKind: "REVERSE_CHARGE_EU_SERVICE", net: 0 }), ctx),
    null,
  );
});

test("§ 13b zum ermäßigten Satz nutzt dieselbe Kennzahl, aber 7 %", () => {
  const entry = buildDocumentBookedEntry(
    doc({ inputVatKind: "REVERSE_CHARGE_EU_SERVICE", net: 1000, rate: 7 }),
    ctx,
  );
  assert.ok(entry);
  const r = computeUstva(FORM_2026, toUstvaLines(entry.lines));
  assert.equal(r.byKz.get("46")?.value, 1000);
  assert.equal(r.byKz.get("47")?.value, 70);
});
