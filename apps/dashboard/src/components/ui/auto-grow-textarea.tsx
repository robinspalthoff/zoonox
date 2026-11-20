"use client";

import { forwardRef, useEffect, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement>;

function resize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

export const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, Props>(function AutoGrowTextarea(
  { value, onChange, rows = 1, className, ...rest },
  forwardedRef,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const setRef = (node: HTMLTextAreaElement | null) => {
    innerRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
  };

  useLayoutEffect(() => {
    if (innerRef.current) resize(innerRef.current);
  }, [value]);

  useEffect(() => {
    if (!innerRef.current) return;
    const el = innerRef.current;
    const handler = () => resize(el);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return (
    <textarea
      ref={setRef}
      value={value}
      onChange={onChange}
      rows={rows}
      className={(className ?? "") + " resize-none overflow-hidden"}
      {...rest}
    />
  );
});
