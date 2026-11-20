/**
 * POST /api/documents/[id]/ocr
 *
 * Manually (re-)trigger OCR processing for a document.
 * Useful for FAILED documents or when the API key is added later.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantOrThrow } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { processDocument } from "@/lib/ocr/process-document";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let t;
  try {
    t = await requireTenantOrThrow();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.MISTRAL_API_KEY && !process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: "No OCR API key configured (MISTRAL_API_KEY or OPENROUTER_API_KEY)." },
      { status: 503 }
    );
  }

  const { id } = await params;
  const doc = await db.document.findFirst({
    where: { id, tenantId: t.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  // Fire-and-forget — client polls status
  void processDocument(id);

  return NextResponse.json({ queued: true });
}
