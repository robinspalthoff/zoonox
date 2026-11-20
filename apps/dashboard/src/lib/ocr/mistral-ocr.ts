/**
 * OCR extraction via Mistral AI (mistral-ocr-latest).
 *
 * Two-step approach:
 *   1. Call the Mistral OCR endpoint (/v1/ocr) to extract structured markdown
 *      from the document — supports PDFs natively, no image conversion needed.
 *   2. Call Mistral chat completions to parse the markdown into a structured
 *      OcrResult JSON (same interface as the OpenRouter implementation).
 *
 * Advantages over the OpenRouter vision approach:
 *   - PDF pages processed natively (no mupdf conversion needed)
 *   - Dedicated OCR model with higher accuracy on scanned documents
 *   - Multi-page PDFs handled in a single API call
 *
 * Environment variables required:
 *   MISTRAL_API_KEY   — your Mistral API key
 */

import { EXTRACTION_PROMPT, bufferToDataUrl, normalizeOcrResult } from "./ocr-shared";
import type { OcrResult } from "./ocr-shared";

const MISTRAL_OCR_URL  = "https://api.mistral.ai/v1/ocr";
const MISTRAL_CHAT_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_OCR_MODEL  = "mistral-ocr-latest";
const MISTRAL_CHAT_MODEL = "mistral-small-latest";

async function extractTextWithMistralOcr(
  buffer: Buffer,
  mimeType: string,
  apiKey: string
): Promise<string> {
  const response = await fetch(MISTRAL_OCR_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MISTRAL_OCR_MODEL,
      document: {
        type: "document_url",
        document_url: bufferToDataUrl(buffer, mimeType),
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Mistral OCR API error ${response.status}: ${error}`);
  }

  const data = await response.json();
  const pages: Array<{ index: number; markdown: string }> = data.pages ?? [];
  if (pages.length === 0) {
    throw new Error("Mistral OCR returned no pages.");
  }

  return pages
    .sort((a, b) => a.index - b.index)
    .map((p) => p.markdown)
    .join("\n\n---\n\n");
}

async function parseOcrText(ocrText: string, apiKey: string): Promise<OcrResult> {
  const userMessage = `${EXTRACTION_PROMPT}\n\n---\nDOCUMENT TEXT:\n${ocrText}`;

  const response = await fetch(MISTRAL_CHAT_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MISTRAL_CHAT_MODEL,
      messages: [{ role: "user", content: userMessage }],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Mistral chat API error ${response.status}: ${error}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Empty response from Mistral chat.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
  } catch {
    throw new Error(`Failed to parse Mistral JSON response: ${content}`);
  }

  return normalizeOcrResult(parsed, ocrText);
}

export async function extractDocumentDataWithMistral(
  fileBuffer: Buffer,
  mimeType: string
): Promise<OcrResult> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY environment variable is not set.");
  }

  const ocrText = await extractTextWithMistralOcr(fileBuffer, mimeType, apiKey);
  return parseOcrText(ocrText, apiKey);
}
