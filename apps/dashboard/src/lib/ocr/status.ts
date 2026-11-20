// Welchen Status ein Beleg nach der Texterkennung bekommt.
//
// Steht bewusst als eigene Funktion da: die Regel ist kurz, aber sie war die
// Ursache eines Fehlers, der von außen wie ein UI-Problem aussah. Früher setzte
// die OCR schlicht DONE — derselbe Wert, mit dem der Nutzer einen Beleg
// fertigstellt. Ein frisch hochgeladener Beleg galt damit als abgeschlossen und
// ließ sich zum Beispiel nicht mehr als Anlagegut markieren.

import type { DocumentStatus } from "@prisma/client";

/**
 * Nach der Texterkennung ist ein Beleg in Bearbeitung, nicht fertig — der
 * Nutzer muss die erkannten Werte noch prüfen.
 *
 * Ausnahme: einen bereits fertiggestellten oder bezahlten Beleg stuft ein
 * erneuter OCR-Lauf nicht zurück. Das passiert beim manuellen Neuverarbeiten
 * eines alten Belegs und darf dessen Bearbeitungsstand nicht verwerfen.
 */
export function statusAfterOcr(current: DocumentStatus): DocumentStatus {
  if (current === "DONE" || current === "PAID") return current;
  return "DRAFT";
}

/** True, wenn die Texterkennung durch ist — unabhängig vom Bearbeitungsstand. */
export function isOcrComplete(doc: {
  status: DocumentStatus;
  ocrCompletedAt: Date | null;
}): boolean {
  // ocrCompletedAt ist die verlässliche Quelle. Der Statusvergleich fängt
  // Bestandsdaten ab, bei denen das Feld noch nicht gesetzt wurde.
  return doc.ocrCompletedAt !== null || doc.status === "DONE" || doc.status === "PAID";
}
