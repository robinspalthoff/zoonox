import { test } from "node:test";
import assert from "node:assert/strict";
import { toNetAndVat } from "../../src/lib/taxes/ustva/line-mapping";

// Die Buchungszeilen unten sind echte Ausgaben der Regeln aus
// src/lib/journal/posting-rules.ts — deshalb sind die Fälle so unsymmetrisch.

test("USt19 sitzt auf der Umsatzsteuerzeile: Betrag ist die Steuer, Netto wird zurückgerechnet", () => {
  // Doppelte Buchführung: Umsatzsteuer 190 € im Haben.
  const r = toNetAndVat("USt19", 0, 190, 190);
  assert.equal(r.vat, 190);
  assert.equal(r.net, 1000);
});

test("USt7 rechnet mit dem ermäßigten Satz zurück", () => {
  const r = toNetAndVat("USt7", 0, 35, 35);
  assert.equal(r.net, 500);
});

test("im Einzelbuchungsmodus steht das Brutto auf der Zeile — vatAmount bleibt maßgeblich", () => {
  // SINGLE_ENTRY: Erlöszeile trägt 1190 € brutto, vatAmount die Steuer.
  const r = toNetAndVat("USt19", 0, 1190, 190);
  assert.equal(r.vat, 190);
  assert.equal(r.net, 1000, "Netto darf nicht aus dem Brutto der Zeile kommen");
});

test("steuerfreie Erlöse tragen das Netto direkt", () => {
  const r = toNetAndVat("USt0:IG", 0, 5000, 0);
  assert.equal(r.net, 5000);
  assert.equal(r.vat, 0);
});

test("Vorsteuer steht im Soll und wird positiv gezählt", () => {
  const r = toNetAndVat("VSt19", 190, 0, 190);
  assert.equal(r.vat, 190);
  assert.equal(r.net, 1000);
});

test("Reverse-Charge-Aufwand steht im Soll und trägt das Netto", () => {
  const r = toNetAndVat("RC13b19", 1000, 0, 190);
  assert.equal(r.net, 1000);
  assert.equal(r.vat, 190);
});

test("Vorsteuer aus § 13b trägt nur den Steuerbetrag, kein Netto", () => {
  const r = toNetAndVat("VSt:13b", 190, 0, 190);
  assert.equal(r.vat, 190);
  assert.equal(r.net, 0, "ohne Satz gibt es hier kein sinnvolles Netto");
});

test("eine Gutschrift dreht das Vorzeichen mit", () => {
  // Stornobuchung: Umsatzsteuer im Soll statt im Haben.
  const r = toNetAndVat("USt19", 190, 0, -190);
  assert.equal(r.vat, -190);
  assert.equal(r.net, -1000);
});

test("ein unbekannter Steuerschlüssel wird unverändert durchgereicht", () => {
  const r = toNetAndVat("VSt42", 0, 0, 42);
  assert.equal(r.vat, 42);
});
