import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { db } from "@/lib/db";
import { parseOnboardingState } from "@/lib/onboarding";
import { getNotifications } from "@/lib/comments/queries";
import { OnboardingProvider } from "@/components/onboarding/onboarding-provider";
import { OnboardingHints } from "@/components/onboarding/onboarding-hints";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();

  if (!session?.user) redirect(`/${locale}/auth/login`);

  // Eingeloggt, aber kein aktiver Tenant: User ist verwaister Account
  // (kein TenantUser-Membership). Statt Loop zwischen /setup und /auth/login
  // direkt auf eine "no tenant"-Seite, die einen Logout-Button anbietet.
  if (!session.user.tenantId) redirect(`/${locale}/auth/no-tenant`);

  const [userRow, notifications] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: { onboardingState: true },
    }),
    // Header-Bell: aggregiert Comments + MonthClose-Events, rollenabhängig.
    getNotifications(
      session.user.tenantId,
      session.user.id,
      session.user.tenantRole ?? "MEMBER",
      8,
    ),
  ]);
  const onboardingState = parseOnboardingState(userRow?.onboardingState);

  return (
    <OnboardingProvider initialState={onboardingState}>
      <DashboardShell
        userName={session.user.name ?? null}
        userEmail={session.user.email ?? null}
        userRole={session.user.role}
        tenantRole={session.user.tenantRole ?? "MEMBER"}
        tenantCount={session.user.tenants?.length ?? 1}
        notifications={notifications}
      >
        {children}
      </DashboardShell>
      {/* Route-aware contextual hints — portal'd, so placement here is
          purely a mount point that lives above every dashboard route. */}
      <OnboardingHints />
    </OnboardingProvider>
  );
}
