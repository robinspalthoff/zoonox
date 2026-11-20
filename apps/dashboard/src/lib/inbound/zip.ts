import JSZip from "jszip";
import { UPLOAD_MAX_FILE_SIZE } from "@/lib/documents/create-from-upload";

// Sicherheitslimits gegen Zip-Bombs / Ressourcen-Erschöpfung.
const MAX_ENTRIES = 20;
const MAX_TOTAL_UNCOMPRESSED = 25 * 1024 * 1024; // 25 MB über alle Einträge

const ACCEPTED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg"];

const ZIP_CONTENT_TYPES = [
  "application/zip",
  "application/x-zip-compressed",
  "multipart/x-zip",
];

export function isZipAttachment(name: string, contentType: string): boolean {
  if (ZIP_CONTENT_TYPES.includes(contentType.toLowerCase())) return true;
  return name.toLowerCase().endsWith(".zip");
}

export type ExtractedFile = {
  fileName: string;
  buffer: Buffer;
};

/**
 * Entpackt ein ZIP-Archiv und liefert die enthaltenen Belegdateien (PDF/PNG/JPG).
 * Verzeichnisse, andere Dateitypen und alles jenseits der Sicherheitslimits
 * werden übersprungen. Wirft nie — bei kaputtem Archiv kommt eine leere Liste.
 */
export async function extractZip(buffer: Buffer): Promise<ExtractedFile[]> {
  const out: ExtractedFile[] = [];
  let total = 0;
  try {
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.values(zip.files).filter((f) => !f.dir);

    let processed = 0;
    for (const entry of entries) {
      if (processed >= MAX_ENTRIES) break;
      processed++;

      const baseName = entry.name.split("/").pop() ?? entry.name;
      const lower = baseName.toLowerCase();
      if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue;

      const content = await entry.async("nodebuffer");
      if (content.length === 0 || content.length > UPLOAD_MAX_FILE_SIZE) continue;

      total += content.length;
      if (total > MAX_TOTAL_UNCOMPRESSED) break;

      out.push({ fileName: baseName, buffer: content });
    }
  } catch (err) {
    console.error("[inbound] zip extraction failed:", err);
  }
  return out;
}
