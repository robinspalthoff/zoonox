/**
 * Empty state shown on the Angebote / Auftragsbestätigungen list pages when
 * the tenant has zero rows of that type. We intentionally hide all the
 * machinery (tabs, search, table) until the user has *something* to manage —
 * a stripped, focused first-run screen with a single CTA performs better
 * than dropping a new user into an empty data grid.
 *
 * Layout: vertically + horizontally centered card on a soft radial-gradient
 * canvas, with a brand-colored icon medallion, three checkmark bullets and
 * one primary CTA. The card is wide enough to breathe on desktop, with
 * sensible mobile collapse.
 */

import { Link } from "@/i18n/navigation";
import { CheckCircle2, Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  /** Lucide icon rendered inside the medallion. Pass a brand-matched one
   *  per module (ClipboardList for Angebote, FileSignature for AB). */
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  subtitle: string;
  bullets: string[];
  ctaLabel: string;
  ctaHref: "/dashboard/quotes/new" | "/dashboard/order-confirmations/new";
  helpText?: string;
}

export function BusinessDocEmptyState({
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  bullets,
  ctaLabel,
  ctaHref,
  helpText,
}: EmptyStateProps) {
  return (
    // Full content-area canvas — we eat the parent <main>'s p-6 by going
    // -m-6 so the soft gradient bleeds edge-to-edge. min-h-[calc(...)]
    // matches the dashboard shell so the card lands roughly in the middle
    // of the visible viewport instead of crammed at the top.
    <div className="-m-6 min-h-[calc(100vh-4rem)] flex items-center justify-center px-6 py-12 relative overflow-hidden">
      {/* Soft radial gradient backdrop — pulls the eye toward the card
          without competing with the foreground content. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 35%, rgba(99, 102, 241, 0.08), transparent 70%)",
        }}
      />

      <div className="relative w-full max-w-lg text-center">
        {/* Icon medallion — large enough to be the visual anchor, with a
            layered ring effect so it doesn't read as a flat sticker. */}
        <div className="relative inline-flex items-center justify-center mb-6">
          <div
            aria-hidden
            className="absolute inset-0 rounded-2xl bg-primary/10 blur-xl scale-110"
          />
          <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 flex items-center justify-center shadow-sm">
            <Icon className="w-8 h-8 text-primary" strokeWidth={1.5} />
          </div>
        </div>

        <p className="text-xs font-semibold uppercase tracking-wider text-primary/80 mb-2">
          {eyebrow}
        </p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight mb-3">
          {title}
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed mb-7 max-w-md mx-auto">
          {subtitle}
        </p>

        {/* Bullet list — left-aligned within a centered block so the rows
            line up but the whole stack still feels centered on the page. */}
        <ul className="inline-flex flex-col gap-2.5 text-left mb-8">
          {bullets.map((bullet) => (
            <li key={bullet} className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" strokeWidth={2} />
              <span className="text-sm text-foreground/90 leading-snug">{bullet}</span>
            </li>
          ))}
        </ul>

        <div>
          <Link
            href={ctaHref}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors shadow-sm hover:shadow"
          >
            <Plus className="w-4 h-4" />
            {ctaLabel}
          </Link>
        </div>

        {helpText && (
          <p className="text-xs text-muted-foreground mt-8 max-w-sm mx-auto leading-relaxed">
            {helpText}
          </p>
        )}
      </div>
    </div>
  );
}
