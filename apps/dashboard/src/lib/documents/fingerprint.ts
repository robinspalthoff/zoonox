/**
 * Duplikat-Erkennung für Belege.
 *
 * Zwei Match-Stufen:
 *  - exact: identische Datei-Bytes (sha256(fileHash))
 *  - semantic: identischer Fingerprint aus OCR-Feldern
 *    sha256(vendor_normalized | amount_cents | date_YYYYMMDD)
 *
 * Der semantische Fingerprint trifft auch Re-Scans oder Re-Exports derselben
 * Rechnung, deren Bytes sich unterscheiden. Falsch-positive sind möglich
 * (gleicher Lieferant + gleicher Betrag + gleiches Datum in unterschiedlichem
 * Kontext) — deshalb nur soft warning, kein hartes Blocking.
 */

import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Normalisiert den Lieferantennamen für den Fingerprint:
 *  - lower-case
 *  - DACH-Rechtsformen entfernen (GmbH, AG, UG, KG, e.K.) — damit
 *    "Acme GmbH" und "Acme" auf denselben Fingerprint mappen.
 *  - Mehrfach-Whitespace → einzelnes Space, trim.
 */
export function normalizeVendor(vendor: string): string {
  return vendor
    .toLowerCase()
    .replace(/\s*(gmbh|ag|ug|kg|e\.k\.)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type FingerprintInput = {
  vendor: string | null | undefined;
  amount: number | string | null | undefined; // EUR, kann Decimal-String sein
  date: Date | string | null | undefined;
};

/**
 * Berechnet den Fingerprint, sofern alle drei Felder vorhanden sind.
 * Liefert `null`, wenn ein Feld fehlt (z.B. OCR konnte nichts erkennen) —
 * dann gibt es keinen sinnvollen Schlüssel, also auch keinen Match.
 */
export function computeFingerprint(input: FingerprintInput): string | null {
  if (!input.vendor || !input.amount || !input.date) return null;

  const vendorNorm = normalizeVendor(String(input.vendor));
  if (!vendorNorm) return null;

  const amountNum = typeof input.amount === "string" ? Number(input.amount) : input.amount;
  if (!Number.isFinite(amountNum)) return null;
  const amountCents = Math.round((amountNum as number) * 100);

  const d = input.date instanceof Date ? input.date : new Date(input.date);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const dateStr = `${yyyy}${mm}${dd}`;

  return createHash("sha256")
    .update(`${vendorNorm}|${amountCents}|${dateStr}`)
    .digest("hex");
}

export type DuplicateMatchKind = "exact" | "semantic";

export type DuplicateMatch = {
  id: string;
  fileName: string;
  status: string;
  category: string | null;
  recognizedSupplier: string | null;
  recognizedAmount: string | null;
  recognizedDate: string | null;
  createdAt: string;
  kind: DuplicateMatchKind;
};

/**
 * Sucht Duplikate für einen Beleg innerhalb des gleichen Tenants.
 * Soft-deleted Belege werden ignoriert. Der Beleg selbst (`excludeId`) wird
 * ausgeschlossen, sonst trifft jeder Beleg sich selbst.
 *
 * Reihenfolge: exact zuerst, dann semantic — exact-Treffer sind belastbarer.
 */
export async function findDuplicates(args: {
  tenantId: string;
  excludeId?: string | null;
  fileHash?: string | null;
  fingerprint?: string | null;
}): Promise<DuplicateMatch[]> {
  const { tenantId, excludeId } = args;
  if (!args.fileHash && !args.fingerprint) return [];

  const baseWhere: Prisma.DocumentWhereInput = {
    tenantId,
    deletedAt: null,
    ...(excludeId ? { id: { not: excludeId } } : {}),
  };

  const select = {
    id: true,
    fileName: true,
    status: true,
    category: true,
    recognizedSupplier: true,
    recognizedAmount: true,
    recognizedDate: true,
    createdAt: true,
  } as const;

  const [exactMatches, semanticMatches] = await Promise.all([
    args.fileHash
      ? db.document.findMany({
          where: { ...baseWhere, fileHash: args.fileHash },
          select,
          orderBy: { createdAt: "desc" },
          take: 5,
        })
      : Promise.resolve([]),
    args.fingerprint
      ? db.document.findMany({
          where: { ...baseWhere, fingerprint: args.fingerprint },
          select,
          orderBy: { createdAt: "desc" },
          take: 5,
        })
      : Promise.resolve([]),
  ]);

  const seen = new Set<string>();
  const out: DuplicateMatch[] = [];

  for (const doc of exactMatches) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    out.push(serializeMatch(doc, "exact"));
  }
  for (const doc of semanticMatches) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    out.push(serializeMatch(doc, "semantic"));
  }
  return out;
}

function serializeMatch(
  doc: {
    id: string;
    fileName: string;
    status: string;
    category: string | null;
    recognizedSupplier: string | null;
    recognizedAmount: Prisma.Decimal | null;
    recognizedDate: Date | null;
    createdAt: Date;
  },
  kind: DuplicateMatchKind,
): DuplicateMatch {
  return {
    id: doc.id,
    fileName: doc.fileName,
    status: doc.status,
    category: doc.category,
    recognizedSupplier: doc.recognizedSupplier,
    recognizedAmount: doc.recognizedAmount ? doc.recognizedAmount.toString() : null,
    recognizedDate: doc.recognizedDate ? doc.recognizedDate.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    kind,
  };
}
