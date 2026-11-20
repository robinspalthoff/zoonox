"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  Camera as CameraIcon,
  RotateCcw,
  Check,
  Loader2,
  AlertCircle,
} from "lucide-react";

// OpenCV.js wird per CDN nachgeladen — ~8 MB einmalig, danach Browser-Cache.
const OPENCV_URL = "https://docs.opencv.org/4.10.0/opencv.js";
const TARGET_LONG_EDGE = 2400; // px für die finale Beleg-JPEG
const JPEG_QUALITY = 0.9;
const DETECT_INTERVAL_MS = 200; // 5 Hz Live-Detection
const STABILITY_THRESHOLD_PX_RATIO = 0.025; // <2,5 % des Frames = stabil
const STABILITY_REQUIRED_FRAMES = 2; // n stabile Frames bevor Overlay erscheint
const CARRY_OVER_MS = 500; // Detection darf 500 ms ausfallen ohne Overlay-Flicker
const SMOOTHING_ALPHA = 0.35; // EMA-Gewicht für neue Frames (0..1)

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cv?: any;
  }
}

let openCvPromise: Promise<void> | null = null;
function loadOpenCv(): Promise<void> {
  if (openCvPromise) return openCvPromise;
  openCvPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("SSR"));
    if (window.cv?.Mat) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[data-opencv="1"]`);
    const finalize = () => {
      const start = Date.now();
      const check = () => {
        if (window.cv?.Mat) return resolve();
        if (Date.now() - start > 15000) return reject(new Error("OpenCV-Timeout"));
        setTimeout(check, 50);
      };
      check();
    };
    if (existing) return finalize();
    const s = document.createElement("script");
    s.src = OPENCV_URL;
    s.async = true;
    s.dataset.opencv = "1";
    s.onload = finalize;
    s.onerror = () => reject(new Error("OpenCV konnte nicht geladen werden"));
    document.head.appendChild(s);
  });
  return openCvPromise;
}

type Phase = "loading" | "live" | "review" | "error";
type Point = { x: number; y: number };
type Corners = { tl: Point; tr: Point; bl: Point; br: Point };
type CornerKey = keyof Corners;

type Props = {
  onClose: () => void;
  onCapture: (file: File) => void;
};

export function DocumentScanner({ onClose, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoBoxRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);

  // Live: zuletzt erkannte Eckpunkte in natürlichen Video-Koordinaten.
  const [liveCorners, setLiveCorners] = useState<Corners | null>(null);
  // Render-Rechteck des Videos innerhalb seiner Box (object-contain ⇒ Letterbox).
  const [videoRect, setVideoRect] = useState<RenderedRect | null>(null);

  // Captured frame for review phase
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [capturedSize, setCapturedSize] = useState<{ w: number; h: number } | null>(null);
  const capturedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [corners, setCorners] = useState<Corners | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // ── Boot: OpenCV + Kamera ────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await loadOpenCv();
        if (!mounted) return;

        const mod = await import("jscanify/client");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Ctor: any = (mod as any).default ?? mod;
        scannerRef.current = new Ctor();

        // Work-Canvas einmalig anlegen.
        workCanvasRef.current = document.createElement("canvas");

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setPhase("live");
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Scanner nicht verfügbar");
        setPhase("error");
      }
    })();
    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stream an Video binden
  useEffect(() => {
    if (phase !== "live") return;
    const v = videoRef.current;
    const stream = streamRef.current;
    if (!v || !stream) return;
    v.srcObject = stream;
    v.muted = true;
    v.playsInline = true;
    v.play().catch((err) => console.warn("[scanner] video.play() failed:", err));
  }, [phase]);

  // ── Live-Box-Measure (für Overlay-Mapping) ───────────────────────────────
  useEffect(() => {
    if (phase !== "live") return;
    function measure() {
      const v = videoRef.current;
      const box = videoBoxRef.current;
      if (!v || !box || v.videoWidth === 0) return;
      const br = box.getBoundingClientRect();
      const inner = computeContainedRect(
        { w: br.width, h: br.height },
        v.videoWidth / v.videoHeight,
      );
      setVideoRect(inner);
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (videoBoxRef.current) ro.observe(videoBoxRef.current);
    const v = videoRef.current;
    if (v) v.addEventListener("loadedmetadata", measure);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      if (v) v.removeEventListener("loadedmetadata", measure);
      window.removeEventListener("resize", measure);
    };
  }, [phase]);

  // ── Live-Detection mit Smoothing + Stability-Gate + Carry-Over ──────────
  // Designed to look like Apple Notes: kein flackerndes Overlay, lieber
  // gar keins. Erst wenn Detection mehrfach in Folge konsistent ist, wird
  // angezeigt. Kurze Aussetzer (< CARRY_OVER_MS) halten die letzte Form.
  const smoothedRef = useRef<Corners | null>(null);
  const lastDetectAtRef = useRef<number>(0);
  const stableFramesRef = useRef<number>(0);
  useEffect(() => {
    if (phase !== "live") return;
    let cancelled = false;
    smoothedRef.current = null;
    lastDetectAtRef.current = 0;
    stableFramesRef.current = 0;

    function tick() {
      if (cancelled) return;
      const v = videoRef.current;
      const work = workCanvasRef.current;
      if (v && work && v.videoWidth > 0) {
        const vw = v.videoWidth;
        const vh = v.videoHeight;
        const longEdge = 480;
        const dw = vw >= vh ? longEdge : Math.round((vw / vh) * longEdge);
        const dh = vh >= vw ? longEdge : Math.round((vh / vw) * longEdge);
        work.width = dw;
        work.height = dh;
        const wctx = work.getContext("2d");
        if (wctx) {
          wctx.drawImage(v, 0, 0, dw, dh);
          const found = detectPaperCorners(work);
          if (found) {
            // Auf natürliche Video-Auflösung hochskalieren.
            const sx = vw / dw;
            const sy = vh / dh;
            const detected: Corners = {
              tl: { x: found.tl.x * sx, y: found.tl.y * sy },
              tr: { x: found.tr.x * sx, y: found.tr.y * sy },
              br: { x: found.br.x * sx, y: found.br.y * sy },
              bl: { x: found.bl.x * sx, y: found.bl.y * sy },
            };

            // EMA-Smoothing gegen Zittern.
            const prev = smoothedRef.current;
            const next: Corners = prev
              ? {
                  tl: emaPoint(prev.tl, detected.tl, SMOOTHING_ALPHA),
                  tr: emaPoint(prev.tr, detected.tr, SMOOTHING_ALPHA),
                  br: emaPoint(prev.br, detected.br, SMOOTHING_ALPHA),
                  bl: emaPoint(prev.bl, detected.bl, SMOOTHING_ALPHA),
                }
              : detected;

            // Stability-Counter: zählt aufeinanderfolgende stabile Frames.
            const ref = Math.min(vw, vh);
            const movement = prev ? maxCornerMovement(prev, detected) / ref : 999;
            if (movement < STABILITY_THRESHOLD_PX_RATIO) {
              stableFramesRef.current += 1;
            } else {
              stableFramesRef.current = 0;
            }

            smoothedRef.current = next;
            lastDetectAtRef.current = Date.now();

            if (stableFramesRef.current >= STABILITY_REQUIRED_FRAMES) {
              setLiveCorners(next);
            }
          } else {
            // Kein Detect — halte die letzte Form für CARRY_OVER_MS, sonst clear.
            if (Date.now() - lastDetectAtRef.current > CARRY_OVER_MS) {
              smoothedRef.current = null;
              stableFramesRef.current = 0;
              setLiveCorners(null);
            }
          }
        }
      }
      if (!cancelled) setTimeout(tick, DETECT_INTERVAL_MS);
    }
    const id = setTimeout(tick, 400);
    return () => {
      cancelled = true;
      clearTimeout(id);
      smoothedRef.current = null;
      lastDetectAtRef.current = 0;
      stableFramesRef.current = 0;
      setLiveCorners(null);
    };
  }, [phase]);

  // ── Capture ──────────────────────────────────────────────────────────────
  const capture = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) return;

    const w = v.videoWidth;
    const h = v.videoHeight;
    const full = document.createElement("canvas");
    full.width = w;
    full.height = h;
    const fctx = full.getContext("2d");
    if (!fctx) return;
    fctx.drawImage(v, 0, 0, w, h);

    capturedCanvasRef.current = full;
    setCapturedSize({ w, h });
    full.toBlob(
      (blob) => {
        if (!blob) return;
        setCapturedUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
      },
      "image/jpeg",
      0.95,
    );

    // Live-Detect-Korner als Start nehmen, sonst Default-Inset (10 %).
    setCorners(liveCorners ?? defaultCorners(w, h));
    setPhase("review");
  }, [liveCorners]);

  const retake = useCallback(() => {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedUrl(null);
    setCapturedSize(null);
    setCorners(null);
    capturedCanvasRef.current = null;
    setPhase("live");
  }, [capturedUrl]);

  // ── Confirm: Perspective + Kontrast + Upload ─────────────────────────────
  const confirm = useCallback(async () => {
    const full = capturedCanvasRef.current;
    const c = corners;
    const scanner = scannerRef.current;
    if (!full || !c || !scanner) return;
    setIsProcessing(true);
    try {
      const topW = dist(c.tl, c.tr);
      const bottomW = dist(c.bl, c.br);
      const leftH = dist(c.tl, c.bl);
      const rightH = dist(c.tr, c.br);
      const avgW = Math.max(1, (topW + bottomW) / 2);
      const avgH = Math.max(1, (leftH + rightH) / 2);
      const ratio = avgW / avgH;
      const outLong = TARGET_LONG_EDGE;
      const outShort = Math.round(outLong / Math.max(ratio, 1 / ratio));
      const outW = ratio >= 1 ? outLong : outShort;
      const outH = ratio >= 1 ? outShort : outLong;

      const warped = scanner.extractPaper(full, outW, outH, {
        topLeftCorner:     c.tl,
        topRightCorner:    c.tr,
        bottomLeftCorner:  c.bl,
        bottomRightCorner: c.br,
      }) as HTMLCanvasElement | null;
      if (!warped) throw new Error("Warp fehlgeschlagen");

      const ctx = warped.getContext("2d");
      if (ctx) {
        const img = ctx.getImageData(0, 0, warped.width, warped.height);
        const data = img.data;
        const contrast = 1.18;
        const brightness = 8;
        for (let i = 0; i < data.length; i += 4) {
          data[i]     = clamp((data[i]     - 128) * contrast + 128 + brightness);
          data[i + 1] = clamp((data[i + 1] - 128) * contrast + 128 + brightness);
          data[i + 2] = clamp((data[i + 2] - 128) * contrast + 128 + brightness);
        }
        ctx.putImageData(img, 0, 0);
      }

      const blob = await new Promise<Blob | null>((res) =>
        warped.toBlob(res, "image/jpeg", JPEG_QUALITY),
      );
      if (!blob) throw new Error("Encoding fehlgeschlagen");
      const file = new File([blob], `scan-${Date.now()}.jpg`, { type: "image/jpeg" });
      onCapture(file);
    } catch (err) {
      console.error("[scanner] confirm failed:", err);
      setError(err instanceof Error ? err.message : "Verarbeitung fehlgeschlagen");
      setPhase("error");
    } finally {
      setIsProcessing(false);
    }
  }, [corners, onCapture]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black">
      <button
        type="button"
        onClick={onClose}
        className="absolute right-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur active:bg-black/80"
        aria-label="Schließen"
      >
        <X className="h-5 w-5" />
      </button>

      {phase === "loading" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-white">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Scanner wird vorbereitet…</p>
          <p className="text-xs text-white/60">OpenCV wird einmalig geladen</p>
        </div>
      )}

      {phase === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-white">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm">{error}</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 rounded-md bg-white/10 px-4 py-2 text-sm"
          >
            Zurück
          </button>
        </div>
      )}

      {phase === "live" && (
        <div className="relative flex flex-1 flex-col">
          <p className="absolute left-0 right-12 top-3 z-10 text-center text-xs font-medium text-white/80">
            {liveCorners
              ? "Beleg erkannt — auslösen, wenn der Rahmen passt"
              : "Beleg flach auflegen, gleichmäßig beleuchten"}
          </p>
          <div ref={videoBoxRef} className="relative flex-1 overflow-hidden">
            <video
              ref={videoRef}
              playsInline
              muted
              className="absolute inset-0 h-full w-full object-contain"
            />
            {/* Live-erkanntes Quadrilateral (orange) */}
            {liveCorners && videoRect && (
              <LiveOverlay corners={liveCorners} rect={videoRect} naturalW={
                videoRef.current?.videoWidth ?? 0
              } naturalH={videoRef.current?.videoHeight ?? 0} />
            )}
          </div>
          <div className="flex items-center justify-center bg-black p-6">
            <button
              type="button"
              onClick={capture}
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-white/10 active:bg-white/30"
              aria-label="Aufnehmen"
            >
              <CameraIcon className="h-6 w-6 text-white" />
            </button>
          </div>
        </div>
      )}

      {phase === "review" && capturedUrl && capturedSize && corners && (
        <ReviewPhase
          imageUrl={capturedUrl}
          natural={capturedSize}
          corners={corners}
          onCornersChange={setCorners}
          onRetake={retake}
          onConfirm={confirm}
          isProcessing={isProcessing}
        />
      )}
    </div>
  );
}

// ─── Live-Overlay: SVG-Quad über den Video-Letterbox-Bereich ─────────────
function LiveOverlay({
  corners,
  rect,
  naturalW,
  naturalH,
}: {
  corners: Corners;
  rect: RenderedRect;
  naturalW: number;
  naturalH: number;
}) {
  if (!naturalW || !naturalH) return null;
  const sx = rect.w / naturalW;
  const sy = rect.h / naturalH;
  const tr = (p: Point) => `${rect.x + p.x * sx},${rect.y + p.y * sy}`;
  const points = [tr(corners.tl), tr(corners.tr), tr(corners.br), tr(corners.bl)].join(" ");
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
    >
      <polygon
        points={points}
        fill="rgba(253,154,0,0.15)"
        stroke="#FD9A00"
        strokeWidth={3}
      />
    </svg>
  );
}

// ─── Review-Phase mit verschiebbaren Eck-Punkten ─────────────────────────
function ReviewPhase({
  imageUrl,
  natural,
  corners,
  onCornersChange,
  onRetake,
  onConfirm,
  isProcessing,
}: {
  imageUrl: string;
  natural: { w: number; h: number };
  corners: Corners;
  onCornersChange: (c: Corners) => void;
  onRetake: () => void;
  onConfirm: () => void;
  isProcessing: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [rect, setRect] = useState<RenderedRect | null>(null);

  // Tatsächlicher Render-Bereich des Bildes (object-contain → Letterbox).
  useEffect(() => {
    function measure() {
      const img = imgRef.current;
      const box = containerRef.current;
      if (!img || !box) return;
      const br = box.getBoundingClientRect();
      const ir = img.getBoundingClientRect();
      // img ist absolute inset-0 — sein bounding rect == container. Daraus
      // mit object-contain den tatsächlichen Bildbereich rechnen.
      const inner = computeContainedRect(
        { w: ir.width, h: ir.height },
        natural.w / natural.h,
      );
      setRect({
        w: inner.w,
        h: inner.h,
        x: ir.left - br.left + inner.x,
        y: ir.top - br.top + inner.y,
      });
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    if (imgRef.current) ro.observe(imgRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [natural.w, natural.h, imageUrl]);

  const draggingRef = useRef<CornerKey | null>(null);

  function naturalFromClient(clientX: number, clientY: number): Point | null {
    const box = containerRef.current;
    if (!box || !rect) return null;
    const br = box.getBoundingClientRect();
    const localX = clientX - br.left - rect.x;
    const localY = clientY - br.top - rect.y;
    const sx = natural.w / rect.w;
    const sy = natural.h / rect.h;
    return {
      x: clamp(localX * sx, 0, natural.w),
      y: clamp(localY * sy, 0, natural.h),
    };
  }

  function onPointerDown(e: React.PointerEvent, key: CornerKey) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draggingRef.current = key;
  }
  function onPointerMove(e: React.PointerEvent) {
    const key = draggingRef.current;
    if (!key) return;
    const p = naturalFromClient(e.clientX, e.clientY);
    if (p) onCornersChange({ ...corners, [key]: p });
  }
  function onPointerUp(e: React.PointerEvent) {
    if (draggingRef.current) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      draggingRef.current = null;
    }
  }

  // Render-Position eines Naturkoordinaten-Punkts.
  function toRender(p: Point) {
    if (!rect) return { x: 0, y: 0 };
    return {
      x: rect.x + (p.x / natural.w) * rect.w,
      y: rect.y + (p.y / natural.h) * rect.h,
    };
  }

  const rTl = toRender(corners.tl);
  const rTr = toRender(corners.tr);
  const rBr = toRender(corners.br);
  const rBl = toRender(corners.bl);
  const polyPoints = [
    `${rTl.x},${rTl.y}`,
    `${rTr.x},${rTr.y}`,
    `${rBr.x},${rBr.y}`,
    `${rBl.x},${rBl.y}`,
  ].join(" ");

  return (
    <div className="relative flex flex-1 flex-col">
      {/* pointer-events-none — sonst frisst der Text Klicks auf Eck-Punkte, die
          aufgrund -translate-y-1/2 in den Bereich des Texts hineinragen. */}
      <p className="pointer-events-none absolute left-0 right-12 top-3 z-10 text-center text-xs font-medium text-white/80">
        Ecken bei Bedarf justieren — dann „Übernehmen"
      </p>
      {/* Container für Pointer-Events. overflow-visible damit Handle-Hitboxen
          am Bildrand nicht beschnitten werden. */}
      <div
        ref={containerRef}
        className="relative flex-1 bg-black"
        style={{ touchAction: "none" }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Aufnahme"
          className="absolute inset-0 h-full w-full object-contain"
        />
        {rect && (
          <>
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              xmlns="http://www.w3.org/2000/svg"
            >
              <polygon
                points={polyPoints}
                fill="rgba(253,154,0,0.12)"
                stroke="#FD9A00"
                strokeWidth={2}
              />
            </svg>
            {(["tl", "tr", "br", "bl"] as CornerKey[]).map((key) => {
              const p = toRender(
                key === "tl" ? corners.tl :
                key === "tr" ? corners.tr :
                key === "br" ? corners.br : corners.bl,
              );
              return (
                <button
                  key={key}
                  type="button"
                  onPointerDown={(e) => onPointerDown(e, key)}
                  // Großzügige 80×80-Hit-Area mit hohem z-Index. Visueller
                  // Punkt liegt zentriert in der Mitte; die transparente
                  // Fläche drumherum fängt Touch- und Maus-Klicks ein.
                  className="absolute z-20 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
                  style={{ left: p.x, top: p.y }}
                  aria-label={`Ecke ${key}`}
                >
                  <span className="block h-6 w-6 rounded-full border-[3px] border-white bg-primary shadow-lg ring-2 ring-black/30" />
                </button>
              );
            })}
          </>
        )}
      </div>
      <div className="flex items-stretch justify-center gap-3 bg-black p-4">
        <button
          type="button"
          onClick={onRetake}
          disabled={isProcessing}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 py-3 text-sm font-medium text-white active:bg-white/20 disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" />
          Neu aufnehmen
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isProcessing}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground active:bg-primary/90 disabled:opacity-50"
        >
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Übernehmen
        </button>
      </div>
    </div>
  );
}

// ─── OpenCV-Detection: nur echte 4-Eck-Quadrilateral akzeptieren ─────────
//
// Strategie (Web-Best-Practice, ohne ML):
//   1. Graustufen + Bilateral-Blur (Kanten-erhaltend, weniger Rauschen als Gauß)
//   2. Canny-Edges + Dilate (geschlossene Konturen)
//   3. Konturen → approxPolyDP → behalte nur 4-Eck-Polygone
//   4. Score = area × convexity × rectangularity
//   5. Plausibilität (Coverage, Seitenverhältnisse, Rechtwinkligkeit)
//
// Damit fallen Tischkanten/Schatten zuverlässig raus.
function detectPaperCorners(source: HTMLCanvasElement): Corners | null {
  const cv = window.cv;
  if (!cv) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let img: any, gray: any, blur: any, edges: any, dilated: any, kernel: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let contours: any, hierarchy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bestApprox: any = null;
  try {
    img = cv.imread(source);
    gray = new cv.Mat();
    cv.cvtColor(img, gray, cv.COLOR_RGBA2GRAY);
    blur = new cv.Mat();
    // Bilateral-Filter erhält Kanten besser als Gauß — wichtig für Papier auf Holz/Stoff.
    cv.bilateralFilter(gray, blur, 9, 75, 75, cv.BORDER_DEFAULT);
    edges = new cv.Mat();
    cv.Canny(blur, edges, 50, 150);
    // Dilate schließt Kantenlücken — sonst zerfallen echte 4-Ecke in Mini-Konturen.
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    dilated = new cv.Mat();
    cv.dilate(edges, dilated, kernel, new cv.Point(-1, -1), 1);

    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const totalArea = img.cols * img.rows;
    let bestScore = 0;

    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      const coverage = area / totalArea;
      if (coverage < 0.15 || coverage > 0.92) continue;

      const perim = cv.arcLength(c, true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const approx: any = new cv.Mat();
      cv.approxPolyDP(c, approx, 0.025 * perim, true);

      // Wir wollen ein echtes Quadrilateral — sonst weiter.
      if (approx.rows !== 4) {
        approx.delete();
        continue;
      }

      // Convexity-Check: ein Beleg ist konvex.
      const isConvex = cv.isContourConvex(approx);
      if (!isConvex) {
        approx.delete();
        continue;
      }

      // Rectangularity: Verhältnis Polygon-Fläche zu bounding-rect.
      const rect = cv.boundingRect(approx);
      const rectArea = rect.width * rect.height;
      const rectangularity = rectArea > 0 ? area / rectArea : 0;

      // Score: gewichteter Mix — größere, eckigere, „rechteckigere" Polygone gewinnen.
      const score = area * rectangularity;

      if (score > bestScore) {
        bestScore = score;
        if (bestApprox) bestApprox.delete();
        bestApprox = approx;
      } else {
        approx.delete();
      }
    }

    if (!bestApprox) return null;

    // approx ist ein Mat mit 4 Punkten in beliebiger Reihenfolge.
    // Wir sortieren sie zu tl/tr/br/bl anhand der Schwerpunkt-Lage.
    const raw: Point[] = [];
    for (let i = 0; i < 4; i++) {
      raw.push({
        x: bestApprox.data32S[i * 2],
        y: bestApprox.data32S[i * 2 + 1],
      });
    }
    const corners = orderCorners(raw);
    return isPlausiblePaper(corners, img.cols, img.rows) ? corners : null;
  } catch {
    return null;
  } finally {
    img?.delete();
    gray?.delete();
    blur?.delete();
    edges?.delete();
    dilated?.delete();
    kernel?.delete();
    contours?.delete();
    hierarchy?.delete();
    bestApprox?.delete();
  }
}

/**
 * Sortiert 4 Punkte in tl/tr/br/bl-Reihenfolge anhand des Schwerpunkts.
 * Ersetzt jscanify's getCornerPoints — wir bekommen die Punkte aus
 * approxPolyDP statt aus dem rohen Kontur-Buffer.
 */
function orderCorners(pts: Point[]): Corners {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  let tl = pts[0], tr = pts[0], br = pts[0], bl = pts[0];
  for (const p of pts) {
    if (p.x < cx && p.y < cy) tl = p;
    else if (p.x > cx && p.y < cy) tr = p;
    else if (p.x > cx && p.y > cy) br = p;
    else if (p.x < cx && p.y > cy) bl = p;
  }
  return { tl, tr, br, bl };
}

// ─── Geometrie-Helpers ───────────────────────────────────────────────────
type RenderedRect = { w: number; h: number; x: number; y: number };

/**
 * Berechnet den tatsächlich gerenderten Bildbereich innerhalb eines Containers
 * unter object-contain. Liefert Größe + Offset relativ zur Container-Box.
 */
function computeContainedRect(
  box: { w: number; h: number },
  naturalAspect: number,
): RenderedRect {
  const boxAspect = box.w / box.h;
  if (naturalAspect > boxAspect) {
    // Bild breiter — Letterbox oben/unten
    const w = box.w;
    const h = box.w / naturalAspect;
    return { w, h, x: 0, y: (box.h - h) / 2 };
  }
  // Bild höher — Letterbox links/rechts
  const h = box.h;
  const w = box.h * naturalAspect;
  return { w, h, x: (box.w - w) / 2, y: 0 };
}

function defaultCorners(w: number, h: number): Corners {
  const ix = w * 0.1;
  const iy = h * 0.1;
  return {
    tl: { x: ix,     y: iy },
    tr: { x: w - ix, y: iy },
    br: { x: w - ix, y: h - iy },
    bl: { x: ix,     y: h - iy },
  };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** EMA-Smoothing: alpha=0 = nur prev, alpha=1 = nur next. */
function emaPoint(prev: Point, next: Point, alpha: number): Point {
  return {
    x: prev.x * (1 - alpha) + next.x * alpha,
    y: prev.y * (1 - alpha) + next.y * alpha,
  };
}

/** Maximale Eck-Bewegung zwischen zwei Quadrilateralen, in Pixeln. */
function maxCornerMovement(a: Corners, b: Corners): number {
  return Math.max(
    dist(a.tl, b.tl),
    dist(a.tr, b.tr),
    dist(a.br, b.br),
    dist(a.bl, b.bl),
  );
}

function clamp(v: number, lo = 0, hi = 255): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Plausibility-Check — filtert offensichtlich unsinnige Konturen
 * (Tischkanten, ganze Frames, winzige Bereiche, zu schiefe Quads).
 */
function isPlausiblePaper(c: Corners, w: number, h: number): boolean {
  const topW = dist(c.tl, c.tr);
  const bottomW = dist(c.bl, c.br);
  const leftH = dist(c.tl, c.bl);
  const rightH = dist(c.tr, c.br);

  const avgW = (topW + bottomW) / 2;
  const avgH = (leftH + rightH) / 2;
  const coverage = (avgW * avgH) / (w * h);
  if (coverage < 0.15 || coverage > 0.92) return false;
  if (Math.min(topW, bottomW) / Math.max(topW, bottomW) < 0.5) return false;
  if (Math.min(leftH, rightH) / Math.max(leftH, rightH) < 0.5) return false;
  return true;
}
