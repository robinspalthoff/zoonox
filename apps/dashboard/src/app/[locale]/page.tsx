import { redirect } from "next/navigation";

// Locale explizit aus params lesen und in die Redirect-URL einbauen:
// /de → /de/dashboard, /en → /en/dashboard.
// NICHT redirect("/dashboard") — das würde /dashboard ohne Locale-Prefix erzeugen,
// was [locale] mit locale="dashboard" matcht → Redirect-Loop.
export default async function LocaleRootPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/dashboard`);
}
