"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function toggle() {
    const next = locale === "de" ? "en" : "de";
    router.replace(pathname, { locale: next });
  }

  return (
    <button
      onClick={toggle}
      className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted"
      aria-label="Switch language"
    >
      {locale === "de" ? "EN" : "DE"}
    </button>
  );
}
