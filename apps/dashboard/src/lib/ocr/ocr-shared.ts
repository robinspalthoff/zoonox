/**
 * Shared types, prompt and normalisation logic used by both OCR providers
 * (openrouter-ocr.ts and mistral-ocr.ts).
 */

// ─── OcrResult ────────────────────────────────────────────────────────────────

export interface OcrResult {
  rawText: string;
  confidence: number;             // 0-1 estimate
  supplierName: string | null;
  documentNumber: string | null;
  documentDate: string | null;    // ISO date string
  dueDate: string | null;         // ISO date string
  deliveryDate: string | null;    // ISO date string — Leistungs-/Lieferdatum (falls back to documentDate)
  totalAmount: number | null;     // Bruttobetrag (gross)
  vatRate: number | null;         // MwSt.-Satz in % (e.g. 19, 7, 0)
  category: string | null;        // Suggested DocumentCategory enum value
  bookingAccount: string | null;  // Suggested SKR03 account number
  description: string | null;     // Kurzbezeichnung des Beleg-Inhalts (Bezeichnung der 1. Belegposition)
}

// ─── Shared extraction prompt ─────────────────────────────────────────────────

export const EXTRACTION_PROMPT = `
You are a German accounting assistant. Analyse the provided document (invoice, receipt or similar) and extract all relevant data.
If multiple pages are provided, treat them as a single document — the total amount and due date may appear on a later page.

Return a single JSON object — no markdown, no explanation:

{
  "rawText": "<full visible text from the document>",
  "confidence": <0.0-1.0 extraction confidence>,
  "supplierName": "<company name of the sender/supplier or null>",
  "documentNumber": "<invoice/receipt number e.g. RE-12345 or null>",
  "documentDate": "<ISO date YYYY-MM-DD of the document or null>",
  "dueDate": "<ISO date YYYY-MM-DD of the payment deadline or null>",
  "deliveryDate": "<ISO date YYYY-MM-DD of the service/delivery date (Leistungsdatum/Lieferdatum) or null>",
  "totalAmount": <gross total as number without currency symbol or null>,
  "vatRate": <VAT rate as number (e.g. 19, 7, or 0) or null if not determinable>,
  "category": "<one of: INVOICE_INCOMING, RECEIPT, CONTRACT, CREDIT_NOTE, DELIVERY_NOTE, OTHER>",
  "bookingAccount": "<SKR03 account number as described below or null>",
  "description": "<short German line describing WHAT was billed, e.g. 'Mobilfunk-Vertrag Mai 2026', 'Server-Hosting Hetzner', 'Büromaterial' or null>"
}

Rules:
- All monetary values as plain numbers (no € sign, use . as decimal separator)
- Dates in ISO 8601 format (YYYY-MM-DD)
- null for any field that is not clearly visible
- German date formats like "15. April 2026" or "15.04.2026" → "2026-04-15"
- For dueDate: if the document says "sofort fällig", "zahlbar sofort", "fällig bei Erhalt" or similar immediate-payment terms, set dueDate = documentDate
- For dueDate: if only a payment term like "14 Tage" or "30 Tage netto" is given, calculate dueDate from documentDate
- For deliveryDate: extract the Leistungsdatum or Lieferdatum if stated explicitly. If a range is given (e.g. "Leistungszeitraum 01.03.–31.03.2026"), use the start date. If not stated at all, set deliveryDate = null (the system will fall back to documentDate automatically).
- For vatRate: extract the VAT percentage from the document (typically 19 for standard German invoices, 7 for reduced rate, 0 for exempt). Return the number only, not the % sign.
- For category: INVOICE_INCOMING for incoming invoices / Rechnungen (→ Ausgabe), RECEIPT for Quittungen/Kassenbelege (→ Ausgabe), CONTRACT for Verträge, CREDIT_NOTE for Gutschriften (→ Einnahme), DELIVERY_NOTE for Lieferscheine, OTHER if unclear
- For description: Write a short German subject line (3–8 words) that summarises WHAT was billed — combining the main service AND any period/object reference visible on the document. Examples: "Mobilfunk Mai 2026", "Server-Hosting Hetzner Mai", "Bürobedarf Druckerpatronen", "DSL-Anschluss Q2/2026", "Bahnticket Berlin–Hamburg". Do NOT just repeat the supplier name. Prefer the line-item description over the document title. null if nothing recognisable.

BOOKING ACCOUNT (SKR03) — choose the MOST SPECIFIC match based on supplier name AND service description:

Postage & Shipping (look for: DHL, Hermes, DPD, UPS, FedEx, GLS, Deutsche Post, Paket, Versand, Porto, Fracht):
  4730 = Outgoing freight (Ausgangsfrachten) — for shipping parcels/goods to customers
  4910 = Postage (Porto) — for letters, stamps, general postal services

Telecommunications (look for: Telekom, Vodafone, O2, Congstar, 1&1, Telefon, Mobilfunk, SIM):
  4920 = Telephone (Telefon/Mobilfunk)
  4921 = Internet / DSL / Breitband

Software & SaaS & Cloud (look for: AWS, Azure, Google Cloud, Hetzner, IONOS, Strato, Netcup, GitHub, GitLab, Notion, Slack, Zoom, Figma, Adobe, Microsoft, Office 365, Dropbox, Hosting, Domain, Server, Software, Lizenz, Abo, Subscription):
  4806 = Hardware and software maintenance / SaaS subscriptions
  4805 = Repairs and maintenance of other equipment
  0027 = EDV-Software (for one-time software purchases/licenses)

Office supplies (look for: Bürobedarf, Papier, Stift, Drucker, Toner, Staples, Office Depot, Amazon Business — if items are stationery/supplies):
  4930 = Office supplies (Bürobedarf)

Rent & premises (look for: Miete, Nebenkosten, Kaltmiete, Warmmiete, Strom, Gas, Wasser, Heizung):
  4210 = Rent (Miete)
  4230 = Heating (Heizung)
  4240 = Gas, electricity, water

Consulting & legal (look for: Beratung, Consulting, Rechtsanwalt, Steuerberater, Notar, Anwalt):
  4950 = Legal and consulting costs
  4955 = Bookkeeping expenses

External services / freelancers (look for: Fremdleistungen, Subunternehmer, Freelancer, Honorar, Dienstleistung):
  3100 = Third-party services (Fremdleistungen)

Vehicle (look for: Tankstelle, Kraftstoff, Benzin, Diesel, ADAC, Kfz, TÜV, Reparatur — vehicle):
  4530 = Ongoing vehicle operating costs
  4540 = Vehicle repairs

Marketing & advertising (look for: Werbung, Marketing, Anzeige, Facebook Ads, Google Ads, Print, Flyer, Banner):
  4600 = Advertising expenses (Werbekosten)

Travel (look for: Deutsche Bahn, DB, Bahn, Flug, Hotel, Übernachtung, Airbnb, Taxi, Uber, Mietwagen, Reise):
  4660 = Employee travel costs
  4670 = Business owner travel costs

Catering / entertainment (look for: Restaurant, Gaststätte, Catering, Bewirtung):
  4650 = Entertainment costs (Bewirtungskosten)

Insurance (look for: Versicherung, Allianz, ERGO, HDI, AXA, Haftpflicht, Berufsunfähigkeit):
  4300 = Insurance
  4390 = Other insurance

Books & education (look for: Buch, Zeitschrift, Fortbildung, Seminar, Kurs, Schulung, Udemy, Coursera):
  4940 = Newspapers, books, digital media
  4945 = Training costs

Machinery & equipment (look for: Gerät, Maschine, Werkzeug, Bürostuhl, Schreibtisch — office furniture/equipment):
  0420 = Office equipment (Büroeinrichtung)
  0480 = Low-value assets up to 800 € (GWG)
  4855 = Immediate write-off of low-value assets

Bank / payment fees (look for: Bankgebühr, Kontoführung, PayPal, Stripe, Klarna, Gebühr):
  4970 = Incidental monetary transaction costs
`.trim();

// ─── Category validation ──────────────────────────────────────────────────────

import { DocumentCategory, DocumentType } from "@prisma/client";

const VALID_CATEGORIES = new Set<string>(Object.values(DocumentCategory));

export function toDocumentCategory(value: string | null): DocumentCategory | null {
  if (value && VALID_CATEGORIES.has(value)) return value as DocumentCategory;
  return null;
}

/**
 * Infers INCOME / EXPENSE from the OCR category string.
 * CREDIT_NOTE = money coming back in (Einnahme).
 * All incoming document types (invoices, receipts, etc.) = EXPENSE (Ausgabe).
 */
export function inferDocumentType(category: string | null): DocumentType | null {
  if (!category) return null;
  if (category === "CREDIT_NOTE") return DocumentType.INCOME;
  if (
    category === "INVOICE_INCOMING" ||
    category === "RECEIPT"          ||
    category === "CONTRACT"         ||
    category === "DELIVERY_NOTE"    ||
    category === "OTHER"
  ) return DocumentType.EXPENSE;
  return null;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

export function bufferToDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

/**
 * Normalises a raw LLM JSON payload into a typed OcrResult.
 * Coerces bookingAccount to string because LLMs sometimes return it as an
 * integer (e.g. 4730 instead of "4730").
 */
export function normalizeOcrResult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsed: any,
  fallbackRawText = ""
): OcrResult {
  return {
    rawText:        parsed.rawText        ?? fallbackRawText,
    confidence:     Math.min(1, Math.max(0, parsed.confidence ?? 0.5)),
    supplierName:   parsed.supplierName   ?? null,
    documentNumber: parsed.documentNumber ?? null,
    documentDate:   parsed.documentDate   ?? null,
    dueDate:        parsed.dueDate        ?? null,
    deliveryDate:   parsed.deliveryDate   ?? null,
    totalAmount:    typeof parsed.totalAmount === "number" ? parsed.totalAmount : null,
    vatRate:        typeof parsed.vatRate    === "number" ? parsed.vatRate    : null,
    category:       parsed.category       ?? null,
    bookingAccount: parsed.bookingAccount != null ? String(parsed.bookingAccount) : null,
    description:    typeof parsed.description === "string" && parsed.description.trim().length > 0
                      ? parsed.description.trim().slice(0, 200)
                      : null,
  };
}
