/**
 * POST /api/documents/upload
 *
 * Accepts file uploads (PDF, PNG, JPG), stores them on disk,
 * creates a Document record, and returns the document ID.
 *
 * Max file size: 10 MB
 * Accepted types: application/pdf, image/png, image/jpeg
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantOrThrow } from "@/lib/require-tenant";
import {
  createDocumentFromUpload,
  serializeDocumentForApi,
} from "@/lib/documents/create-from-upload";

export async function POST(req: NextRequest) {
  let t;
  try {
    t = await requireTenantOrThrow();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await createDocumentFromUpload({
      tenantId: t.tenantId,
      userId: t.userId,
      fileName: file.name,
      fileType: file.type,
      size: file.size,
      buffer,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(serializeDocumentForApi(result.document));
  } catch (err) {
    console.error("[documents] Upload failed:", err);
    return NextResponse.json(
      { error: "Upload failed. Please try again." },
      { status: 500 },
    );
  }
}
