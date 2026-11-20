// Übersetzung einer Buchungszeile in das Paar (Netto, Steuer) der Voranmeldung.
//
// Steht getrennt von query.ts, damit es ohne Datenbank testbar bleibt — die
// Regeln hier sind subtil genug, dass sie eigene Tests verdienen.

import { targetFor } from "./mapping";

/**
 * Zwei Fallstricke stecken hier drin:
 *
 * 1. Die Buchungsseite. Ausgangsumsätze stehen im Haben, Aufwand und
 *    Vorsteuer im Soll. Beide sollen positiv in die Voranmeldung gehen.
 * 2. Was der Betrag überhaupt bedeutet. Bei `USt19` sitzt der Steuerschlüssel
 *    auf der Umsatzsteuerzeile — der Betrag ist die Steuer, das Netto wird
 *    über den Satz zurückgerechnet. Bei `USt0:IG` oder `RC13b19` sitzt er auf
 *    der Erlös- bzw. Aufwandszeile und der Betrag IST das Netto.
 *
 * Die Rückrechnung über den Satz ist zugleich der Grund, warum das in beiden
 * Buchungsmodi funktioniert: im Einzelbuchungsmodus steht auf der Zeile der
 * Bruttobetrag, aber `vatAmount` trägt in beiden Modi die Steuer.
 */
export function toNetAndVat(
  vatCode: string,
  debit: number,
  credit: number,
  vatAmount: number,
): { net: number; vat: number } {
  const target = targetFor(vatCode);
  // Unbekannter Schlüssel: unverändert durchreichen, damit er in der Ansicht
  // als ungeklärt auftauchen kann statt lautlos zu verschwinden.
  if (!target) return { net: credit - debit, vat: vatAmount };

  const signed = target.direction === "sales" ? credit - debit : debit - credit;

  if (target.carries === "net") return { net: signed, vat: vatAmount };

  const vat = vatAmount || signed;
  const net = target.rate ? (vat * 100) / target.rate : 0;
  return { net, vat };
}
