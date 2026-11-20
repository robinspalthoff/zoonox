"use server";

import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { fullName } from "@/lib/user-name";
import { revalidatePath } from "next/cache";
import type { MonthCloseStatus } from "@prisma/client";

/**
 * Versendet Benachrichtigung an alle verknüpften Steuerberater des Tenants,
 * dass ein Monat zur Prüfung eingereicht wurde. Inhalt kommt aus den
 * `monthClose.emails.submitted.*`-Keys, Locale-Default ist „de" (DACH-Fokus).
 * Best-effort: Fehler werden geloggt, blockieren den Submit-Flow nicht.
 */
async function sendMonthSubmitEmail(opts: {
  tenantId: string;
  submitterId: string;
  year: number;
  month: number;
}): Promise<void> {
  try {
    if (!process.env.BREVO_API_KEY || !process.env.PLATFORM_SENDER_EMAIL) {
      console.warn("[month-close] Skipping submit email — Brevo not configured.");
      return;
    }

    const [accountants, tenant, submitter] = await Promise.all([
      db.tenantUser.findMany({
        where: { tenantId: opts.tenantId, role: "ACCOUNTANT" },
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
      }),
      db.tenant.findUnique({ where: { id: opts.tenantId }, select: { name: true } }),
      db.user.findUnique({
        where: { id: opts.submitterId },
        select: { firstName: true, lastName: true, email: true },
      }),
    ]);
    if (accountants.length === 0) return;

    const { render } = await import("@react-email/render");
    const { MonthCloseSubmittedEmail } = await import("@/emails/month-close-submitted-email");
    const React = await import("react");
    const { brevo, Brevo } = await import("@/lib/email");
    const { getTranslations } = await import("next-intl/server");
    const locale = "de";
    const tEmail = await getTranslations({ locale, namespace: "monthClose.emails.submitted" });

    const platformName = process.env.PLATFORM_NAME ?? "Zoonox";
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001").replace(/\/$/, "");
    const reviewUrl = `${baseUrl}/${locale}/dashboard/firm/closing`;
    const workspaceName = tenant?.name ?? "Workspace";
    const submitterName =
      fullName(submitter ?? { firstName: null, lastName: null }) ??
      submitter?.email ??
      "";
    const monthLabel = new Intl.DateTimeFormat(locale, { month: "long" })
      .format(new Date(opts.year, opts.month - 1, 1));

    await Promise.all(
      accountants.map(async (a) => {
        const recipientName = fullName(a.user) ?? a.user.email ?? "";
        const htmlContent = await render(
          React.createElement(MonthCloseSubmittedEmail, {
            previewLine: tEmail("previewLine", { workspace: workspaceName, month: monthLabel, year: opts.year }),
            heading: tEmail("heading", { month: monthLabel, year: opts.year }),
            greeting: tEmail("greeting", { name: recipientName }),
            body: tEmail("body", {
              submitter: submitterName,
              month: monthLabel,
              year: opts.year,
              workspace: workspaceName,
            }),
            openButtonLabel: tEmail("openButton"),
            footer: tEmail("footer", { platform: platformName }),
            reviewUrl,
            platformName,
          }),
        );
        const sendEmail = new Brevo.SendSmtpEmail();
        sendEmail.subject = tEmail("subject", { workspace: workspaceName, month: monthLabel, year: opts.year });
        sendEmail.sender = {
          name: platformName,
          email: process.env.PLATFORM_SENDER_EMAIL!,
        };
        sendEmail.to = [{ email: a.user.email, name: recipientName }];
        sendEmail.htmlContent = htmlContent;
        try {
          await brevo.sendTransacEmail(sendEmail);
        } catch (e) {
          console.error(`[month-close] Email failed for ${a.user.email}:`, e);
        }
      }),
    );
  } catch (e) {
    console.error("[month-close] Email dispatch failed:", e);
  }
}

/**
 * Server actions geben Fehler als Kürzel zurück; der Client mappt sie auf
 * `firm.closing.errors.<CODE>`.
 */
type ActionResult = { success: true } | { success: false; errorCode: string };

function validatePeriod(year: number, month: number): boolean {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  return true;
}

/**
 * Idempotent: holt die MonthClose-Zeile oder legt sie als OPEN an.
 */
async function ensureMonthClose(tenantId: string, year: number, month: number) {
  return db.monthClose.upsert({
    where: { tenantId_year_month: { tenantId, year, month } },
    update: {},
    create: { tenantId, year, month, status: "OPEN" },
  });
}

/**
 * Mandant: reicht den Monat zur Prüfung beim Steuerberater ein.
 * OPEN → SUBMITTED. Erlaubt aus jedem Status (idempotent „re-submit" nach
 * Rückfragen), löscht aber alte reviewNotes zur Klarheit.
 */
export async function submitMonth(input: { year: number; month: number }): Promise<ActionResult> {
  try {
    const t = await requireTenant();
    if (!can(t.tenantRole, "monthClose.submit")) return { success: false, errorCode: "FORBIDDEN" };
    if (!validatePeriod(input.year, input.month)) return { success: false, errorCode: "INVALID_PERIOD" };

    const existing = await ensureMonthClose(t.tenantId, input.year, input.month);
    if (existing.status === "CLOSED") {
      return { success: false, errorCode: "ALREADY_CLOSED" };
    }

    await db.monthClose.update({
      where: { tenantId_year_month: { tenantId: t.tenantId, year: input.year, month: input.month } },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
        submittedById: t.userId,
        reviewNotes: null,
      },
    });

    await createAuditLog({
      tenantId: t.tenantId,
      userId: t.userId,
      action: "MONTH_CLOSE_SUBMITTED",
      entityType: "MonthClose",
      entityId: `${input.year}-${String(input.month).padStart(2, "0")}`,
      details: { year: input.year, month: input.month },
    });

    await sendMonthSubmitEmail({
      tenantId: t.tenantId,
      submitterId: t.userId,
      year: input.year,
      month: input.month,
    });

    revalidatePath("/dashboard/firm/closing");
    return { success: true };
  } catch (err) {
    console.error("[submitMonth] fehlgeschlagen:", err);
    return { success: false, errorCode: "UNKNOWN" };
  }
}

/**
 * Steuerberater: schickt den Monat mit Notizen zurück. SUBMITTED → OPEN.
 */
export async function reopenMonth(input: {
  year: number;
  month: number;
  reviewNotes?: string | null;
}): Promise<ActionResult> {
  try {
    const t = await requireTenant();
    if (!can(t.tenantRole, "monthClose.reopen")) return { success: false, errorCode: "FORBIDDEN" };
    if (!validatePeriod(input.year, input.month)) return { success: false, errorCode: "INVALID_PERIOD" };

    const row = await ensureMonthClose(t.tenantId, input.year, input.month);
    if (row.status === "OPEN") return { success: true };
    if (row.status === "CLOSED") {
      return { success: false, errorCode: "ALREADY_CLOSED" };
    }

    await db.monthClose.update({
      where: { tenantId_year_month: { tenantId: t.tenantId, year: input.year, month: input.month } },
      data: {
        status: "OPEN",
        reviewNotes: input.reviewNotes?.trim() || null,
      },
    });

    await createAuditLog({
      tenantId: t.tenantId,
      userId: t.userId,
      action: "MONTH_CLOSE_REOPENED",
      entityType: "MonthClose",
      entityId: `${input.year}-${String(input.month).padStart(2, "0")}`,
      details: { year: input.year, month: input.month, reviewNotes: input.reviewNotes ?? null },
    });

    revalidatePath("/dashboard/firm/closing");
    return { success: true };
  } catch (err) {
    console.error("[reopenMonth] fehlgeschlagen:", err);
    return { success: false, errorCode: "UNKNOWN" };
  }
}

/**
 * Reverse für versehentliche Finalize-Klicks. CLOSED → OPEN. Setzt finalize-
 * Metadaten zurück. Keine GoBD-Implikation (siehe Schema-Kommentar).
 */
export async function unfinalizeMonth(input: { year: number; month: number }): Promise<ActionResult> {
  try {
    const t = await requireTenant();
    if (!can(t.tenantRole, "monthClose.unfinalize")) return { success: false, errorCode: "FORBIDDEN" };
    if (!validatePeriod(input.year, input.month)) return { success: false, errorCode: "INVALID_PERIOD" };

    const row = await db.monthClose.findUnique({
      where: { tenantId_year_month: { tenantId: t.tenantId, year: input.year, month: input.month } },
      select: { status: true },
    });
    if (!row || row.status !== "CLOSED") {
      return { success: false, errorCode: "NOT_CLOSED" };
    }

    await db.monthClose.update({
      where: { tenantId_year_month: { tenantId: t.tenantId, year: input.year, month: input.month } },
      data: { status: "OPEN", finalizedAt: null, finalizedById: null },
    });

    await createAuditLog({
      tenantId: t.tenantId,
      userId: t.userId,
      action: "MONTH_CLOSE_REOPENED",
      entityType: "MonthClose",
      entityId: `${input.year}-${String(input.month).padStart(2, "0")}`,
      details: { year: input.year, month: input.month, fromStatus: "CLOSED" },
    });

    revalidatePath("/dashboard/firm/closing");
    return { success: true };
  } catch (err) {
    console.error("[unfinalizeMonth] fehlgeschlagen:", err);
    return { success: false, errorCode: "UNKNOWN" };
  }
}

/**
 * Steuerberater (oder Owner): markiert den Monat als endgültig abgeschlossen.
 * SUBMITTED → CLOSED. Aus OPEN heraus ebenfalls erlaubt (z.B. wenn der
 * Owner ohne Submit-Schritt direkt abschließen will).
 */
export async function finalizeMonth(input: { year: number; month: number }): Promise<ActionResult> {
  try {
    const t = await requireTenant();
    if (!can(t.tenantRole, "monthClose.finalize")) return { success: false, errorCode: "FORBIDDEN" };
    if (!validatePeriod(input.year, input.month)) return { success: false, errorCode: "INVALID_PERIOD" };

    const row = await ensureMonthClose(t.tenantId, input.year, input.month);
    if (row.status === "CLOSED") return { success: true };

    await db.monthClose.update({
      where: { tenantId_year_month: { tenantId: t.tenantId, year: input.year, month: input.month } },
      data: {
        status: "CLOSED" as MonthCloseStatus,
        finalizedAt: new Date(),
        finalizedById: t.userId,
      },
    });

    await createAuditLog({
      tenantId: t.tenantId,
      userId: t.userId,
      action: "MONTH_CLOSE_FINALIZED",
      entityType: "MonthClose",
      entityId: `${input.year}-${String(input.month).padStart(2, "0")}`,
      details: { year: input.year, month: input.month },
    });

    revalidatePath("/dashboard/firm/closing");
    return { success: true };
  } catch (err) {
    console.error("[finalizeMonth] fehlgeschlagen:", err);
    return { success: false, errorCode: "UNKNOWN" };
  }
}
