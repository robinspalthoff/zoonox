"use server";

import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { CommentEntityType } from "@prisma/client";

/**
 * Server actions geben Fehler als KÜRZEL zurück, nicht als übersetzten Text.
 * Der Client mappt das Kürzel über die i18n-Keys (`comments.errors.<CODE>`)
 * auf die lokalisierte Anzeige. Das hält Server und i18n entkoppelt.
 */
type ActionResult = { success: true } | { success: false; errorCode: string };

async function assertEntityInTenant(
  tenantId: string,
  entityType: CommentEntityType,
  entityId: string,
): Promise<void> {
  let exists: { id: string } | null = null;
  switch (entityType) {
    case "DOCUMENT":
      exists = await db.document.findFirst({ where: { id: entityId, tenantId }, select: { id: true } });
      break;
    case "INVOICE":
      exists = await db.invoice.findFirst({ where: { id: entityId, tenantId }, select: { id: true } });
      break;
    case "JOURNAL_ENTRY":
      exists = await db.journalEntry.findFirst({ where: { id: entityId, tenantId }, select: { id: true } });
      break;
    case "BANK_TRANSACTION":
      exists = await db.bankTransaction.findFirst({ where: { id: entityId, tenantId }, select: { id: true } });
      break;
  }
  if (!exists) throw new Error("ENTITY_NOT_FOUND");
}

const ENTITY_TYPES = new Set<CommentEntityType>(["DOCUMENT", "INVOICE", "JOURNAL_ENTRY", "BANK_TRANSACTION"]);

function parseEntityType(raw: string): CommentEntityType {
  if (!ENTITY_TYPES.has(raw as CommentEntityType)) throw new Error("INVALID_ENTITY_TYPE");
  return raw as CommentEntityType;
}

export async function addComment(input: {
  entityType: string;
  entityId: string;
  body: string;
  parentId?: string | null;
}): Promise<ActionResult> {
  try {
    const t = await requireTenant();
    if (!can(t.tenantRole, "comments.write")) return { success: false, errorCode: "FORBIDDEN" };
    const entityType = parseEntityType(input.entityType);
    const body = input.body.trim();
    if (!body) return { success: false, errorCode: "EMPTY" };
    if (body.length > 5000) return { success: false, errorCode: "TOO_LONG" };

    await assertEntityInTenant(t.tenantId, entityType, input.entityId);

    if (input.parentId) {
      const parent = await db.comment.findFirst({
        where: { id: input.parentId, tenantId: t.tenantId, entityType, entityId: input.entityId },
        select: { id: true },
      });
      if (!parent) return { success: false, errorCode: "PARENT_NOT_FOUND" };
    }

    const created = await db.comment.create({
      data: {
        tenantId: t.tenantId,
        entityType,
        entityId: input.entityId,
        body,
        authorId: t.userId,
        parentId: input.parentId ?? null,
      },
      select: { id: true },
    });

    await createAuditLog({
      tenantId: t.tenantId,
      userId: t.userId,
      action: "COMMENT_CREATED",
      entityType,
      entityId: input.entityId,
      details: { commentId: created.id, parentId: input.parentId ?? null },
    });

    revalidatePath("/dashboard", "layout");
    return { success: true };
  } catch (e) {
    const code = e instanceof Error ? e.message : "UNKNOWN";
    // Map known errors to translation codes, sonst UNKNOWN.
    if (["ENTITY_NOT_FOUND", "INVALID_ENTITY_TYPE"].includes(code)) {
      return { success: false, errorCode: code };
    }
    return { success: false, errorCode: "UNKNOWN" };
  }
}

export async function resolveComment(commentId: string): Promise<ActionResult> {
  try {
    const t = await requireTenant();
    if (!can(t.tenantRole, "comments.resolve")) return { success: false, errorCode: "FORBIDDEN" };
    const c = await db.comment.findFirst({
      where: { id: commentId, tenantId: t.tenantId, deletedAt: null },
      select: { id: true, entityType: true, entityId: true, resolvedAt: true },
    });
    if (!c) return { success: false, errorCode: "NOT_FOUND" };
    if (c.resolvedAt) return { success: true };

    await db.comment.update({
      where: { id: commentId },
      data: { resolvedAt: new Date(), resolvedById: t.userId },
    });

    await createAuditLog({
      tenantId: t.tenantId,
      userId: t.userId,
      action: "COMMENT_RESOLVED",
      entityType: c.entityType,
      entityId: c.entityId,
      details: { commentId },
    });

    revalidatePath("/dashboard", "layout");
    return { success: true };
  } catch (err) {
    console.error("[resolveComment] fehlgeschlagen:", err);
    return { success: false, errorCode: "UNKNOWN" };
  }
}

export async function reopenComment(commentId: string): Promise<ActionResult> {
  try {
    const t = await requireTenant();
    if (!can(t.tenantRole, "comments.resolve")) return { success: false, errorCode: "FORBIDDEN" };
    const c = await db.comment.findFirst({
      where: { id: commentId, tenantId: t.tenantId, deletedAt: null },
      select: { id: true, entityType: true, entityId: true, resolvedAt: true },
    });
    if (!c) return { success: false, errorCode: "NOT_FOUND" };
    if (!c.resolvedAt) return { success: true };

    await db.comment.update({
      where: { id: commentId },
      data: { resolvedAt: null, resolvedById: null },
    });

    await createAuditLog({
      tenantId: t.tenantId,
      userId: t.userId,
      action: "COMMENT_REOPENED",
      entityType: c.entityType,
      entityId: c.entityId,
      details: { commentId },
    });

    revalidatePath("/dashboard", "layout");
    return { success: true };
  } catch (err) {
    console.error("[reopenComment] fehlgeschlagen:", err);
    return { success: false, errorCode: "UNKNOWN" };
  }
}

export async function deleteComment(commentId: string): Promise<ActionResult> {
  try {
    const t = await requireTenant();
    if (!can(t.tenantRole, "comments.write")) return { success: false, errorCode: "FORBIDDEN" };
    const c = await db.comment.findFirst({
      where: { id: commentId, tenantId: t.tenantId, deletedAt: null },
      select: { id: true, authorId: true, entityType: true, entityId: true },
    });
    if (!c) return { success: false, errorCode: "NOT_FOUND" };
    const isOwnerLike = t.tenantRole === "OWNER" || t.tenantRole === "ADMIN";
    if (c.authorId !== t.userId && !isOwnerLike) {
      return { success: false, errorCode: "ONLY_AUTHOR_CAN_DELETE" };
    }

    await db.comment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });

    await createAuditLog({
      tenantId: t.tenantId,
      userId: t.userId,
      action: "COMMENT_DELETED",
      entityType: c.entityType,
      entityId: c.entityId,
      details: { commentId },
    });

    revalidatePath("/dashboard", "layout");
    return { success: true };
  } catch (err) {
    console.error("[deleteComment] fehlgeschlagen:", err);
    return { success: false, errorCode: "UNKNOWN" };
  }
}
