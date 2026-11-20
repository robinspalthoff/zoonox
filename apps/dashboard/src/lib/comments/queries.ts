import { db } from "@/lib/db";
import type { CommentEntityType, TenantRole } from "@prisma/client";

export type NotificationKind =
  | "COMMENT"
  | "MONTH_CLOSE_SUBMITTED"
  | "MONTH_CLOSE_REOPENED";

export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  /** Vollständige Ziel-URL inkl. Query-Params (?comment=…&txn=…), aber
   *  OHNE Locale-Prefix. Der Header-Link prependiert den. */
  href: string;
  /** Comment-spezifisch. */
  entityType?: CommentEntityType;
  body?: string;
  /** MonthClose-spezifisch. */
  monthLabel?: string;
  year?: number;
  reviewNotes?: string;
  /** Wer hat das Event ausgelöst — Comment-Autor, Mandant der eingereicht
   *  hat, Berater der reopened hat. null wenn unbekannt (System / gelöscht). */
  actorName: string | null;
  createdAt: string;
  /** True wenn `createdAt > user.notificationsSeenAt` (oder seenAt=null). */
  unread: boolean;
};

export type NotificationSummary = {
  /** Anzahl ungelesener Events (für die Header-Badge). */
  unreadCount: number;
  /** Vorgemerkte Liste (neueste zuerst), bis zu `limit` Einträgen. */
  items: NotificationItem[];
};

function actorName(user: { firstName: string | null; lastName: string | null; email: string } | null): string | null {
  if (!user) return null;
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
}

function commentHref(
  entityType: CommentEntityType,
  entityId: string,
  commentId: string,
  bankAccountByTxId: Map<string, string>,
): string {
  switch (entityType) {
    case "INVOICE":
      return `/dashboard/invoices/${entityId}?comment=${commentId}`;
    case "DOCUMENT":
      return `/dashboard/documents/${entityId}?comment=${commentId}`;
    case "JOURNAL_ENTRY":
      return `/dashboard/taxes/journal/${entityId}?comment=${commentId}`;
    case "BANK_TRANSACTION": {
      const accountId = bankAccountByTxId.get(entityId);
      if (!accountId) return `/dashboard/bank`;
      return `/dashboard/bank/${accountId}?txn=${entityId}&comment=${commentId}`;
    }
  }
}

/**
 * Header-Notifications: aggregiert
 *   1. Offene Kommentare anderer User (KIND=COMMENT)
 *   2. Eingereichte Monatsabschlüsse (KIND=MONTH_CLOSE_SUBMITTED) —
 *      Berater-only
 *   3. Vom Berater zurückgegebene Monate mit reviewNotes
 *      (KIND=MONTH_CLOSE_REOPENED) — Mandant-only
 *
 * Read-State läuft über User.notificationsSeenAt: ein Event gilt als
 * ungelesen wenn createdAt > seenAt. Bewusst KEIN per-Item-Read, das
 * würde eine Junction-Tabelle bedingen und für v1 ist die Granularität
 * "alle ab Zeitpunkt X gelesen" mehr als ausreichend.
 */
export async function getNotifications(
  tenantId: string,
  userId: string,
  tenantRole: TenantRole,
  limit = 8,
): Promise<NotificationSummary> {
  const userRow = await db.user.findUnique({
    where: { id: userId },
    select: { notificationsSeenAt: true, dismissedNotifications: true },
  });
  const seenAt = userRow?.notificationsSeenAt ?? null;
  const isUnread = (d: Date) => (seenAt ? d > seenAt : true);

  // Als „erledigt" weggeklickte System-Notifications: Map syntheticId →
  // createdAtISO. Ein Item gilt nur dann als dismissed, wenn ID UND
  // createdAt übereinstimmen — so taucht ein erneut eingereichter Monat
  // (neuer Timestamp) wieder auf.
  const dismissed = (userRow?.dismissedNotifications ?? {}) as Record<string, string>;
  const isDismissed = (id: string, createdAt: string) => dismissed[id] === createdAt;

  // ─── 1) Comments ────────────────────────────────────────────────
  const commentWhere = {
    tenantId,
    resolvedAt: null,
    deletedAt: null,
    NOT: { authorId: userId },
  } as const;

  // ─── 2/3) MonthClose ───────────────────────────────────────────
  // Berater: alle SUBMITTED-Monate des Tenants.
  // Mandant: alle Monate mit reviewNotes nicht-leer UND status=OPEN.
  // Mandant=alle anderen Rollen außer ACCOUNTANT (OWNER/ADMIN/MEMBER).
  const isAccountant = tenantRole === "ACCOUNTANT";

  const [commentRows, monthCloseRows] = await Promise.all([
    db.comment.findMany({
      where: commentWhere,
      orderBy: { createdAt: "desc" },
      take: limit * 2,
      include: {
        author: { select: { firstName: true, lastName: true, email: true } },
      },
    }),
    isAccountant
      ? db.monthClose.findMany({
          where: { tenantId, status: "SUBMITTED" },
          orderBy: { submittedAt: "desc" },
          include: {
            submittedBy: { select: { firstName: true, lastName: true, email: true } },
          },
        })
      : db.monthClose.findMany({
          where: {
            tenantId,
            status: "OPEN",
            reviewNotes: { not: null },
          },
          orderBy: { updatedAt: "desc" },
          // Es gibt keine eigene `reopenedBy`-Relation; finalizedBy ist
          // der zuletzt agierende Berater (auch nach Reopen). Sonst Fallback.
          include: {
            finalizedBy: { select: { firstName: true, lastName: true, email: true } },
          },
        }),
  ]);

  // BankTransaction → BankAccountId Lookup für die Comment-Hrefs.
  const bankTxIds = commentRows
    .filter((c) => c.entityType === "BANK_TRANSACTION")
    .map((c) => c.entityId);
  const bankTxs = bankTxIds.length
    ? await db.bankTransaction.findMany({
        where: { id: { in: bankTxIds } },
        select: { id: true, bankAccountId: true },
      })
    : [];
  const bankAccountByTxId = new Map(bankTxs.map((t) => [t.id, t.bankAccountId]));

  const commentItems: NotificationItem[] = commentRows.map((c) => ({
    id: c.id,
    kind: "COMMENT",
    href: commentHref(c.entityType, c.entityId, c.id, bankAccountByTxId),
    entityType: c.entityType,
    body: c.body,
    actorName: actorName(c.author),
    createdAt: c.createdAt.toISOString(),
    unread: isUnread(c.createdAt),
  }));

  const monthLabelFor = (year: number, month: number) =>
    new Intl.DateTimeFormat("de", { month: "long" }).format(new Date(year, month - 1, 1));

  let mcItems: NotificationItem[] = [];
  if (isAccountant) {
    mcItems = monthCloseRows
      .filter((m): m is typeof m & { submittedAt: Date } => !!m.submittedAt)
      .map((m) => ({
        id: `mc-${m.id}-submitted`,
        kind: "MONTH_CLOSE_SUBMITTED" as const,
        href: `/dashboard/firm/closing`,
        monthLabel: monthLabelFor(m.year, m.month),
        year: m.year,
        actorName: actorName((m as { submittedBy?: { firstName: string | null; lastName: string | null; email: string } | null }).submittedBy ?? null),
        createdAt: m.submittedAt.toISOString(),
        unread: isUnread(m.submittedAt),
      }));
  } else {
    mcItems = monthCloseRows.map((m) => ({
      id: `mc-${m.id}-reopened`,
      kind: "MONTH_CLOSE_REOPENED" as const,
      // Beide Personas landen auf /firm/closing — die Page ist permission-
      // gegated, OWNER/ADMIN/MEMBER sehen ihre eigene Closing-Liste mit
      // den reviewNotes inline, Berater sehen dort sowieso seinen Posteingang.
      href: `/dashboard/firm/closing`,
      monthLabel: monthLabelFor(m.year, m.month),
      year: m.year,
      reviewNotes: m.reviewNotes ?? undefined,
      actorName: actorName((m as { finalizedBy?: { firstName: string | null; lastName: string | null; email: string } | null }).finalizedBy ?? null),
      // updatedAt approximiert den Reopen-Zeitpunkt — die DB hält
      // keinen eigenen `reopenedAt`-Stempel, was für v1 ok ist.
      createdAt: m.updatedAt.toISOString(),
      unread: isUnread(m.updatedAt),
    }));
  }

  // System-Notifications (MonthClose) können nicht serverseitig resolved
  // werden — sie sind aus dem Live-State abgeleitet. Stattdessen filtern
  // wir hier die vom User explizit weggeklickten heraus. Comments haben
  // ihren eigenen resolved-Mechanismus und sind nie dismissed.
  const visibleMcItems = mcItems.filter((i) => !isDismissed(i.id, i.createdAt));

  // Merge + sort + cap. Sort nach createdAt desc.
  const merged = [...commentItems, ...visibleMcItems].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
  const items = merged.slice(0, limit);
  const unreadCount = merged.filter((i) => i.unread).length;

  return { unreadCount, items };
}

/** @deprecated Use `getNotifications` — Kept until callers migrate. */
export async function getCommentNotifications(
  tenantId: string,
  userId: string,
  limit = 5,
): Promise<NotificationSummary> {
  return getNotifications(tenantId, userId, "MEMBER", limit);
}

export type CommentAuthor = {
  id: string | null;
  name: string | null;
  email: string | null;
};

export type CommentDTO = {
  id: string;
  body: string;
  authorId: string | null;
  author: CommentAuthor | null;
  parentId: string | null;
  resolvedAt: string | null;
  resolvedBy: CommentAuthor | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Liest alle nicht-gelöschten Kommentare für eine Entität, ältester zuerst.
 * Auf Caller-Seite werden Threads (parentId) gerendert. Aufgrund der
 * polymorphen Verknüpfung muss `tenantId` immer mitgegeben werden — der
 * Index `(tenantId, entityType, entityId)` deckt diese Abfrage ab.
 */
export async function listComments(
  tenantId: string,
  entityType: CommentEntityType,
  entityId: string,
): Promise<CommentDTO[]> {
  const rows = await db.comment.findMany({
    where: { tenantId, entityType, entityId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: { id: true, firstName: true, lastName: true, email: true } },
      resolvedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    body: c.body,
    authorId: c.authorId,
    author: c.author
      ? {
          id: c.author.id,
          name: [c.author.firstName, c.author.lastName].filter(Boolean).join(" ") || null,
          email: c.author.email,
        }
      : null,
    parentId: c.parentId,
    resolvedAt: c.resolvedAt?.toISOString() ?? null,
    resolvedBy: c.resolvedBy
      ? {
          id: c.resolvedBy.id,
          name: [c.resolvedBy.firstName, c.resolvedBy.lastName].filter(Boolean).join(" ") || null,
          email: c.resolvedBy.email,
        }
      : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));
}

/**
 * Lädt alle Kommentare für eine Liste von Entity-IDs in einem Rutsch und
 * gruppiert sie je entityId. Praktisch für Listenseiten, die jede Zeile mit
 * einem Comment-Drawer ausstatten wollen, ohne pro Zeile einen Roundtrip
 * zu fahren.
 */
export async function listCommentsByEntityIds(
  tenantId: string,
  entityType: CommentEntityType,
  entityIds: string[],
): Promise<Map<string, CommentDTO[]>> {
  const map = new Map<string, CommentDTO[]>();
  if (entityIds.length === 0) return map;
  const rows = await db.comment.findMany({
    where: { tenantId, entityType, entityId: { in: entityIds }, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: { id: true, firstName: true, lastName: true, email: true } },
      resolvedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
  for (const c of rows) {
    const dto: CommentDTO = {
      id: c.id,
      body: c.body,
      authorId: c.authorId,
      author: c.author
        ? {
            id: c.author.id,
            name: [c.author.firstName, c.author.lastName].filter(Boolean).join(" ") || null,
            email: c.author.email,
          }
        : null,
      parentId: c.parentId,
      resolvedAt: c.resolvedAt?.toISOString() ?? null,
      resolvedBy: c.resolvedBy
        ? {
            id: c.resolvedBy.id,
            name: [c.resolvedBy.firstName, c.resolvedBy.lastName].filter(Boolean).join(" ") || null,
            email: c.resolvedBy.email,
          }
        : null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
    const arr = map.get(c.entityId) ?? [];
    arr.push(dto);
    map.set(c.entityId, arr);
  }
  return map;
}

/**
 * Zählt offene (nicht-resolvte) Kommentare je Entitäts-ID — für Badges
 * in Listenansichten. Nimmt eine Liste von IDs entgegen und gibt ein
 * `Map<entityId, count>` zurück.
 */
export async function countOpenCommentsByEntity(
  tenantId: string,
  entityType: CommentEntityType,
  entityIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (entityIds.length === 0) return map;
  const grouped = await db.comment.groupBy({
    by: ["entityId"],
    where: {
      tenantId,
      entityType,
      entityId: { in: entityIds },
      resolvedAt: null,
      deletedAt: null,
    },
    _count: { _all: true },
  });
  for (const row of grouped) {
    map.set(row.entityId, row._count._all);
  }
  return map;
}
