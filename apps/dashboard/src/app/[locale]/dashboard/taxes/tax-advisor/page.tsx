import { redirect } from "next/navigation";

/**
 * Alte Sub-Route bleibt als Redirect erhalten, damit existierende
 * Bookmarks und alte Tabs nicht ins Leere laufen. Konzeptionell ist
 * "Mein Steuerberater" weder eine Steuer-Auswertung noch ein Report,
 * sondern Beziehung+Workflow zum Berater — daher Top-Level
 * `/dashboard/tax-advisor`. DATEV-Export lebt separat unter
 * `/dashboard/taxes/datev-export`.
 */
export default async function TaxAdvisorRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/dashboard/tax-advisor`);
}
