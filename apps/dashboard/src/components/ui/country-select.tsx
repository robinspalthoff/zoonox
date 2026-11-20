"use client";

import { useLocale } from "next-intl";
import { COUNTRIES } from "@/lib/countries";

const INPUT = "w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors cursor-pointer";

interface Props {
  // Controlled (invoice form)
  value?: string;
  onChange?: (code: string) => void;
  // Uncontrolled (NewClientModal via FormData)
  name?: string;
  defaultValue?: string;
  className?: string;
}

export function CountrySelect({ value, onChange, name, defaultValue = "DE", className }: Props) {
  const locale = useLocale();
  const label = (c: { de: string; en: string }) => locale === "de" ? c.de : c.en;

  const sorted = [...COUNTRIES].sort((a, b) =>
    label(a).localeCompare(label(b), locale)
  );

  // Controlled mode
  if (value !== undefined && onChange) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={className ?? INPUT}>
        {sorted.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} – {label(c)}
          </option>
        ))}
      </select>
    );
  }

  // Uncontrolled mode (works with FormData)
  return (
    <select name={name} defaultValue={defaultValue} className={className ?? INPUT}>
      {sorted.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} – {label(c)}
        </option>
      ))}
    </select>
  );
}