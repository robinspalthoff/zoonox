/**
 * E-Invoice Validation Test Script
 *
 * Generates sample invoices covering all VAT regulation scenarios,
 * then validates each against the KOSIT validator service.
 *
 * Run manually:   KOSIT_VALIDATOR_URL=http://localhost:8282 npx tsx tests/e-invoice/validate-samples.ts
 * Run in CI/CD:   Called by .github/workflows/einvoice-validation.yml
 *
 * Exit code 0 = all valid, 1 = at least one failure
 */

import { generateZugferdXml } from "../../src/lib/e-invoice/zugferd-xml";
import { generateXrechnungXml } from "../../src/lib/e-invoice/xrechnung-xml";
import { validateWithKosit, isValidatorAvailable } from "../../src/lib/e-invoice/kosit-validator";
import type { EInvoiceGeneratorInput } from "../../src/lib/e-invoice/types";
import * as fs from "fs";
import * as path from "path";

// ─── Sample Data ──────────────────────────────────────────────────────────────

const SAMPLE_SETTINGS = {
  id: "singleton",
  name: "Example GmbH",
  ownerName: null,
  legalForm: "GmbH",
  address: "Musterstraße 1",
  city: "Berlin",
  zip: "10115",
  country: "DE",
  email: "info@example.com",
  senderEmail: "invoices@example.com",
  senderName: "Example GmbH Accounting",
  phone: "+49 30 12345678",
  website: "https://example.com",
  taxId: "27/123/45678",
  vatId: "DE123456789",
  managingDirector: "Max Mustermann",
  bankName: "Deutsche Kreditbank",
  iban: "DE89 3704 0044 0532 0130 00",
  bic: "DEUTDEDB",
  logoBase64: null,
  invoicePrefix: "RE",
  defaultNotes: null,
  defaultIntroText: null,
  updatedAt: new Date(),
} as any;

const SAMPLE_CLIENT = {
  id: "client-1",
  name: "Muster GmbH",
  contactName: "Erika Mustermann",
  address: "Hauptstraße 42",
  city: "München",
  zip: "80331",
  country: "DE",
  email: "rechnung@muster-gmbh.de",
  phone: "+49 89 9876543",
  vatId: "DE987654321",
  notes: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const SAMPLE_LINE_ITEMS = [
  {
    id: "item-1",
    invoiceId: "inv-1",
    position: 1,
    description: "Software Development Services",
    quantity: 40,
    unit: "Std.",
    unitPrice: 120,
    vatRate: 19,
    amount: 4800,
  },
  {
    id: "item-2",
    invoiceId: "inv-1",
    position: 2,
    description: "Project Management",
    quantity: 10,
    unit: "Std.",
    unitPrice: 95,
    vatRate: 19,
    amount: 950,
  },
];

function buildSampleInvoice(overrides: Partial<any> = {}): EInvoiceGeneratorInput {
  const subtotal = SAMPLE_LINE_ITEMS.reduce((s, i) => s + i.amount, 0);
  const taxAmount = SAMPLE_LINE_ITEMS.reduce((s, i) => s + i.amount * (i.vatRate / 100), 0);

  return {
    invoice: {
      id: "inv-test-1",
      number: "RE-2026-001",
      type: "INVOICE",
      status: "DRAFT",
      clientId: SAMPLE_CLIENT.id,
      client: SAMPLE_CLIENT,
      issueDate: new Date("2026-04-08"),
      dueDate: new Date("2026-04-22"),
      serviceDate: new Date("2026-04-01"),
      serviceDateEnd: null,
      subtotal,
      taxAmount,
      total: subtotal + taxAmount,
      notes: null,
      introText: null,
      vatRegulation: "STANDARD",
      createdById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      leitwegId: null,
      buyerReference: "00",
      eInvoiceXml: null,
      finalizedAt: null,
      paidAt: null,
      pdfHash: null,
      creditNoteForId: null,
      lineItems: SAMPLE_LINE_ITEMS,
      ...overrides,
    } as any,
    settings: SAMPLE_SETTINGS,
  };
}

// ─── Test Scenarios ───────────────────────────────────────────────────────────

interface TestCase {
  name: string;
  format: "ZUGFERD" | "XRECHNUNG";
  input: EInvoiceGeneratorInput;
}

const TEST_CASES: TestCase[] = [
  {
    name: "Standard B2B invoice (ZUGFeRD)",
    format: "ZUGFERD",
    input: buildSampleInvoice(),
  },
  {
    name: "Standard B2B invoice (XRechnung)",
    format: "XRECHNUNG",
    input: buildSampleInvoice({
      leitwegId: "991-1234512345-06",
      buyerReference: "991-1234512345-06",
    }),
  },
  {
    name: "Invoice with 0% VAT line items",
    format: "ZUGFERD",
    input: buildSampleInvoice({
      lineItems: [{
        ...SAMPLE_LINE_ITEMS[0],
        vatRate: 0,
      }],
      subtotal: 4800,
      taxAmount: 0,
      total: 4800,
      vatRegulation: "REVERSE_CHARGE_13B",
    }),
  },
  {
    name: "Invoice with mixed VAT rates (7% + 19%)",
    format: "ZUGFERD",
    input: buildSampleInvoice({
      lineItems: [
        { ...SAMPLE_LINE_ITEMS[0], vatRate: 19 },
        { ...SAMPLE_LINE_ITEMS[1], vatRate: 7, amount: 950 },
      ],
    }),
  },
  {
    name: "Credit note (ZUGFeRD)",
    format: "ZUGFERD",
    input: buildSampleInvoice({
      type: "CREDIT_NOTE",
      number: "GU-2026-001",
      subtotal: -4800,
      taxAmount: -912,
      total: -5712,
      creditNoteForId: "inv-original",
      creditNoteFor: { number: "RE-2026-001", issueDate: new Date("2026-04-01") },
      lineItems: SAMPLE_LINE_ITEMS.map((i) => ({ ...i, amount: -i.amount })),
    }),
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const reportsDir = path.join(__dirname, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  E-Invoice KOSIT Validation — Test Suite");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Check validator availability with a direct fetch (avoid AbortSignal.timeout issues)
  const validatorUrl = process.env.KOSIT_VALIDATOR_URL ?? "http://localhost:8081";
  try {
    const probe = await fetch(validatorUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
      },
      body: "<probe/>",
    });
    // KOSIT returns 200 for valid docs, 406 for invalid/unrecognized — both mean service is up
    if (probe.status !== 200 && probe.status !== 406) throw new Error(`HTTP ${probe.status}`);
  } catch (err) {
    console.error("✗ KOSIT validator is not available at:", validatorUrl);
    console.error("  Start it with: docker compose -f infra/docker/docker-compose.dev.yml up kosit-validator");
    console.error("  Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
  console.log("✓ KOSIT validator is available at", validatorUrl, "\n");

  let failures = 0;
  const results: { name: string; valid: boolean; errors: number; warnings: number; durationMs: number }[] = [];

  for (const testCase of TEST_CASES) {
    process.stdout.write(`  Testing: ${testCase.name} ... `);

    try {
      // Generate XML
      const xml = testCase.format === "XRECHNUNG"
        ? generateXrechnungXml(testCase.input)
        : generateZugferdXml(testCase.input);

      // Save generated XML for debugging
      const xmlFile = path.join(reportsDir, `${testCase.name.replace(/[^a-zA-Z0-9]/g, "_")}.xml`);
      fs.writeFileSync(xmlFile, xml, "utf-8");

      // Validate with KOSIT
      const result = await validateWithKosit(xml, testCase.format);

      // Save validation report
      if (result.rawReport) {
        const reportFile = path.join(reportsDir, `${testCase.name.replace(/[^a-zA-Z0-9]/g, "_")}_report.xml`);
        fs.writeFileSync(reportFile, result.rawReport, "utf-8");
      }

      results.push({
        name: testCase.name,
        valid: result.valid,
        errors: result.errors.length,
        warnings: result.warnings.length,
        durationMs: result.durationMs,
      });

      if (result.valid) {
        console.log(`✓ VALID (${result.durationMs}ms, ${result.warnings.length} warnings)`);
      } else {
        failures++;
        console.log(`✗ INVALID (${result.errors.length} errors, ${result.warnings.length} warnings)`);
        for (const err of result.errors) {
          console.log(`    ✗ ${err.ruleId ? `[${err.ruleId}] ` : ""}${err.message}`);
        }
      }
    } catch (err) {
      failures++;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`✗ ERROR: ${message}`);
      results.push({ name: testCase.name, valid: false, errors: 1, warnings: 0, durationMs: 0 });
    }
  }

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`  Results: ${results.length - failures}/${results.length} passed`);
  console.log("═══════════════════════════════════════════════════════════\n");

  // Write JSON summary
  fs.writeFileSync(
    path.join(reportsDir, "summary.json"),
    JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2),
    "utf-8"
  );

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});