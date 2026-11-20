/**
 * POST /api/documents/[id]/attach
 *
 * Reicht eine Datei (PDF/PNG/JPG) zu einem manuell angelegten, file-losen
 * Beleg nach. Nur erlaubt, solange der Beleg noch keine Datei und keine
 * Journal-Buchung hat. Die anschließende OCR läuft im "fill-empty"-Modus,
 * d.h. bereits manuell gepflegte Felder bleiben unverändert.
 */

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireTenantOrThrow } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { storage, buildDocumentKey } from "@/lib/storage";
import { sniffContentType } from "@/lib/storage/sniff";
import { processDocument } from "@/lib/ocr/process-document";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];

export async function POST(
  req: NextRequest,
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
    select: { id: true, storagePath: true, fileName: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
  if (doc.storagePath !== "") {
    return NextResponse.json(
      { error: "Beleg hat bereits eine Datei." },
      { status: 409 },
    );
  }

  // Wenn der Beleg schon gebucht ist, darf nichts mehr ergänzt werden.
  const journalCount = await db.journalEntry.count({
    where: { tenantId: t.tenantId, sourceType: "DOCUMENT", sourceId: id },
  });
  if (journalCount > 0) {
    return NextResponse.json(
      { error: "Beleg ist bereits gebucht — Datei kann nicht nachgereicht werden." },
      { status: 409 },
    );
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `File type ${file.type} not supported. Accepted: PDF, PNG, JPG.` },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum size is 10 MB." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffedType = sniffContentType(buffer);
  if (!sniffedType) {
    return NextResponse.json(
      { error: "File content not recognized. Accepted: PDF, PNG, JPG." },
      { status: 400 },
    );
  }

  try {
    const storagePath = buildDocumentKey(t.tenantId, file.name);
    const fileHash = createHash("sha256").update(buffer).digest("hex");
    await storage.put(storagePath, buffer, sniffedType);

    await db.document.update({
      where: { id },
      data: {
        fileName: file.name,
        fileType: sniffedType,
        fileSize: file.size,
        storagePath,
        fileHash,
        status: "PENDING",
      },
    });

    // OCR im "fill-empty"-Modus — bereits manuell gepflegte Felder bleiben.
    if (process.env.MISTRAL_API_KEY || process.env.OPENROUTER_API_KEY) {
      void processDocument(id, { mergeStrategy: "fill-empty" });
    }

    return NextResponse.json({ id, fileName: file.name, fileType: sniffedType });
  } catch (err) {
    console.error("[documents] attach failed:", err);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
