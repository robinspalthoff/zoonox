"use client";

import { signOut } from "next-auth/react";
import { useParams } from "next/navigation";

export function SignOutButton({ label }: { label: string }) {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "de";

  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: `/${locale}/auth/login` })}
      className="w-full inline-flex items-center justify-center rounded-lg bg-foreground text-background px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
    >
      {label}
    </button>
  );
}
