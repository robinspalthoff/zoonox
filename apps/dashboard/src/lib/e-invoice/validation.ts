/**
 * E-Invoice Pre-Flight Validation
 *
 * Checks all required EN 16931 Business Terms before generating XML.
 * Shows missing fields as UI errors so the user can fix them before sending.
 *
 * Required fields vary by invoice type:
 *  - B2B (regular): seller VAT ID or tax number, buyer name & address
 *  - B2G (public authority): additionally requires Leitweg-ID (BT-10)
 */

import type {
  EInvoiceGeneratorInput,
  EInvoiceValidationError,
  EInvoiceValidationResult,
} from "./types";

export function validateForEInvoice(
  input: EInvoiceGeneratorInput,
  requireLeitwegId = false
): EInvoiceValidationResult {
  const { invoice, settings } = input;
  const { contact: client } = invoice;
  const errors: EInvoiceValidationError[] = [];

  // ── Seller (Company Settings) ─────────────────────────────────────────────

  if (!settings.name?.trim()) {
    errors.push({
      field: "settings.name",
      message: "Firmenname fehlt in den Einstellungen.",
      bt: "BT-27",
      severity: "error",
    });
  }

  if (!settings.address?.trim()) {
    errors.push({
      field: "settings.address",
      message: "Firmenadresse fehlt in den Einstellungen.",
      bt: "BT-35",
      severity: "error",
    });
  }

  if (!settings.zip?.trim()) {
    errors.push({
      field: "settings.zip",
      message: "PLZ fehlt in den Einstellungen.",
      bt: "BT-38",
      severity: "error",
    });
  }

  if (!settings.city?.trim()) {
    errors.push({
      field: "settings.city",
      message: "Ort fehlt in den Einstellungen.",
      bt: "BT-37",
      severity: "error",
    });
  }

  // Seller must have either VAT ID (BT-31) or tax number (BT-32) — §14 UStG
  if (!settings.vatId?.trim() && !settings.taxId?.trim()) {
    errors.push({
      field: "settings.vatId",
      message:
        "USt-IdNr. oder Steuernummer fehlt in den Einstellungen (§14 UStG Pflicht).",
      bt: "BT-31/BT-32",
      severity: "error",
    });
  }

  // ── Buyer (Client) ────────────────────────────────────────────────────────

  if (!client.name?.trim()) {
    errors.push({
      field: "client.name",
      message: "Kundenname fehlt.",
      bt: "BT-44",
      severity: "error",
    });
  }

  if (!client.address?.trim()) {
    errors.push({
      field: "client.address",
      message: "Kundenadresse fehlt.",
      bt: "BT-50",
      severity: "warning",
    });
  }

  if (!client.zip?.trim()) {
    errors.push({
      field: "client.zip",
      message: "Kunden-PLZ fehlt.",
      bt: "BT-53",
      severity: "warning",
    });
  }

  if (!client.city?.trim()) {
    errors.push({
      field: "client.city",
      message: "Kunden-Ort fehlt.",
      bt: "BT-52",
      severity: "warning",
    });
  }

  // ── Invoice Document ──────────────────────────────────────────────────────

  if (!invoice.issueDate) {
    errors.push({
      field: "invoice.issueDate",
      message: "Rechnungsdatum fehlt.",
      bt: "BT-2",
      severity: "error",
    });
  }

  if (invoice.lineItems.length === 0) {
    errors.push({
      field: "invoice.lineItems",
      message: "Mindestens eine Rechnungsposition ist erforderlich.",
      bt: "BG-25",
      severity: "error",
    });
  }

  // All line items must have a description
  invoice.lineItems.forEach((item, i) => {
    if (!item.description?.trim()) {
      errors.push({
        field: `lineItems[${i}].description`,
        message: `Position ${i + 1}: Beschreibung fehlt.`,
        bt: "BT-153",
        severity: "error",
      });
    }
  });

  // ── B2G: Leitweg-ID required for public authorities ───────────────────────

  if (requireLeitwegId && !invoice.leitwegId?.trim()) {
    errors.push({
      field: "invoice.leitwegId",
      message:
        "Leitweg-ID fehlt. Diese ist für Rechnungen an Behörden (B2G) Pflicht.",
      bt: "BT-10",
      severity: "error",
    });
  }

  const hasBlockingErrors = errors.some((e) => e.severity === "error");

  return {
    valid: !hasBlockingErrors,
    errors,
  };
}
