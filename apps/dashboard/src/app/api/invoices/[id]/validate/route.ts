/**
 * POST /api/invoices/[id]/validate
 *
 * Validates the e-invoice XML for a given invoice against the KOSIT validator.
 * Returns structured validation results with Schematron rule violations.
 *
 * Used by:
 *  - The "Review & Send" flow to validate before sending
 *  - The invoice detail page to show validation status
 *  - CI/CD pipeline for regression testing
 *
 * Auth: Required (session cookie)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantOrThrow } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import {
  generateZugferdXml,
  generateXrechnungXml,
  validateForEInvoice,
  validateWithKosit,
  isValidatorAvailable,
} from "@/lib/e-invoice";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let t;
  try {
    t = await requireTenantOrThrow();
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;

  const formatParam = req.nextUrl.searchParams.get("format")?.toUpperCase();
  const format = formatParam === "XRECHNUNG" ? "XRECHNUNG" : "ZUGFERD";

  const [invoice, settings] = await Promise.all([
    db.invoice.findFirst({
      where: { id, tenantId: t.tenantId },
      include: {
        contact: true,
        lineItems: { orderBy: { position: "asc" } },
        creditNoteFor: { select: { number: true, issueDate: true } },
      },
    }),
    db.companySettings.findUnique({ where: { tenantId: t.tenantId } }),
  ]);

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  if (!settings) {
    return NextResponse.json(
      { error: "Company settings missing." },
      { status: 422 }
    );
  }

  // ── Pre-flight field validation ──────────────────────────────────────────────
  const fieldValidation = validateForEInvoice(
    { invoice, settings },
    format === "XRECHNUNG"
  );

  if (!fieldValidation.valid) {
    return NextResponse.json({
      valid: false,
      stage: "field_validation",
      errors: fieldValidation.errors.filter((e) => e.severity === "error"),
      warnings: fieldValidation.errors.filter((e) => e.severity === "warning"),
    });
  }

  // ── Check validator availability ─────────────────────────────────────────────
  const available = await isValidatorAvailable();
  if (!available) {
    return NextResponse.json({
      valid: true,
      stage: "skipped",
      message: "KOSIT validator service is not available. Field validation passed.",
      warnings: [{
        severity: "warning",
        ruleId: null,
        message: "Schematron validation was skipped because the KOSIT service is unavailable.",
      }],
    });
  }

  // ── Generate XML ─────────────────────────────────────────────────────────────
  let xml: string;
  try {
    xml = format === "XRECHNUNG"
      ? generateXrechnungXml({ invoice, settings })
      : generateZugferdXml({ invoice, settings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { valid: false, stage: "xml_generation", error: message },
      { status: 500 }
    );
  }

  // ── KOSIT Schematron validation ──────────────────────────────────────────────
  const result = await validateWithKosit(xml, format);

  return NextResponse.json({
    valid: result.valid,
    stage: "kosit_validation",
    assessment: result.assessment,
    errors: result.errors,
    warnings: result.warnings,
    durationMs: result.durationMs,
    format,
    invoiceNumber: invoice.number,
  });
}
