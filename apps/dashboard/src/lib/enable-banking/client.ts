// Thin, typed HTTP client for the Enable Banking API.
//
// ── Go-live checklist (sandbox → production) ────────────────────────────────
//   1. Create a *production* application in the Enable Banking control panel
//      and upload the public key whose private half we sign with.
//   2. Set ENABLEBANKING_APP_ID to the production application id and point
//      ENABLEBANKING_PRIVATE_KEY_PATH at the production key.
//   3. Register the production redirect URL (https://<domain>/api/banking/callback).
//   4. Set ENABLEBANKING_ENV=production and NEXT_PUBLIC_APP_URL to the prod URL.
//   No code changes required — everything above is env/config driven.
//
// All calls are read-only (accounts, balances, transactions). Payment
// initiation is intentionally out of scope (future FinAPI feature).

import { getAppJwt } from "./jwt";
import { EB_API_URL, assertEbConfigured } from "./config";
import type {
  AspspListResponse,
  Aspsp,
  AuthRequest,
  AuthResponse,
  SessionResponse,
  BalancesResponse,
  TransactionsResponse,
  AccountResource,
} from "./types";

export class EnableBankingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "EnableBankingError";
  }

  /** Consent/session no longer valid — caller should mark the connection
   *  EXPIRED and prompt the user to re-authorize, not retry. */
  get isConsentExpired(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Retry on transient failures (429 + 5xx + network errors); never on 4xx
 *  client errors, which won't get better by retrying. */
function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

async function ebFetch<T>(
  pathname: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {},
): Promise<T> {
  assertEbConfigured();

  const url = new URL(`${EB_API_URL}${pathname}`);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  const method = init.method ?? "GET";

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          // Re-read the JWT each attempt — it may have refreshed mid-retry.
          Authorization: `Bearer ${getAppJwt()}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        // EB is an external API; never cache.
        cache: "no-store",
      });
    } catch (networkErr) {
      // Network/DNS/timeout — retry with backoff.
      lastErr = networkErr;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
        continue;
      }
      throw new EnableBankingError(
        `Enable Banking ${method} ${pathname} network error: ${
          (networkErr as Error).message
        }`,
        0,
      );
    }

    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;

    if (res.ok) return parsed as T;

    const detail =
      (parsed as { message?: string; error?: string })?.message ??
      (parsed as { error?: string })?.error ??
      res.statusText;
    const err = new EnableBankingError(
      `Enable Banking ${method} ${pathname} failed: ${res.status} ${detail}`,
      res.status,
      parsed ?? text,
    );

    if (isRetryable(res.status) && attempt < MAX_ATTEMPTS) {
      lastErr = err;
      // Honour Retry-After when present, else exponential backoff.
      const retryAfter = Number(res.headers.get("retry-after")) * 1000;
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter
          : BASE_BACKOFF_MS * 2 ** (attempt - 1),
      );
      continue;
    }
    throw err;
  }

  // Exhausted retries on a retryable error.
  throw lastErr instanceof EnableBankingError
    ? lastErr
    : new EnableBankingError(
        `Enable Banking ${method} ${pathname} failed after ${MAX_ATTEMPTS} attempts`,
        0,
      );
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** List available ASPSPs (banks), optionally filtered by country / psu_type. */
export async function getAspsps(params: {
  country?: string;
  psuType?: "business" | "personal";
} = {}): Promise<Aspsp[]> {
  const data = await ebFetch<AspspListResponse>("/aspsps", {
    query: { country: params.country, psu_type: params.psuType },
  });
  return data.aspsps ?? [];
}

/** Start PSU authorization. Returns the URL to redirect the user to. */
export async function startAuth(body: AuthRequest): Promise<AuthResponse> {
  return ebFetch<AuthResponse>("/auth", { method: "POST", body });
}

/** Exchange the authorization `code` for a session + accessible accounts. */
export async function createSession(code: string): Promise<SessionResponse> {
  return ebFetch<SessionResponse>("/sessions", {
    method: "POST",
    body: { code },
  });
}

/** Fetch an existing session (accounts + status). */
export async function getSession(sessionId: string): Promise<SessionResponse> {
  return ebFetch<SessionResponse>(`/sessions/${encodeURIComponent(sessionId)}`);
}

/** Revoke a session at Enable Banking (used on disconnect). Best-effort:
 *  a 404/410 means it's already gone, which is fine. */
export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await ebFetch<unknown>(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
  } catch (err) {
    if (err instanceof EnableBankingError && (err.status === 404 || err.status === 410)) {
      return;
    }
    throw err;
  }
}

/** Full details for a single account uid. */
export async function getAccountDetails(uid: string): Promise<AccountResource> {
  return ebFetch<AccountResource>(`/accounts/${encodeURIComponent(uid)}/details`);
}

/** Current balances for an account. */
export async function getBalances(uid: string): Promise<BalancesResponse> {
  return ebFetch<BalancesResponse>(`/accounts/${encodeURIComponent(uid)}/balances`);
}

/**
 * Transactions for an account, with optional date range. Transparently
 * follows `continuation_key` pagination and returns the merged list.
 */
export async function getAllTransactions(
  uid: string,
  opts: { dateFrom?: string; dateTo?: string; maxPages?: number } = {},
): Promise<TransactionsResponse["transactions"]> {
  const maxPages = opts.maxPages ?? 20;
  const all: TransactionsResponse["transactions"] = [];
  let continuationKey: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const data = await ebFetch<TransactionsResponse>(
      `/accounts/${encodeURIComponent(uid)}/transactions`,
      {
        query: {
          date_from: opts.dateFrom,
          date_to: opts.dateTo,
          continuation_key: continuationKey,
        },
      },
    );
    all.push(...(data.transactions ?? []));
    if (!data.continuation_key) break;
    continuationKey = data.continuation_key;
  }

  return all;
}
