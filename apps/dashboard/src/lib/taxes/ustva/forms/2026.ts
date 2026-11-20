// Vordruckmuster USt 1 A — Umsatzsteuer-Voranmeldung 2026.
//
// Eingeführt mit BMF-Schreiben vom 29.12.2025 (GZ III C 3 - S 7344/00039/007/036)
// für Voranmeldungszeiträume ab Januar 2026. Beschriftungen sind wortgleich
// zum amtlichen Vordruck, `hint` fasst die Anleitung USt 1 E zusammen.
//
// Änderungen gegenüber 2025 (aus dem BMF-Schreiben):
//   - Umsätze nach Art. 20 Abs. 1 VO (EU) 2025/1106 („SAFE") → Kz 43
//   - Übergangsregelung § 27 Abs. 40a UStG (Auslagerung) → Kz 69 bzw. Kz 66
//   - Durchschnittssatz § 24 Abs. 1 Satz 1 Nr. 2 UStG für 2026: 19 %
//
// ACHTUNG beim Pflegen: Zeilennummern und Kennzahlen niemals „aufräumen".
// Sie sind die gemeinsame Sprache mit Mein ELSTER. Wenn das BMF eine Zeile
// verschiebt, wird ein neues Jahresfile angelegt, dieses bleibt unberührt.

import type { UstvaForm } from "../types";

export const FORM_2026: UstvaForm = {
  year: 2026,
  formId: "2026USt1A561",
  sections: [
    {
      id: "A",
      title:
        "Steuerpflichtige Lieferungen, sonstige Leistungen und unentgeltliche Wertabgaben",
      elster: { number: 3, title: "Lieferungen und sonstige Leistungen (einschließlich unentgeltlicher Wertabgaben)" },
      fields: [
        {
          kz: "81",
          zeile: 13,
          kind: "bmg",
          rounding: "euro",
          rate: 19,
          label: "Steuerpflichtige Umsätze zum Steuersatz von 19 %",
          hint: "Bemessungsgrundlagen sind stets Nettobeträge ohne Umsatzsteuer, in vollen Euro. Auch unentgeltliche Wertabgaben gehören hierher. Die Steuer errechnet ELSTER selbst.",
        },
        {
          kz: "86",
          zeile: 14,
          kind: "bmg",
          rounding: "euro",
          rate: 7,
          label: "Steuerpflichtige Umsätze zum Steuersatz von 7 %",
        },
        {
          kz: "87",
          zeile: 15,
          kind: "bmg",
          rounding: "euro",
          rate: 0,
          label: "Steuerpflichtige Umsätze zum Steuersatz von 0 %",
          // Wird von uns nicht automatisch befüllt: es gibt keinen
          // Steuerschlüssel für den Nullsatz nach § 12 Absatz 3 UStG. Der Fall
          // betrifft ausschließlich Photovoltaik und kommt bei nahezu keinem
          // Mandanten vor. Wer ihn hat, trägt den Wert in ELSTER selbst ein.
          hint: "Nur Lieferung, Installation und unentgeltliche Wertabgabe von Solarmodulen, wesentlichen PV-Komponenten und Stromspeichern an den Anlagenbetreiber (§ 12 Absatz 3 UStG). Dieses Feld wird nicht automatisch befüllt — bitte bei Photovoltaik-Umsätzen selbst ergänzen.",
        },
        {
          kz: "35",
          zeile: 16,
          kind: "bmg",
          rounding: "euro",
          taxKz: "36",
          label: "Steuerpflichtige Umsätze zu anderen Steuersätzen",
          hint: "Unter anderem Änderungen der Bemessungsgrundlage (§ 17 UStG) für Umsätze, die den Sätzen von 16 % bzw. 5 % (Juli–Dezember 2020) unterlagen. Steuerbetrag selbst berechnen.",
        },
        {
          kz: "36",
          zeile: 16,
          kind: "tax",
          rounding: "cent",
          label: "Steuer zu anderen Steuersätzen",
        },
        {
          kz: "77",
          zeile: 17,
          kind: "bmg",
          rounding: "euro",
          label:
            "Lieferungen land- und forstwirtschaftlicher Betriebe nach § 24 UStG an Abnehmer mit Umsatzsteuer-Identifikationsnummer",
          hint: "Trägt keinen eigenen Steuerbetrag. Über diese Lieferungen ist zusätzlich eine Zusammenfassende Meldung an das BZSt zu übermitteln.",
        },
        {
          kz: "76",
          zeile: 18,
          kind: "bmg",
          rounding: "euro",
          taxKz: "80",
          label:
            "Umsätze, für die eine Steuer nach § 24 UStG zu entrichten ist (Sägewerkserzeugnisse, Getränke und alkoholische Flüssigkeiten, z. B. Wein)",
          hint: "Durchschnittssatz 2026: 19 %, vermindert um den aktuellen Satz für pauschalierte Vorsteuerbeträge. Ergebnis als Steuerbetrag in Kz 80 eintragen.",
        },
        {
          kz: "80",
          zeile: 18,
          kind: "tax",
          rounding: "cent",
          label: "Steuer auf Umsätze nach § 24 UStG",
        },
      ],
    },
    {
      id: "B",
      title:
        "Steuerfreie Lieferungen, sonstige Leistungen und unentgeltliche Wertabgaben",
      elster: { number: 3, title: "Lieferungen und sonstige Leistungen (einschließlich unentgeltlicher Wertabgaben)" },
      fields: [
        {
          kz: "41",
          zeile: 19,
          kind: "bmg",
          rounding: "euro",
          label:
            "Innergemeinschaftliche Lieferungen (§ 4 Nummer 1 Buchstabe b UStG) an Abnehmer mit Umsatzsteuer-Identifikationsnummer",
          hint: "Zu erklären in dem Voranmeldungszeitraum, in dem die Rechnung ausgestellt wird, spätestens im Zeitraum, in dem der auf die Lieferung folgende Monat endet (§ 18b UStG). Zusätzlich Zusammenfassende Meldung ans BZSt.",
        },
        {
          kz: "44",
          zeile: 20,
          kind: "bmg",
          rounding: "euro",
          label:
            "Innergemeinschaftliche Lieferungen neuer Fahrzeuge an Abnehmer ohne Umsatzsteuer-Identifikationsnummer",
        },
        {
          kz: "49",
          zeile: 21,
          kind: "bmg",
          rounding: "euro",
          label:
            "Innergemeinschaftliche Lieferungen neuer Fahrzeuge außerhalb eines Unternehmens (§ 2a UStG)",
        },
        {
          kz: "43",
          zeile: 22,
          kind: "bmg",
          rounding: "euro",
          label:
            "Weitere steuerfreie Umsätze mit Vorsteuerabzug (z. B. Ausfuhrlieferungen, Umsätze nach § 4 Nummer 2 bis 7 UStG, Umsätze nach Verordnungen der EU)",
          hint: "Neben Ausfuhrlieferungen (§ 4 Nummer 1 Buchstabe a, § 6 UStG) u. a. Lohnveredelung, Seeschifffahrt und Luftfahrt, grenzüberschreitende Güterbeförderung, Vermittlungsleistungen nach § 4 Nummer 5 UStG sowie ab 2026 Umsätze nach der SAFE-Verordnung (EU) 2025/1106.",
        },
        {
          kz: "48",
          zeile: 23,
          kind: "bmg",
          rounding: "euro",
          label:
            "Steuerfreie Umsätze ohne Vorsteuerabzug (z. B. Umsätze nach § 4 Nummer 8 bis 29 oder § 19 Absatz 1 UStG)",
          hint: "Zum Beispiel Grundstücksvermietung (§ 4 Nummer 12), heilberufliche Leistungen (§ 4 Nummer 14) sowie Umsätze als Kleinunternehmer nach § 19 Absatz 1 UStG.",
        },
      ],
    },
    {
      id: "C",
      title: "Innergemeinschaftliche Erwerbe",
      elster: { number: 4, title: "Innergemeinschaftliche Erwerbe" },
      fields: [
        {
          kz: "91",
          zeile: 24,
          kind: "bmg",
          rounding: "euro",
          label:
            "Steuerfreie innergemeinschaftliche Erwerbe von bestimmten Gegenständen und Anlagegold (§§ 4b und 25c UStG)",
        },
        {
          kz: "89",
          zeile: 25,
          kind: "bmg",
          rounding: "euro",
          rate: 19,
          label: "Steuerpflichtige innergemeinschaftliche Erwerbe zum Steuersatz von 19 %",
          hint: "Zu erklären in dem Voranmeldungszeitraum, in dem die Rechnung ausgestellt wird, spätestens im Zeitraum, in dem der auf den Erwerb folgende Monat endet (§ 13 Absatz 1 Nummer 6 UStG). Die Steuer errechnet ELSTER selbst; der Vorsteuerabzug läuft über Kz 61.",
        },
        {
          kz: "93",
          zeile: 26,
          kind: "bmg",
          rounding: "euro",
          rate: 7,
          label: "Steuerpflichtige innergemeinschaftliche Erwerbe zum Steuersatz von 7 %",
        },
        {
          kz: "90",
          zeile: 27,
          kind: "bmg",
          rounding: "euro",
          rate: 0,
          label: "Steuerpflichtige innergemeinschaftliche Erwerbe zum Steuersatz von 0 %",
          hint: "Nur innergemeinschaftliche Erwerbe von Solarmodulen, wesentlichen PV-Komponenten und Stromspeichern durch den Anlagenbetreiber (§ 12 Absatz 3 UStG).",
        },
        {
          kz: "95",
          zeile: 28,
          kind: "bmg",
          rounding: "euro",
          taxKz: "98",
          label: "Steuerpflichtige innergemeinschaftliche Erwerbe zu anderen Steuersätzen",
        },
        {
          kz: "98",
          zeile: 28,
          kind: "tax",
          rounding: "cent",
          label: "Steuer auf innergemeinschaftliche Erwerbe zu anderen Steuersätzen",
        },
        {
          kz: "94",
          zeile: 29,
          kind: "bmg",
          rounding: "euro",
          taxKz: "96",
          label:
            "Innergemeinschaftliche Erwerbe neuer Fahrzeuge (§ 1b Absatz 2 und 3 UStG) von Lieferern ohne Umsatzsteuer-Identifikationsnummer zum allgemeinen Steuersatz",
        },
        {
          kz: "96",
          zeile: 29,
          kind: "tax",
          rounding: "cent",
          label: "Steuer auf innergemeinschaftliche Erwerbe neuer Fahrzeuge",
        },
      ],
    },
    {
      id: "D",
      title: "Leistungsempfänger als Steuerschuldner (§ 13b UStG)",
      elster: { number: 5, title: "Leistungsempfänger als Steuerschuldner (§ 13b UStG)" },
      fields: [
        {
          kz: "46",
          zeile: 30,
          kind: "bmg",
          rounding: "euro",
          taxKz: "47",
          label:
            "Sonstige Leistungen nach § 3a Absatz 2 UStG eines im übrigen Gemeinschaftsgebiet ansässigen Unternehmers (§ 13b Absatz 1 UStG)",
          hint: "Der klassische Fall für Software- und Werbeleistungen aus dem EU-Ausland. Die Steuer entsteht mit Ablauf des Voranmeldungszeitraums, in dem die Leistung ausgeführt wurde. Der Vorsteuerabzug läuft über Kz 67.",
        },
        {
          kz: "47",
          zeile: 30,
          kind: "tax",
          rounding: "cent",
          label: "Steuer auf sonstige Leistungen nach § 3a Absatz 2 UStG",
        },
        {
          kz: "73",
          zeile: 31,
          kind: "bmg",
          rounding: "euro",
          taxKz: "74",
          label: "Umsätze, die unter das GrEStG fallen (§ 13b Absatz 2 Nummer 3 UStG)",
        },
        {
          kz: "74",
          zeile: 31,
          kind: "tax",
          rounding: "cent",
          label: "Steuer auf Umsätze, die unter das GrEStG fallen",
        },
        {
          kz: "84",
          zeile: 32,
          kind: "bmg",
          rounding: "euro",
          taxKz: "85",
          label: "Andere Leistungen (§ 13b Absatz 2 Nummer 1, 2, 4 bis 12 UStG)",
          hint: "Unter anderem Werklieferungen und sonstige Leistungen im Ausland ansässiger Unternehmer, Bauleistungen, Gebäudereinigung, Altmetalle und Schrott, Mobilfunkgeräte ab 5.000 € sowie Emissionszertifikate.",
        },
        {
          kz: "85",
          zeile: 32,
          kind: "tax",
          rounding: "cent",
          label: "Steuer auf andere Leistungen nach § 13b UStG",
        },
      ],
    },
    {
      id: "E",
      title: "Ergänzende Angaben zu Umsätzen",
      elster: { number: 6, title: "Ergänzende Angaben zu Umsätzen" },
      fields: [
        {
          kz: "42",
          zeile: 33,
          kind: "bmg",
          rounding: "euro",
          label:
            "Lieferungen des ersten Abnehmers bei innergemeinschaftlichen Dreiecksgeschäften (§ 25b UStG)",
        },
        {
          kz: "60",
          zeile: 34,
          kind: "bmg",
          rounding: "euro",
          label:
            "Steuerpflichtige Umsätze des leistenden Unternehmers, für die der Leistungsempfänger die Steuer nach § 13b Absatz 5 UStG schuldet",
          hint: "Die Gegenseite zu Abschnitt D: hier stehen die eigenen Ausgangsumsätze, bei denen der Kunde die Steuer schuldet. Trägt keinen eigenen Steuerbetrag.",
        },
        {
          kz: "21",
          zeile: 35,
          kind: "bmg",
          rounding: "euro",
          label:
            "Nicht steuerbare sonstige Leistungen gemäß § 18b Satz 1 Nummer 2 UStG",
          hint: "Sonstige Leistungen nach § 3a Absatz 2 UStG an Unternehmer im übrigen Gemeinschaftsgebiet, für die der Leistungsempfänger die Steuer schuldet. Zusätzlich Zusammenfassende Meldung ans BZSt.",
        },
        {
          kz: "45",
          zeile: 36,
          kind: "bmg",
          rounding: "euro",
          label: "Übrige nicht steuerbare Umsätze (Leistungsort nicht im Inland)",
          hint: "Umsätze, deren Leistungsort nicht im Inland liegt und die im Inland steuerbar wären. Dazu zählen laut Anleitung auch innergemeinschaftliche Fernverkäufe. Nicht hierher gehören die in den Zeilen 33 bis 35 zu erklärenden Umsätze.",
        },
        {
          kz: null,
          zeile: 37,
          kind: "computed",
          rounding: "cent",
          label: "Umsatzsteuer (Summe der Zeilen 13 bis 18 und 25 bis 32)",
        },
      ],
    },
    {
      id: "F",
      title: "Abziehbare Vorsteuerbeträge und Berichtigung des Vorsteuerabzugs",
      elster: { number: 7, title: "Abziehbare Vorsteuerbeträge" },
      fields: [
        {
          kz: "66",
          zeile: 38,
          kind: "input_tax",
          rounding: "cent",
          label:
            "Vorsteuerbeträge aus Rechnungen von anderen Unternehmern (§ 15 Absatz 1 Satz 1 Nummer 1 UStG), aus Leistungen im Sinne des § 27 Absatz 40a UStG und aus innergemeinschaftlichen Dreiecksgeschäften (§ 25b Absatz 5 UStG)",
          hint: "Der Regelfall. Vorsteuer aus innergemeinschaftlichen Erwerben, Einfuhrumsatzsteuer und § 13b-Leistungen gehören ausdrücklich NICHT hierher, sondern in Kz 61, 62 bzw. 67.",
        },
        {
          kz: "61",
          zeile: 39,
          kind: "input_tax",
          rounding: "cent",
          label:
            "Vorsteuerbeträge aus dem innergemeinschaftlichen Erwerb von Gegenständen (§ 15 Absatz 1 Satz 1 Nummer 3 UStG)",
        },
        {
          kz: "62",
          zeile: 40,
          kind: "input_tax",
          rounding: "cent",
          label: "Entstandene Einfuhrumsatzsteuer (§ 15 Absatz 1 Satz 1 Nummer 2 UStG)",
        },
        {
          kz: "67",
          zeile: 41,
          kind: "input_tax",
          rounding: "cent",
          label:
            "Vorsteuerbeträge aus Leistungen im Sinne des § 13b UStG (§ 15 Absatz 1 Satz 1 Nummer 4 UStG)",
          hint: "Der Gegenposten zu Abschnitt D: die in Kz 47, 74 und 85 geschuldete Steuer ist hier als Vorsteuer abziehbar, soweit die allgemeinen Voraussetzungen des § 15 UStG vorliegen.",
        },
        {
          kz: "63",
          zeile: 42,
          kind: "input_tax",
          rounding: "cent",
          label:
            "Vorsteuerbeträge, die nach allgemeinen Durchschnittssätzen berechnet sind (§ 23a UStG)",
        },
        {
          kz: "59",
          zeile: 43,
          kind: "input_tax",
          rounding: "cent",
          label:
            "Vorsteuerabzug für innergemeinschaftliche Lieferungen neuer Fahrzeuge außerhalb eines Unternehmens (§ 2a UStG) sowie von Kleinunternehmern im Sinne des § 19 Absatz 1 UStG (§ 15 Absatz 4a UStG)",
        },
        {
          kz: "64",
          zeile: 44,
          kind: "input_tax",
          rounding: "cent",
          label: "Berichtigung des Vorsteuerabzugs (§ 15a UStG)",
          hint: "Kann positiv oder negativ sein. Ein negativer Wert erhöht die Zahllast.",
        },
        {
          kz: null,
          zeile: 45,
          kind: "computed",
          rounding: "cent",
          label: "Verbleibender Betrag (Zeile 37 abzüglich der Zeilen 38 bis 44)",
        },
      ],
    },
    {
      id: "G",
      title: "Andere Steuerbeträge",
      elster: { number: 8, title: "Andere Steuerbeträge" },
      fields: [
        {
          kz: "65",
          zeile: 46,
          kind: "tax",
          rounding: "cent",
          label:
            "Steuer infolge des Wechsels der Besteuerungsform sowie Nachsteuer auf versteuerte Anzahlungen und ähnlichem wegen Steuersatzänderung",
        },
        {
          kz: "69",
          zeile: 47,
          kind: "tax",
          rounding: "cent",
          label:
            "In Rechnungen unrichtig oder unberechtigt ausgewiesene Steuerbeträge (§ 14c UStG) sowie Steuerbeträge, die nach § 6a Absatz 4 Satz 2, § 17 Absatz 1 Satz 7, § 25b Absatz 2 UStG oder von einem Auslagerer oder Lagerhalter nach § 27 Absatz 40a UStG geschuldet werden",
        },
      ],
    },
    {
      id: "H",
      title: "Vorauszahlung/Überschuss",
      elster: { number: 9, title: "Umsatzsteuer-Vorauszahlung / Überschuss und Berechnung" },
      fields: [
        {
          kz: null,
          zeile: 48,
          kind: "computed",
          rounding: "cent",
          label: "Umsatzsteuer-Vorauszahlung/Überschuss (Summe der Zeilen 45 bis 47)",
        },
        {
          kz: "39",
          zeile: 49,
          kind: "input_tax",
          rounding: "cent",
          label:
            "Abzug der festgesetzten Sondervorauszahlung für Dauerfristverlängerung (in der Regel nur in der letzten Voranmeldung des Besteuerungszeitraums auszufüllen)",
          hint: "Nur relevant bei gewährter Dauerfristverlängerung. Die Anmeldung der Sondervorauszahlung selbst erfolgt über den Vordruck USt 1 H und ist nicht Teil dieser Ansicht.",
        },
        {
          kz: "83",
          zeile: 50,
          kind: "computed",
          rounding: "cent",
          label:
            "Verbleibende Umsatzsteuer-Vorauszahlung / Verbleibender Überschuss (Überschuss bitte mit Minuszeichen)",
          hint: "Bitte in jedem Fall ausfüllen — auch bei 0,00 €.",
        },
      ],
    },
    {
      id: "I",
      title:
        "Ergänzende Angaben zu Minderungen nach § 17 Absatz 1 Sätze 1 und 2 in Verbindung mit Absatz 2 Nummer 1 Satz 1 UStG",
      elster: { number: 10, title: "Ergänzende Angaben zu Minderungen nach § 17 Absatz 1 Sätze 1 und 2 in Verbindung mit Absatz 2 Nummer 1 Satz 1 UStG" },
      fields: [
        {
          kz: "50",
          zeile: 51,
          kind: "bmg",
          rounding: "euro",
          memoOnly: true,
          label: "Minderung der Bemessungsgrundlage (in den Zeilen 13 bis 18 enthalten)",
          hint: "Nachrichtliche Angabe. Der Betrag ist bereits in den Zeilen 13 bis 18 enthalten und wird hier nur zusätzlich ausgewiesen.",
        },
        {
          kz: "37",
          zeile: 52,
          kind: "input_tax",
          rounding: "cent",
          memoOnly: true,
          label:
            "Minderung der abziehbaren Vorsteuerbeträge (in der Zeile 38 aus Rechnungen von anderen Unternehmen (§ 15 Absatz 1 Satz 1 Nummer 1 UStG) sowie in den Zeilen 42 und 43 enthalten)",
          hint: "Nachrichtliche Angabe. Der Betrag ist bereits in den Zeilen 38, 42 und 43 enthalten.",
        },
      ],
    },
    {
      id: "J",
      title: "Sonstige Angaben",
      elster: { number: 11, title: "Sonstige Angaben" },
      fields: [
        {
          kz: "29",
          zeile: 53,
          kind: "flag",
          rounding: "cent",
          label:
            "Verrechnung des Erstattungsbetrags erwünscht / Erstattungsbetrag ist abgetreten (1 = Ja)",
          hint: "Ankreuzfeld, kein Betrag. Wird von dieser Ansicht nicht befüllt — bitte in Mein ELSTER selbst entscheiden.",
        },
        {
          kz: "26",
          zeile: 54,
          kind: "flag",
          rounding: "cent",
          label:
            "Das SEPA-Lastschriftmandat soll ausnahmsweise für diesen Voranmeldungszeitraum nicht verwendet werden (1 = Ja)",
          hint: "Ankreuzfeld, kein Betrag. Wird von dieser Ansicht nicht befüllt.",
        },
        {
          kz: "500",
          zeile: 55,
          kind: "flag",
          rounding: "cent",
          label: "Ergänzende Angaben zur Steueranmeldung (1 bis 4)",
          hint: "Nur auszufüllen, wenn steuererheblich Sachverhalte nicht erklärt werden konnten, bewusst eine abweichende Rechtsauffassung vertreten wird oder eine personelle Prüfung gewünscht ist. Eine Eintragung verlängert die Bearbeitungsdauer.",
        },
      ],
    },
  ],
};
