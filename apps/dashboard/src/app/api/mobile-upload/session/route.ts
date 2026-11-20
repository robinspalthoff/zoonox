import { NextResponse } from "next/server";
import { requireTenantOrThrow } from "@/lib/require-tenant";
import { createMobileUploadSession } from "@/lib/documents/mobile-upload-session";
import { revokeMobileSession } from "@/lib/documents/mobile-upload-session";

export async function POST() {
  let t;
  try {
    t = await requireTenantOrThrow();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const info = await createMobileUploadSession({
      tenantId: t.tenantId,
      userId: t.userId,
    });
    return NextResponse.json({
      token: info.token,
      url: info.url,
      expiresAt: info.expiresAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "RATE_LIMITED") {
      return NextResponse.json(
        { error: "Too many active upload sessions. Please wait." },
        { status: 429 },
      );
    }
    console.error("[mobile-upload] session create failed:", err);
    return NextResponse.json({ error: "Failed to create session." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  let t;
  try {
    t = await requireTenantOrThrow();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  await revokeMobileSession({ token, userId: t.userId });
  return NextResponse.json({ ok: true });
}
