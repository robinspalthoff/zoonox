"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Download, FileText, FileUp, Image, ZoomIn, ZoomOut, Loader2, CheckCircle2 } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { compressIfImage } from "@/lib/documents/compress-image";

const ZOOM_STEPS = [50, 75, 90, 100, 125, 150];

export function DocumentPreviewPanel({
  documentId,
  fileName,
  fileType,
  status,
}: {
  documentId: string;
  fileName: string;
  fileType: string;
  status: string;
}) {
  const t = useTranslations("documents");
  const router = useRouter();
  const isProcessing = status === "PROCESSING" || status === "PENDING";
  // Manuell angelegte Belege ohne Datei: fileType ist "" (Sentinel).
  const hasFile = fileType !== "";
  const [zoomIndex, setZoomIndex] = useState(2); // default 90%
  const zoom = ZOOM_STEPS[zoomIndex];

  const fileUrl = `/api/documents/${documentId}/file`;
  // ?download=1 lets the API distinguish DOCUMENT_DOWNLOADED from a plain
  // DOCUMENT_VIEWED (inline preview) in the audit log.
  const downloadUrl = `${fileUrl}?download=1`;
  const isPdf = fileType === "application/pdf";
  const isImage = fileType.startsWith("image/");

  // ── Nachreich-Upload für file-lose Belege ─────────────────────────────────
  const [isAttaching, setIsAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);

  const attachFile = useCallback(
    async (file: File) => {
      setAttachError(null);
      setIsAttaching(true);
      try {
        const compressed = await compressIfImage(file);
        const fd = new FormData();
        fd.append("file", compressed, compressed.name);
        const res = await fetch(`/api/documents/${documentId}/attach`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        // Detail neu laden — Server liefert jetzt Vorschau, OCR läuft im
        // Hintergrund weiter.
        router.refresh();
      } catch (err) {
        setAttachError(err instanceof Error ? err.message : "Upload fehlgeschlagen.");
      } finally {
        setIsAttaching(false);
      }
    },
    [documentId, router],
  );

  // Drag&Drop nur aktiv solange kein File da ist.
  const dragCounter = useRef(0);
  useEffect(() => {
    if (hasFile) return;
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
      if (files.length > 0) void attachFile(files[0]);
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
  }, [hasFile, attachFile]);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-card/90 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2.5">
          <Link
            href="/dashboard/documents"
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={t("detail.back")}
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-px h-4 bg-border" />
          {isImage ? (
            <Image className="w-4 h-4 text-muted-foreground" />
          ) : (
            <FileText className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium text-foreground truncate max-w-[300px]">{fileName}</span>
        </div>

        {/* Zoom + Download nur bei tatsächlich vorhandener Datei. */}
        {hasFile && (
          <>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
                disabled={zoomIndex === 0}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30"
                title={t("detail.zoomOut")}
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-medium text-muted-foreground tabular-nums w-10 text-center">
                {zoom} %
              </span>
              <button
                onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
                disabled={zoomIndex === ZOOM_STEPS.length - 1}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30"
                title={t("detail.zoomIn")}
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            <a
              href={downloadUrl}
              download={fileName}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-muted hover:bg-accent text-foreground transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              {t("detail.download")}
            </a>
          </>
        )}
      </div>

      {/* ── Preview canvas ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto bg-muted/20 relative">
        {/* Nachreich-Drop-Zone für manuell angelegte Belege ohne Datei */}
        {!hasFile && (
          <div
            onClick={() => !isAttaching && attachInputRef.current?.click()}
            className={`absolute inset-0 m-6 flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed text-center cursor-pointer transition-colors ${
              isDragOver
                ? "border-primary bg-primary/10"
                : "border-border bg-card hover:border-primary/50 hover:bg-muted/50"
            } ${isAttaching ? "pointer-events-none opacity-80" : ""}`}
          >
            <input
              ref={attachInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void attachFile(f);
                e.target.value = "";
              }}
            />
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-primary/10">
              {isAttaching ? (
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              ) : (
                <FileUp className="w-8 h-8 text-primary" />
              )}
            </div>
            <div className="max-w-xs">
              <p className="text-base font-medium text-foreground">
                {isAttaching ? t("detail.attach.uploading") : t("detail.attach.title")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("detail.attach.hint")}
              </p>
            </div>
            {attachError && (
              <p className="text-xs text-destructive max-w-xs">{attachError}</p>
            )}
            <p className="text-[11px] text-muted-foreground/70 flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3" />
              {t("detail.attach.preserveHint")}
            </p>
          </div>
        )}

        {/* Processing overlay */}
        {hasFile && isProcessing && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/60 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4 p-6 rounded-2xl bg-card border border-border shadow-lg">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                <FileText className="w-6 h-6 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">{t("detail.ocrProcessingTitle")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("detail.ocrProcessingSubtitle")}</p>
              </div>
            </div>
          </div>
        )}

        {hasFile && isPdf && (
          <div className="w-full h-full p-6 flex justify-center">
            <div style={{ width: `${zoom}%`, maxWidth: "900px", minWidth: "300px" }} className="h-full">
              <iframe
                src={fileUrl}
                title={fileName}
                className="w-full border border-border rounded-lg shadow-sm bg-white"
                style={{ height: "calc(100vh - 10rem)", minHeight: "400px" }}
              />
            </div>
          </div>
        )}

        {hasFile && isImage && (
          <div className="p-8 flex justify-center items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fileUrl}
              alt={fileName}
              style={{ zoom: zoom / 100 }}
              className="max-w-full rounded-lg shadow-sm border border-border"
            />
          </div>
        )}

        {hasFile && !isPdf && !isImage && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <FileText className="w-12 h-12 opacity-30" />
            <p className="text-sm">{t("detail.noPreview")}</p>
            <a
              href={downloadUrl}
              download={fileName}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              <Download className="w-4 h-4" />
              {t("detail.downloadFile")}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
