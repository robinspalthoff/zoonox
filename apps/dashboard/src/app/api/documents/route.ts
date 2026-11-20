import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireTenantOrThrow } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { deleteDocumentById } from "@/lib/documents/delete";

export async function GET() {
  let t;
  try {
    t = await requireTenantOrThrow();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const documents = await db.document.findMany({
    where: { tenantId: t.tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      status: true,
      category: true,
      recognizedAmount: true,
      recognizedDate: true,
      recognizedSupplier: true,
      suggestedCategory: true,
      createdAt: true,
      uploadedBy: { select: { firstName: true, lastName: true } },
    },
  });

  return NextResponse.json(documents);
}

export async function DELETE(req: NextRequest) {
  let t;
  try {
    t = await requireTenantOrThrow();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "ID required." }, { status: 400 });
  }

  // Booked documents are soft-deleted (bookings reversed, file retained for
  // GoBD); un-booked ones are hard-deleted. See lib/documents/delete.ts.
  const result = await deleteDocumentById(id, t.tenantId, t.userId);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // RSC-Cache invalidieren — sonst hält Next die Belegliste auf der
  // /dashboard/documents-Seite beim nächsten Navigieren noch im Cache und
  // der gerade gelöschte Beleg taucht wieder auf.
  revalidatePath("/dashboard/documents");
  revalidatePath(`/dashboard/documents/${id}`);

  return NextResponse.json({ success: true, mode: result.mode });
}
