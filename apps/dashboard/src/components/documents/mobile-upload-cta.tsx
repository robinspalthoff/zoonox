"use client";

import { useTranslations } from "next-intl";

/**
 * Desktop-zu-Mobile-Foto-Handoff CTA.
 *
 * Das Handy IST der Button — keine umschließende Card. Im Display läuft
 * permanent ein Scan-Effekt (zwei Layer + Sweep-Line, Fingerprint-Style),
 * der den QR als „aktiv/scannbar" signalisiert. Beim Hover bekommt der
 * Rahmen Primary-Akzent; Klick öffnet den echten QR-Dialog.
 */
export function MobileUploadCta({ onActivate }: { onActivate: () => void }) {
  const t = useTranslations("documents.mobileUpload");

  return (
    <button
      type="button"
      onClick={onActivate}
      title={t("buttonTitle")}
      aria-label={t("buttonTitle")}
      className="group flex h-full w-full flex-col items-center justify-center gap-3 bg-transparent p-2 transition-colors focus:outline-none"
    >
      {/* ── Smartphone-Frame ──────────────────────────────────────────────── */}
      <div className="relative h-[170px] w-[88px] rounded-[18px] border-[3px] border-foreground/70 bg-card shadow-sm transition-colors group-hover:border-primary group-focus-visible:border-primary">
        {/* Speaker */}
        <div className="absolute left-1/2 top-1.5 h-1 w-7 -translate-x-1/2 rounded-full bg-foreground/40 transition-colors group-hover:bg-primary/70" />
        {/* Home-Indicator */}
        <div className="absolute bottom-1 left-1/2 h-1 w-6 -translate-x-1/2 rounded-full bg-foreground/30 transition-colors group-hover:bg-primary/50" />

        {/* Screen */}
        <div className="absolute inset-x-1.5 inset-y-5 overflow-hidden rounded-[8px] bg-background">
          {/* Base-Layer: schwacher QR — gibt dem Auge ein Pattern */}
          <FakeQr className="absolute inset-1.5 text-foreground/40" />

          {/* Fill-Layer: primärfarbener QR, dessen Höhe von unten her wächst.
              Container bleibt am unteren Rand fixiert (bottom-0) und ändert
              nur die height — der QR „füllt sich" wie ein Scan-Heatmap. */}
          <div className="absolute inset-x-0 bottom-0 h-0 overflow-hidden motion-safe:group-hover:animate-scan-fill motion-safe:group-focus-visible:animate-scan-fill">
            <div className="relative h-[150px] w-full">
              <FakeQr className="absolute inset-1.5 text-primary" />
            </div>
          </div>

          {/* Sweep-Linie mit Glow — läuft synchron auf-ab; im Idle unsichtbar */}
          <div
            className="pointer-events-none absolute inset-x-0 h-[2px] bg-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-safe:group-hover:animate-scan-sweep motion-safe:group-focus-visible:animate-scan-sweep"
            style={{
              filter:
                "drop-shadow(0 0 6px var(--color-primary)) drop-shadow(0 0 14px var(--color-primary))",
            }}
          />
        </div>
      </div>

      {/* Label unter dem Handy — sichtbar, nicht überlappend */}
      <span className="text-xs font-medium text-foreground">{t("ctaTitle")}</span>
    </button>
  );
}

/** Dekoratives 11×11 QR-artiges Pattern (kein echter Code). */
function FakeQr({ className = "" }: { className?: string }) {
  const cells: boolean[] = [
    1,1,1,1,1,1,1,0,1,1,1,
    1,0,0,0,0,0,1,0,1,0,1,
    1,0,1,1,1,0,1,0,1,1,1,
    1,0,1,1,1,0,1,0,0,1,0,
    1,0,1,1,1,0,1,0,1,0,1,
    1,0,0,0,0,0,1,0,1,1,0,
    1,1,1,1,1,1,1,0,1,0,1,
    0,0,0,0,0,0,0,0,1,1,1,
    1,1,1,0,1,0,1,1,0,1,0,
    0,1,0,1,1,1,0,1,1,0,1,
    1,1,1,0,1,0,1,0,1,1,0,
  ].map((n) => n === 1);

  return (
    <svg viewBox="0 0 11 11" className={className} aria-hidden="true" preserveAspectRatio="none">
      {cells.map((on, i) =>
        on ? (
          <rect
            key={i}
            x={i % 11}
            y={Math.floor(i / 11)}
            width={1}
            height={1}
            fill="currentColor"
          />
        ) : null,
      )}
    </svg>
  );
}
