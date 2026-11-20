import { test } from "node:test";
import assert from "node:assert/strict";
import { detectInputVatKind } from "../../src/lib/ocr/reverse-charge";

// Die Textausschnitte unten sind an echte Rechnungsformulierungen angelehnt.

test("AWS-Rechnung mit englischem Reverse-Charge-Vermerk", () => {
  const d = detectInputVatKind(
    "Amazon Web Services EMEA SARL\n38 Avenue John F. Kennedy, L-1855 Luxembourg\n" +
      "VAT Registration Number: LU26888617\n" +
      "VAT amount: 0.00 EUR\nVAT reverse charged",
  );
  assert.equal(d?.kind, "REVERSE_CHARGE_EU_SERVICE");
  assert.ok(d.evidence.some((e) => e.includes("LU26888617")), "USt-IdNr. als Beleg erwartet");
});

test("deutscher Hinweis auf die Steuerschuldnerschaft des Leistungsempfängers", () => {
  const d = detectInputVatKind(
    "Rechnung\nSteuerschuldnerschaft des Leistungsempfängers gemäß § 13b UStG",
  );
  assert.equal(d?.kind, "REVERSE_CHARGE_EU_SERVICE");
});

test("Bauleistung wird als übriger § 13b-Tatbestand erkannt (Kz 84/85)", () => {
  const d = detectInputVatKind(
    "Bauleistungen gemäß Werkvertrag\nReverse Charge — Steuerschuldnerschaft des Leistungsempfängers",
  );
  assert.equal(d?.kind, "REVERSE_CHARGE_OTHER");
});

test("Gebäudereinigung landet ebenfalls bei den übrigen Tatbeständen", () => {
  const d = detectInputVatKind("Gebäudereinigung Objekt Musterstraße\nUmkehr der Steuerschuld");
  assert.equal(d?.kind, "REVERSE_CHARGE_OTHER");
});

test("Grunderwerbsteuer-Fall bekommt seine eigene Einstufung", () => {
  const d = detectInputVatKind(
    "Grundstückskaufvertrag, Umsatz fällt unter das GrEStG\nReverse Charge",
  );
  assert.equal(d?.kind, "REVERSE_CHARGE_GRESTG");
});

test("innergemeinschaftliche Lieferung des Lieferanten ist für uns ein Erwerb", () => {
  const d = detectInputVatKind(
    "Steuerfreie innergemeinschaftliche Lieferung gemäß Art. 138 MwStSystRL\nNettobetrag 2.000,00",
  );
  assert.equal(d?.kind, "INTRA_COMMUNITY_ACQUISITION");
});

test("Einfuhrabgabenbescheid des Zolls wird als Einfuhrumsatzsteuer erkannt", () => {
  const d = detectInputVatKind("Hauptzollamt Hamburg\nEinfuhrabgabenbescheid\nEinfuhrumsatzsteuer 430,50 EUR");
  assert.equal(d?.kind, "IMPORT_VAT");
});

test("Einfuhrumsatzsteuer schlägt § 13b, wenn beides im Text steht", () => {
  const d = detectInputVatKind("Zollamt\nEinfuhrumsatzsteuer\nHinweis: reverse charge");
  assert.equal(d?.kind, "IMPORT_VAT");
});

// ── Was NICHT erkannt werden darf ──────────────────────────────────────────

test("eine normale deutsche Rechnung mit ausgewiesener USt löst nichts aus", () => {
  const d = detectInputVatKind(
    "Rechnung Nr. 2026-042\nNetto 1.000,00 EUR\nzzgl. 19% MwSt 190,00 EUR\n" +
      "Gesamt 1.190,00 EUR\nUSt-IdNr. DE123456789",
  );
  assert.equal(d, null);
});

test("eine deutsche USt-IdNr. allein ist kein Reverse-Charge-Merkmal", () => {
  assert.equal(detectInputVatKind("Lieferant GmbH, USt-IdNr. DE811234567"), null);
});

test("eine ausländische USt-IdNr. allein reicht nicht", () => {
  // Ohne Reverse-Charge-Vermerk kann das auch eine normal besteuerte
  // Leistung sein — hier lieber nichts setzen als falsch buchen.
  assert.equal(detectInputVatKind("Fournisseur SARL, TVA FR12345678901"), null);
});

test("leerer oder fehlender Text ergibt keine Einstufung", () => {
  assert.equal(detectInputVatKind(null), null);
  assert.equal(detectInputVatKind(""), null);
});

test("ein Ländername wird nicht als USt-IdNr. missverstanden", () => {
  // "LUXEMBOURG" beginnt mit dem Ländercode LU und ist sonst reine Buchstaben —
  // eine echte USt-IdNr. besteht überwiegend aus Ziffern.
  const d = detectInputVatKind("Sitz: Luxembourg\nReverse charge");
  assert.equal(d?.kind, "REVERSE_CHARGE_EU_SERVICE");
  assert.ok(
    !d.evidence.some((e) => e.includes("LUXEMBOURG")),
    "der Ländername darf nicht als USt-IdNr. auftauchen",
  );
});

test("die Erkennung ist unabhängig von Groß- und Kleinschreibung", () => {
  assert.equal(detectInputVatKind("REVERSE CHARGE")?.kind, "REVERSE_CHARGE_EU_SERVICE");
  assert.equal(detectInputVatKind("Reverse Charge")?.kind, "REVERSE_CHARGE_EU_SERVICE");
});

test("fehlende Umlaute aus schlechter OCR werden mitgefangen", () => {
  const d = detectInputVatKind("Steuerschuldnerschaft des Leistungsempfangers");
  assert.equal(d?.kind, "REVERSE_CHARGE_EU_SERVICE");
});
