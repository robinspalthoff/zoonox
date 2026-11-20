import type { ReactNode } from "react";

// Standalone reading layout for the public legal pages (privacy, terms,
// imprint). Deliberately minimal chrome — these are linked discreetly from the
// auth footer, not surfaced in the app UI. Public (not behind /dashboard auth).
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        {/* Explicit child styling — the @tailwindcss/typography (`prose`)
            plugin isn't installed, so we can't rely on it. */}
        <article className="[&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:mb-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-muted-foreground [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-sm [&_ul]:text-muted-foreground [&_ul]:space-y-1 [&_ul]:mb-3 [&_strong]:text-foreground [&_a]:text-primary [&_a]:underline">
          {children}
        </article>
      </div>
    </div>
  );
}
