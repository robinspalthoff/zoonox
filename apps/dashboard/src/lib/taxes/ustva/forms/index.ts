// Registry der Vordruckjahrgänge.
//
// Pflegeprinzip: Ein Jahr bekommt nur dann ein eigenes File, wenn das BMF am
// Vordruck etwas ändert, das uns betrifft (neue/entfallene Kennzahl, geänderte
// Zeilenzuordnung, geänderte Rechenregel). Für alle anderen Jahre greift
// automatisch der jüngste definierte Jahrgang.
//
// Das ist Absicht: 2027 soll ohne Codeänderung weiterlaufen, wenn sich nichts
// ändert. Reine Jahreszahl-Anpassungen im Vordruck sind für uns irrelevant.
//
// Der Fallback wird aber nie verschwiegen — `resolveForm` meldet ihn zurück,
// damit die UI kennzeichnen kann, dass der Formularstand nicht für das
// angefragte Jahr geprüft wurde. Stillschweigend veraltete Steuerformulare zu
// verwenden wäre die schlechtere Variante von „bricht nicht".

import type { UstvaForm } from "../types";
import { FORM_2026 } from "./2026";

/** Alle explizit gepflegten Jahrgänge, aufsteigend sortiert ausgewertet. */
const FORMS: readonly UstvaForm[] = [FORM_2026];

/** Frühestes Jahr, für das wir überhaupt einen Vordruck kennen. */
export const EARLIEST_FORM_YEAR = Math.min(...FORMS.map((f) => f.year));

export type ResolvedForm = {
  form: UstvaForm;
  /** Angefragtes Kalenderjahr. */
  requestedYear: number;
  /**
   * True, wenn für `requestedYear` kein eigener Jahrgang gepflegt ist und
   * ersatzweise ein älterer verwendet wird. Die UI weist darauf hin.
   */
  isFallback: boolean;
};

/**
 * Liefert den Vordruck für ein Kalenderjahr.
 *
 * Gesucht wird der jüngste gepflegte Jahrgang, der nicht nach `year` liegt.
 * Für Jahre vor dem frühesten gepflegten Jahrgang wird dieser verwendet —
 * rückwirkende Voranmeldungen für sehr alte Zeiträume sind kein Anwendungs-
 * fall, und ein Fehler wäre hier unfreundlicher als ein gekennzeichneter
 * Näherungswert.
 */
export function resolveForm(year: number): ResolvedForm {
  const candidates = FORMS.filter((f) => f.year <= year);
  const form =
    candidates.length > 0
      ? candidates.reduce((best, f) => (f.year > best.year ? f : best))
      : FORMS.reduce((best, f) => (f.year < best.year ? f : best));

  return { form, requestedYear: year, isFallback: form.year !== year };
}

export { FORM_2026 };
