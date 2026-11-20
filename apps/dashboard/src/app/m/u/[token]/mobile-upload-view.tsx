"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  Camera,
  Image as ImageIcon,
  ScanLine,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Check,
} from "lucide-react";
import { appConfig } from "@/config/app";
import { compressIfImage } from "@/lib/documents/compress-image";

// Scanner lazy-laden — er zieht OpenCV.js (~8 MB) nach. Außerhalb des
// Scan-Pfads soll dieser Code gar nicht erst ins Bundle.
const DocumentScanner = dynamic(
  () => import("@/components/documents/document-scanner").then((m) => m.DocumentScanner),
  { ssr: false, loading: () => null },
);

type Upload = {
  id: string;
  name: string;
  size: number;
  status: "uploading" | "done" | "error";
  error?: string;
};

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MobileUploadView({ token, expiresAt }: { token: string; expiresAt: string }) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  // `null` während SSR → kein Hydration-Mismatch durch Date.now().
  const [remaining, setRemaining] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);
  const [finished, setFinished] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  useEffect(() => {
    const tick = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setRemaining(ms);
      if (ms <= 0) setExpired(true);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  async function uploadFiles(files: File[]) {
    for (const original of files) {
      const id = crypto.randomUUID();
      const initialName = original.name && original.name.length > 0
        ? original.name
        : `mobile-upload-${Date.now()}.jpg`;
      setUploads((prev) => [
        { id, name: initialName, size: original.size, status: "uploading" },
        ...prev,
      ]);
      try {
        // Kamerabilder können 3–5 MB groß sein; OCR-Qualität braucht das nicht.
        const file = await compressIfImage(original);
        const safeName = file.name && file.name.length > 0
          ? file.name
          : initialName;
        setUploads((prev) =>
          prev.map((u) => (u.id === id ? { ...u, size: file.size } : u)),
        );
        const fd = new FormData();
        fd.append("file", file, safeName);
        const res = await fetch(`/api/mobile-upload/${token}`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        setUploads((prev) =>
          prev.map((u) => (u.id === id ? { ...u, status: "done" } : u)),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload fehlgeschlagen";
        setUploads((prev) =>
          prev.map((u) => (u.id === id ? { ...u, status: "error", error: msg } : u)),
        );
      }
    }
  }

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;
    void uploadFiles(files);
    e.target.value = "";
  }

  const successCount = uploads.filter((u) => u.status === "done").length;
  const anyPending = uploads.some((u) => u.status === "uploading");

  // ── Done-Screen ─────────────────────────────────────────────────────────────
  if (finished) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500/15 motion-safe:animate-pulse">
          <Check className="h-12 w-12 text-emerald-500" strokeWidth={3} />
        </div>
        <h1 className="mt-6 text-xl font-semibold">Fertig</h1>
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">
          {successCount > 0
            ? `${successCount} Beleg${successCount === 1 ? "" : "e"} übertragen.`
            : "Sitzung beendet."}{" "}
          Du kannst dieses Fenster jetzt schließen und am Laptop weitermachen.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col p-4">
      <header className="mb-6 mt-2 flex items-center gap-3 border-b border-border pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-rbg.png"
          alt={appConfig.name}
          className="h-10 w-10 shrink-0 rounded-md object-contain"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">{appConfig.name}</p>
          <p className="text-xs text-muted-foreground">Beleg-Upload</p>
        </div>
        <span
          suppressHydrationWarning
          className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground tabular-nums"
        >
          {remaining === null ? "—:—" : expired ? "Abgelaufen" : formatRemaining(remaining)}
        </span>
      </header>

      {successCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {successCount} Beleg{successCount === 1 ? "" : "e"} erfolgreich übertragen
        </div>
      )}

      <div className="grid gap-3">
        {/* Primärer CTA: Beleg-Scanner mit Live-Kantenerkennung */}
        <button
          type="button"
          onClick={() => setScannerOpen(true)}
          disabled={expired}
          className="flex h-32 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-primary bg-primary text-primary-foreground shadow-sm transition-colors active:bg-primary/90 disabled:opacity-50"
        >
          <ScanLine className="h-8 w-8" />
          <span className="text-sm font-semibold">Beleg scannen</span>
          <span className="text-[11px] opacity-80">Mit automatischer Kantenerkennung</span>
        </button>

        {/* Sekundär: einfaches Kamera-Foto (Fallback wenn jscanify scheitert) */}
        <label
          className={`flex h-20 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-muted/30 text-foreground transition-colors active:bg-muted ${
            expired ? "pointer-events-none opacity-50" : ""
          }`}
        >
          <Camera className="h-5 w-5 text-muted-foreground" />
          <span className="text-xs font-medium">Schnelles Foto</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={handlePick}
            disabled={expired}
          />
        </label>

        <label
          className={`flex h-20 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-muted/30 text-foreground transition-colors active:bg-muted ${
            expired ? "pointer-events-none opacity-50" : ""
          }`}
        >
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
          <span className="text-xs font-medium">Aus Mediathek wählen</span>
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="sr-only"
            onChange={handlePick}
            disabled={expired}
          />
        </label>
      </div>

      {/* Hinweistext direkt unter den Buttons — vorher am Container-Boden
          mit mt-auto, dadurch nur per Scroll erreichbar. */}
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Bilder werden direkt deinem Account zugeordnet.
      </p>

      {scannerOpen && (
        <DocumentScanner
          onClose={() => setScannerOpen(false)}
          onCapture={(file) => {
            setScannerOpen(false);
            void uploadFiles([file]);
          }}
        />
      )}

      {uploads.length > 0 && (
        <ul className="mt-6 space-y-2">
          {uploads.map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
            >
              {u.status === "uploading" && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
              )}
              {u.status === "done" && (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              )}
              {u.status === "error" && (
                <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u.name}</p>
                {u.status === "error" ? (
                  <p className="truncate text-xs text-destructive">{u.error}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {(u.size / 1024).toFixed(0)} KB
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Fertig-Button: sichtbar, sobald mind. 1 Upload durchgelaufen ist. */}
      {successCount > 0 && (
        <button
          type="button"
          onClick={() => setFinished(true)}
          disabled={anyPending}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-medium text-white shadow-sm transition-colors active:bg-emerald-600 disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
          {anyPending ? "Warte auf laufende Uploads…" : "Fertig"}
        </button>
      )}

    </main>
  );
}
