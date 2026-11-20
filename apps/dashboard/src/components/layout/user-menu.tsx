"use client";

import { signOut } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useRef, useEffect } from "react";
import { LogOut, Settings, ChevronDown, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";

interface UserMenuProps {
  userName: string | null;
  userEmail: string | null;
}

export function UserMenu({ userName, userEmail }: UserMenuProps) {
  const t = useTranslations("common.nav");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const initials = userName
    ? userName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : userEmail?.charAt(0).toUpperCase() ?? "?";

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent transition-colors"
      >
        <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-primary text-xs font-semibold">
          {initials}
        </div>
        <div className="hidden sm:block text-left">
          <p className="text-xs font-medium text-foreground leading-none">{userName ?? "–"}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-none">{userEmail ?? ""}</p>
        </div>
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-card border border-border rounded-xl shadow-xl shadow-black/20 overflow-hidden z-50">
          {/* User Info */}
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs font-medium text-foreground">{userName}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{userEmail}</p>
          </div>

          {/* Navigation */}
          <div className="p-1.5">
            <Link
              href="/dashboard/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Settings className="w-4 h-4" />
              {t("settings")}
            </Link>
            <Link
              href="/dashboard/settings#account"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <KeyRound className="w-4 h-4" />
              {t("changePassword")}
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: `/${locale}/auth/login` })}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              {t("logout")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
