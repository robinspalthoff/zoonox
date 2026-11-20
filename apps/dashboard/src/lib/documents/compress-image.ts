// Client-Side Bildkompression. iPhone-Fotos sind im Original 3–5 MB —
// für OCR reichen ~2000 px lange Kante / JPEG-Qualität 0.85 völlig aus
// und reduzieren auf ~500 KB. PDFs und sehr kleine Bilder werden
// unverändert durchgereicht.

const MAX_EDGE = 2000;
const QUALITY = 0.85;
// Bilder unter dieser Größe schon klein genug → keine Kompression.
const SKIP_BELOW_BYTES = 500 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Bild konnte nicht geladen werden."));
    };
    img.src = url;
  });
}

export async function compressIfImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= SKIP_BELOW_BYTES) return file;

  try {
    const img = await loadImage(file);
    const longEdge = Math.max(img.width, img.height);
    const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    const base = file.name.replace(/\.[^./\\]+$/, "");
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
