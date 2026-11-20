// GoBD / §147 AO retention policy.
//
// Steuerlich relevante Belege (Rechnungen, Eingangsbelege) müssen 10 Jahre
// unveränderbar aufbewahrt werden. Die Frist beginnt mit dem Schluss des
// Kalenderjahres, in dem der Beleg entstanden ist (§ 147 Abs. 3/4 AO) — ein
// im März 2026 gebuchter Beleg ist also bis zum 31.12.2036 aufzubewahren.
//
// Umgesetzt über S3/R2 Object Lock im COMPLIANCE-Modus: bis zum
// retain-until-Datum kann das Objekt von NIEMANDEM — auch nicht vom
// Account-Owner — gelöscht oder überschrieben werden.

export type ObjectLockMode = "COMPLIANCE" | "GOVERNANCE";

/** Object-Lock-Modus für GoBD-Belege. COMPLIANCE = echte Unveränderbarkeit. */
export const GOBD_OBJECT_LOCK_MODE: ObjectLockMode = "COMPLIANCE";

/** Aufbewahrungsfrist in Jahren (§ 147 AO). */
export const GOBD_RETENTION_YEARS = 10;

/**
 * Retain-until-Datum für einen Beleg, der zum Zeitpunkt `from` entstanden ist.
 * Rundet auf den 31.12. des Jahres `from + 10` — die Frist läuft ab
 * Kalenderjahresende, daher wird bis Jahresende des Zieljahres aufbewahrt.
 */
export function gobdRetainUntil(from: Date = new Date()): Date {
  return new Date(
    Date.UTC(from.getUTCFullYear() + GOBD_RETENTION_YEARS, 11, 31, 23, 59, 59),
  );
}
