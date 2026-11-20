"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";

export function DeleteDocumentButton({
  documentId,
  locale,
  deleteLabel = "Löschen",
  confirmLabel = "Löschen bestätigen",
  cancelLabel = "Abbrechen",
}: {
  documentId: string;
  locale: string;
  deleteLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/documents?id=${documentId}`, { method: "DELETE" });
      if (res.ok) {
        router.push(`/${locale}/dashboard/documents`);
      }
    } finally {
      setDeleting(false);
    }
  }

  if (!confirm) {
    return (
      <button
        onClick={() => setConfirm(true)}
        className="flex items-center justify-center gap-2 w-full px-3 py-2 text-sm font-medium rounded-lg text-destructive bg-destructive/10 hover:bg-destructive/20 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
        {deleteLabel}
      </button>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg text-white bg-destructive hover:bg-destructive/90 transition-colors disabled:opacity-60"
      >
        {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        {confirmLabel}
      </button>
      <button
        onClick={() => setConfirm(false)}
        className="px-3 py-2 text-sm font-medium rounded-lg text-muted-foreground bg-muted hover:bg-accent transition-colors"
      >
        {cancelLabel}
      </button>
    </div>
  );
}
