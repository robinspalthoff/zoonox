"use client";

import { usePathname } from "@/i18n/navigation";
import { HINTS } from "./hints";
import { OnboardingHint } from "./onboarding-hint";
import { useOnboarding } from "./onboarding-provider";

/**
 * Route-aware orchestrator for the contextual hints. Picks at most one
 * hint to show — the lowest-order hint that is unseen, route-eligible
 * and has its prerequisite satisfied — so the user is never swamped.
 */
export function OnboardingHints() {
  const { state } = useOnboarding();
  const pathname = usePathname();

  // Hold hints back until the welcome modal is dismissed — they should
  // never compete with it for attention.
  if (!state.welcomeDismissed) return null;

  const seen = new Set(state.hintsSeen);
  const active = HINTS.filter((h) => !seen.has(h.id))
    .filter((h) => !h.requires || seen.has(h.requires))
    .filter((h) => h.matchRoute(pathname))
    .sort((a, b) => a.order - b.order)[0];

  if (!active) return null;
  return <OnboardingHint key={active.id} def={active} />;
}
