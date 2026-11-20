import { db } from "@/lib/db";
import type { MonthCloseStatus } from "@prisma/client";

export type MonthCloseDTO = {
  year: number;
  month: number;
  status: MonthCloseStatus;
  submittedAt: string | null;
  submittedBy: { name: string | null; email: string | null } | null;
  finalizedAt: string | null;
  finalizedBy: { name: string | null; email: string | null } | null;
  reviewNotes: string | null;
  /** Anzahl Belege im Monat, die noch nicht gebucht sind. */
  unbookedDocuments: number;
  /** Anzahl Bank-Transaktionen im Monat, die noch UNMATCHED sind. */
  unmatchedTransactions: number;
  /** Summe offener Kommentare an Belegen/Buchungen/Rechnungen/Bankbewegungen des Monats. */
  openComments: number;
};

/**
 * Liefert die letzten `count` Monate (inkl. aktuellem) mit ihrem
 * MonthClose-Status. Monate ohne Datenbankzeile gelten als OPEN.
 */
export async function listRecentMonths(
  tenantId: string,
  count: number = 12,
): Promise<MonthCloseDTO[]> {
  const now = new Date();
  const months: { year: number; month: number }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  const rows = await db.monthClose.findMany({
    where: { tenantId, OR: months.map((m) => ({ year: m.year, month: m.month })) },
    include: {
      submittedBy: { select: { firstName: true, lastName: true, email: true } },
      finalizedBy: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  const byKey = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byKey.set(`${r.year}-${r.month}`, r);

  // Statistiken je Monat (Belege offen / Bank-Tx ungeklärt / offene Kommentare)
  // — ein Query pro Metrik je Monat, parallel. Bei nur 6 Monaten <= 18 Queries,
  // alle indexgestützt. Falls die Liste länger wird, lohnt sich ein einziger
  // grouped Query mit DATE_TRUNC.
  async function statsForMonth(year: number, month: number) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const [unbookedDocuments, unmatchedTransactions, openComments] = await Promise.all([
      // Belege, deren WIRTSCHAFTLICHES Datum im Monat liegt und die noch
      // nicht abgeschlossen sind. Priorität: deliveryDate → recognizedDate
      // → createdAt (Fallback wenn weder Belegdatum bestätigt noch von OCR
      // erkannt wurde). Identische Logik wie in /dashboard/documents/[id]
      // beim Bestimmen von `bookingDate`.
      db.document.count({
        where: {
          tenantId,
          deletedAt: null,
          status: { notIn: ["DONE", "PAID"] },
          OR: [
            { deliveryDate: { gte: start, lt: end } },
            { deliveryDate: null, recognizedDate: { gte: start, lt: end } },
            {
              deliveryDate: null,
              recognizedDate: null,
              createdAt: { gte: start, lt: end },
            },
          ],
        },
      }),
      db.bankTransaction.count({
        where: {
          tenantId,
          date: { gte: start, lt: end },
          status: "UNMATCHED",
        },
      }),
      db.comment.count({
        where: {
          tenantId,
          deletedAt: null,
          resolvedAt: null,
          createdAt: { gte: start, lt: end },
        },
      }),
    ]);
    return { unbookedDocuments, unmatchedTransactions, openComments };
  }

  const stats = await Promise.all(months.map((m) => statsForMonth(m.year, m.month)));

  return months.map((m, i) => {
    const r = byKey.get(`${m.year}-${m.month}`);
    const s = stats[i];
    const base = {
      year: m.year,
      month: m.month,
      unbookedDocuments: s.unbookedDocuments,
      unmatchedTransactions: s.unmatchedTransactions,
      openComments: s.openComments,
    };
    if (!r) {
      return {
        ...base,
        status: "OPEN" as MonthCloseStatus,
        submittedAt: null,
        submittedBy: null,
        finalizedAt: null,
        finalizedBy: null,
        reviewNotes: null,
      };
    }
    return {
      ...base,
      status: r.status,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      submittedBy: r.submittedBy
        ? {
            name: [r.submittedBy.firstName, r.submittedBy.lastName].filter(Boolean).join(" ") || null,
            email: r.submittedBy.email,
          }
        : null,
      finalizedAt: r.finalizedAt?.toISOString() ?? null,
      finalizedBy: r.finalizedBy
        ? {
            name: [r.finalizedBy.firstName, r.finalizedBy.lastName].filter(Boolean).join(" ") || null,
            email: r.finalizedBy.email,
          }
        : null,
      reviewNotes: r.reviewNotes,
    };
  });
}

/**
 * Status für einen einzelnen Monat (z.B. für Banner im UI). OPEN, wenn keine
 * Zeile existiert.
 */
export async function getMonthCloseStatus(
  tenantId: string,
  date: Date,
): Promise<MonthCloseStatus> {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const row = await db.monthClose.findUnique({
    where: { tenantId_year_month: { tenantId, year, month } },
    select: { status: true },
  });
  return row?.status ?? "OPEN";
}
