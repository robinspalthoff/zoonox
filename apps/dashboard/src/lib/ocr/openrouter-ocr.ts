/**
 * OCR extraction via OpenRouter (free tier / any vision model).
 *
 * Uses a vision-capable model to extract structured data from document images.
 * Primary model: nvidia/nemotron-nano-12b-v2-vl:free  (free tier on OpenRouter)
 *
 * Supports multiple images per request — used for multi-page PDFs where pages
 * 1-2 are sent together so the model can find totals/due dates across pages.
 *
 * Environment variables required:
 *   OPENROUTER_API_KEY   — your OpenRouter API key
 *   OPENROUTER_MODEL     — optional model override
 */

import { EXTRACTION_PROMPT, bufferToDataUrl, normalizeOcrResult } from "./ocr-shared";
export type { OcrResult } from "./ocr-shared";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "nvidia/nemotron-nano-12b-v2-vl:free";

export async function extractDocumentData(
  fileBuffers: Buffer | Buffer[],
  mimeType: string
) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is not set.");
  }

  const model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
  const bufferArray = Array.isArray(fileBuffers) ? fileBuffers : [fileBuffers];
  const imageContent = bufferArray.map((buf) => ({
    type: "image_url" as const,
    image_url: { url: bufferToDataUrl(buf, mimeType) },
  }));

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://example.com",
      "X-Title": "Zoonox",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACTION_PROMPT },
            ...imageContent,
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${error}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Empty response from OpenRouter.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
  } catch {
    throw new Error(`Failed to parse OCR JSON response: ${content}`);
  }

  return normalizeOcrResult(parsed);
}
