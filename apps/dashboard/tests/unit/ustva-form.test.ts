import { test } from "node:test";
import assert from "node:assert/strict";
import { FORM_2026, resolveForm } from "../../src/lib/taxes/ustva/forms";
import type { UstvaField } from "../../src/lib/taxes/ustva/types";

function allFields(): UstvaField[] {
  return FORM_2026.sections.flatMap((s) => s.fields);
}

function kzMap(): Map<string, UstvaField> {
  const m = new Map<string, UstvaField>();
  for (const f of allFields()) if (f.kz) m.set(f.kz, f);
  return m;
}

// ── Strukturelle Integrität ────────────────────────────────────────────────
// Diese Tests prüfen keine Fachlichkeit, sondern dass niemand beim Pflegen
// eines Jahrgangs eine Kennzahl verdoppelt oder eine Referenz ins Leere
// zeigen lässt. Genau das sind die Fehler, die man beim Draufschauen übersieht.

test("Kennzahlen sind eindeutig", () => {
  const seen = new Set<string>();
  for (const f of allFields()) {
    if (!f.kz) continue;
    assert.ok(!seen.has(f.kz), `Kennzahl ${f.kz} ist doppelt vergeben`);
    seen.add(f.kz);
  }
});

test("jede taxKz-Referenz zeigt auf ein existierendes Steuerfeld", () => {
  const map = kzMap();
  for (const f of allFields()) {
    if (!f.taxKz) continue;
    const target = map.get(f.taxKz);
    assert.ok(target, `Kz ${f.kz} verweist auf unbekannte Kz ${f.taxKz}`);
    assert.equal(target.kind, "tax", `Kz ${f.taxKz} muss ein Steuerfeld sein`);
    assert.equal(target.zeile, f.zeile, `Kz ${f.kz}/${f.taxKz} müssen dieselbe Zeile teilen`);
  }
});

test("Bemessungsgrundlagen haben entweder einen Steuersatz oder eine taxKz — nie beides", () => {
  for (const f of allFields()) {
    if (f.kind !== "bmg") continue;
    const hasRate = f.rate !== undefined;
    const hasTaxKz = f.taxKz !== undefined;
    assert.ok(!(hasRate && hasTaxKz), `Kz ${f.kz} hat sowohl rate als auch taxKz`);
  }
});

test("Bemessungsgrundlagen runden auf volle Euro, Steuerbeträge auf Cent", () => {
  for (const f of allFields()) {
    if (f.kind === "bmg") {
      assert.equal(f.rounding, "euro", `Kz ${f.kz} ist eine BMG und muss auf Euro runden`);
    }
    if (f.kind === "tax" || f.kind === "input_tax") {
      assert.equal(f.rounding, "cent", `Kz ${f.kz} ist ein Steuerbetrag und braucht Cent`);
    }
  }
});

test("Zeilennummern laufen über das Formular hinweg aufsteigend", () => {
  let previous = 0;
  for (const f of allFields()) {
    assert.ok(f.zeile >= previous, `Zeile ${f.zeile} folgt auf ${previous} — Reihenfolge kaputt`);
    previous = f.zeile;
  }
});

// ── Stichproben gegen das amtliche Vordruckmuster ──────────────────────────
// Punktuelle Absicherung der Felder, die wir tatsächlich befüllen. Wenn hier
// etwas rot wird, stimmt das Mapping nicht mehr mit dem Papier überein.

test("Kernkennzahlen sitzen auf den amtlichen Zeilen", () => {
  const map = kzMap();
  const expected: Array<[string, number, number | undefined]> = [
    // [Kennzahl, Zeile, Steuersatz]
    ["81", 13, 19],
    ["86", 14, 7],
    ["87", 15, 0],
    ["41", 19, undefined],
    ["43", 22, undefined],
    ["48", 23, undefined],
    ["89", 25, 19],
    ["93", 26, 7],
    ["46", 30, undefined],
    ["84", 32, undefined],
    ["60", 34, undefined],
    ["21", 35, undefined],
    ["45", 36, undefined],
    ["66", 38, undefined],
    ["61", 39, undefined],
    ["62", 40, undefined],
    ["67", 41, undefined],
    ["83", 50, undefined],
  ];
  for (const [kz, zeile, rate] of expected) {
    const f = map.get(kz);
    assert.ok(f, `Kz ${kz} fehlt im Vordruck 2026`);
    assert.equal(f.zeile, zeile, `Kz ${kz} steht auf Zeile ${f.zeile}, erwartet ${zeile}`);
    assert.equal(f.rate, rate, `Kz ${kz} hat Steuersatz ${f.rate}, erwartet ${rate}`);
  }
});

test("Abschnitte tragen die amtlichen Buchstaben A–J", () => {
  assert.deepEqual(
    FORM_2026.sections.map((s) => s.id),
    ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
  );
});

test("nachrichtliche Felder in Abschnitt I sind als memoOnly markiert", () => {
  const map = kzMap();
  assert.equal(map.get("50")?.memoOnly, true);
  assert.equal(map.get("37")?.memoOnly, true);
});

// ── Jahresauflösung ────────────────────────────────────────────────────────

test("ein gepflegtes Jahr wird exakt aufgelöst", () => {
  const r = resolveForm(2026);
  assert.equal(r.form.year, 2026);
  assert.equal(r.isFallback, false);
});

test("ein ungepflegtes Folgejahr erbt den jüngsten Jahrgang und meldet den Fallback", () => {
  const r = resolveForm(2027);
  assert.equal(r.form.year, 2026);
  assert.equal(r.requestedYear, 2027);
  assert.equal(r.isFallback, true);
});

test("ein Jahr vor dem frühesten Jahrgang fällt auf diesen zurück", () => {
  const r = resolveForm(2019);
  assert.equal(r.form.year, 2026);
  assert.equal(r.isFallback, true);
});
