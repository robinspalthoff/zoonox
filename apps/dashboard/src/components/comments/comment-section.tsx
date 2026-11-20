"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { Check, MessageCircle, MoreHorizontal, RotateCcw, Send, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CommentDTO } from "@/lib/comments/queries";
import {
  addComment,
  resolveComment,
  reopenComment,
  deleteComment,
} from "@/lib/comments/actions";

interface CommentSectionProps {
  entityType: "DOCUMENT" | "INVOICE" | "JOURNAL_ENTRY" | "BANK_TRANSACTION";
  entityId: string;
  comments: CommentDTO[];
  currentUserId: string;
  canWrite: boolean;
  canResolve: boolean;
  /** Optionaler Override für die Überschrift. Standardmäßig "comments.title". */
  titleKey?: "title" | "titleBank";
}

export function CommentSection({
  entityType,
  entityId,
  comments,
  currentUserId,
  canWrite,
  canResolve,
  titleKey = "title",
}: CommentSectionProps) {
  const t = useTranslations("comments");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Direct-Jump: kommt der User aus einer Notification mit `?comment={id}`,
  // den Eintrag highlighten und in den Viewport scrollen.
  const focusCommentId = searchParams.get("comment");
  const [highlightedId, setHighlightedId] = useState<string | null>(focusCommentId);
  const focusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusCommentId) return;
    // Erst nach dem Render scrollen — das DOM-Node existiert dann.
    const id = window.setTimeout(() => {
      focusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    // Highlight fade-out nach ~3 s.
    const fade = window.setTimeout(() => setHighlightedId(null), 3000);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(fade);
    };
  }, [focusCommentId]);

  const topLevel = comments.filter((c) => !c.parentId);
  const repliesByParent = comments
    .filter((c) => !!c.parentId)
    .reduce<Record<string, CommentDTO[]>>((acc, c) => {
      const key = c.parentId!;
      (acc[key] ??= []).push(c);
      return acc;
    }, {});

  const openCount = comments.filter((c) => !c.resolvedAt).length;

  function translateError(code: string): string {
    // next-intl: use `t.has(...)` is not standard. We use raw with fallback.
    try {
      return t(`errors.${code}` as never);
    } catch {
      return t("errors.UNKNOWN");
    }
  }

  function submit(parentId: string | null = null, content: string) {
    const trimmed = content.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const res = await addComment({
        entityType,
        entityId,
        body: trimmed,
        parentId,
      });
      if (!res.success) {
        setError(translateError(res.errorCode));
        return;
      }
      if (parentId === null) setBody("");
      router.refresh();
    });
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <MessageCircle className="w-4 h-4" />
          <span>{t(titleKey)}</span>
          {openCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
              {t("openCount", { count: openCount })}
            </span>
          )}
        </div>
      </header>

      <div className="px-4 py-3 space-y-3">
        {topLevel.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">{t("empty")}</p>
        )}

        {topLevel.map((c) => {
          // Highlight gilt auch wenn der Direct-Jump auf einen Reply
          // zeigt — wir scrollen zum Top-Level-Parent (Reply lebt im
          // selben Card-Container).
          const replies = repliesByParent[c.id] ?? [];
          const isFocus =
            highlightedId === c.id ||
            replies.some((r) => r.id === highlightedId);
          return (
            <div
              key={c.id}
              ref={isFocus ? focusRef : undefined}
              className={
                isFocus
                  ? "rounded-md ring-2 ring-primary/40 transition-shadow"
                  : undefined
              }
            >
              <CommentRow
                comment={c}
                replies={replies}
                currentUserId={currentUserId}
                canWrite={canWrite}
                canResolve={canResolve}
                isPending={isPending}
                onReply={(content) => submit(c.id, content)}
              />
            </div>
          );
        })}

        {canWrite && (
          <form
            className="mt-2 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit(null, body);
            }}
          >
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("placeholder")}
              rows={2}
              maxLength={5000}
              disabled={isPending}
              className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[60px]"
            />
            {error && <p className="text-[12px] text-destructive">{error}</p>}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isPending || !body.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{t("send")}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

function CommentRow({
  comment,
  replies,
  currentUserId,
  canWrite,
  canResolve,
  isPending,
  onReply,
}: {
  comment: CommentDTO;
  replies: CommentDTO[];
  currentUserId: string;
  canWrite: boolean;
  canResolve: boolean;
  isPending: boolean;
  onReply: (content: string) => void;
}) {
  const t = useTranslations("comments");
  const router = useRouter();
  const [showReply, setShowReply] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const isResolved = !!comment.resolvedAt;
  const isOwn = comment.authorId === currentUserId;
  const authorLabel = comment.author?.name ?? comment.author?.email ?? t("unknownAuthor");

  function handleResolveToggle() {
    setMenuOpen(false);
    const action = isResolved ? reopenComment(comment.id) : resolveComment(comment.id);
    action.then((res) => {
      if (res.success) router.refresh();
    });
  }

  function handleDelete() {
    setMenuOpen(false);
    if (!confirm(t("confirmDelete"))) return;
    deleteComment(comment.id).then((res) => {
      if (res.success) router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "rounded-md border p-3 transition-colors",
        isResolved ? "border-border bg-muted/40 opacity-75" : "border-border bg-background",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="font-medium text-foreground">{authorLabel}</span>
            <span>·</span>
            <span>{formatDate(comment.createdAt)}</span>
            {isResolved && (
              <span className="inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] font-semibold">
                <Check className="w-3 h-3" /> {t("resolved")}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-foreground whitespace-pre-wrap break-words">
            {comment.body}
          </p>
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={t("actionsLabel")}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-full mt-1 z-20 min-w-[160px] bg-card border border-border rounded-md shadow-lg py-1"
              onMouseLeave={() => setMenuOpen(false)}
            >
              {canResolve && (
                <button
                  type="button"
                  onClick={handleResolveToggle}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-foreground hover:bg-accent"
                >
                  {isResolved ? <RotateCcw className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                  {isResolved ? t("reopen") : t("markResolved")}
                </button>
              )}
              {isOwn && canWrite && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="w-3.5 h-3.5" /> {t("delete")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {replies.length > 0 && (
        <div className="mt-3 ml-3 pl-3 border-l border-border space-y-2">
          {replies.map((r) => (
            <div key={r.id} className="text-sm">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {r.author?.name ?? r.author?.email ?? t("unknownAuthor")}
                </span>
                <span>·</span>
                <span>{formatDate(r.createdAt)}</span>
              </div>
              <p className="mt-0.5 text-sm text-foreground whitespace-pre-wrap break-words">{r.body}</p>
            </div>
          ))}
        </div>
      )}

      {canWrite && !isResolved && (
        <div className="mt-2">
          {showReply ? (
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!replyBody.trim()) return;
                onReply(replyBody);
                setReplyBody("");
                setShowReply(false);
              }}
            >
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder={t("replyPlaceholder")}
                rows={2}
                disabled={isPending}
                autoFocus
                className="w-full px-2 py-1.5 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReplyBody("");
                    setShowReply(false);
                  }}
                  className="px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground"
                >
                  {t("replyCancel")}
                </button>
                <button
                  type="submit"
                  disabled={isPending || !replyBody.trim()}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[12px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Send className="w-3 h-3" /> {t("replySend")}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowReply(true)}
              className="text-[12px] text-muted-foreground hover:text-foreground"
            >
              {t("reply")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  // Native Intl-Format mit Browser-Locale — vermeidet die Notwendigkeit,
  // den Locale-String durch alle Komponenten zu reichen.
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
