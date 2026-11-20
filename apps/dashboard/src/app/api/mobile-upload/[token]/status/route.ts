import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTenantOrThrow } from "@/lib/require-tenant";
import { serializeDocumentForApi } from "@/lib/documents/create-from-upload";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  let t;
  try {
    t = await requireTenantOrThrow();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token } = await ctx.params;
  const session = await db.mobileUploadSession.findUnique({ where: { token } });
  if (!session || session.tenantId !== t.tenantId || session.userId !== t.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isExpired = session.expiresAt.getTime() <= Date.now();
  const status = session.revokedAt
    ? "revoked"
    : isExpired
      ? "expired"
      : session.documentIds.length > 0
        ? "active"
        : "pending";

  const documents = session.documentIds.length
    ? await db.document.findMany({
        where: { id: { in: session.documentIds }, tenantId: t.tenantId },
        include: { uploadedBy: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return NextResponse.json({
    status,
    expiresAt: session.expiresAt.toISOString(),
    documentCount: session.documentIds.length,
    documents: documents.map(serializeDocumentForApi),
  });
}
