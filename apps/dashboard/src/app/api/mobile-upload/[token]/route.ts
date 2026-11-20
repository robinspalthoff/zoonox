import { NextRequest, NextResponse } from "next/server";
import {
  appendDocumentToSession,
  resolveActiveMobileSession,
} from "@/lib/documents/mobile-upload-session";
import {
  createDocumentFromUpload,
  serializeDocumentForApi,
} from "@/lib/documents/create-from-upload";

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { token } = await ctx.params;
  const session = await resolveActiveMobileSession(token);
  if (!session) {
    return NextResponse.json(
      { error: "Upload-Link ist abgelaufen oder ungültig." },
      { status: 401 },
    );
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Keine Datei übermittelt." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await createDocumentFromUpload({
      tenantId: session.tenantId,
      userId: session.userId,
      fileName: file.name || `mobile-upload-${Date.now()}.jpg`,
      fileType: file.type || "image/jpeg",
      size: file.size,
      buffer,
      source: "MOBILE",
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    await appendDocumentToSession(session.id, result.document.id);

    return NextResponse.json(serializeDocumentForApi(result.document));
  } catch (err) {
    console.error("[mobile-upload] upload failed:", err);
    return NextResponse.json({ error: "Upload fehlgeschlagen." }, { status: 500 });
  }
}
