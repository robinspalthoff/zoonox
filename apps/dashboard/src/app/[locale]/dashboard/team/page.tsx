import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { TeamClient } from "./team-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("team");
  return { title: t("pageTitle") };
}

export default async function TeamPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { tenantId, userId, role } = await requireTenant();

  if (!["SUPER_ADMIN", "ADMIN"].includes(role)) {
    redirect(`/${locale}/dashboard`);
  }

  // Steuerberater werden bewusst NICHT als Team-Mitglieder geführt — sie
  // sind eine eigenständige Geschäftsbeziehung (Mandat), keine Mitarbeiter.
  // Die Verwaltung läuft über /dashboard/tax-advisor (Einladen, Trennen);
  // hier zeigen wir nur klassisches Team (OWNER/ADMIN/MEMBER).
  const tenantUsers = await db.tenantUser.findMany({
    where: { tenantId, role: { not: "ACCOUNTANT" } },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const users = tenantUsers.map((tu) => tu.user);

  return (
    <TeamClient
      users={JSON.parse(JSON.stringify(users))}
      currentUserId={userId}
      currentUserRole={role}
    />
  );
}
