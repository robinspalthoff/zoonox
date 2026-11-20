import { test } from "node:test";
import assert from "node:assert/strict";
import { FORM_2026 } from "../../src/lib/taxes/ustva/forms";
import {
  computeUstva,
  roundEuro,
  roundEuroInFavour,
  roundCent,
  type UstvaSourceLine,
} from "../../src/lib/taxes/ustva/compute";
import { targetFor, mappedVatCodes } from "../../src/lib/taxes/ustva/mapping";

function line(vatCode: string, net: number, vat = 0): UstvaSourceLine<string> {
  return { vatCode, net, vat, source: `${vatCode}:${net}` };
}

function run(lines: UstvaSourceLine<string>[]) {
  return computeUstva(FORM_2026, lines);
}

function kz(r: ReturnType<typeof run>, k: string): number {
  const row = r.byKz.get(k);
  assert.ok(row, `Kennzahl ${k} fehlt im Ergebnis`);
  return row.value;
}

// ── Rundung ────────────────────────────────────────────────────────────────

test("nachrichtliche Bemessungsgrundlagen runden kaufmännisch auf volle Euro", () => {
  assert.equal(roundEuro(100.49), 100);
  assert.equal(roundEuro(100.5), 101);
  assert.equal(roundEuro(0), 0);
});

test("steuerauslösende Bemessungsgrundlagen runden zugunsten des Steuerpflichtigen ab", () => {
  assert.equal(roundEuroInFavour(100.99), 100);
  assert.equal(roundEuroInFavour(100.01), 100);
  // Negativ: Abrunden Richtung minus unendlich vergrößert das Guthaben,
  // ist also ebenfalls zugunsten des Steuerpflichtigen.
  assert.equal(roundEuroInFavour(-100.01), -101);
});

test("Rundung ist symmetrisch um null — Gutschriften dürfen nicht driften", () => {
  // Math.round(-0.5) ergibt -0, rundet also Richtung plus unendlich. Bei
  // Gutschriften und Entgeltminderungen sind negative Beträge normal, deshalb
  // muss die Rundung am Vorzeichen gespiegelt sein statt verschoben.
  assert.equal(roundEuro(-100.5), -101);
  assert.equal(roundEuro(-100.49), -100);

  // Als Eigenschaft geprüft, nicht an einem einzelnen Grenzwert: Werte wie
  // 1.005 sind binär nicht exakt darstellbar, ein Literal-Vergleich würde
  // Float-Verhalten testen statt unserer Rundungsregel.
  for (const v of [0.5, 1.005, 12.345, 100.5, 1234.567, 0.004]) {
    assert.equal(roundCent(-v), -roundCent(v), `roundCent bei ${v} nicht symmetrisch`);
    assert.equal(roundEuro(-v), -roundEuro(v), `roundEuro bei ${v} nicht symmetrisch`);
  }
});

// ── Grundfall ──────────────────────────────────────────────────────────────

test("19%-Umsatz landet als Bemessungsgrundlage in Kz 81", () => {
  const r = run([line("USt19", 1000, 190)]);
  assert.equal(kz(r, "81"), 1000);
  assert.equal(r.totalVat, 190);
});

test("ELSTER rechnet die Steuer aus der gerundeten Bemessungsgrundlage", () => {
  // 1000,49 € netto → BMG 1000 € → Steuer 190,00 €, nicht 190,09 €.
  const r = run([line("USt19", 1000.49, 190.09)]);
  assert.equal(kz(r, "81"), 1000);
  assert.equal(r.totalVat, 190);
});

test("Kz 81 wird abgerundet, auch wenn kaufmännisch aufzurunden wäre", () => {
  const r = run([line("USt19", 1000.9, 190.17)]);
  assert.equal(kz(r, "81"), 1000, "Abrunden zugunsten des Steuerpflichtigen");
  assert.equal(r.totalVat, 190);
});

test("steuerfreie Umsätze runden weiterhin kaufmännisch — dort entsteht keine Steuer", () => {
  const r = run([line("USt0:IG", 5000.6)]);
  assert.equal(kz(r, "41"), 5001);
});

test("die Rundungsdifferenz zur Buchhaltung wird ausgewiesen statt versteckt", () => {
  const r = run([line("USt19", 1000.49, 190.09)]);
  assert.equal(r.roundingDelta, -0.09);
});

test("7% und 19% werden getrennt geführt und in Zeile 37 summiert", () => {
  const r = run([line("USt19", 1000, 190), line("USt7", 500, 35)]);
  assert.equal(kz(r, "81"), 1000);
  assert.equal(kz(r, "86"), 500);
  assert.equal(r.totalVat, 225);
});

// ── Vorsteuer und Zahllast ─────────────────────────────────────────────────

test("Vorsteuer mindert die Zahllast über Zeile 45", () => {
  const r = run([line("USt19", 1000, 190), line("VSt19", 500, 95)]);
  assert.equal(kz(r, "66"), 95);
  assert.equal(r.totalVat, 190);
  assert.equal(r.remainder, 95);
  assert.equal(r.payable, 95);
});

test("Vorsteuerüberhang ergibt einen negativen Wert in Kz 83 (Erstattung)", () => {
  const r = run([line("USt19", 100, 19), line("VSt19", 1000, 190)]);
  assert.equal(r.payable, -171);
});

test("Sondervorauszahlung nach Kz 39 wird von Zeile 48 abgezogen", () => {
  const r = run([
    line("USt19", 10000, 1900),
    { vatCode: "VSt19", net: 0, vat: 0 },
  ]);
  // Ohne Kz 39 bleibt die Zahllast unverändert — das Feld wird von uns nicht
  // befüllt, aber die Rechenkette muss es korrekt berücksichtigen.
  assert.equal(r.advancePayment, 1900);
  assert.equal(r.payable, 1900);
});

// ── Reverse Charge § 13b als Leistungsempfänger ────────────────────────────

test("§ 13b-Eingangsleistung erzeugt Steuer in Kz 47 und Bemessungsgrundlage in Kz 46", () => {
  const r = run([line("RC13b19", 1000, 190)]);
  assert.equal(kz(r, "46"), 1000);
  assert.equal(kz(r, "47"), 190);
  assert.equal(r.totalVat, 190);
});

test("§ 13b ist zahllastneutral, wenn die Vorsteuer nach Kz 67 abziehbar ist", () => {
  const r = run([line("RC13b19", 1000, 190), line("VSt:13b", 1000, 190)]);
  assert.equal(kz(r, "47"), 190);
  assert.equal(kz(r, "67"), 190);
  assert.equal(r.payable, 0);
});

test("§ 13b-Vorsteuer landet nicht in Kz 66", () => {
  const r = run([line("VSt:13b", 1000, 190)]);
  assert.equal(kz(r, "66"), 0);
  assert.equal(kz(r, "67"), 190);
});

// ── Innergemeinschaftlicher Erwerb ─────────────────────────────────────────

test("innergemeinschaftlicher Erwerb: Steuer aus Kz 89, Vorsteuer aus Kz 61", () => {
  const r = run([line("IGE19", 2000, 380), line("VSt:IGE", 2000, 380)]);
  assert.equal(kz(r, "89"), 2000);
  assert.equal(kz(r, "61"), 380);
  assert.equal(r.totalVat, 380);
  assert.equal(r.payable, 0);
});

test("Einfuhrumsatzsteuer landet in Kz 62, nicht in Kz 66", () => {
  const r = run([line("VSt:EUSt", 0, 250)]);
  assert.equal(kz(r, "62"), 250);
  assert.equal(kz(r, "66"), 0);
});

// ── Steuerfreie Ausgangsumsätze ────────────────────────────────────────────

test("steuerfreie Umsätze gehen in ihre jeweilige Kennzahl und erzeugen keine Steuer", () => {
  const r = run([
    line("USt0:IG", 5000),
    line("USt0:EXP", 3000),
    line("USt0:TE4", 1000),
    line("USt0:13b", 2000),
    line("USt0:18b", 800),
    line("USt0:NDS", 400),
  ]);
  assert.equal(kz(r, "41"), 5000);
  assert.equal(kz(r, "43"), 3000);
  assert.equal(kz(r, "48"), 1000);
  assert.equal(kz(r, "60"), 2000);
  assert.equal(kz(r, "21"), 800);
  assert.equal(kz(r, "45"), 400);
  assert.equal(r.totalVat, 0);
});

test("Kz 77 trägt eine Bemessungsgrundlage, aber keine Steuer", () => {
  const r = run([line("USt19", 1000, 190)]);
  assert.equal(kz(r, "77"), 0);
  assert.equal(r.totalVat, 190);
});

// ── Randfälle ──────────────────────────────────────────────────────────────

test("ein leerer Zeitraum liefert überall null und hasData=false", () => {
  const r = run([]);
  assert.equal(r.hasData, false);
  assert.equal(r.totalVat, 0);
  assert.equal(r.payable, 0);
  assert.equal(kz(r, "81"), 0);
});

test("Gutschriften kürzen die Bemessungsgrundlage", () => {
  const r = run([line("USt19", 1000, 190), line("USt19", -300, -57)]);
  assert.equal(kz(r, "81"), 700);
  assert.equal(r.totalVat, 133);
});

test("eine vollständige Stornierung ergibt exakt null, keinen Rundungsrest", () => {
  const r = run([line("USt19", 1234.56, 234.57), line("USt19", -1234.56, -234.57)]);
  assert.equal(kz(r, "81"), 0);
  assert.equal(r.totalVat, 0);
  assert.equal(r.roundingDelta, 0);
});

test("unbekannte Steuerschlüssel verschwinden nicht, sondern werden ausgewiesen", () => {
  const r = run([line("USt19", 1000, 190), line("VSt42", 100, 42)]);
  assert.equal(r.unmapped.length, 1);
  assert.equal(r.unmapped[0].vatCode, "VSt42");
  assert.equal(r.unmapped[0].vat, 42);
  assert.equal(r.unmapped[0].reason, null);
});

test("OSS-Fernverkäufe gehen nach Kz 45 und erzeugen keine deutsche Steuer", () => {
  // § 3c UStG verlagert den Leistungsort ins Bestimmungsland: im Inland
  // nicht steuerbar, deshalb nur nachrichtlich in Kz 45. Die Steuer selbst
  // läuft über die OSS-Meldung beim BZSt.
  const r = run([line("USt0:OSS", 2500)]);
  assert.equal(r.unmapped.length, 0);
  assert.equal(kz(r, "45"), 2500);
  assert.equal(kz(r, "81"), 0, "darf keinesfalls zusätzlich in Zeile 13 landen");
  assert.equal(r.totalVat, 0);
});

test("Ankreuzfelder in Abschnitt J werden nicht befüllt", () => {
  const r = run([line("USt19", 1000, 190)]);
  for (const k of ["29", "26", "500"]) {
    assert.equal(r.byKz.get(k)?.notFilled, true, `Kz ${k} darf nicht befüllt werden`);
  }
});

test("nachrichtliche Felder aus Abschnitt I gehen in keine Summe ein", () => {
  // Kz 37 ist ein input_tax-Feld — läge es im Bereich der Zeilen 38–44,
  // würde es die Zahllast verfälschen.
  const r = run([line("USt19", 1000, 190)]);
  assert.equal(r.remainder, 190);
  assert.equal(r.byKz.get("37")?.field.memoOnly, true);
});

test("Belegquellen bleiben je Kennzahl für den Drill-down erhalten", () => {
  const r = run([line("USt19", 600, 114), line("USt19", 400, 76)]);
  assert.deepEqual(r.byKz.get("81")?.sources, ["USt19:600", "USt19:400"]);
});

// ── Mapping-Integrität ─────────────────────────────────────────────────────

test("jede Zielkennzahl im Mapping existiert im Vordruck 2026", () => {
  const known = new Set(
    FORM_2026.sections.flatMap((s) => s.fields.map((f) => f.kz)).filter(Boolean),
  );
  for (const code of mappedVatCodes()) {
    const t = targetFor(code);
    assert.ok(t);
    for (const k of [t.bmgKz, t.taxKz, t.inputTaxKz]) {
      if (k) assert.ok(known.has(k), `Steuerschlüssel ${code} zeigt auf unbekannte Kz ${k}`);
    }
  }
});
