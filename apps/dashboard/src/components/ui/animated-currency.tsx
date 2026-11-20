"use client";

import { useEffect, useRef, useState } from "react";

const CURRENCY_FMT = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

/**
 * Currency display that count-up/down-animates between values.
 *
 * Intended for the "Gesamt"-line in invoice/quote/OC forms: when the user
 * edits a line item the grand total smoothly transitions instead of
 * snapping. The animation is intentionally quick (~280 ms) so it feels
 * responsive — long enough to register as motion, short enough to never
 * block the user's next edit.
 *
 * Mounting renders the initial value immediately (no animation from 0,
 * which would look like a load-in flicker). Subsequent changes animate
 * from the previous displayed value, even if they arrive mid-transition.
 */
export function AnimatedCurrency({
  value,
  durationMs = 400,
  className,
}: {
  value: number;
  durationMs?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  // `startValue` and `targetValue` are tracked via refs so a value
  // change mid-animation can re-base from the current displayed number
  // without forcing the component to re-render twice per frame.
  const startValueRef = useRef(value);
  const targetValueRef = useRef(value);
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (value === targetValueRef.current) return;
    // Re-base from whatever we're currently showing — not from the
    // previous *target* — so a quick succession of edits doesn't snap.
    startValueRef.current = display;
    targetValueRef.current = value;
    startTimeRef.current = null;

    function tick(now: number) {
      if (startTimeRef.current === null) startTimeRef.current = now;
      const elapsed = now - startTimeRef.current;
      const t = Math.min(1, elapsed / durationMs);
      // ease-out-quart: snappy start, soft landing. Reads as "the number
      // catches up to where it should be" rather than a slow ramp.
      const eased = 1 - Math.pow(1 - t, 4);
      const next =
        startValueRef.current +
        (targetValueRef.current - startValueRef.current) * eased;
      setDisplay(t >= 1 ? targetValueRef.current : next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    }

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // `display` intentionally not in deps — it's read once per change
    // to re-base, then driven by the rAF loop. Including it would
    // restart the animation on every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return <span className={className}>{CURRENCY_FMT.format(display)}</span>;
}
