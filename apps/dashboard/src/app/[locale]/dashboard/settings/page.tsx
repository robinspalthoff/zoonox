import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ProfileSettingsForm } from "./profile-settings-form";
import { AccountSettingsForm } from "./account-settings-form";
import { TwoFactorSettings } from "./two-factor-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("user.title") };
}

export default async function SettingsUserPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { firstName: true, lastName: true, email: true, twoFactorEnabled: true },
  });
  if (!user) redirect("/auth/login");

  const t = await getTranslations("settings");

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("user.title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("user.subtitle")}</p>
      </div>

      <ProfileSettingsForm
        firstName={user.firstName}
        lastName={user.lastName}
        email={user.email}
      />
      <AccountSettingsForm />
      <TwoFactorSettings enabled={user.twoFactorEnabled} />
    </>
  );
}
