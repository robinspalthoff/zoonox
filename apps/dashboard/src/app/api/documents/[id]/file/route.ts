/**
 * GET /api/documents/[id]/file
 *
 * Serves a stored document file (PDF or image). Authentication required —
 * files are private. The flow depends on the storage driver:
 *
 *   - R2:    issue a 5-minute presigned URL and redirect; the browser
 *            fetches the file directly from Cloudflare. Saves bandwidth
 *            on the app server and benefits from R2's free egress.
 *   - local: stream the file inline, same as before.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantOrThrow } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { storage, STORAGE_DRIVER } from "@/lib/storage";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let t;
  try {
    t = await requireTenantOrThrow();
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;

  const doc = await db.document.findFirst({
    where: { id, tenantId: t.tenantId, deletedAt: null },
    select: { storagePath: true, fileType: true, fileName: true },
  });

  if (!doc) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // Manuell angelegte file-lose Belege haben storagePath = "" und dürfen
  // keinen Storage-Zugriff auslösen.
  if (!doc.storagePath) {
    return new NextResponse("No file attached", { status: 404 });
  }

  // DSGVO / forensics: record every access to a document file. The
  // ?download=1 flag (set by the explicit download buttons) separates a
  // deliberate download from an inline preview render.
  const isDownload = req.nextUrl.searchParams.get("download") === "1";
  await createAuditLog({
    action: isDownload ? "DOCUMENT_DOWNLOADED" : "DOCUMENT_VIEWED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Document",
    entityId: id,
    details: { fileName: doc.fileName },
  });

  if (STORAGE_DRIVER === "r2") {
    const url = await storage.signedUrl(doc.storagePath, 300);
    return NextResponse.redirect(url, 302);
  }

  const buf = await storage.get(doc.storagePath);
  if (!buf) {
    return new NextResponse("File not found in storage", { status: 404 });
  }

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": doc.fileType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(doc.fileName)}"`,
      "Cache-Control": "private, max-age=3600",
      "Content-Length": buf.byteLength.toString(),
    },
  });
}
