"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Bell, CalendarCheck2, Check, CheckCheck, Eye, EyeOff, MessageCircle, Send } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { NotificationItem, NotificationSummary } from "@/lib/comments/queries";
import {
  dismissNotification,
  fetchNotifications,
  markItemSeen,
  markItemUnseen,
  markNotificationsSeen,
} from "@/lib/notifications/actions";
import { resolveComment } from "@/lib/comments/actions";

interface Props {
  initial: NotificationSummary;
}

const POLL_INTERVAL_MS = 30_000;

function timeAgo(iso: string, locale: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short" });
}

function shortBody(body: string, max = 96): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function IconForKind({ kind }: { kind: NotificationItem["kind"] }) {
  if (kind === "COMMENT") return <MessageCircle className="w-3 h-3" />;
  if (kind === "MONTH_CLOSE_SUBMITTED") return <Send className="w-3 h-3" />;
  return <CalendarCheck2 className="w-3 h-3" />;
}

export function CommentNotifications({ initial }: Props) {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const router = useRouter();

  const [summary, setSummary] = useState<NotificationSummary>(initial);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Background polling. Wir verzichten auf SSE/WS und nehmen 30s — passt
  // zu Comment-Workflow-Geschwindigkeit (kein Chat). Pausiert wenn Tab
  // versteckt, damit Hintergrund-Tabs nicht ewig pollen.
  const poll = useCallback(async () => {
    try {
      const next = await fetchNotifications();
      setSummary(next);
    } catch {
      // Server-Action kann auf Auth/Network scheitern — kein User-facing
      // Error, der Bell bleibt mit dem letzten Stand bestehen.
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    function start() {
      stop();
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void poll();
      }, POLL_INTERVAL_MS);
    }
    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
    function onVisibility() {
      if (document.visibilityState === "visible") {
        void poll();
        start();
      } else {
        stop();
      }
    }
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [poll]);

  // Klick außerhalb / Escape schließt das Dropdown.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Beim Öffnen frisch laden — der State könnte vom letzten Poll stammen
  // und der User will im Moment des Klicks sehen, was wirklich aktuell ist.
  // WICHTIG: poll() darf NICHT im setState-Updater stehen — React würde
  // das während des Renders ausführen, und die Server-Action triggert
  // intern Router-State-Updates → „Cannot update Router during render".
  function handleToggle() {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen) void poll();
  }

  function handleMarkAllRead() {
    // Optimistisch: lokal sofort als gelesen markieren, dann persist.
    setSummary((prev) => ({
      unreadCount: 0,
      items: prev.items.map((i) => ({ ...i, unread: false })),
    }));
    startTransition(async () => {
      await markNotificationsSeen();
      // Router refresh ist nicht zwingend nötig — aber so syncen die per
      // Server-Render geladenen Layouts ihre seenAt-Werte (z. B. wenn
      // dieselben Notifs auf der Seite woanders gerendert wären).
      router.refresh();
    });
  }

  function handleItemClick(item: NotificationItem) {
    setOpen(false);
    // Klick auf ein Item gilt als "ich habe genau das gesehen" → nur
    // dieses Item (und Ältere) als gelesen markieren. Neuere bleiben
    // ungelesen, damit der Zähler dem entspricht, was der User wirklich
    // angesehen hat.
    if (item.unread) {
      setSummary((prev) => {
        const itemDate = new Date(item.createdAt).getTime();
        const updated = prev.items.map((i) =>
          new Date(i.createdAt).getTime() <= itemDate ? { ...i, unread: false } : i,
        );
        return {
          unreadCount: updated.filter((i) => i.unread).length,
          items: updated,
        };
      });
      startTransition(async () => {
        await markItemSeen(item.createdAt);
      });
    }
    router.push(item.href as never);
  }

  /** Markiert genau dieses Item als gelesen (alles Ältere wird auto-seen,
   *  siehe markItemSeen-Doc). Bleibt im Dropdown, verliert nur Badge/
   *  Highlight. */
  function handleMarkOneSeen(item: NotificationItem, e: React.MouseEvent) {
    e.stopPropagation();
    setSummary((prev) => {
      const itemDate = new Date(item.createdAt).getTime();
      const updated = prev.items.map((i) =>
        new Date(i.createdAt).getTime() <= itemDate ? { ...i, unread: false } : i,
      );
      return {
        unreadCount: updated.filter((i) => i.unread).length,
        items: updated,
      };
    });
    startTransition(async () => {
      await markItemSeen(item.createdAt);
    });
  }

  /** Inverse: markiert dieses Item (und alles Neuere) wieder als ungelesen.
   *  Read-Line-Semantik, siehe markItemUnseen-Doc. */
  function handleMarkOneUnseen(item: NotificationItem, e: React.MouseEvent) {
    e.stopPropagation();
    setSummary((prev) => {
      const itemDate = new Date(item.createdAt).getTime();
      const updated = prev.items.map((i) =>
        new Date(i.createdAt).getTime() >= itemDate ? { ...i, unread: true } : i,
      );
      return {
        unreadCount: updated.filter((i) => i.unread).length,
        items: updated,
      };
    });
    startTransition(async () => {
      await markItemUnseen(item.createdAt);
    });
  }

  /** Markiert ein Item als erledigt und entfernt es aus der Liste.
   *  COMMENT → resolveComment (echter DB-Record). System-Notifications
   *  (MonthClose) → dismissNotification (JSON-Dismissal, da abgeleitet).
   *  In beiden Fällen optimistisch sofort entfernen. */
  function handleResolveItem(item: NotificationItem, e: React.MouseEvent) {
    e.stopPropagation();
    setSummary((prev) => {
      const items = prev.items.filter((i) => i.id !== item.id);
      return {
        unreadCount: items.filter((i) => i.unread).length,
        items,
      };
    });
    startTransition(async () => {
      if (item.kind === "COMMENT") {
        await resolveComment(item.id);
      } else {
        await dismissNotification(item.id, item.createdAt);
      }
      // Frischer Poll — falls neue Notifications nachgerückt sind.
      await poll();
    });
  }

  const badge = summary.unreadCount > 9 ? "9+" : String(summary.unreadCount);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        aria-label={t("title")}
        title={t("title")}
        className="relative p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <Bell className="w-4 h-4" />
        {summary.unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold inline-flex items-center justify-center">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 bg-card border border-border rounded-lg shadow-xl py-1 z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <div>
              <p className="text-xs font-semibold text-foreground">{t("title")}</p>
              {summary.unreadCount > 0 && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {t("subtitleWithCount", { count: summary.unreadCount })}
                </p>
              )}
            </div>
            {summary.unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                title={t("markAllRead")}
              >
                <CheckCheck className="w-3.5 h-3.5" />
                {t("markAllRead")}
              </button>
            )}
          </div>

          {summary.items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto">
              {summary.items.map((item) => (
                <li
                  key={item.id}
                  // Die GANZE Karte ist die Klick-Fläche (role=button +
                  // Tastatur-Support). Die Action-Icons rechts liegen im
                  // selben Node, stoppen aber die Propagation, damit ihr
                  // Klick nicht zusätzlich navigiert.
                  role="button"
                  tabIndex={0}
                  onClick={() => handleItemClick(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleItemClick(item);
                    }
                  }}
                  className={`group relative flex items-start gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-accent transition-colors outline-none focus-visible:bg-accent ${
                    item.unread ? "bg-primary/5" : ""
                  }`}
                >
                  <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary shrink-0">
                    <IconForKind kind={item.kind} />
                  </span>
                  <div className="min-w-0 flex-1 pr-16">
                    <NotifLine item={item} />
                    <NotifBody item={item} />
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5 font-mono">
                      {timeAgo(item.createdAt, locale)}
                    </p>
                  </div>

                  {/* Action-Strip rechts: nur bei Hover/Focus sichtbar,
                      damit das normale Layout ruhig bleibt. */}
                  <div className="absolute right-2 top-2.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    {item.unread ? (
                      <button
                        type="button"
                        onClick={(e) => handleMarkOneSeen(item, e)}
                        title={t("markRead")}
                        aria-label={t("markRead")}
                        className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-card border border-transparent hover:border-border"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => handleMarkOneUnseen(item, e)}
                        title={t("markUnread")}
                        aria-label={t("markUnread")}
                        className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-card border border-transparent hover:border-border"
                      >
                        <EyeOff className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => handleResolveItem(item, e)}
                      title={t("resolveItem")}
                      aria-label={t("resolveItem")}
                      className="p-1 rounded-md text-muted-foreground hover:text-emerald-600 hover:bg-card border border-transparent hover:border-border"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {item.unread && (
                    <span
                      className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0 group-hover:opacity-0 transition-opacity"
                      aria-label={t("unreadDot")}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Kopf-Zeile: Autor · Kontext (Entity/Monat). */
function NotifLine({ item }: { item: NotificationItem }) {
  const t = useTranslations("notifications");
  const actor = item.actorName ?? t("systemAuthor");

  if (item.kind === "COMMENT" && item.entityType) {
    return (
      <p className="text-[12px] text-foreground leading-snug">
        <span className="font-medium">{actor}</span>{" "}
        <span className="text-muted-foreground">· {t(`entity.${item.entityType}` as never)}</span>
      </p>
    );
  }
  if (item.kind === "MONTH_CLOSE_SUBMITTED") {
    return (
      <p className="text-[12px] text-foreground leading-snug">
        <span className="font-medium">{actor}</span>{" "}
        <span className="text-muted-foreground">· {t("monthCloseSubmittedLabel")}</span>
      </p>
    );
  }
  return (
    <p className="text-[12px] text-foreground leading-snug">
      <span className="font-medium">{actor}</span>{" "}
      <span className="text-muted-foreground">· {t("monthCloseReopenedLabel")}</span>
    </p>
  );
}

/** Body / Sub-Zeile. */
function NotifBody({ item }: { item: NotificationItem }) {
  const t = useTranslations("notifications");
  if (item.kind === "COMMENT" && item.body) {
    return (
      <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
        {shortBody(item.body)}
      </p>
    );
  }
  if (item.kind === "MONTH_CLOSE_SUBMITTED" && item.monthLabel && item.year) {
    return (
      <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
        {t("monthCloseSubmittedBody", { month: item.monthLabel, year: item.year })}
      </p>
    );
  }
  if (item.kind === "MONTH_CLOSE_REOPENED" && item.monthLabel && item.year) {
    return (
      <>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
          {t("monthCloseReopenedBody", { month: item.monthLabel, year: item.year })}
        </p>
        {item.reviewNotes && (
          <p className="text-[11px] text-foreground mt-1 leading-snug italic">
            „{shortBody(item.reviewNotes, 120)}"
          </p>
        )}
      </>
    );
  }
  return null;
}
