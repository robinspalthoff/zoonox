"use client";

import { useEffect, type ReactNode } from "react";

/**
 * Restored beim Unmount das ursprünglich aktive Theme. Der harte
 * Light-Switch passiert via Inline-Script im Auth-Layout (vor Paint);
 * dieser Guard kümmert sich nur darum, dass nach erfolgreichem Login
 * (oder Navigation weg von /auth/*) das vom User gewählte Theme
 * (aus localStorage) wieder greift.
 */
export default function AuthThemeGuard({ children }: { children: ReactNode }) {
  useEffect(() => {
    return () => {
      try {
        const stored = (localStorage.getItem("theme") as "light" | "dark" | null) ?? "dark";
        const root = document.documentElement;
        root.classList.remove("light", "dark");
        root.classList.add(stored);
      } catch {
        // localStorage kann blockiert sein — egal, dann bleibt light.
      }
    };
  }, []);

  return <>{children}</>;
}
