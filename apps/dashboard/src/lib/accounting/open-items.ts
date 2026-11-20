/**
 * Open-items (OPOS / „offene Posten") — flache Listen für die OPOS-Auswertung.
 *
 * Bewusst pragmatisch gehalten (vgl. Lexware): keine Aging-Buckets, keine
 * Gruppierung — der Buchhalter sieht eine Tabelle pro Modus (Forderungen
 * oder Verbindlichkeiten) und die Summen unter dem Strich.
 *
 * Receivables: Ausgangsrechnungen mit Status SENT/OVERDUE.
 * Payables:    Eingangsbelege (documentType EXPENSE) mit Status DONE und ohne
 *              DocumentPayment — also gebuchte, aber noch unbezahlte Belege.
 */

import { db } from "@/lib/db";

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

export interface OpenItemContact {
  id: string;
  name: string;
  customerNumber: string | null;
  supplierNumber: string | null;
}

export interface OpenReceivable {
  invoiceId: string;
  number: string;
  issueDate: Date;
  dueDate: Date | null;
  total: number;
  daysOverdue: number;
  contact: OpenItemContact;
}

export interface OpenPayable {
  documentId: string;
  fileName: string;
  documentNumber: string | null;
  date: Date;
  dueDate: Date | null;
  total: number;
  daysOverdue: number;
  // Lieferant kann fehlen (Beleg noch nicht verknüpft); die Page zeigt
  // solche Zeilen mit einem Hinweis, damit der Nutzer den Kontakt nachträgt.
  contact: OpenItemContact | null;
}

export async function getOpenReceivables(
  tenantId: string,
  contactId: string | null = null,
  now: Date = new Date(),
): Promise<OpenReceivable[]> {
  const invoices = await db.invoice.findMany({
    where: {
      tenantId,
      status: { in: ["SENT", "OVERDUE"] },
      ...(contactId ? { contactId } : {}),
    },
    select: {
      id: true,
      number: true,
      issueDate: true,
      dueDate: true,
      total: true,
      contact: {
        select: {
          id: true,
          name: true,
          customerNumber: true,
          supplierNumber: true,
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { issueDate: "asc" }],
  });

  return invoices.map((inv) => {
    const due = inv.dueDate ?? inv.issueDate;
    return {
      invoiceId: inv.id,
      number: inv.number,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      total: Number(inv.total),
      daysOverdue: daysBetween(due, now),
      contact: inv.contact,
    };
  });
}

export async function getOpenPayables(
  tenantId: string,
  contactId: string | null = null,
  now: Date = new Date(),
): Promise<OpenPayable[]> {
  const docs = await db.document.findMany({
    where: {
      tenantId,
      deletedAt: null,
      documentType: "EXPENSE",
      status: "DONE",
      payment: null,
      ...(contactId ? { contactId } : {}),
    },
    select: {
      id: true,
      fileName: true,
      documentNumber: true,
      recognizedDate: true,
      createdAt: true,
      dueDate: true,
      lineItems: { select: { total: true } },
      contact: {
        select: {
          id: true,
          name: true,
          customerNumber: true,
          supplierNumber: true,
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { recognizedDate: "asc" }],
  });

  return docs.map((d) => {
    const refDate = d.recognizedDate ?? d.createdAt;
    const due = d.dueDate ?? refDate;
    const total = d.lineItems.reduce(
      (s, li) => s + (li.total ? Number(li.total) : 0),
      0,
    );
    return {
      documentId: d.id,
      fileName: d.fileName,
      documentNumber: d.documentNumber,
      date: refDate,
      dueDate: d.dueDate,
      total,
      daysOverdue: daysBetween(due, now),
      contact: d.contact,
    };
  });
}

export function sumTotals<T extends { total: number }>(items: T[]): number {
  return items.reduce((s, i) => s + i.total, 0);
}
