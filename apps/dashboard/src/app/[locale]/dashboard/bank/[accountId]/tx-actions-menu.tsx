"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  MoreVertical,
  UserRound,
  UserRoundX,
  FilePlus2,
  Trash2,
  AlertTriangle,
  ArrowUpDown,
} from "lucide-react";
import {
  deleteTransaction,
  togglePrivateTransaction,
  createReceiptFromTransaction,
  flipTransactionSign,
} from "../actions";
import { cn } from "@/lib/utils";

interface TxActionsMenuProps {
  transactionId: string;
  isPrivate: boolean;
  status: "UNMATCHED" | "MATCHED" | "IGNORED";
  hasDocument: boolean;
  disabled?: boolean;
}

const MENU_WIDTH = 224; // tailwind w-56 = 14rem = 224px
const MENU_GAP = 4; // gap between button and menu

/**
 * Kebab menu with secondary row actions. Primary actions (Match / Ignore /
 * Unignore / Unmatch) stay inline for one-click access; this menu hosts the
 * longer tail (private, create receipt, delete).
 *
 * The dropdown uses fixed positioning anchored to the trigger button's bounding
 * rect so it escapes any ancestor with `overflow: hidden|auto|scroll` and
 * never causes its container to become scrollable.
 */
export function TxActionsMenu({
  transactionId,
  isPrivate,
  status,
  hasDocument,
  disabled,
}: TxActionsMenuProps) {
  const t = useTranslations("bank.transactions.menu");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );

  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    // Prefer aligning the menu's right edge to the button's right edge
    // (matches the previous `right-0` behavior).
    let left = rect.right - MENU_WIDTH;
    // Keep the menu inside the viewport horizontally.
    if (left < 8) left = 8;
    if (left + MENU_WIDTH > viewportW - 8) left = viewportW - MENU_WIDTH - 8;

    // Default: open below the button.
    let top = rect.bottom + MENU_GAP;
    // If not enough room below, flip above.
    const estimatedMenuHeight = 160;
    if (top + estimatedMenuHeight > viewportH - 8) {
      top = rect.top - MENU_GAP - estimatedMenuHeight;
      if (top < 8) top = 8;
    }

    setMenuPos({ top, left });
  }, []);

  // Recompute position when the menu opens, and on scroll/resize while open.
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handler = () => updatePosition();
    // `true` so we catch scrolls in any ancestor (the scrollable container).
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [open, updatePosition]);

  // Close on outside click (check both the trigger and the menu itself,
  // since they are no longer DOM descendants of the same wrapper visually).
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function runPrivateToggle() {
    setOpen(false);
    setIsPending(true);
    await togglePrivateTransaction(transactionId, !isPrivate);
    setIsPending(false);
    router.refresh();
  }

  async function runCreateReceipt() {
    setOpen(false);
    setIsPending(true);
    const res = await createReceiptFromTransaction(transactionId);
    setIsPending(false);
    if (res.success) {
      router.push(`/dashboard/documents/${res.documentId}` as never);
    }
  }

  async function runFlipSign() {
    setOpen(false);
    setIsPending(true);
    await flipTransactionSign(transactionId);
    setIsPending(false);
    router.refresh();
  }

  async function runDelete() {
    setIsPending(true);
    await deleteTransaction(transactionId);
    setIsPending(false);
    setConfirmDelete(false);
    router.refresh();
  }

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || isPending}
        title={t("more")}
        className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>

      {open && menuPos && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: "fixed",
            top: menuPos.top,
            left: menuPos.left,
            width: MENU_WIDTH,
          }}
          className="z-50 bg-card text-card-foreground border border-border rounded-lg shadow-lg py-1 text-sm"
        >
          <button
            type="button"
            onClick={runPrivateToggle}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent hover:text-accent-foreground text-left"
          >
            {isPrivate ? (
              <>
                <UserRoundX className="w-3.5 h-3.5" />
                {t("unmarkPrivate")}
              </>
            ) : (
              <>
                <UserRound className="w-3.5 h-3.5" />
                {t("markPrivate")}
              </>
            )}
          </button>

          {!hasDocument && status !== "IGNORED" && (
            <button
              type="button"
              onClick={runCreateReceipt}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent hover:text-accent-foreground text-left"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              {t("createReceipt")}
            </button>
          )}

          {status !== "IGNORED" && (
            <button
              type="button"
              onClick={runFlipSign}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent hover:text-accent-foreground text-left"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              {t("flipSign")}
            </button>
          )}

          <div className="h-px bg-border my-1" />

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setConfirmDelete(true);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-destructive/10 text-destructive text-left"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t("delete")}
          </button>
        </div>
      )}

      {confirmDelete && (
        <DeleteConfirmOverlay
          isPending={isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={runDelete}
        />
      )}
    </div>
  );
}

function DeleteConfirmOverlay({
  isPending,
  onCancel,
  onConfirm,
}: {
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("bank.transactions.deleteDialog");
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className={cn("bg-card border border-border rounded-lg w-full max-w-md")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 p-5">
          <div className="p-2 bg-destructive/10 text-destructive rounded">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-sm">{t("title")}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t("message")}</p>
            <p className="text-xs text-muted-foreground mt-2">{t("hint")}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/30">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 border border-input rounded-lg text-sm hover:bg-accent transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="px-3 py-1.5 bg-destructive text-destructive-foreground rounded-lg text-sm font-medium hover:bg-destructive/90 disabled:opacity-50 transition-colors"
          >
            {isPending ? "…" : t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
