/**
 * GET /api/documents/[id]/duplicates
 *
 * Liefert potenzielle Duplikate für einen Beleg innerhalb des Mandanten.
 *
 *  - exact:    identische Datei-Bytes (fileHash-Match)
 *  - semantic: identischer Fingerprint (vendor + amount + date), Bytes
 *              dürfen sich unterscheiden — fängt Re-Scans / Re-Exports.
 *
 * Antwort ist eine soft warning: der Client zeigt einen Banner mit Link
 * zum vorhandenen Beleg, blockt aber nichts.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantOrThrow } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { findDuplicates } from "@/lib/documents/fingerprint";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let t;
  try {
    t = await requireTenantOrThrow();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const doc = await db.document.findFirst({
    where: { id, tenantId: t.tenantId, deletedAt: null },
    select: { id: true, fileHash: true, fingerprint: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const matches = await findDuplicates({
    tenantId: t.tenantId,
    excludeId: doc.id,
    fileHash: doc.fileHash,
    fingerprint: doc.fingerprint,
  });

  return NextResponse.json({ matches });
}
