"use client";

import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { useState } from "react";
import type { JournalSourceType, JournalEntryStatus } from "@prisma/client";

const SOURCE_TYPES: JournalSourceType[] = [
  "INVOICE",
  "INVOICE_PAYMENT",
  "DOCUMENT",
  "DOCUMENT_PAYMENT",
  "BANK_TRANSACTION",
  "MANUAL",
];

const STATUSES: JournalEntryStatus[] = ["POSTED", "REVERSED"];

export function JournalFilters({
  q,
  fromStr,
  toStr,
  source,
  status,
}: {
  q: string;
  fromStr: string;
  toStr: string;
  source: JournalSourceType | null;
  status: JournalEntryStatus | null;
}) {
  const t = useTranslations("taxes.journal");
  const router = useRouter();
  const pathname = usePathname();

  const [form, setForm] = useState({
    q,
    fromStr,
    toStr,
    source: source ?? "",
    status: status ?? "",
  });

  function apply(next: typeof form) {
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.fromStr) params.set("from", next.fromStr);
    if (next.toStr) params.set("to", next.toStr);
    if (next.source) params.set("source", next.source);
    if (next.status) params.set("status", next.status);
    const qs = params.toString();
    router.push((qs ? `${pathname}?${qs}` : pathname) as never);
  }

  return (
    <form
      className="grid grid-cols-1 md:grid-cols-5 gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        apply(form);
      }}
    >
      <input
        type="search"
        placeholder={t("filters.searchPlaceholder")}
        value={form.q}
        onChange={(e) => setForm({ ...form, q: e.target.value })}
        className="px-3 py-2 bg-muted border border-border rounded-lg text-sm"
      />
      <input
        type="date"
        value={form.fromStr}
        onChange={(e) => {
          const next = { ...form, fromStr: e.target.value };
          setForm(next);
          apply(next);
        }}
        className="px-3 py-2 bg-muted border border-border rounded-lg text-sm"
      />
      <input
        type="date"
        value={form.toStr}
        onChange={(e) => {
          const next = { ...form, toStr: e.target.value };
          setForm(next);
          apply(next);
        }}
        className="px-3 py-2 bg-muted border border-border rounded-lg text-sm"
      />
      <select
        value={form.source}
        onChange={(e) => {
          const next = { ...form, source: e.target.value };
          setForm(next);
          apply(next);
        }}
        className="px-3 py-2 bg-muted border border-border rounded-lg text-sm"
      >
        <option value="">{t("filters.allSources")}</option>
        {SOURCE_TYPES.map((s) => (
          <option key={s} value={s}>
            {t(`sourceType.${s}`)}
          </option>
        ))}
      </select>
      <select
        value={form.status}
        onChange={(e) => {
          const next = { ...form, status: e.target.value };
          setForm(next);
          apply(next);
        }}
        className="px-3 py-2 bg-muted border border-border rounded-lg text-sm"
      >
        <option value="">{t("filters.allStatuses")}</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`status.${s}`)}
          </option>
        ))}
      </select>
    </form>
  );
}
