// EPC QR-Code ("GiroCode") generation for invoice PDFs.
//
// The EPC QR-Code is the European Payments Council standard for encoding a
// SEPA credit transfer into a QR-Code. A customer scans it with their banking
// app and gets a pre-filled transfer (recipient, IBAN, amount, reference).
//
// Spec reference: EPC069-12 "Quick Response Code — Guidelines to Enable the
// Data Capture for the Initiation of a SEPA Credit Transfer".

import QRCode from "qrcode";

export interface EpcQrInput {
  /** Beneficiary (the invoice issuer) — shown to the payer in their app. */
  beneficiaryName: string | null | undefined;
  iban: string | null | undefined;
  /** Optional in EPC version 002 for SEPA-internal transfers. */
  bic: string | null | undefined;
  /** Invoice gross total in EUR. */
  amount: number;
  /** Unstructured remittance info — e.g. the invoice number. */
  remittance: string;
}

/**
 * Build the EPC QR-Code payload string. Returns `null` when mandatory data is
 * missing or the amount is outside the SEPA credit-transfer range — the caller
 * then simply omits the QR-Code from the document.
 */
export function buildEpcQrPayload(input: EpcQrInput): string | null {
  const name = input.beneficiaryName?.trim();
  const iban = input.iban?.replace(/\s+/g, "").toUpperCase();
  if (!name || !iban) return null;
  // EPC allows amounts from 0.01 to 999,999,999.99 EUR.
  if (!(input.amount >= 0.01 && input.amount <= 999_999_999.99)) return null;

  const bic = input.bic?.replace(/\s+/g, "").toUpperCase() ?? "";

  // Field order is fixed by the spec. Lengths: name ≤ 70, remittance ≤ 140.
  const lines = [
    "BCD",                            // Service Tag
    "002",                            // Version
    "1",                              // Character set (1 = UTF-8)
    "SCT",                            // Identification (SEPA Credit Transfer)
    bic,                              // BIC of the beneficiary bank
    name.slice(0, 70),                // Beneficiary name
    iban,                             // Beneficiary account (IBAN)
    `EUR${input.amount.toFixed(2)}`,  // Amount
    "",                               // Purpose code (unused)
    "",                               // Structured creditor reference (unused)
    input.remittance.trim().slice(0, 140), // Unstructured remittance info
  ];
  const payload = lines.join("\n");

  // The spec caps the total payload at 331 bytes. TextEncoder (not Buffer)
  // keeps this helper usable in the browser bundle too — the invoice preview
  // renders the QR-Code client-side.
  if (new TextEncoder().encode(payload).length > 331) return null;
  return payload;
}

export interface EpcQrSvg {
  /** SVG path data covering every dark module. */
  path: string;
  /** SVG viewBox including the mandatory 4-module quiet zone. */
  viewBox: string;
}

/**
 * Build an SVG path for the EPC QR-Code of the given invoice data. Returns
 * `null` when the payload cannot be built (see {@link buildEpcQrPayload}).
 *
 * Synchronous on purpose so it can be called directly inside the PDF
 * React component without any async plumbing.
 */
export function buildEpcQrSvg(input: EpcQrInput): EpcQrSvg | null {
  const payload = buildEpcQrPayload(input);
  if (!payload) return null;

  // Error-correction level "M" is mandated by the EPC standard.
  const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const QUIET = 4; // mandatory quiet zone, in modules

  // Emit one rect per horizontal run of dark modules — keeps the path short.
  let path = "";
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (qr.modules.get(row, col)) {
        let run = 1;
        while (col + run < size && qr.modules.get(row, col + run)) run++;
        path += `M${col + QUIET} ${row + QUIET}h${run}v1h-${run}z`;
        col += run;
      } else {
        col++;
      }
    }
  }

  const total = size + QUIET * 2;
  return { path, viewBox: `0 0 ${total} ${total}` };
}
