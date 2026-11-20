// Zuordnung Steuerschlüssel (JournalLine.vatCode) → Kennzahl im Vordruck.
//
// Grammatik der Steuerschlüssel:
//
//   USt<rate>          Ausgangsumsatz zum Regelsatz. Die Zeile trägt den
//                      Steuerbetrag, das Netto wird daraus abgeleitet.
//   USt0:<TAG>         Steuerfreier/besonderer Ausgangsumsatz. Die Zeile trägt
//                      das Netto, Steuerbetrag ist 0.
//   VSt<rate>          Vorsteuer aus Eingangsrechnung (Regelfall).
//   VSt:<KIND>         Vorsteuer aus Sondertatbestand (igE, EUSt, § 13b).
//   IGE<rate>          Steuerpflichtiger innergemeinschaftlicher Erwerb.
//   RC13b*<rate>       § 13b als Leistungsempfänger — wir schulden die Steuer.
//
// Jeder Schlüssel zeigt auf genau eine Kennzahl. Ein Schlüssel ohne Eintrag
// hier verschwindet NICHT stillschweigend, sondern landet in `unmapped` und
// wird in der Ansicht als ungeklärt ausgewiesen — siehe compute.ts.

/** Wohin ein Steuerschlüssel im Formular fließt. */
export type KzTarget = {
  /**
   * Was der Betrag der Buchungszeile (Soll minus Haben) bedeutet.
   *
   * Der Unterschied ist keine Feinheit: bei `USt19` sitzt der Steuerschlüssel
   * auf der Umsatzsteuerzeile, der Betrag ist also die Steuer und das Netto
   * muss über den Satz zurückgerechnet werden. Bei `USt0:IG` oder `RC13b19`
   * sitzt er auf der Erlös- bzw. Aufwandszeile und der Betrag IST das Netto.
   */
  carries: "net" | "tax";
  /** Buchungsseite: Ausgangsumsätze im Haben, Eingangsseite im Soll. */
  direction: "sales" | "input";
  /** Steuersatz — nur bei `carries: "tax"`, um die Bemessungsgrundlage abzuleiten. */
  rate?: number;
  /** Kennzahl, die die Bemessungsgrundlage aufnimmt. */
  bmgKz?: string;
  /**
   * Kennzahl, die den Steuerbetrag aufnimmt. Fehlt sie bei gesetzter `bmgKz`,
   * rechnet ELSTER die Steuer selbst aus der Bemessungsgrundlage.
   */
  taxKz?: string;
  /** Kennzahl, die den Betrag als abziehbare Vorsteuer aufnimmt. */
  inputTaxKz?: string;
};

/**
 * Steuerschlüssel, deren Zuordnung fachlich noch nicht abschließend geklärt
 * ist. Sie werden bewusst NICHT geraten: die Ansicht weist sie separat aus,
 * damit niemand eine falsche Kennzahl in ELSTER überträgt.
 *
 * Aktuell leer — der zwischenzeitlich hier geführte OSS-Fall ist geklärt
 * (siehe Kommentar bei `USt0:OSS` im Mapping).
 */
export const PENDING_CLARIFICATION: Record<string, string> = {};

const MAPPING: Record<string, KzTarget> = {
  // ── Abschnitt A — steuerpflichtige Ausgangsumsätze ──────────────────────
  // Kz 81/86/87 nehmen nur die Bemessungsgrundlage; die Steuer errechnet
  // ELSTER aus dem auf volle Euro gerundeten Wert. Der Steuerschlüssel sitzt
  // auf der Umsatzsteuerzeile, das Netto wird über den Satz zurückgerechnet.
  USt19: { carries: "tax", direction: "sales", rate: 19, bmgKz: "81" },
  USt7: { carries: "tax", direction: "sales", rate: 7, bmgKz: "86" },
  USt0: { carries: "net", direction: "sales", bmgKz: "87" },

  // ── Abschnitt B — steuerfreie Ausgangsumsätze ───────────────────────────
  // Hier trägt die Erlöszeile selbst den Schlüssel, der Betrag ist das Netto.
  "USt0:IG": { carries: "net", direction: "sales", bmgKz: "41" }, // § 4 Nr. 1b
  "USt0:EXP": { carries: "net", direction: "sales", bmgKz: "43" }, // § 4 Nr. 1a / § 6
  "USt0:TE4": { carries: "net", direction: "sales", bmgKz: "48" }, // § 4 Nr. 8–29

  // ── Abschnitt C — innergemeinschaftliche Erwerbe ────────────────────────
  IGE19: { carries: "net", direction: "input", bmgKz: "89" },
  IGE7: { carries: "net", direction: "input", bmgKz: "93" },
  IGE0: { carries: "net", direction: "input", bmgKz: "90" },

  // ── Abschnitt D — § 13b als Leistungsempfänger ──────────────────────────
  // Der Regelfall für Software-, Werbe- und Plattformleistungen aus dem
  // EU-Ausland: sonstige Leistung nach § 3a Absatz 2 UStG.
  RC13b19: { carries: "net", direction: "input", bmgKz: "46", taxKz: "47" },
  RC13b7: { carries: "net", direction: "input", bmgKz: "46", taxKz: "47" },
  // Umsätze unter das GrEStG (§ 13b Absatz 2 Nummer 3 UStG)
  RC13bGrESt19: { carries: "net", direction: "input", bmgKz: "73", taxKz: "74" },
  // Übrige § 13b-Tatbestände (Absatz 2 Nummer 1, 2, 4 bis 12) — Werklieferungen
  // im Ausland ansässiger Unternehmer, Bauleistungen, Gebäudereinigung, Schrott …
  RC13bOther19: { carries: "net", direction: "input", bmgKz: "84", taxKz: "85" },
  RC13bOther7: { carries: "net", direction: "input", bmgKz: "84", taxKz: "85" },

  // ── Abschnitt E — ergänzende Angaben ────────────────────────────────────
  "USt0:13b": { carries: "net", direction: "sales", bmgKz: "60" }, // wir leisten
  "USt0:18b": { carries: "net", direction: "sales", bmgKz: "21" }, // an EU-Unternehmer
  "USt0:NDS": { carries: "net", direction: "sales", bmgKz: "45" }, // Ort nicht im Inland
  // One-Stop-Shop (§ 18j UStG). Der scheinbare Widerspruch in der Anleitung
  // löst sich über den Leistungsort auf: bei innergemeinschaftlichen
  // Fernverkäufen verlagert § 3c UStG den Ort ins Bestimmungsland, der Umsatz
  // ist im Inland also nicht steuerbar. Er gehört deshalb ausschließlich als
  // Nettobetrag nach Kz 45 und darf in den Zeilen 13 bis 16 nicht auftauchen —
  // sonst würde zusätzlich deutsche Umsatzsteuer festgesetzt. Die eigentliche
  // Steuer wird über die OSS-Meldung beim BZSt erklärt und abgeführt.
  "USt0:OSS": { carries: "net", direction: "sales", bmgKz: "45" },

  // ── Abschnitt F — Vorsteuer ─────────────────────────────────────────────
  VSt19: { carries: "tax", direction: "input", rate: 19, inputTaxKz: "66" },
  VSt7: { carries: "tax", direction: "input", rate: 7, inputTaxKz: "66" },
  VSt0: { carries: "tax", direction: "input", inputTaxKz: "66" },
  "VSt:IGE": { carries: "tax", direction: "input", inputTaxKz: "61" },
  "VSt:EUSt": { carries: "tax", direction: "input", inputTaxKz: "62" },
  "VSt:13b": { carries: "tax", direction: "input", inputTaxKz: "67" },
};

/** Zielkennzahl(en) eines Steuerschlüssels, oder null wenn unbekannt. */
export function targetFor(vatCode: string): KzTarget | null {
  return MAPPING[vatCode] ?? null;
}

/** True, wenn der Schlüssel bekannt, aber fachlich noch nicht freigegeben ist. */
export function isPendingClarification(vatCode: string): boolean {
  return vatCode in PENDING_CLARIFICATION;
}

/** Alle zugeordneten Steuerschlüssel — für Tests und Diagnose. */
export function mappedVatCodes(): string[] {
  return Object.keys(MAPPING);
}
