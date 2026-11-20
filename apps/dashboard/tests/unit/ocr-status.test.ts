import { test } from "node:test";
import assert from "node:assert/strict";
import { statusAfterOcr, isOcrComplete } from "../../src/lib/ocr/status";

// Hintergrund: Früher setzte die Texterkennung DONE — denselben Wert, mit dem
// der Nutzer einen Beleg fertigstellt. Ein frisch hochgeladener Beleg galt
// damit als abgeschlossen und ließ sich nicht mehr als Anlagegut markieren.

test("nach der Texterkennung ist ein neuer Beleg in Bearbeitung, nicht fertig", () => {
  assert.equal(statusAfterOcr("PENDING"), "DRAFT");
  assert.equal(statusAfterOcr("PROCESSING"), "DRAFT");
});

test("ein erneuter Lauf stuft einen fertiggestellten Beleg nicht zurück", () => {
  assert.equal(statusAfterOcr("DONE"), "DONE");
  assert.equal(statusAfterOcr("PAID"), "PAID");
});

test("ein gescheiterter Beleg wird nach erfolgreicher Erkennung zum Entwurf", () => {
  assert.equal(statusAfterOcr("FAILED"), "DRAFT");
});

test("ein Entwurf bleibt ein Entwurf", () => {
  assert.equal(statusAfterOcr("DRAFT"), "DRAFT");
});

test("die Texterkennung gilt als durch, sobald der Zeitstempel steht", () => {
  assert.equal(isOcrComplete({ status: "DRAFT", ocrCompletedAt: new Date() }), true);
  assert.equal(isOcrComplete({ status: "DRAFT", ocrCompletedAt: null }), false);
});

test("Bestandsbelege ohne Zeitstempel gelten über den Status als erkannt", () => {
  // Vor der Migration gab es das Feld nicht — DONE/PAID hieß dort, dass die
  // Erkennung durchgelaufen war.
  assert.equal(isOcrComplete({ status: "DONE", ocrCompletedAt: null }), true);
  assert.equal(isOcrComplete({ status: "PAID", ocrCompletedAt: null }), true);
  assert.equal(isOcrComplete({ status: "PENDING", ocrCompletedAt: null }), false);
});
