import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";

export default async function FirmIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await requireTenant();
  const tenantCount = await db.tenantUser.count({ where: { userId: t.userId } });

  // Bei mehreren Mandanten zur Liste, sonst direkt zum Monatsabschluss
  // (Steuerberater mit nur einem Mandanten wäre die seltene Ausnahme).
  if (tenantCount > 1) {
    redirect(`/${locale}/dashboard/firm/clients`);
  }
  redirect(`/${locale}/dashboard/firm/closing`);
}
