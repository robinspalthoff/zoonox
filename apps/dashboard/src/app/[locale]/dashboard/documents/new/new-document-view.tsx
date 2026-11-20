"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  FileUp,
  FileText,
  Loader2,
  CheckCircle2,
  ArrowLeft,
  Pencil,
} from "lucide-react";
import { useRouter, Link } from "@/i18n/navigation";
import { formatFileSize } from "@/lib/format";
import { compressIfImage } from "@/lib/documents/compress-image";
import { MobileUploadQrDialog } from "@/components/documents/mobile-upload-qr-dialog";
import { MobileUploadCta } from "@/components/documents/mobile-upload-cta";
import { createEmptyDocument } from "../actions";

interface UploadingFile {
  id: string;
  file: File;
  status: "uploading" | "done" | "error";
  error?: string;
}

export function NewDocumentView() {
  const t = useTranslations("documents");
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [isPendingManual, startManualTransition] = useTransition();
  const [manualError, setManualError] = useState<string | null>(null);

  // ── Upload-Pipeline ───────────────────────────────────────────────────────
  const uploadFiles = useCallback(
    async (files: File[]) => {
      const valid = files.filter(
        (f) =>
          ["application/pdf", "image/png", "image/jpeg"].includes(f.type) &&
          f.size <= 10 * 1024 * 1024,
      );
      if (valid.length === 0) return;

      const newOnes: UploadingFile[] = valid.map((file) => ({
        id: crypto.randomUUID(),
        file,
        status: "uploading" as const,
      }));
      setUploading((prev) => [...prev, ...newOnes]);

      for (const upload of newOnes) {
        try {
          const file = await compressIfImage(upload.file);
          const fd = new FormData();
          fd.append("file", file, file.name);
          const res = await fetch("/api/documents/upload", {
            method: "POST",
            body: fd,
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(data.error ?? `HTTP ${res.status}`);
          }
          const newDoc = (await res.json()) as { id: string };
          setUploading((prev) =>
            prev.map((u) => (u.id === upload.id ? { ...u, status: "done" } : u)),
          );
          router.push(`/dashboard/documents/${newDoc.id}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Upload fehlgeschlagen";
          setUploading((prev) =>
            prev.map((u) =>
              u.id === upload.id ? { ...u, status: "error", error: msg } : u,
            ),
          );
        }
      }
    },
    [router],
  );

  // ── Full-Page Drag&Drop (Window-Listener mit Counter) ──────────────────────
  const dragCounter = useRef(0);
  useEffect(() => {
    function hasFiles(e: DragEvent): boolean {
      return !!e.dataTransfer?.types?.includes("Files");
    }
    function onEnter(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounter.current += 1;
      setIsDragOver(true);
    }
    function onLeave(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounter.current = Math.max(0, dragCounter.current - 1);
      if (dragCounter.current === 0) setIsDragOver(false);
    }
    function onOver(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
    }
    function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragOver(false);
      const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
      if (files.length > 0) uploadFiles(files);
    }
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [uploadFiles]);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      uploadFiles(files);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [uploadFiles],
  );

  // ── Manueller leerer Beleg ────────────────────────────────────────────────
  const handleCreateManual = useCallback(() => {
    setManualError(null);
    startManualTransition(async () => {
      const res = await createEmptyDocument();
      if (!res.success) {
        setManualError(res.error);
        return;
      }
      router.push(`/dashboard/documents/${res.id}`);
    });
  }, [router]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/dashboard/documents"
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            title={t("new.back")}
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-foreground truncate">{t("new.pageTitle")}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">{t("new.subtitle")}</p>
          </div>
        </div>
      </div>

      {/* Drei-Optionen-Layout: Upload (groß) + Phone-CTA + Manuell (rechte Spalte gestapelt) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-stretch">
        {/* Drop-Zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="relative border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/30 flex flex-col items-center justify-center gap-4 min-h-[260px]"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            multiple
            onChange={handleFileInput}
            className="hidden"
          />
          <div className="w-14 h-14 rounded-xl flex items-center justify-center bg-muted">
            <FileUp className="w-7 h-7 text-muted-foreground" />
          </div>
          <div>
            <p className="text-base font-medium text-foreground">{t("upload.title")}</p>
            <p className="text-xs text-muted-foreground mt-1">{t("upload.hint")}</p>
          </div>
        </div>

        {/* Rechte Spalte: Phone-CTA + Manuell, gestapelt und gleich hoch wie Drop-Zone */}
        <div className="flex flex-col gap-4 lg:w-48">
          <div className="flex-1 rounded-xl border border-border bg-card">
            <MobileUploadCta onActivate={() => setQrDialogOpen(true)} />
          </div>
          <button
            type="button"
            onClick={handleCreateManual}
            disabled={isPendingManual}
            className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isPendingManual ? (
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            ) : (
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-muted">
                <Pencil className="w-5 h-5 text-muted-foreground" />
              </div>
            )}
            <span className="text-xs font-medium text-foreground">{t("new.manual.title")}</span>
            <span className="text-[11px] text-muted-foreground text-center leading-tight">
              {t("new.manual.hint")}
            </span>
          </button>
        </div>
      </div>

      {manualError && (
        <p className="text-xs text-destructive text-center">{manualError}</p>
      )}

      {/* Upload-Progress */}
      {uploading.length > 0 && (
        <div className="space-y-2">
          {uploading.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-3 bg-card border border-border rounded-lg px-4 py-3"
            >
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-sm text-foreground flex-1 truncate">{u.file.name}</span>
              <span className="text-xs text-muted-foreground">{formatFileSize(u.file.size)}</span>
              {u.status === "uploading" && (
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
              )}
              {u.status === "done" && (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              )}
              {u.status === "error" && (
                <span className="text-xs text-destructive">{u.error}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* QR-Dialog für Mobile-Foto-Handoff */}
      <MobileUploadQrDialog
        open={qrDialogOpen}
        onClose={() => setQrDialogOpen(false)}
        onDocumentArrived={(doc) => {
          // Beim ersten ankommenden mobile-Beleg direkt zur Detailseite —
          // identisch zum bisherigen Verhalten in documents-view.
          setQrDialogOpen(false);
          router.push(`/dashboard/documents/${doc.id}`);
        }}
      />

      {/* Full-Page Drop-Overlay */}
      {isDragOver && (
        <div className="fixed inset-0 z-40 pointer-events-none p-6">
          <div className="h-full w-full rounded-2xl border-4 border-dashed border-primary bg-primary/10 backdrop-blur-sm flex items-center justify-center motion-safe:animate-[onbFade_.15s_ease-out_both]">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center">
                <FileUp className="w-8 h-8 text-primary" />
              </div>
              <p className="text-lg font-semibold text-foreground">{t("upload.dropTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("upload.dropHint")}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
