import type { HintId } from "@/lib/onboarding";

/**
 * Registry of contextual spotlight hints. Each hint points at a real DOM
 * element (tagged with a `data-onboarding` attribute) and surfaces only
 * when its route + prerequisite conditions are met. Together they form a
 * light guided thread — not a forced step-by-step tour: every hint is
 * dismissible and the user can skip the whole sequence at any point.
 */
export interface HintDef {
  id: HintId;
  /** CSS selector for the element the hint anchors to. */
  anchor: string;
  /** Side of the anchor the popover sits on. */
  placement: "top" | "bottom" | "left" | "right";
  /** Sequence order — the lowest-order eligible hint wins. */
  order: number;
  /** Hint that must be acknowledged before this one becomes eligible. */
  requires?: HintId;
  /** Whether the hint is eligible for the given (locale-stripped) path. */
  matchRoute: (pathname: string) => boolean;
}

/** Dashboard root, regardless of trailing slash. `usePathname` from
 *  next-intl returns the path without the locale prefix. */
const isDashboardRoot = (p: string) => /^\/dashboard\/?$/.test(p);

export const HINTS: HintDef[] = [
  {
    id: "settings-nav",
    anchor: '[data-onboarding="nav-settings"]',
    placement: "right",
    order: 1,
    matchRoute: isDashboardRoot,
  },
  {
    id: "settings-company-form",
    anchor: '[data-onboarding="company-form"]',
    placement: "bottom",
    order: 2,
    requires: "settings-nav",
    matchRoute: (p) => p.includes("/dashboard/settings/company"),
  },
  {
    id: "new-invoice",
    anchor: '[data-onboarding="nav-invoices"]',
    placement: "right",
    order: 3,
    requires: "settings-company-form",
    matchRoute: isDashboardRoot,
  },
];
