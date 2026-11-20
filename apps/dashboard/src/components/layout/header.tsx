"use client";

import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { TenantSwitcher } from "./tenant-switcher";
import { CommentNotifications } from "./comment-notifications";
import type { NotificationSummary } from "@/lib/comments/queries";

interface HeaderProps {
  userName: string | null;
  userEmail: string | null;
  notifications: NotificationSummary;
}

export function Header({ userName, userEmail, notifications }: HeaderProps) {
  return (
    <header
      // `relative z-40` is the actual fix for the user-menu dropdown
      // being covered on /dashboard, /invoices, /documents. Without
      // explicit positioning the header sits at z-auto in the flex
      // parent, tied with <main>, and CSS source-order makes main
      // paint on top — so positioned descendants of main (badges with
      // backdrop-blur, sticky tab bars, row action menus etc.) ended
      // up over the dropdown despite its inner z-50. z-40 keeps the
      // header above normal page content but still below modal
      // overlays (z-50) and below the collapsed-sidebar flyout (z-50)
      // — both of those are meant to take over the screen.
      className="relative z-40 h-16 shrink-0 flex items-center justify-between px-6 border-b border-border bg-card/50 backdrop-blur-sm"
    >
      <div className="flex items-center">
        <TenantSwitcher />
      </div>

      <div className="flex items-center gap-1">
        <CommentNotifications initial={notifications} />
        <ThemeToggle />

        <div className="w-px h-5 bg-border mx-1" />

        <UserMenu userName={userName} userEmail={userEmail} />
      </div>
    </header>
  );
}
