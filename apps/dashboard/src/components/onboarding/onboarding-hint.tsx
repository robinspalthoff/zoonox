"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Lightbulb, ArrowRight } from "lucide-react";
import { ALL_HINT_IDS } from "@/lib/onboarding";
import type { HintDef } from "./hints";
import { useOnboarding } from "./onboarding-provider";

const GAP = 14;
const POPOVER_W = 290;

/**
 * A single contextual spotlight hint: a small popover anchored to a real
 * DOM element, with a soft pulsing ring on the target. Deliberately
 * lightweight — no full-screen dimming overlay — so it guides without
 * blocking the user from exploring on their own.
 */
export function OnboardingHint({ def }: { def: HintDef }) {
  const t = useTranslations("onboarding.hints");
  const { markHintSeen, skipAll } = useOnboarding();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Locate the anchor element and keep its viewport rect in sync with
  // scrolling, resizing and layout shifts. The anchor can mount a beat
  // after navigation, so we poll briefly until it appears.
  useEffect(() => {
    let el: Element | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let ro: ResizeObserver | null = null;

    const measure = () => {
      if (el) setRect(el.getBoundingClientRect());
    };

    const attach = (found: Element) => {
      el = found;
      measure();
      ro = new ResizeObserver(measure);
      ro.observe(found);
    };

    const initial = document.querySelector(def.anchor);
    if (initial) {
      attach(initial);
    } else {
      let tries = 0;
      poll = setInterval(() => {
        tries += 1;
        const found = document.querySelector(def.anchor);
        if (found) {
          if (poll) clearInterval(poll);
          poll = null;
          attach(found);
        } else if (tries > 25) {
          if (poll) clearInterval(poll);
          poll = null;
        }
      }, 150);
    }

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      if (poll) clearInterval(poll);
      if (ro) ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [def.anchor]);

  if (!mounted || !rect) return null;

  const popoverStyle: CSSProperties = (() => {
    switch (def.placement) {
      case "right":
        return {
          top: rect.top + rect.height / 2,
          left: rect.right + GAP,
          transform: "translateY(-50%)",
        };
      case "left":
        return {
          top: rect.top + rect.height / 2,
          left: rect.left - GAP,
          transform: "translate(-100%, -50%)",
        };
      case "top":
        return {
          top: rect.top - GAP,
          left: rect.left + rect.width / 2,
          transform: "translate(-50%, -100%)",
        };
      case "bottom":
      default:
        return {
          top: rect.bottom + GAP,
          left: rect.left + rect.width / 2,
          transform: "translateX(-50%)",
        };
    }
  })();

  // Arrow sits on the popover edge facing the anchor.
  const arrowClass = {
    right: "left-[-4px] top-1/2 -translate-y-1/2",
    left: "right-[-4px] top-1/2 -translate-y-1/2",
    top: "bottom-[-4px] left-1/2 -translate-x-1/2",
    bottom: "top-[-4px] left-1/2 -translate-x-1/2",
  }[def.placement];

  return createPortal(
    <>
      {/* Spotlight ring around the anchored element */}
      <div
        aria-hidden
        className="pointer-events-none fixed z-[90] rounded-lg ring-2 ring-primary motion-safe:animate-[onbRing_2.2s_ease-in-out_infinite]"
        style={{
          top: rect.top - 4,
          left: rect.left - 4,
          width: rect.width + 8,
          height: rect.height + 8,
        }}
      />

      {/* Popover */}
      <div
        role="dialog"
        aria-labelledby={`onb-hint-${def.id}`}
        className="fixed z-[92] motion-safe:animate-[onbPop_.26s_cubic-bezier(.22,1,.36,1)_both]"
        style={{ ...popoverStyle, width: POPOVER_W }}
      >
        <div className="relative rounded-2xl border border-border bg-card text-card-foreground p-4 shadow-2xl">
          <span
            aria-hidden
            className={`absolute h-2 w-2 rotate-45 border border-border bg-card ${arrowClass}`}
          />

          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.09em] text-primary">
            <Lightbulb className="h-3 w-3" />
            {t("step", { current: def.order, total: ALL_HINT_IDS.length })}
          </div>

          <h3
            id={`onb-hint-${def.id}`}
            className="mt-1.5 text-sm font-semibold text-foreground"
          >
            {t(`${def.id}.title`)}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t(`${def.id}.body`)}
          </p>

          <div className="mt-3.5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={skipAll}
              className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("skip")}
            </button>
            <button
              type="button"
              onClick={() => markHintSeen(def.id)}
              className="group inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90"
            >
              {t("gotIt")}
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
