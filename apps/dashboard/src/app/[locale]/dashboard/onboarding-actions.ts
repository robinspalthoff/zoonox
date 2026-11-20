"use server";

import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  ALL_HINT_IDS,
  parseOnboardingState,
  type HintId,
  type OnboardingState,
} from "@/lib/onboarding";

/**
 * Read-modify-write the current user's onboarding state. The column is
 * tiny and writes are rare (a handful per user, ever), so a plain
 * round-trip is fine — no need for partial JSON updates.
 */
async function mutate(
  fn: (state: OnboardingState) => OnboardingState,
): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { onboardingState: true },
  });
  const next = fn(parseOnboardingState(user?.onboardingState));
  await db.user.update({
    where: { id: userId },
    data: { onboardingState: next as unknown as Prisma.InputJsonValue },
  });
}

/** Welcome modal closed via its primary CTA. */
export async function dismissWelcome(): Promise<void> {
  await mutate((s) => ({ ...s, welcomeDismissed: true }));
}

/** Setup checklist card explicitly dismissed. */
export async function dismissChecklist(): Promise<void> {
  await mutate((s) => ({ ...s, checklistDismissed: true }));
}

/** A contextual hint was shown and acknowledged. */
export async function markHintSeen(hintId: HintId): Promise<void> {
  if (!ALL_HINT_IDS.includes(hintId)) return;
  await mutate((s) =>
    s.hintsSeen.includes(hintId)
      ? s
      : { ...s, hintsSeen: [...s.hintsSeen, hintId] },
  );
}

/**
 * User opted out of onboarding entirely (e.g. "Onboarding überspringen"
 * in the welcome modal or "Tour beenden" on a hint). Silences every
 * remaining surface in one write.
 */
export async function skipOnboarding(): Promise<void> {
  await mutate(() => ({
    welcomeDismissed: true,
    checklistDismissed: true,
    hintsSeen: [...ALL_HINT_IDS],
  }));
}
