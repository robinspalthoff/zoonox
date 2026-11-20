"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/require-tenant";
import { getNotifications, type NotificationSummary } from "@/lib/comments/queries";

/**
 * Setzt `User.notificationsSeenAt = NOW()`. Damit gilt alles, was vor
 * diesem Zeitpunkt entstand, als gelesen. Aufgerufen vom Header-Bell
 * über das "Alle als gelesen markieren"-Knopf bzw. automatisch beim
 * Öffnen des Dropdowns.
 *
 * Nimmt bewusst KEINEN Item-Identifier — der Read-State ist
 * timestamp-basiert (siehe Begründung in queries.ts).
 */
export async function markNotificationsSeen(): Promise<{ ok: true }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: true };
  await db.user.update({
    where: { id: session.user.id },
    data: { notificationsSeenAt: new Date() },
  });
  return { ok: true };
}

/**
 * Markiert genau ein Notification-Item als gelesen, indem der User-
 * Timestamp auf max(current, item.createdAt) gesetzt wird. Konsequenz
 * unseres Single-Timestamp-Modells: jedes Item OLDER als das gewählte
 * gilt damit automatisch auch als gelesen — was für die strikt
 * chronologische Bell-UI passt (User markiert "von oben nach unten" weg).
 *
 * Persist explizit nur wenn der neue Timestamp wirklich größer ist —
 * sonst würde ein Klick auf ein älteres Item den seenAt-Stempel
 * zurückdrehen und neuere Items wieder als ungelesen markieren.
 */
export async function markItemSeen(itemCreatedAt: string): Promise<{ ok: true }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: true };
  const target = new Date(itemCreatedAt);
  if (Number.isNaN(target.getTime())) return { ok: true };

  const userRow = await db.user.findUnique({
    where: { id: session.user.id },
    select: { notificationsSeenAt: true },
  });
  const current = userRow?.notificationsSeenAt ?? null;
  if (current && current >= target) return { ok: true };

  await db.user.update({
    where: { id: session.user.id },
    data: { notificationsSeenAt: target },
  });
  return { ok: true };
}

/**
 * Inverse zu `markItemSeen`: markiert dieses Item (und alles NEUERE)
 * wieder als ungelesen, indem der Read-Stempel auf knapp VOR die
 * createdAt des Items gesetzt wird. Das ist die natürliche Semantik
 * eines Single-Timestamp-„Read-Line"-Modells — wie „als ungelesen
 * markieren" in einem Mail-Client, der ab dieser Stelle alles als neu
 * behandelt.
 *
 * Persist nur wenn der neue Stempel den aktuellen wirklich nach vorne
 * zieht — sonst wäre der Aufruf ein No-op.
 */
export async function markItemUnseen(itemCreatedAt: string): Promise<{ ok: true }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: true };
  const target = new Date(itemCreatedAt);
  if (Number.isNaN(target.getTime())) return { ok: true };
  // 1 ms vor dem Item: das Item selbst gilt damit wieder als ungelesen.
  const justBefore = new Date(target.getTime() - 1);

  const userRow = await db.user.findUnique({
    where: { id: session.user.id },
    select: { notificationsSeenAt: true },
  });
  const current = userRow?.notificationsSeenAt ?? null;
  // Wenn der aktuelle Stempel ohnehin schon vor dem Item liegt (oder
  // null = noch nie etwas gesehen), ist das Item bereits ungelesen.
  if (!current || current <= justBefore) return { ok: true };

  await db.user.update({
    where: { id: session.user.id },
    data: { notificationsSeenAt: justBefore },
  });
  return { ok: true };
}

/**
 * Markiert eine abgeleitete System-Notification (MonthClose-Events) als
 * erledigt. Diese Items haben keinen eigenen DB-Record, der resolved
 * werden könnte — daher merken wir die Dismissal als JSON-Map auf dem
 * User: { syntheticId: createdAtISO }. Der createdAt-Vergleich in der
 * Query sorgt dafür, dass dasselbe Event nach einer Status-Änderung
 * (z. B. erneut eingereicht) wieder als frische Notification erscheint.
 *
 * Comments laufen NICHT hierüber — die haben `resolveComment`.
 */
export async function dismissNotification(
  id: string,
  createdAt: string,
): Promise<{ ok: true }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: true };

  const userRow = await db.user.findUnique({
    where: { id: session.user.id },
    select: { dismissedNotifications: true },
  });
  const current = (userRow?.dismissedNotifications ?? {}) as Record<string, string>;
  const next = { ...current, [id]: createdAt };

  await db.user.update({
    where: { id: session.user.id },
    data: { dismissedNotifications: next },
  });
  return { ok: true };
}

/**
 * Polling-Endpoint für die Header-Bell. Wird vom Client alle ~30 s
 * aufgerufen, statt einer eigenen Route. Server Actions liefern JSON
 * zurück ohne Layout-Re-Render — perfekt für Background-Refresh.
 */
export async function fetchNotifications(): Promise<NotificationSummary> {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return { unreadCount: 0, items: [] };
  }
  const t = await requireTenant();
  return getNotifications(t.tenantId, t.userId, t.tenantRole, 8);
}
