// Erkennung der Steuerschuldumkehr aus dem Belegtext.
//
// Bewusst regelbasiert statt über das Sprachmodell: Die Einstufung entscheidet,
// in welche Kennzahl der Voranmeldung ein Beleg fließt. Regeln sind
// nachvollziehbar, testbar und ändern ihr Verhalten nicht zwischen zwei
// Modellversionen. Das Modell liefert die Rohtexterkennung, die steuerliche
// Einordnung machen wir hier.
//
// Der Ansatz ist bewusst konservativ: Im Zweifel wird nichts gesetzt. Ein
// nicht erkannter Reverse-Charge-Beleg fällt beim Prüfen des Belegs auf.
// Ein falsch als Reverse Charge eingestufter Beleg bucht dagegen still
// falsch — der teurere Fehler.

import type { InputVatKind } from "@prisma/client";

export type ReverseChargeDetection = {
  kind: InputVatKind;
  /** Textstellen, die zur Einstufung geführt haben — für die Belegansicht. */
  evidence: string[];
};

/** Wortmarken, die eindeutig auf die Umkehr der Steuerschuld hindeuten. */
const REVERSE_CHARGE_MARKERS = [
  "reverse charge",
  "reverse-charge",
  "steuerschuldnerschaft des leistungsempfängers",
  "steuerschuldnerschaft des leistungsempfangers",
  "umkehr der steuerschuld",
  "steuerschuldumkehr",
  "vat reverse charged",
  "vat to be paid by the recipient",
  "tax to be paid by the recipient",
  "§ 13b",
  "§13b",
  "par. 13b",
  "article 196",
  "art. 196",
  "artikel 196",
];

/** Marken für den innergemeinschaftlichen Erwerb von Gegenständen. */
const INTRA_COMMUNITY_MARKERS = [
  "innergemeinschaftliche lieferung",
  "innergemeinschaftlicher erwerb",
  "intra-community supply",
  "intra community supply",
  "intracommunity supply",
  "article 138",
  "art. 138",
  "artikel 138",
];

/** Marken für Einfuhrumsatzsteuer. */
const IMPORT_VAT_MARKERS = [
  "einfuhrumsatzsteuer",
  "einfuhrabgabenbescheid",
  "import vat",
  "zollamt",
  "hauptzollamt",
];

/**
 * Marken für § 13b-Tatbestände, die NICHT unter Absatz 1 fallen (Bauleistung,
 * Gebäudereinigung, Schrott …). Sie gehören in Kz 84/85 statt 46/47.
 */
const OTHER_13B_MARKERS = [
  "bauleistung",
  "bauleistungen",
  "§ 13b abs. 2 nr. 4",
  "gebäudereinigung",
  "gebaudereinigung",
  "altmetall",
  "schrott",
  "werklieferung",
];

/** Marken für Umsätze, die unter das Grunderwerbsteuergesetz fallen. */
const GRESTG_MARKERS = ["grunderwerbsteuer", "grestg", "§ 13b abs. 2 nr. 3"];

/**
 * USt-IdNr. eines anderen EU-Mitgliedstaats im Text.
 *
 * Deutsche IDs (DE) werden ausgeklammert — eine deutsche USt-IdNr. auf einer
 * Eingangsrechnung ist der Normalfall und kein Hinweis auf Reverse Charge.
 * Die eigene USt-IdNr. des Empfängers steht auf solchen Rechnungen ebenfalls,
 * deshalb ist das allein kein hinreichendes Merkmal, sondern nur ein
 * unterstützendes.
 */
const EU_VAT_ID_CANDIDATE =
  /\b(AT|BE|BG|CY|CZ|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[ ]?([0-9A-Z]{8,12})\b/g;

/**
 * Sucht eine USt-IdNr. aus einem anderen EU-Mitgliedstaat.
 *
 * Der Ländercode allein reicht als Muster nicht: „LUXEMBOURG" beginnt mit LU
 * und erfüllt sonst jede Zeichenklasse aus Buchstaben. Deshalb muss der Rumpf
 * überwiegend aus Ziffern bestehen — bei echten USt-IdNr. ist das immer so.
 */
function findEuVatId(upperText: string): string | null {
  EU_VAT_ID_CANDIDATE.lastIndex = 0;
  for (const m of upperText.matchAll(EU_VAT_ID_CANDIDATE)) {
    const digits = (m[2].match(/[0-9]/g) ?? []).length;
    if (digits >= 6) return m[0];
  }
  return null;
}

function findMarkers(haystack: string, markers: string[]): string[] {
  return markers.filter((m) => haystack.includes(m));
}

/**
 * Stuft einen Belegtext ein. Gibt null zurück, wenn kein belastbares Merkmal
 * gefunden wurde — dann bleibt es beim Regelfall (Vorsteuer nach Kz 66).
 */
export function detectInputVatKind(rawText: string | null): ReverseChargeDetection | null {
  if (!rawText) return null;
  const text = rawText.toLowerCase();

  // Einfuhrumsatzsteuer zuerst: ein Einfuhrabgabenbescheid ist eindeutig und
  // soll nicht versehentlich als § 13b durchgehen.
  const importMarkers = findMarkers(text, IMPORT_VAT_MARKERS);
  if (importMarkers.length > 0) {
    return { kind: "IMPORT_VAT", evidence: importMarkers };
  }

  const rcMarkers = findMarkers(text, REVERSE_CHARGE_MARKERS);
  const igMarkers = findMarkers(text, INTRA_COMMUNITY_MARKERS);

  // Innergemeinschaftlicher Erwerb: der Lieferant nennt seine Lieferung
  // "innergemeinschaftlich". Aus unserer Sicht ist das ein Erwerb.
  if (igMarkers.length > 0) {
    return { kind: "INTRA_COMMUNITY_ACQUISITION", evidence: igMarkers };
  }

  if (rcMarkers.length === 0) return null;

  // Ab hier steht fest: Steuerschuldumkehr. Bleibt die Frage, welcher
  // Tatbestand — davon hängt die Kennzahl ab.
  const grestg = findMarkers(text, GRESTG_MARKERS);
  if (grestg.length > 0) {
    return { kind: "REVERSE_CHARGE_GRESTG", evidence: [...rcMarkers, ...grestg] };
  }

  const other = findMarkers(text, OTHER_13B_MARKERS);
  if (other.length > 0) {
    return { kind: "REVERSE_CHARGE_OTHER", evidence: [...rcMarkers, ...other] };
  }

  // Regelfall: sonstige Leistung eines im übrigen Gemeinschaftsgebiet
  // ansässigen Unternehmers (§ 13b Absatz 1 UStG). Eine USt-IdNr. aus einem
  // anderen Mitgliedstaat stützt das zusätzlich, ist aber nicht erforderlich —
  // die Reverse-Charge-Marke allein trägt die Einstufung.
  const euVatId = findEuVatId(rawText.toUpperCase());
  return {
    kind: "REVERSE_CHARGE_EU_SERVICE",
    evidence: euVatId ? [...rcMarkers, `USt-IdNr. ${euVatId}`] : rcMarkers,
  };
}
