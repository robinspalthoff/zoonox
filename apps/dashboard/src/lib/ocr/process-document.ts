/**
 * Background OCR processor for a single document.
 *
 * Provider selection (automatic):
 *   - MISTRAL_API_KEY set  → Mistral OCR (mistral-ocr-latest)
 *     PDFs processed natively — no image conversion needed.
 *     Multi-page support is built into the Mistral OCR API.
 *
 *   - MISTRAL_API_KEY not set → OpenRouter vision model (free tier)
 *     PDFs are converted to PNG images (pages 1-2) before sending,
 *     because vision models require image input.
 *
 * Call this from the upload API route AFTER creating the DB record.
 * It runs fire-and-forget via `void processDocument(id)` — no awaiting.
 */

import { db } from "@/lib/db";
import { extractDocumentData } from "./openrouter-ocr";
import { extractDocumentDataWithMistral } from "./mistral-ocr";
import { pdfPagesToImages } from "./pdf-to-image";
import { storage } from "@/lib/storage";
import { toDocumentCategory, inferDocumentType } from "./ocr-shared";
import { detectInputVatKind } from "./reverse-charge";
import { statusAfterOcr } from "./status";
import { computeFingerprint } from "@/lib/documents/fingerprint";

/**
 * Merge-Strategie für die Übernahme der OCR-Ergebnisse in den Document-Record.
 *  - "overwrite"  (Default): bestehende Werte werden überschrieben — passt für
 *    den frischen Upload und für manuelles Re-OCR via /api/documents/[id]/ocr.
 *  - "fill-empty": nur leere Felder werden ausgefüllt. Wird vom Nachreich-Flow
 *    (POST /api/documents/[id]/attach) genutzt: der User hat manuell Werte
 *    eingetragen und reicht später den Beleg nach — OCR darf seine Eingaben
 *    nicht überschreiben.
 */
export type OcrMergeStrategy = "overwrite" | "fill-empty";

export async function processDocument(
  documentId: string,
  options: { mergeStrategy?: OcrMergeStrategy } = {},
): Promise<void> {
  const mergeStrategy: OcrMergeStrategy = options.mergeStrategy ?? "overwrite";

  await db.document.update({
    where: { id: documentId },
    data: { status: "PROCESSING" },
  });

  try {
    const doc = await db.document.findUnique({
      where: { id: documentId },
      select: {
        storagePath: true,
        fileType: true,
        // Für "fill-empty": vorhandene manuelle Werte einlesen.
        recognizedSupplier: true,
        recognizedDocNumber: true,
        recognizedDate: true,
        recognizedDueDate: true,
        deliveryDate: true,
        recognizedAmount: true,
        recognizedVatRate: true,
        recognizedDescription: true,
        suggestedCategory: true,
        category: true,
        bookingAccount: true,
        documentType: true,
        vatRate: true,
        inputVatKind: true,
        status: true,
      },
    });

    if (!doc) throw new Error(`Document ${documentId} not found.`);

    const fileBuffer = await storage.get(doc.storagePath);
    if (!fileBuffer) {
      throw new Error(`Document ${documentId} file missing in storage.`);
    }

    let result;

    if (process.env.MISTRAL_API_KEY) {
      result = await extractDocumentDataWithMistral(fileBuffer, doc.fileType);
    } else {
      let ocrBuffers: Buffer | Buffer[];
      let ocrMimeType: string;

      if (doc.fileType === "application/pdf") {
        ocrBuffers  = pdfPagesToImages(fileBuffer, 2);
        ocrMimeType = "image/png";
      } else {
        ocrBuffers  = fileBuffer;
        ocrMimeType = doc.fileType;
      }

      result = await extractDocumentData(ocrBuffers, ocrMimeType);
    }

    const suggestedCategory = toDocumentCategory(result.category);
    const documentType      = inferDocumentType(result.category);

    // Im "fill-empty"-Modus übernimmt nur, was im Document noch leer ist.
    // Im "overwrite"-Modus (Default) immer übernehmen.
    const keep = mergeStrategy === "fill-empty";
    const empty = (v: unknown) => v === null || v === undefined || v === "";

    // Endgültige Werte für den Fingerprint vorab bestimmen — sie hängen von
    // der Merge-Strategie ab (manuelle Eingaben dürfen im fill-empty-Modus
    // nicht überschrieben werden). Der Fingerprint muss diese finalen Werte
    // hashen, nicht die rohen OCR-Resultate.
    const finalSupplier =
      !keep || empty(doc.recognizedSupplier) ? result.supplierName : doc.recognizedSupplier;
    const finalDate =
      !keep || empty(doc.recognizedDate)
        ? result.documentDate
          ? new Date(result.documentDate)
          : null
        : doc.recognizedDate;
    const finalAmount =
      !keep || empty(doc.recognizedAmount) ? result.totalAmount ?? null : doc.recognizedAmount;
    const fingerprint = computeFingerprint({
      vendor: finalSupplier,
      amount: finalAmount as number | string | null,
      date: finalDate,
    });

    // Steuerschuldumkehr aus dem Belegtext ableiten. Regelbasiert, damit die
    // Einstufung nachvollziehbar bleibt — sie entscheidet, in welche Kennzahl
    // der Voranmeldung der Beleg fließt. Erkennt die Regel nichts, bleibt es
    // beim Regelfall (Vorsteuer nach Kz 66).
    const detectedInputVat = detectInputVatKind(result.rawText);
    if (detectedInputVat) {
      console.log(
        `[OCR] Steuerschuldumkehr erkannt für ${documentId}: ${detectedInputVat.kind} ` +
          `(${detectedInputVat.evidence.join(", ")})`,
      );
    }

    await db.document.update({
      where: { id: documentId },
      data: {
        // Nach der Texterkennung ist der Beleg in Bearbeitung, nicht fertig —
        // der Nutzer muss die erkannten Werte noch prüfen. Siehe ./status.ts.
        status:              statusAfterOcr(doc.status),
        // OCR-Roh-Felder sind systemtechnisch und werden auch im fill-empty-
        // Modus aktualisiert (User editiert die nicht direkt).
        ocrText:             result.rawText,
        ocrConfidence:       result.confidence,
        ocrCompletedAt:      new Date(),
        fingerprint,

        ...(!keep || empty(doc.recognizedSupplier)
          ? { recognizedSupplier: result.supplierName } : {}),
        ...(!keep || empty(doc.recognizedDocNumber)
          ? { recognizedDocNumber: result.documentNumber } : {}),
        ...(!keep || empty(doc.recognizedDate)
          ? { recognizedDate: result.documentDate ? new Date(result.documentDate) : null } : {}),
        ...(!keep || empty(doc.recognizedDueDate)
          ? { recognizedDueDate: result.dueDate ? new Date(result.dueDate) : null } : {}),
        ...(!keep || empty(doc.deliveryDate)
          ? {
              deliveryDate: result.deliveryDate
                ? new Date(result.deliveryDate)
                : result.documentDate
                  ? new Date(result.documentDate)
                  : null,
            }
          : {}),
        ...(!keep || empty(doc.recognizedAmount)
          ? { recognizedAmount: result.totalAmount ?? undefined } : {}),
        ...(!keep || empty(doc.recognizedVatRate)
          ? { recognizedVatRate: result.vatRate ?? undefined } : {}),
        ...(!keep || empty(doc.recognizedDescription)
          ? { recognizedDescription: result.description ?? undefined } : {}),
        ...(!keep || empty(doc.suggestedCategory)
          ? { suggestedCategory } : {}),
        ...(suggestedCategory && (!keep || empty(doc.category) || doc.category === "OTHER")
          ? { category: suggestedCategory } : {}),
        ...(documentType && (!keep || empty(doc.documentType))
          ? { documentType } : {}),
        ...(result.bookingAccount && (!keep || empty(doc.bookingAccount))
          ? { bookingAccount: result.bookingAccount } : {}),
        ...(result.vatRate != null && (!keep || empty(doc.vatRate))
          ? { vatRate: result.vatRate } : {}),
        // Nur setzen, wenn erkannt UND der Nutzer nichts eingetragen hat. Eine
        // manuelle Einstufung darf die Regel nie überschreiben.
        ...(detectedInputVat && (!keep || empty(doc.inputVatKind))
          ? { inputVatKind: detectedInputVat.kind } : {}),
      },
    });
  } catch (err) {
    console.error(`[OCR] Processing failed for document ${documentId}:`, err);

    await db.document.update({
      where: { id: documentId },
      data: { status: "FAILED" },
    });
  }
}