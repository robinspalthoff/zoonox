/**
 * E-Invoice Module — Public API
 *
 * Entry point for XRechnung / ZUGFeRD generation.
 *
 * Usage:
 *   import { generateEInvoice, validateForEInvoice } from "@/lib/e-invoice";
 *
 *   const validation = validateForEInvoice({ invoice, settings });
 *   if (!validation.valid) throw new Error("Missing required fields");
 *
 *   // ZUGFeRD hybrid PDF (B2B):
 *   const { xml, pdf } = await generateEInvoice({ invoice, settings }, pdfBuffer);
 *
 *   // XRechnung XML only (B2G):
 *   const { xml } = await generateEInvoice({ invoice, settings }, undefined, "XRECHNUNG");
 */

export { validateForEInvoice } from "./validation";
export { generateZugferdXml } from "./zugferd-xml";
export { generateXrechnungXml } from "./xrechnung-xml";
export { embedZugferdXml } from "./pdf-embed";
export {
  validateWithKosit,
  validateAndSummarize,
  isValidatorAvailable,
} from "./kosit-validator";
export type {
  KositValidationResult,
  KositValidationMessage,
} from "./kosit-validator";
export type {
  EInvoiceFormat,
  EInvoiceGeneratorInput,
  EInvoiceValidationResult,
  EInvoiceValidationError,
  TaxGroup,
  ZugferdProfile,
} from "./types";

// ─── Convenience orchestrator ─────────────────────────────────────────────────

import { generateZugferdXml } from "./zugferd-xml";
import { generateXrechnungXml } from "./xrechnung-xml";
import { embedZugferdXml } from "./pdf-embed";
import type { EInvoiceFormat, EInvoiceGeneratorInput } from "./types";

export interface GenerateEInvoiceResult {
  /** The XML string (factur-x.xml or XRechnung UBL) */
  xml: string;
  /** ZUGFeRD hybrid PDF buffer (only when format=ZUGFERD and pdfBuffer provided) */
  pdf?: Buffer;
  /** Detected format used */
  format: EInvoiceFormat;
}

/**
 * Generate an e-invoice XML (and optionally embed it into the PDF).
 *
 * @param input      - Invoice data + company settings
 * @param pdfBuffer  - Existing PDF buffer from @react-pdf/renderer (for ZUGFeRD embedding)
 * @param format     - "ZUGFERD" (default, B2B hybrid) or "XRECHNUNG" (B2G UBL only)
 */
export async function generateEInvoice(
  input: EInvoiceGeneratorInput,
  pdfBuffer?: Buffer,
  format: EInvoiceFormat = "ZUGFERD"
): Promise<GenerateEInvoiceResult> {
  if (format === "XRECHNUNG") {
    const xml = generateXrechnungXml(input);
    return { xml, format };
  }

  // Default: ZUGFeRD
  const xml = generateZugferdXml(input);

  if (pdfBuffer) {
    const pdf = await embedZugferdXml(pdfBuffer, xml);
    return { xml, pdf, format };
  }

  return { xml, format };
}
