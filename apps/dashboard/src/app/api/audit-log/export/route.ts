import { NextRequest, NextResponse } from "next/server";
import { requireTenantOrThrow } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import type { AuditAction } from "@prisma/client";
import { fullName } from "@/lib/user-name";

export async function GET(req: NextRequest) {
  let t;
  try {
    t = await requireTenantOrThrow();
  } catch {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (!["SUPER_ADMIN", "ADMIN"].includes(t.role) && t.tenantRole !== "OWNER" && t.tenantRole !== "ADMIN") {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const sp = req.nextUrl.searchParams;

  const where: Record<string, unknown> = { tenantId: t.tenantId };
  if (sp.get("action")) where.action = sp.get("action") as AuditAction;
  if (sp.get("user")) where.userId = sp.get("user");
  if (sp.get("from") || sp.get("to")) {
    const dateFilter: Record<string, Date> = {};
    if (sp.get("from")) dateFilter.gte = new Date(`${sp.get("from")}T00:00:00`);
    if (sp.get("to")) dateFilter.lte = new Date(`${sp.get("to")}T23:59:59`);
    where.createdAt = dateFilter;
  }

  const entries = await db.auditLog.findMany({
    where,
    include: { user: { select: { firstName: true, lastName: true, email: true } } },
    orderBy: { createdAt: "desc" },
    // Cap at 10 000 rows to keep exports manageable
    take: 10_000,
  });

  const header = ["Zeitpunkt", "Nutzer", "E-Mail", "Aktion", "Objekt-Typ", "Objekt-ID", "IP-Adresse", "User-Agent"];

  const rows = entries.map((e) => [
    e.createdAt.toISOString(),
    fullName(e.user) ?? "",
    e.user?.email ?? "",
    e.action,
    e.entityType ?? "",
    e.entityId ?? "",
    e.ipAddress ?? "",
    e.userAgent ?? "",
  ]);

  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");

  const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
