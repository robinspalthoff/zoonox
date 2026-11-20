"use client";

import { useState } from "react";
import { ArrowLeft, Download, FileText, ZoomIn, ZoomOut } from "lucide-react";
import { Link } from "@/i18n/navigation";

const ZOOM_STEPS = [50, 75, 90, 100, 125, 150];

export function InvoicePreviewPanel({
  invoiceNumber,
  pdfUrl,
  backHref = "/dashboard/invoices",
  downloadLabel = "Herunterladen",
  children,
}: {
  invoiceNumber: string;
  pdfUrl: string;
  /** Where the back arrow points. Defaults to the invoice list — quote/AB
   *  detail pages pass their own list path here. */
  backHref?:
    | "/dashboard/invoices"
    | "/dashboard/quotes"
    | "/dashboard/order-confirmations";
  downloadLabel?: string;
  children: React.ReactNode;
}) {
  const [zoomIndex, setZoomIndex] = useState(2); // default 90%
  const zoom = ZOOM_STEPS[zoomIndex];

  return (
    <div className="flex-1 flex flex-col min-w-0" >
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-card/90 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2.5">
          <Link
            href={backHref}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-px h-4 bg-border" />
          <FileText className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{invoiceNumber}.pdf</span>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setZoomIndex(i => Math.max(0, i - 1))}
            disabled={zoomIndex === 0}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30"
            title="Verkleinern"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-medium text-muted-foreground tabular-nums w-10 text-center">
            {zoom} %
          </span>
          <button
            onClick={() => setZoomIndex(i => Math.min(ZOOM_STEPS.length - 1, i + 1))}
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30"
            title="Vergrößern"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        <a
          href={pdfUrl}
          download={`${invoiceNumber}.pdf`}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-muted hover:bg-accent text-foreground transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          {downloadLabel}
        </a>
      </div>

      {/* ── Scrollable canvas ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <div className="p-8 pb-12 flex justify-center">
          {/* zoom via CSS zoom property — affects layout unlike transform:scale */}
          <div style={{ zoom: zoom / 100, width: "595px", flexShrink: 0 }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
