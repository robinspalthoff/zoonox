"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

/**
 * Kleines Info-Icon mit Instant-Hover-Tooltip. Portal in <body>, damit
 * `overflow-hidden` auf umgebenden Karten den Tooltip nicht clippt.
 *
 * Bewusst eigenständig (kein Headless-UI), weil das native `title`-Attribut
 * eine 2s-Verzögerung hat und shadcn-Tooltips für diesen Use Case overkill
 * wären — das Icon ersetzt einen sichtbaren Beschreibungsabsatz und muss
 * sofort reagieren.
 */
export function InfoTooltip({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  function show() {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, left: rect.left + rect.width / 2 });
    setOpen(true);
  }

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
        tabIndex={0}
        className="inline-flex items-center text-muted-foreground/70 hover:text-foreground transition-colors outline-none focus-visible:text-foreground"
      >
        <Info className="w-3.5 h-3.5" />
      </span>
      {mounted && open && pos
        ? createPortal(
            <div
              role="tooltip"
              className="fixed z-[70] -translate-x-1/2 max-w-[280px] px-2.5 py-1.5 rounded-md bg-card border border-border text-[11px] leading-snug text-card-foreground shadow-lg pointer-events-none"
              style={{ top: pos.top, left: pos.left }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
