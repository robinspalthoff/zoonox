"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Landmark,
  Loader2,
  ChevronRight,
  Search,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { listAspsps, startBankConnection } from "../enable-banking-actions";
import type { Aspsp } from "@/lib/enable-banking/types";
import { cn } from "@/lib/utils";

type PsuType = "business" | "personal";

// Popular German banks shown as quick-filter chips when the search is empty.
// They only pre-fill the query — the actual connect target is always a concrete
// ASPSP from the live list (important for Sparkasse/Volksbank, which are
// hundreds of separate ASPSPs).
const QUICK_PICKS = [
  "Sparkasse",
  "Volksbank",
  "Deutsche Bank",
  "Commerzbank",
  "ING",
  "DKB",
  "N26",
  "Postbank",
];

/**
 * In-wizard Enable Banking connect panel: choose PSU type, search the live
 * ASPSP list, pick a bank → hand off to its consent screen. Rendered inside the
 * "Bank account" step of the add-account wizard.
 */
export function EnableBankingConnectPanel({ country = "DE" }: { country?: string }) {
  const t = useTranslations("bank.connect");
  const [psuType, setPsuType] = useState<PsuType>("business");
  const [query, setQuery] = useState("");
  const [aspsps, setAspsps] = useState<Aspsp[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectingKey, setConnectingKey] = useState<string | null>(null);

  // (Re)load the ASPSP list whenever country or PSU type changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAspsps(null);
    listAspsps(country, psuType).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.success) setAspsps(res.aspsps);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [country, psuType]);

  const results = useMemo(() => {
    if (!aspsps) return [];
    const q = query.trim().toLowerCase();
    const list = q
      ? aspsps.filter((a) => a.name.toLowerCase().includes(q))
      : aspsps;
    // Cap the rendered list; the search narrows it further.
    return list.slice(0, 60);
  }, [aspsps, query]);

  async function connect(a: Aspsp) {
    const key = `${a.name}-${a.country}`;
    setConnectingKey(key);
    setError(null);
    const res = await startBankConnection({
      aspspName: a.name,
      country: a.country,
      psuType,
    });
    if (res.success) {
      window.location.href = res.url; // hand off to the bank's consent screen
    } else {
      setConnectingKey(null);
      setError(res.error);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* PSU type toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t("psuType.label")}
        </span>
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {(["business", "personal"] as const).map((pt) => (
            <button
              key={pt}
              type="button"
              onClick={() => setPsuType(pt)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                psuType === pt
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`psuType.${pt}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="w-full pl-10 pr-3 py-2.5 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Quick-pick chips (only when nothing typed yet) */}
      {!query && (
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PICKS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setQuery(name)}
              className="px-2.5 py-1 text-xs rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("loading")}
        </div>
      )}

      {!loading && aspsps && (
        <>
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {query ? t("noResults") : t("empty")}
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto divide-y divide-border rounded-lg border border-border">
              {results.map((a) => {
                const key = `${a.name}-${a.country}`;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      disabled={connectingKey !== null}
                      onClick={() => connect(a)}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <BankLogo logo={a.logo} name={a.name} />
                        <span className="truncate text-sm text-foreground">
                          {a.name}
                        </span>
                        {a.sandbox && (
                          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                            Sandbox
                          </span>
                        )}
                      </span>
                      {connectingKey === key ? (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function BankLogo({ logo, name }: { logo?: string; name: string }) {
  const [ok, setOk] = useState(Boolean(logo));
  if (logo && ok) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt={name}
        className="w-5 h-5 rounded object-contain shrink-0"
        onError={() => setOk(false)}
      />
    );
  }
  return <Landmark className="w-4 h-4 shrink-0 text-muted-foreground" />;
}

// Success / error banner rendered after the callback redirects back with
// ?bank_connected=1&imported=N or ?bank_error=<code>.
export function BankConnectStatus() {
  const t = useTranslations("bank.connect");
  const params = useSearchParams();

  const connected = params.get("bank_connected");
  const bankError = params.get("bank_error");
  if (!connected && !bankError) return null;

  if (connected) {
    const imported = params.get("imported") ?? "0";
    const accounts = params.get("accounts") ?? "0";
    const matched = params.get("matched") ?? "0";
    return (
      <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300 text-sm px-3 py-2 border border-emerald-200 dark:border-emerald-900">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        {t("success", { accounts, imported, matched })}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2 border border-destructive/20">
      <AlertCircle className="w-4 h-4 shrink-0" />
      {t("error", { code: bankError ?? "" })}
    </div>
  );
}
