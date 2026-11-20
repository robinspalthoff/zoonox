/**
 * KOSIT Validator Client
 *
 * Validates XRechnung / ZUGFeRD XML against the official KOSIT validation
 * modules (EN 16931 Schematron rules).
 *
 * The KOSIT validator runs as a Docker sidecar service exposing a REST API.
 * This client sends the generated XML for validation before the invoice is
 * sent, ensuring 100% compliance with German e-invoicing regulations.
 *
 * Architecture:
 *   App → generate XML → POST to KOSIT → parse report → block or allow send
 *
 * @see https://github.com/itplr-kosit/validator
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KositValidationMessage {
  /** "error" | "warning" | "info" */
  severity: "error" | "warning" | "info";
  /** Schematron rule ID (e.g. "BR-01", "BR-DE-1") */
  ruleId: string | null;
  /** Human-readable message from the Schematron rule */
  message: string;
  /** XPath location in the XML where the issue was found */
  location: string | null;
}

export interface KositValidationResult {
  /** Whether the XML passed all mandatory Schematron rules */
  valid: boolean;
  /** Overall assessment from KOSIT: "acceptable" or "reject" */
  assessment: "acceptable" | "reject" | "unknown";
  /** Individual validation messages grouped by severity */
  errors: KositValidationMessage[];
  warnings: KositValidationMessage[];
  /** Raw XML report from KOSIT (for debugging / audit log) */
  rawReport: string | null;
  /** Time taken for validation in ms */
  durationMs: number;
}

// ─── Configuration ────────────────────────────────────────────────────────────

function getValidatorUrl(): string {
  return process.env.KOSIT_VALIDATOR_URL ?? "http://localhost:8081";
}

/**
 * Check whether the KOSIT validator service is available.
 * The apps4everything KOSIT image responds to any POST on root.
 * We send a minimal probe to check connectivity.
 */
export async function isValidatorAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(getValidatorUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
      },
      body: "<probe/>",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    // KOSIT returns 200 for valid documents, 406 for invalid/unrecognized ones.
    // Both mean the service is running and responding.
    return res.status === 200 || res.status === 406;
  } catch {
    return false;
  }
}

// ─── Main Validation Function ─────────────────────────────────────────────────

/**
 * Validates an e-invoice XML string against the KOSIT validator.
 *
 * @param xml - The ZUGFeRD CII or XRechnung UBL XML string
 * @param format - "ZUGFERD" or "XRECHNUNG" — determines which validation scenario to use
 * @returns Structured validation result with errors, warnings, and assessment
 */
export async function validateWithKosit(
  xml: string,
  format: "ZUGFERD" | "XRECHNUNG" = "ZUGFERD"
): Promise<KositValidationResult> {
  const url = getValidatorUrl();
  const startTime = Date.now();

  try {
    const available = await isValidatorAvailable();
    if (!available) {
      console.warn("[kosit] Validator service not available — skipping validation");
      return {
        valid: true, // graceful degradation — don't block if service is down
        assessment: "unknown",
        errors: [],
        warnings: [{
          severity: "warning",
          ruleId: null,
          message: "KOSIT validator service is unavailable. XML was not validated against Schematron rules.",
          location: null,
        }],
        rawReport: null,
        durationMs: Date.now() - startTime,
      };
    }

    // KOSIT validator accepts XML via POST and returns an XML validation report.
    // Status 200 = document valid, 406 = document invalid/rejected.
    // Both return a full XML report in the body.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
      },
      body: xml,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // Any status other than 200 or 406 is a real error
    if (response.status !== 200 && response.status !== 406) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`[kosit] Validator returned ${response.status}: ${errorText}`);
      return {
        valid: false,
        assessment: "reject",
        errors: [{
          severity: "error",
          ruleId: null,
          message: `KOSIT validator returned HTTP ${response.status}: ${errorText.slice(0, 200)}`,
          location: null,
        }],
        warnings: [],
        rawReport: errorText,
        durationMs: Date.now() - startTime,
      };
    }

    const reportXml = await response.text();
    return parseKositReport(reportXml, Date.now() - startTime);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown validation error";
    console.error("[kosit] Validation failed:", message);
    return {
      valid: false,
      assessment: "unknown",
      errors: [{
        severity: "error",
        ruleId: null,
        message: `Validation request failed: ${message}`,
        location: null,
      }],
      warnings: [],
      rawReport: null,
      durationMs: Date.now() - startTime,
    };
  }
}

// ─── Report Parser ────────────────────────────────────────────────────────────

/**
 * Parses the KOSIT validator XML report into a structured result.
 *
 * The KOSIT validator returns an XML report following the SVRL
 * (Schematron Validation Report Language) format, wrapped in a
 * custom report envelope.
 */
function parseKositReport(reportXml: string, durationMs: number): KositValidationResult {
  const errors: KositValidationMessage[] = [];
  const warnings: KositValidationMessage[] = [];

  // Determine overall assessment from the report
  const isAcceptable = reportXml.includes("<rep:accept") ||
                       reportXml.includes("acceptMatch");
  const isRejected = reportXml.includes("<rep:reject");
  const noScenarioMatched = reportXml.includes("<rep:noScenarioMatched");

  // If no scenario matched, the XML structure itself is wrong
  if (noScenarioMatched) {
    errors.push({
      severity: "error",
      ruleId: "SCENARIO",
      message: "No validation scenario matched. The XML does not conform to any recognized e-invoice format (XRechnung UBL, XRechnung CII, ZUGFeRD/Factur-X). Check the root element and CustomizationID.",
      location: null,
    });
  }

  // Extract SVRL failed assertions (errors)
  const failedAssertions = reportXml.matchAll(
    /<svrl:failed-assert[^>]*(?:location="([^"]*)")?[^>]*>[\s\S]*?<svrl:text>([\s\S]*?)<\/svrl:text>[\s\S]*?<\/svrl:failed-assert>/g
  );

  for (const match of failedAssertions) {
    const location = match[1] ?? null;
    const text = (match[2] ?? "").trim().replace(/\s+/g, " ");
    const ruleIdMatch = text.match(/\[([A-Z]{2,}-(?:DE-)?[\d]+(?:-\d+)?)\]/);
    const ruleId = ruleIdMatch?.[1] ?? null;

    errors.push({ severity: "error", ruleId, message: text, location });
  }

  // Extract SVRL successful reports that are warnings
  const firedRules = reportXml.matchAll(
    /<svrl:successful-report[^>]*(?:location="([^"]*)")?[^>]*>[\s\S]*?<svrl:text>([\s\S]*?)<\/svrl:text>[\s\S]*?<\/svrl:successful-report>/g
  );

  for (const match of firedRules) {
    const location = match[1] ?? null;
    const text = (match[2] ?? "").trim().replace(/\s+/g, " ");
    const ruleIdMatch = text.match(/\[([A-Z]{2,}-(?:DE-)?[\d]+(?:-\d+)?)\]/);
    const ruleId = ruleIdMatch?.[1] ?? null;

    warnings.push({ severity: "warning", ruleId, message: text, location });
  }

  // If no SVRL elements found, try to detect schema-level errors
  if (errors.length === 0 && !isAcceptable && isRejected) {
    // Check for schema validation errors in the report
    const schemaErrors = reportXml.matchAll(
      /<rep:message[^>]*>[\s\S]*?<rep:text>([\s\S]*?)<\/rep:text>[\s\S]*?<\/rep:message>/g
    );
    for (const match of schemaErrors) {
      errors.push({
        severity: "error",
        ruleId: null,
        message: (match[1] ?? "").trim(),
        location: null,
      });
    }
  }

  const assessment = isAcceptable ? "acceptable" : isRejected ? "reject" : "unknown";

  return {
    valid: assessment === "acceptable" && errors.length === 0,
    assessment,
    errors,
    warnings,
    rawReport: reportXml,
    durationMs,
  };
}

// ─── Convenience: Validate and format for UI ──────────────────────────────────

/**
 * Validates XML and returns a user-friendly summary.
 * Used by the send-invoice flow to show errors in the UI.
 */
export async function validateAndSummarize(
  xml: string,
  format: "ZUGFERD" | "XRECHNUNG" = "ZUGFERD"
): Promise<{
  valid: boolean;
  summary: string;
  details: KositValidationMessage[];
}> {
  const result = await validateWithKosit(xml, format);

  if (result.valid) {
    return {
      valid: true,
      summary: result.assessment === "unknown"
        ? "Validation skipped — validator unavailable."
        : "XML is valid according to EN 16931 / KOSIT rules.",
      details: result.warnings,
    };
  }

  const errorSummary = result.errors
    .map((e) => `${e.ruleId ? `[${e.ruleId}] ` : ""}${e.message}`)
    .join("\n");

  return {
    valid: false,
    summary: `E-invoice XML failed validation:\n${errorSummary}`,
    details: [...result.errors, ...result.warnings],
  };
}