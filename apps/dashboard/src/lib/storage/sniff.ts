// Server-side content-type detection from magic bytes.
//
// The browser-supplied File.type header is client-controlled — a malicious
// or simply mislabelled upload could carry an arbitrary payload behind an
// "application/pdf" header. We therefore inspect the actual leading bytes
// and treat the sniffed result as authoritative, both for the accept-check
// and for the fileType persisted on the Document row.

export type SniffedType = "application/pdf" | "image/png" | "image/jpeg";

/**
 * Detect the content type of `buf` from its magic bytes. Returns null for
 * anything that is not one of the supported upload formats.
 */
export function sniffContentType(buf: Buffer): SniffedType | null {
  // PDF — "%PDF-"
  if (buf.length >= 5 && buf.toString("latin1", 0, 5) === "%PDF-") {
    return "application/pdf";
  }
  // PNG — 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG — FF D8 FF
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return "image/jpeg";
  }
  return null;
}
