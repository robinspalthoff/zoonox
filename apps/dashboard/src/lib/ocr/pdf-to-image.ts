/**
 * Converts PDF pages to PNG image buffers using mupdf (WASM).
 *
 * Vision models (OpenRouter) cannot process raw PDF files — they need image input.
 * We render pages 1-2 by default because most invoices have totals on page 1 or 2.
 */

import * as mupdf from "mupdf";

/**
 * Render a single PDF page to a PNG image.
 * @param pdfBuffer  The raw PDF file bytes
 * @param pageIndex  Zero-based page index (default 0 = first page)
 * @param dpi        Resolution (default 200)
 * @returns          PNG image buffer
 */
export function pdfPageToImage(pdfBuffer: Buffer, pageIndex = 0, dpi = 200): Buffer {
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");

  const page = doc.loadPage(pageIndex);
  const scale = dpi / 72;
  const matrix = mupdf.Matrix.scale(scale, scale);

  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
  const pngBytes = pixmap.asPNG();

  return Buffer.from(pngBytes);
}

/**
 * Render the first N pages of a PDF to PNG images.
 * Useful for multi-page invoices where totals may appear on page 2.
 *
 * @param pdfBuffer  The raw PDF file bytes
 * @param maxPages   Maximum number of pages to render (default 2)
 * @param dpi        Resolution (default 200)
 * @returns          Array of PNG image buffers (one per rendered page)
 */
export function pdfPagesToImages(pdfBuffer: Buffer, maxPages = 2, dpi = 200): Buffer[] {
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  const pageCount = doc.countPages();
  const pagesToRender = Math.min(pageCount, maxPages);

  const images: Buffer[] = [];

  for (let i = 0; i < pagesToRender; i++) {
    const page = doc.loadPage(i);
    const scale = dpi / 72;
    const matrix = mupdf.Matrix.scale(scale, scale);

    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
    const pngBytes = pixmap.asPNG();
    images.push(Buffer.from(pngBytes));
  }

  return images;
}
