import { redirect } from "@/i18n/navigation";

export default async function TaxesIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/dashboard/taxes/vat-return", locale });
}
