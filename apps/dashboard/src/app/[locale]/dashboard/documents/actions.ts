"use server";

import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import {
  DocumentStatus,
  InputVatKind,
  PaymentMethod,
  type PaymentDifferenceReason,
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { storage, gobdRetainUntil, GOBD_OBJECT_LOCK_MODE } from "@/lib/storage";
import { deleteDocumentById } from "@/lib/documents/delete";
import { createAuditLog } from "@/lib/audit";
import { issueNumber } from "@/lib/number-ranges";
import { getExchangeRate, isSupportedCurrency } from "@/lib/fx";
import {
  recordDocumentBooked,
  recordDocumentPaid,
  reverseDocumentPayment,
} from "@/lib/journal";

/** Zulässige Werte für die Steuerschuldumkehr — alles andere wird verworfen. */
const INPUT_VAT_KINDS: InputVatKind[] = Object.values(InputVatKind);

type ActionResult = { success: true } | { success: false; error: string };

/**
 * Apply GoBD Object Lock retention to a finalized document's stored file.
 *
 * Best-effort: a failure (Object Lock disabled on the bucket, local-fs in
 * dev) is logged but never aborts the user action — the journal entry is
 * the authoritative GoBD record. setRetention is idempotent: re-locking an
 * already-locked object only ever extends the retain-until date.
 */
async function lockDocumentFile(storagePath: string): Promise<void> {
  try {
    await storage.setRetention(storagePath, {
      mode: GOBD_OBJECT_LOCK_MODE,
      retainUntil: gobdRetainUntil(),
    });
  } catch (e) {
    console.error(`[documents] Object Lock failed for ${storagePath}:`, e);
  }
}

// ─── Save document (draft or complete) ──────────────────────────────────────

export async function saveDocument(formData: FormData): Promise<ActionResult> {
  const t = await requireTenant();

  const id = formData.get("id") as string;
  if (!id) return { success: false, error: "Document ID required." };

  // Verify ownership
  const doc = await db.document.findFirst({
    where: { id, tenantId: t.tenantId, deletedAt: null },
    select: { id: true, storagePath: true },
  });
  if (!doc) return { success: false, error: "Document not found." };

  const documentTypeRaw = formData.get("documentType") as string;
  const documentType = (documentTypeRaw === "INCOME" || documentTypeRaw === "EXPENSE")
    ? (documentTypeRaw as "INCOME" | "EXPENSE")
    : null;
  const bookingAccount = (formData.get("bookingAccount") as string)?.trim() || null;
  const recognizedAmount = formData.get("recognizedAmount") as string;
  const recognizedDate = formData.get("recognizedDate") as string;
  const dueDate = formData.get("dueDate") as string;
  const vatRateRaw = formData.get("vatRate") as string;
  const deliveryDateRaw = formData.get("deliveryDate") as string;
  const deliveryDateEndRaw = formData.get("deliveryDateEnd") as string;
  const recognizedSupplier = (formData.get("recognizedSupplier") as string)?.trim() || null;
  const documentNumber = (formData.get("documentNumber") as string)?.trim() || null;
  const notes = (formData.get("notes") as string)?.trim() || null;
  const tagsRaw = formData.get("tags") as string;
  const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];
  // Fremdwährung: Standard EUR. Bei abweichender Währung wird der Tageskurs
  // (EUR pro 1 Fremdwährungseinheit) gespeichert; null = nicht erfasst.
  const currencyRaw = (formData.get("currency") as string)?.trim() || "EUR";
  const currency = isSupportedCurrency(currencyRaw) ? currencyRaw : "EUR";
  const exchangeRateRaw = (formData.get("exchangeRate") as string)?.trim() || "";
  const exchangeRate = currency === "EUR"
    ? null
    : (exchangeRateRaw && Number.isFinite(parseFloat(exchangeRateRaw)))
      ? parseFloat(exchangeRateRaw)
      : null;
  // Steuerschuldumkehr auf der Eingangsseite. Leerer Wert = Regelfall
  // (inländische Rechnung mit ausgewiesener Vorsteuer).
  const inputVatKindRaw = (formData.get("inputVatKind") as string)?.trim() || "";
  const inputVatKind = INPUT_VAT_KINDS.includes(inputVatKindRaw as InputVatKind)
    ? (inputVatKindRaw as InputVatKind)
    : null;
  const isComplete = formData.get("complete") === "true";

  const lineItemsJson = formData.get("lineItems") as string;
  let lineItems: Array<{
    id?: string;
    position: number;
    description: string | null;
    skrAccount: string | null;
    depreciation: string | null;
    amount: string | null;
    vatRule: string | null;
    vatRate: string | null;
    vatAmount: string | null;
    total: string | null;
  }> = [];

  if (lineItemsJson) {
    try {
      lineItems = JSON.parse(lineItemsJson);
    } catch {
      // ignore malformed JSON
    }
  }

  try {
    await db.document.update({
      where: { id },
      data: {
        documentType: documentType ?? undefined,
        bookingAccount,
        recognizedAmount: recognizedAmount ? parseFloat(recognizedAmount) || undefined : undefined,
        recognizedDate: recognizedDate ? new Date(recognizedDate) : undefined,
        dueDate: dueDate ? new Date(dueDate) : null,
        vatRate: vatRateRaw ? parseFloat(vatRateRaw) || null : null,
        deliveryDate: deliveryDateRaw ? new Date(deliveryDateRaw) : null,
        deliveryDateEnd: deliveryDateEndRaw ? new Date(deliveryDateEndRaw) : null,
        recognizedSupplier,
        documentNumber,
        notes,
        tags,
        currency,
        exchangeRate,
        inputVatKind,
        ...(isComplete ? { status: DocumentStatus.DONE } : { status: DocumentStatus.DRAFT }),
        lineItems: {
          deleteMany: {},
          create: lineItems.map((item, i) => {
            const gross = item.total ? parseFloat(item.total) : null;
            const rate = item.vatRate ? parseFloat(item.vatRate) : null;
            return {
              position:     item.position ?? i,
              description:  item.description || null,
              skrAccount:   item.skrAccount || null,
              depreciation: item.depreciation || null,
              amount:       item.amount ? parseFloat(item.amount) : null,
              vatRule:      item.vatRule || null,
              vatRate:      rate !== null && !Number.isNaN(rate) ? rate : null,
              // Steuerbetrag laut Beleg — nur speichern, wenn er von der
              // Ableitung aus Brutto und Satz abweicht (siehe Schema).
              vatAmount:    item.vatAmount !== null && item.vatAmount !== ""
                              ? (Number.isNaN(parseFloat(item.vatAmount)) ? null : parseFloat(item.vatAmount))
                              : null,
              total:        gross !== null && !Number.isNaN(gross) ? gross : null,
            };
          }),
        },
      },
    });
  } catch (err) {
    // Bis hierher wurde jeder Fehler als "Document not found." gemeldet und der
    // Client hat still zurückgesetzt. Ein fehlgeschlagenes Speichern sah damit
    // aus wie stillschweigender Datenverlust — der Nutzer sieht nur, dass seine
    // Eingabe weg ist, ohne Hinweis warum.
    console.error(`[documents] Speichern von ${id} fehlgeschlagen:`, err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Beleg konnte nicht gespeichert werden.",
    };
  }

  if (isComplete) {
    await recordDocumentBooked(t.tenantId, id, t.userId);
    // Document is now a booked GoBD record — freeze the stored file.
    await lockDocumentFile(doc.storagePath);
  }

  revalidatePath("/dashboard/documents");
  revalidatePath(`/dashboard/documents/${id}`);

  return { success: true };
}

export interface MarkPaidExtras {
  /** Tatsächlich gezahlter Bruttobetrag (in Belegwährung) — falls abweichend. */
  amount?: number | null;
  /** Verknüpfte Banktransaktion — wird MATCHED gesetzt und mit Doc verlinkt. */
  bankTransactionId?: string | null;
  /** Bankkonto (für Cashbook/Cash-Zahlungen ohne Tx); optional. */
  bankAccountId?: string | null;
  /** Grund einer Beleg-/Zahlungsdifferenz (Skonto, Rundung, FX, Sonstige). */
  differenceReason?: PaymentDifferenceReason | null;
  /** Klarschrift-Notiz zur Differenz. */
  differenceNote?: string | null;
}

export async function markDocumentAsPaid(
  documentId: string,
  paidAt: string,
  method: PaymentMethod,
  extras: MarkPaidExtras = {},
): Promise<ActionResult> {
  const t = await requireTenant();

  if (!documentId) return { success: false, error: "Document ID required." };

  const doc = await db.document.findFirst({
    where: { id: documentId, tenantId: t.tenantId, deletedAt: null },
    select: { id: true, storagePath: true },
  });
  if (!doc) return { success: false, error: "Document not found." };

  const paidAtDate = new Date(paidAt);
  if (isNaN(paidAtDate.getTime())) return { success: false, error: "Invalid payment date." };

  // Falls eine konkrete BankTransaktion verknüpft werden soll, prüfen wir
  // Existenz und Tenant-Scope; ein MATCHED-Setzen erfolgt im selben TX-Block.
  if (extras.bankTransactionId) {
    const tx = await db.bankTransaction.findFirst({
      where: { id: extras.bankTransactionId, tenantId: t.tenantId },
      select: { id: true, status: true, documentId: true },
    });
    if (!tx) return { success: false, error: "Bank transaction not found." };
    if (tx.documentId && tx.documentId !== documentId) {
      return { success: false, error: "Bank transaction already linked to another document." };
    }
  }

  try {
    await db.$transaction([
      db.documentPayment.upsert({
        where:  { documentId },
        create: {
          documentId, paidAt: paidAtDate, method,
          amount: extras.amount ?? null,
          bankAccountId: extras.bankAccountId ?? null,
          differenceReason: extras.differenceReason ?? null,
          differenceNote: extras.differenceNote ?? null,
        },
        update: {
          paidAt: paidAtDate, method,
          amount: extras.amount ?? null,
          bankAccountId: extras.bankAccountId ?? null,
          differenceReason: extras.differenceReason ?? null,
          differenceNote: extras.differenceNote ?? null,
        },
      }),
      db.document.update({
        where: { id: documentId },
        data:  { status: DocumentStatus.PAID },
      }),
      // Banktransaktion mit dem Beleg verknüpfen + MATCHED setzen. Nur wenn
      // eine ID übergeben wurde; sonst kein no-op in der Transaktion.
      ...(extras.bankTransactionId
        ? [
            db.bankTransaction.update({
              where: { id: extras.bankTransactionId },
              data: { documentId, status: "MATCHED", autoMatched: false },
            }),
          ]
        : []),
    ]);
  } catch (err) {
    console.error("[markDocumentAsPaid] fehlgeschlagen:", err);
    return { success: false, error: "Failed to record payment." };
  }

  await recordDocumentPaid(t.tenantId, documentId, paidAtDate, method, t.userId);
  // A paid document is a finalized GoBD record — freeze the stored file.
  await lockDocumentFile(doc.storagePath);

  revalidatePath("/dashboard/documents");
  revalidatePath(`/dashboard/documents/${documentId}`);

  return { success: true };
}

export async function markDocumentAsUnpaid(documentId: string): Promise<ActionResult> {
  const t = await requireTenant();

  if (!documentId) return { success: false, error: "Document ID required." };

  const doc = await db.document.findFirst({
    where: { id: documentId, tenantId: t.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!doc) return { success: false, error: "Document not found." };

  try {
    await db.$transaction([
      db.documentPayment.delete({ where: { documentId } }),
      db.document.update({
        where: { id: documentId },
        data:  { status: DocumentStatus.DONE },
      }),
    ]);
  } catch (err) {
    console.error("[markDocumentAsUnpaid] fehlgeschlagen:", err);
    return { success: false, error: "Failed to remove payment." };
  }

  await reverseDocumentPayment(t.tenantId, documentId, t.userId);

  revalidatePath("/dashboard/documents");
  revalidatePath(`/dashboard/documents/${documentId}`);

  return { success: true };
}

// ─── Lieferant (Kreditor) verknüpfen ────────────────────────────────────────
//
// Verknüpft ein Dokument (Eingangsrechnung/Beleg) mit einem Kontakt mit Rolle
// SUPPLIER. Wird auf der Document-Detail-Seite vom Lieferanten-Picker ausgelöst.
// `contactId = null` löst die Verknüpfung wieder. Auch nach DONE/PAID erlaubt,
// da die Verknüpfung keinen GoBD-relevanten Inhalt der Buchung verändert.
export async function linkDocumentContact(
  documentId: string,
  contactId: string | null,
): Promise<ActionResult> {
  const t = await requireTenant();
  if (!documentId) return { success: false, error: "Document ID required." };

  const doc = await db.document.findFirst({
    where: { id: documentId, tenantId: t.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!doc) return { success: false, error: "Document not found." };

  if (contactId) {
    const contact = await db.contact.findFirst({
      where: { id: contactId, tenantId: t.tenantId },
      select: { id: true, name: true, roles: true },
    });
    if (!contact) return { success: false, error: "Contact not found." };
    await db.document.update({
      where: { id: documentId },
      data: {
        contactId,
        // OCR-Freitext wird mit dem kanonischen Lieferantennamen überschrieben,
        // damit Anzeige & Reports konsistent sind. Originaltext liegt im OCR-Log.
        recognizedSupplier: contact.name,
      },
    });
  } else {
    // Unlink: contactId nullen UND den OCR-Freitext leeren. Sonst würde der
    // Auto-Re-Link-Pfad in page.tsx beim nächsten Render sofort einen Kontakt
    // mit demselben Namen finden und die Verknüpfung wiederherstellen — der
    // User könnte den Lieferanten faktisch nie entfernen.
    await db.document.update({
      where: { id: documentId },
      data: { contactId: null, recognizedSupplier: null },
    });
  }

  revalidatePath("/dashboard/documents");
  revalidatePath(`/dashboard/documents/${documentId}`);
  return { success: true };
}

// ─── Lieferant inline anlegen + sofort verknüpfen ──────────────────────────
//
// Minimal-Flow für die Beleg-Detailseite: nur Firmenname + automatisch
// generierte Lieferantennummer (SUPPLIER NumberRange). Restliche Stammdaten
// kann der Nutzer später über den Kontakt-Detail-Link nachpflegen.
export async function createSupplierAndLink(
  documentId: string,
  rawName: string,
): Promise<ActionResult> {
  const t = await requireTenant();
  if (!documentId) return { success: false, error: "Document ID required." };
  const name = rawName.trim();
  if (!name) return { success: false, error: "Name is required." };

  const doc = await db.document.findFirst({
    where: { id: documentId, tenantId: t.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!doc) return { success: false, error: "Document not found." };

  // Dedup-Schutz: wenn bereits ein Kontakt mit gleichem Namen existiert,
  // verknüpfen wir stattdessen mit diesem statt einen Duplikat-Kreditor
  // anzulegen. Verhindert versehentliche Doppel-Anlagen, wenn der OCR-Wert
  // wechselseitig leicht abweicht (z.B. Klick auf Anlegen trotz Treffer).
  const existing = await db.contact.findFirst({
    where: { tenantId: t.tenantId, name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true, roles: true },
  });

  let created: { id: string; name: string };
  if (existing) {
    // Falls existierender Kontakt noch kein SUPPLIER ist, Rolle ergänzen
    // (Kunden, die parallel auch Lieferanten werden, sind nicht selten).
    const needsSupplierRole = !existing.roles.includes("SUPPLIER");
    if (needsSupplierRole) {
      await db.contact.update({
        where: { id: existing.id },
        data: { roles: { set: [...existing.roles, "SUPPLIER"] } },
      });
    }
    await db.document.update({
      where: { id: documentId },
      data: { contactId: existing.id, recognizedSupplier: existing.name },
    });
    created = { id: existing.id, name: existing.name };
  } else {
    // Counter + Kontakt-Anlage atomar zusammen, damit kein „Loch" in der
    // Lieferantennummerierung entsteht, wenn die Anlage selbst fehlschlägt.
    created = await db.$transaction(async (tx) => {
      const supplierNumber = await issueNumber(tx, t.tenantId, "SUPPLIER");
      const contact = await tx.contact.create({
        data: {
          tenantId: t.tenantId,
          name,
          roles: ["SUPPLIER"],
          supplierNumber,
          country: "DE",
        },
        select: { id: true, name: true },
      });
      await tx.document.update({
        where: { id: documentId },
        data: { contactId: contact.id, recognizedSupplier: contact.name },
      });
      return contact;
    });
  }

  await createAuditLog({
    action: "CONTACT_CREATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Contact",
    entityId: created.id,
    details: { source: "document_inline", documentId },
  });

  revalidatePath("/dashboard/documents");
  revalidatePath(`/dashboard/documents/${documentId}`);
  revalidatePath("/dashboard/contacts");
  return { success: true };
}

// ─── Wechselkurs nachschlagen (ECB via frankfurter.app) ────────────────────
//
// Server-Action statt direkter fetch im Client: vermeidet CORS-Probleme,
// nutzt das eingebaute next-fetch-Caching und tenant-isoliert keine Daten —
// der Kurs selbst ist öffentliche Information.
export async function lookupExchangeRate(
  isoDate: string,
  currencyCode: string,
): Promise<{ success: true; rate: number } | { success: false; error: string }> {
  await requireTenant();
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return { success: false, error: "Invalid date." };
  }
  if (!isSupportedCurrency(currencyCode)) {
    return { success: false, error: "Unsupported currency." };
  }
  try {
    const rate = await getExchangeRate(new Date(isoDate), currencyCode);
    return { success: true, rate };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "FX lookup failed.",
    };
  }
}

// ─── Bank-Transaktions-Picker für das Payment-Side-Panel ───────────────────
//
// Liefert verfügbare Bankkonten + die unzugeordneten Transaktionen für das
// Payment-Panel. Standard-Fenster: ±60 Tage um das Belegdatum. Suche matcht
// case-insensitive gegen Counterpart-Name, Verwendungszweck und Betrag.

export interface OpenBankTxOption {
  id: string;
  date: string; // ISO
  valueDate: string | null;
  amount: number; // negative = Ausgang, positive = Eingang
  currency: string;
  counterpartName: string | null;
  counterpartIban: string | null;
  purpose: string | null;
  bankAccountId: string;
}

export interface BankAccountOption {
  id: string;
  name: string;
  bankName: string | null;
  iban: string | null;
  isDefault: boolean;
}

export async function listBankAccountsForPicker(): Promise<BankAccountOption[]> {
  const t = await requireTenant();
  const accounts = await db.bankAccount.findMany({
    where: { tenantId: t.tenantId, isActive: true, type: "BANK" },
    select: { id: true, name: true, bankName: true, iban: true, isDefault: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return accounts;
}

interface ListOpenBankTxArgs {
  bankAccountId?: string;
  dateFrom: string; // ISO YYYY-MM-DD
  dateTo: string;   // ISO YYYY-MM-DD
  search?: string;
  amountSign?: "negative" | "positive" | "all"; // negative = Ausgang (Default für Ausgaben)
}

export async function listOpenBankTransactions(
  args: ListOpenBankTxArgs,
): Promise<OpenBankTxOption[]> {
  const t = await requireTenant();
  const { bankAccountId, dateFrom, dateTo, search, amountSign = "all" } = args;

  const txs = await db.bankTransaction.findMany({
    where: {
      tenantId: t.tenantId,
      status: "UNMATCHED",
      ...(bankAccountId ? { bankAccountId } : {}),
      date: { gte: new Date(dateFrom), lte: new Date(dateTo) },
      ...(amountSign === "negative"
        ? { amount: { lt: 0 } }
        : amountSign === "positive"
          ? { amount: { gt: 0 } }
          : {}),
    },
    select: {
      id: true,
      date: true,
      valueDate: true,
      amount: true,
      currency: true,
      counterpartName: true,
      counterpartIban: true,
      purpose: true,
      bankAccountId: true,
    },
    orderBy: { date: "desc" },
    take: 200,
  });

  const q = (search ?? "").trim().toLowerCase();
  const filtered = q.length > 0
    ? txs.filter((tx) =>
        (tx.counterpartName?.toLowerCase().includes(q) ?? false) ||
        (tx.purpose?.toLowerCase().includes(q) ?? false) ||
        String(tx.amount).includes(q),
      )
    : txs;

  return filtered.map((tx) => ({
    id: tx.id,
    date: tx.date.toISOString(),
    valueDate: tx.valueDate?.toISOString() ?? null,
    amount: Number(tx.amount),
    currency: tx.currency,
    counterpartName: tx.counterpartName,
    counterpartIban: tx.counterpartIban,
    purpose: tx.purpose,
    bankAccountId: tx.bankAccountId,
  }));
}

export async function deleteDocument(id: string): Promise<ActionResult> {
  const t = await requireTenant();

  // Booked documents are soft-deleted (bookings reversed, file retained for
  // GoBD); un-booked ones are hard-deleted. See lib/documents/delete.ts.
  const result = await deleteDocumentById(id, t.tenantId, t.userId);
  if (!result.success) return { success: false, error: result.error };

  revalidatePath("/dashboard/documents");

  return { success: true };
}

/**
 * Legt einen leeren Beleg ohne Datei an („Ausgabe ohne Beleg") — z.B. wenn
 * der User eine Ausgabe vormerken will, bevor die Rechnung physisch da ist.
 * Es läuft KEINE OCR, alle Felder bleiben leer. Auf der Detail-Seite kann
 * der Beleg später per Drop-Zone nachgereicht werden.
 *
 * Sentinel-Werte: storagePath = "", fileSize = 0, fileType = "". Detail-UI
 * und Datei-API erkennen darüber, dass kein File existiert und blenden
 * Vorschau/Download aus.
 */
export async function createEmptyDocument(): Promise<
  { success: true; id: string } | { success: false; error: string }
> {
  const t = await requireTenant();

  const today = new Date();
  const fileName = `Ausgabe vom ${today.toLocaleDateString("de-DE")}`;

  const doc = await db.document.create({
    data: {
      tenantId: t.tenantId,
      fileName,
      fileType: "",
      fileSize: 0,
      storagePath: "",
      status: DocumentStatus.DRAFT,
      uploadedById: t.userId,
    },
    select: { id: true },
  });

  revalidatePath("/dashboard/documents");
  return { success: true, id: doc.id };
}
