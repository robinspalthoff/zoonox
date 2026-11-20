"use client";

import { createContext, useCallback, useContext, useState } from "react";
import {
  dismissChecklist as dismissChecklistAction,
  dismissWelcome as dismissWelcomeAction,
  markHintSeen as markHintSeenAction,
  skipOnboarding as skipOnboardingAction,
} from "@/app/[locale]/dashboard/onboarding-actions";
import {
  ALL_HINT_IDS,
  type HintId,
  type OnboardingState,
} from "@/lib/onboarding";

interface OnboardingContextValue {
  state: OnboardingState;
  /** Close the welcome modal (keeps checklist + hints active). */
  dismissWelcome: () => void;
  /** Permanently hide the setup checklist card. */
  dismissChecklist: () => void;
  /** Acknowledge a contextual hint so it never shows again. */
  markHintSeen: (id: HintId) => void;
  /** Opt out of onboarding entirely — silences every surface. */
  skipAll: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return ctx;
}

/**
 * Holds the user's onboarding state client-side. All mutations are
 * optimistic — the UI updates instantly and the server action runs
 * fire-and-forget in the background. Onboarding state is non-critical
 * (worst case: a hint shows once more), so a failed write needs no
 * rollback or error surface.
 */
export function OnboardingProvider({
  initialState,
  children,
}: {
  initialState: OnboardingState;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<OnboardingState>(initialState);

  const dismissWelcome = useCallback(() => {
    setState((s) => ({ ...s, welcomeDismissed: true }));
    void dismissWelcomeAction();
  }, []);

  const dismissChecklist = useCallback(() => {
    setState((s) => ({ ...s, checklistDismissed: true }));
    void dismissChecklistAction();
  }, []);

  const markHintSeen = useCallback((id: HintId) => {
    setState((s) =>
      s.hintsSeen.includes(id)
        ? s
        : { ...s, hintsSeen: [...s.hintsSeen, id] },
    );
    void markHintSeenAction(id);
  }, []);

  const skipAll = useCallback(() => {
    setState({
      welcomeDismissed: true,
      checklistDismissed: true,
      hintsSeen: [...ALL_HINT_IDS],
    });
    void skipOnboardingAction();
  }, []);

  return (
    <OnboardingContext.Provider
      value={{ state, dismissWelcome, dismissChecklist, markHintSeen, skipAll }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}
