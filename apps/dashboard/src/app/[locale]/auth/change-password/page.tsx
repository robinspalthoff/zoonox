import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { appConfig } from "@/config/app";
import { LocaleSwitcher } from "@/components/locale-switcher";
import ChangePasswordForm from "./change-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.changePassword");
  return { title: t("pageTitle") };
}

export default async function ChangePasswordPage() {
  const t = await getTranslations("auth.changePassword");

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="flex justify-center mb-3">
            <Image
              src="/logo.png"
              alt={appConfig.name}
              width={48}
              height={48}
              className="rounded-xl"
            />
          </div>
          <p className="font-semibold text-foreground">{appConfig.name}</p>
          <h1 className="text-lg font-semibold text-foreground mt-2">{t("title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
        </div>

        <ChangePasswordForm />

        <div className="flex justify-center mt-4">
          <LocaleSwitcher />
        </div>
      </div>
    </div>
  );
}
