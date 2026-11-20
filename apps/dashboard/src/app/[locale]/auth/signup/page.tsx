import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { isSignupEnabled } from "@/lib/signup";
import { SignupWizard } from "./signup-wizard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signup");
  return { title: t("pageTitle") };
}

export default async function SignupPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Closed development: no public sign-up. Send visitors to login.
  if (!isSignupEnabled()) redirect(`/${locale}/auth/login`);

  // Already logged in → straight to dashboard (locale-root handles slug routing).
  const session = await auth();
  if (session?.user) redirect(`/${locale}`);

  return <SignupWizard locale={locale} />;
}
