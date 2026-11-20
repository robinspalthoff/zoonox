/**
 * First-run onboarding — shared types & helpers.
 *
 * The per-user onboarding state lives in `User.onboardingState` (JSONB).
 * It is intentionally tiny: the setup checklist is *data-driven* (we
 * derive item completion from real tenant data, see `ChecklistData`),
 * so the only things worth persisting are the user's explicit dismissals
 * and which contextual hints they have already been shown.
 */

/** Stable IDs for the contextual spotlight hints. Order = guided sequence. */
export type HintId = "settings-nav" | "settings-company-form" | "new-invoice";

export const ALL_HINT_IDS: HintId[] = [
  "settings-nav",
  "settings-company-form",
  "new-invoice",
];

export interface OnboardingState {
  /** Welcome modal has been closed (via CTA or skip). */
  welcomeDismissed: boolean;
  /** Setup checklist card has been explicitly dismissed. */
  checklistDismissed: boolean;
  /** Contextual hints the user has already seen / dismissed. */
  hintsSeen: HintId[];
}

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  welcomeDismissed: false,
  checklistDismissed: false,
  hintsSeen: [],
};

/**
 * Safely coerce the raw JSON column into a well-formed OnboardingState.
 * Anything missing or malformed falls back to the default — a brand-new
 * user (column `NULL`) therefore starts a fresh onboarding.
 */
export function parseOnboardingState(raw: unknown): OnboardingState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_ONBOARDING_STATE };
  const o = raw as Record<string, unknown>;
  const hintsSeen = Array.isArray(o.hintsSeen)
    ? (o.hintsSeen.filter(
        (h): h is HintId => typeof h === "string" && ALL_HINT_IDS.includes(h as HintId),
      ) as HintId[])
    : [];
  return {
    welcomeDismissed: o.welcomeDismissed === true,
    checklistDismissed: o.checklistDismissed === true,
    hintsSeen,
  };
}

/** Completion flags for the setup checklist — computed server-side. */
export interface ChecklistData {
  companyComplete: boolean;
  hasContact: boolean;
  hasInvoice: boolean;
  hasDocument: boolean;
}

/** A keyed minimal shape of CompanySettings — only the fields we gate on. */
interface CompanySettingsLike {
  name: string | null;
  address: string | null;
  zip: string | null;
  city: string | null;
  taxId: string | null;
  vatId: string | null;
}

/**
 * The company master data counts as "done" once the legally relevant
 * essentials for issuing an invoice (§14 UStG) are present: a name, a
 * full address and at least one tax identifier.
 */
export function isCompanyComplete(s: CompanySettingsLike | null | undefined): boolean {
  if (!s) return false;
  const filled = (v: string | null) => typeof v === "string" && v.trim().length > 0;
  return (
    filled(s.name) &&
    filled(s.address) &&
    filled(s.zip) &&
    filled(s.city) &&
    (filled(s.taxId) || filled(s.vatId))
  );
}

/** How many of the checklist items are done (0–4). */
export function checklistProgress(d: ChecklistData): number {
  return [d.companyComplete, d.hasContact, d.hasInvoice, d.hasDocument].filter(Boolean)
    .length;
}

export const CHECKLIST_TOTAL = 4;
