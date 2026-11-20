import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { createSession } from "@/lib/enable-banking/client";
import { syncSessionAccounts } from "@/lib/enable-banking/sync";
import { autoMatchBankAccount } from "@/app/[locale]/dashboard/bank/actions";

// Enable Banking authorization callback.
//
// The PSU is redirected here after authorizing (or declining) access at their
// bank. We validate the anti-CSRF `state` against the pending BankConnection,
// exchange the `code` for a session, link accounts + import transactions, then
// bounce the user back to the bank dashboard with a status flag.

export const runtime = "nodejs";
// This route mutates data and must never be statically cached.
export const dynamic = "force-dynamic";

function dashboardRedirect(
  req: NextRequest,
  params: Record<string, string>,
): NextResponse {
  const locale = req.cookies.get("NEXT_LOCALE")?.value ?? "de";
  // Behind a reverse proxy (Coolify/Traefik) `req.nextUrl.origin` resolves to
  // the internal container bind address (e.g. https://0.0.0.0:3000), which is
  // unreachable from the browser. Prefer the public base URL — the same source
  // used to build the Enable Banking redirect_uri — and fall back to the
  // request origin only for local dev where NEXT_PUBLIC_APP_URL may be unset.
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? req.nextUrl.origin;
  const url = new URL(`/${locale}/dashboard/bank`, base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get("code");
  const state = sp.get("state");
  const ebError = sp.get("error");

  if (!state) {
    return dashboardRedirect(req, { bank_error: "missing_state" });
  }

  const connection = await db.bankConnection.findUnique({
    where: { authState: state },
  });
  if (!connection) {
    return dashboardRedirect(req, { bank_error: "unknown_state" });
  }

  // Make sure the person completing the flow belongs to the tenant that
  // started it (defence-in-depth on top of the unguessable state).
  const session = await auth();
  const sessionTenantId = session?.user?.tenantId;
  if (sessionTenantId && sessionTenantId !== connection.tenantId) {
    return dashboardRedirect(req, { bank_error: "tenant_mismatch" });
  }

  // PSU declined or the bank returned an error.
  if (ebError || !code) {
    await db.bankConnection.update({
      where: { id: connection.id },
      data: {
        status: "ERROR",
        error: (ebError ?? "missing_code").slice(0, 500),
      },
    });
    return dashboardRedirect(req, { bank_error: ebError ?? "no_code" });
  }

  // Idempotency: if we already processed this connection, don't re-sync.
  if (connection.status === "ACTIVE") {
    return dashboardRedirect(req, { bank_connected: "1" });
  }

  const userId = session?.user?.id ?? connection.createdBy ?? "system";

  try {
    const ebSession = await createSession(code);

    await db.bankConnection.update({
      where: { id: connection.id },
      data: {
        status: "ACTIVE",
        sessionId: ebSession.session_id,
        authorizedAt: new Date(),
        validUntil: ebSession.access?.valid_until
          ? new Date(ebSession.access.valid_until)
          : connection.validUntil,
        error: null,
      },
    });

    await createAuditLog({
      action: "BANK_CONNECTION_AUTHORIZED",
      tenantId: connection.tenantId,
      userId: sessionTenantId ? userId : undefined,
      entityType: "BankConnection",
      entityId: connection.id,
      details: { aspsp: connection.aspspName },
    });

    const result = await syncSessionAccounts({
      tenantId: connection.tenantId,
      userId,
      connectionId: connection.id,
      aspspName: connection.aspspName,
      session: ebSession,
    });

    // Reconcile the freshly imported transactions against open invoices and
    // receipts. Only on a user-initiated connect (session present): auto-match
    // links + posts to the journal, so it needs an attributable actor. The
    // 6-hourly background resync intentionally leaves new items UNMATCHED.
    let matched = 0;
    if (sessionTenantId) {
      const accts = await db.bankAccount.findMany({
        where: { tenantId: connection.tenantId, bankConnectionId: connection.id },
        select: { id: true },
      });
      for (const a of accts) {
        try {
          const r = await autoMatchBankAccount(a.id);
          if (r.success) matched += r.result.matched;
        } catch {
          // Non-fatal — the connection itself succeeded.
        }
      }
    }

    return dashboardRedirect(req, {
      bank_connected: "1",
      imported: String(result.imported),
      accounts: String(result.accountsLinked),
      matched: String(matched),
    });
  } catch (err) {
    await db.bankConnection.update({
      where: { id: connection.id },
      data: {
        status: "ERROR",
        error: err instanceof Error ? err.message.slice(0, 500) : "sync failed",
      },
    });
    return dashboardRedirect(req, { bank_error: "sync_failed" });
  }
}
