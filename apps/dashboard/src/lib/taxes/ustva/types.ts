// UStVA — Formularmodell (Umsatzsteuer-Voranmeldung, Vordruck USt 1 A).
//
// Das amtliche Formular ist die Datenstruktur: Abschnitte A–J, Zeilennummern
// und Kennzahlen werden 1:1 aus dem BMF-Vordruckmuster übernommen. Grund:
// Mein ELSTER zeigt exakt dasselbe Formular. Wer unsere Ansicht neben das
// ELSTER-Formular legt, findet jedes Feld an derselben Stelle wieder — das
// ist der ganze Zweck der Übung, also weichen wir hier nirgends ab.
//
// Quelle: BMF-Schreiben v. 29.12.2025, GZ III C 3 - S 7344/00039/007/036
//         Vordruckmuster USt 1 A 2026, Anleitung USt 1 E 2026.

/**
 * Rundungsregel eines Feldes.
 *
 * Aus der Anleitung USt 1 E: „Tragen Sie bei den Bemessungsgrundlagen bitte
 * nur Beträge in vollen Euro ein; bei den Umsatzsteuer- und Vorsteuerbeträgen
 * ist dagegen stets auch die Eintragung von Centbeträgen erforderlich."
 */
export type Rounding = "euro" | "cent";

export type FieldKind =
  /** Bemessungsgrundlage — volle Euro, ohne Umsatzsteuer. */
  | "bmg"
  /** Steuerbetrag — mit Cent. Wird vom Nutzer eingetragen. */
  | "tax"
  /** Vorsteuerbetrag — mit Cent, mindert die Zahllast. */
  | "input_tax"
  /** Ankreuzfeld (1 = Ja) bzw. Auswahlwert — kein Betrag. */
  | "flag"
  /** Rechenzeile ohne eigene Kennzahl (Zeilen 37, 45, 48). */
  | "computed";

/**
 * Ein Feld des Vordrucks.
 *
 * `kz` ist die amtliche Kennzahl. Rechenzeilen ohne Kennzahl (37, 45, 48)
 * bekommen `kz: null` — sie existieren im Formular als Zwischensumme, aber
 * ELSTER überträgt sie nicht als eigenes Feld.
 */
export type UstvaField = {
  /** Amtliche Kennzahl, z.B. "81". Null bei reinen Rechenzeilen. */
  kz: string | null;
  /** Zeilennummer im Vordruck, z.B. 13. */
  zeile: number;
  kind: FieldKind;
  rounding: Rounding;
  /** Feldbeschriftung, wortgleich zum Vordruck. */
  label: string;
  /**
   * Nur bei `kind: "bmg"`: die Kennzahl, die den zugehörigen Steuerbetrag
   * trägt (z.B. 35 → 36). Fehlt sie, rechnet ELSTER die Steuer selbst aus
   * der Bemessungsgrundlage — dann ist `rate` gesetzt.
   */
  taxKz?: string;
  /**
   * Nur bei `kind: "bmg"` ohne `taxKz`: Steuersatz in Prozent, mit dem ELSTER
   * die Steuer aus der (auf volle Euro gerundeten) Bemessungsgrundlage
   * errechnet. Kz 81 → 19, Kz 86 → 7, Kz 87 → 0.
   */
  rate?: number;
  /** Erläuterung aus der Anleitung USt 1 E — für Tooltips in der UI. */
  hint?: string;
  /**
   * Nachrichtliche Angabe: der Betrag ist bereits in einer anderen Zeile
   * enthalten und darf in keine Summe eingehen (Abschnitt I, Kz 50 und 37).
   * Wird getrennt ausgewiesen, damit niemand versehentlich doppelt rechnet.
   */
  memoOnly?: boolean;
};

/**
 * Abschnitt des Vordrucks. `id` und `title` sind wortgleich zum amtlichen
 * Formular, damit die Orientierung in Mein ELSTER ohne Übersetzung klappt.
 */
export type UstvaSection = {
  id: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J";
  title: string;
  /**
   * Der zugehörige Abschnitt im Online-Formular von Mein ELSTER.
   *
   * Wichtig: Mein ELSTER nummeriert die Abschnitte 1 bis 11, der amtliche
   * Papiervordruck nutzt die Buchstaben A bis J. Wer in Mein ELSTER nach
   * „Abschnitt D" sucht, findet nichts. Deshalb führen wir beide Bezeichnungen
   * mit — der Buchstabe für den Vordruck, die Nummer für die Navigation im
   * Online-Formular.
   *
   * A und B liegen in Mein ELSTER zusammen in Abschnitt 3.
   */
  elster: { number: number; title: string };
  fields: UstvaField[];
};

export type UstvaForm = {
  /** Kalenderjahr, für das dieser Vordruck amtlich gilt. */
  year: number;
  /** Vordruckkennung, z.B. "2026USt1A561" — steht im Fuß des Formulars. */
  formId: string;
  sections: UstvaSection[];
};

/** Ein berechneter Feldwert. */
export type UstvaValue = {
  field: UstvaField;
  /**
   * Der Wert, wie er in ELSTER einzutragen ist: bei `rounding: "euro"` eine
   * ganze Zahl, bei `"cent"` auf zwei Nachkommastellen gerundet.
   */
  value: number;
  /**
   * Summe aus den Buchungen vor der Formularrundung. Weicht bei
   * Bemessungsgrundlagen um Centbeträge von `value` ab — siehe
   * `roundingDelta` im Ergebnis.
   */
  rawValue: number;
};
