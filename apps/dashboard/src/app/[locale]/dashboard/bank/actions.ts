"use server";

import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import {
  Prisma,
  TransactionStatus,
  ImportSource,
  CashbookEntryType,
  BankAccountType,
  DocumentStatus,
  InvoiceStatus,
  PaymentMethod,
} from "@prisma/client";
import type { CsvMappingPreset } from "@/lib/csv-mapping";
import { parseCsvMappingPreset } from "@/lib/csv-mapping";
import {
  recordInvoiceIssued,
  recordInvoicePaid,
  reverseInvoicePayment,
  recordDocumentBooked,
  recordDocumentPaid,
  reverseDocumentPayment,
  recordBankPrivateMovement,
  reverseBankPrivateMovement,
  recordCashbookEntry,
  reverseCashbookEntry,
} from "@/lib/journal";
import {
  scoreCandidate,
  pickAutoMatch,
  SUGGEST_THRESHOLD,
  type ScoreInputCandidate,
  type ScoreInputTx,
} from "@/lib/auto-match";

type ActionResult = { success: true } | { success: false; error: string };

// ─── Bank Accounts ────────────────────────────────────────────────────────────

export async function upsertBankAccount(data: {
  id?: string;
  name: string;
  type?: BankAccountType;
  bankName?: string | null;
  iban?: string | null;
  bic?: string | null;
  currency?: string;
  openingBalance?: number;
  bookingAccount?: string | null;
  isDefault?: boolean;
  requireBookingAccount?: boolean;
  csvMapping?: CsvMappingPreset | null;
}): Promise<ActionResult> {
  const t = await requireTenant();

  const {
    id,
    name,
    type = "BANK",
    bankName,
    iban,
    bic,
    currency,
    openingBalance,
    bookingAccount,
    isDefault,
    requireBookingAccount,
    csvMapping,
  } = data;

  if (!name.trim()) return { success: false, error: "Name is required." };

  const normalizedBookingAccount = bookingAccount?.trim() || null;

  if (type === "CLEARING" && !normalizedBookingAccount) {
    return { success: false, error: "Booking account is required for clearing accounts." };
  }
  if (type === "BANK" && requireBookingAccount && !normalizedBookingAccount) {
    return { success: false, error: "Booking account is required for CSV-imported bank accounts." };
  }

  const normalizedIban =
    type === "CLEARING" ? null : iban?.replace(/\s/g, "").toUpperCase() || null;
  const normalizedBic =
    type === "CLEARING" ? null : bic?.trim().toUpperCase() || null;
  const normalizedBankName =
    type === "CLEARING" ? null : bankName?.trim() || null;

  let csvMappingUpdate: CsvMappingPreset | null | undefined;
  if (csvMapping === undefined) {
    csvMappingUpdate = undefined;
  } else if (csvMapping === null) {
    csvMappingUpdate = null;
  } else {
    const parsed = parseCsvMappingPreset(csvMapping);
    if (!parsed) {
      return { success: false, error: "Invalid CSV mapping preset." };
    }
    if (type === "CLEARING") {
      return { success: false, error: "Clearing accounts cannot have a CSV mapping." };
    }
    csvMappingUpdate = parsed;
  }

  try {
    if (isDefault) {
      await db.bankAccount.updateMany({
        where: { tenantId: t.tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }

    if (id) {
      const result = await db.bankAccount.updateMany({
        where: { id, tenantId: t.tenantId },
        data: {
          name: name.trim(),
          type,
          bankName: normalizedBankName,
          iban: normalizedIban,
          bic: normalizedBic,
          currency: currency || "EUR",
          openingBalance: openingBalance ?? 0,
          bookingAccount: normalizedBookingAccount,
          isDefault: isDefault ?? false,
          ...(csvMappingUpdate !== undefined
            ? {
                csvMapping:
                  csvMappingUpdate === null
                    ? Prisma.JsonNull
                    : (csvMappingUpdate as unknown as Prisma.InputJsonValue),
              }
            : {}),
        },
      });
      if (result.count === 0) return { success: false, error: "Not found." };
      await createAuditLog({
        action: "BANK_ACCOUNT_UPDATED",
        tenantId: t.tenantId,
        userId: t.userId,
        entityType: "BankAccount",
        entityId: id,
      });
    } else {
      const account = await db.bankAccount.create({
        data: {
          tenantId: t.tenantId,
          name: name.trim(),
          type,
          bankName: normalizedBankName,
          iban: normalizedIban,
          bic: normalizedBic,
          currency: currency || "EUR",
          openingBalance: openingBalance ?? 0,
          bookingAccount: normalizedBookingAccount,
          isDefault: isDefault ?? false,
          ...(csvMappingUpdate !== undefined && csvMappingUpdate !== null
            ? { csvMapping: csvMappingUpdate as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
      await createAuditLog({
        action: "BANK_ACCOUNT_CREATED",
        tenantId: t.tenantId,
        userId: t.userId,
        entityType: "BankAccount",
        entityId: account.id,
      });
    }
  } catch (err) {
    console.error("[upsertBankAccount] fehlgeschlagen:", err);
    return { success: false, error: "Failed to save bank account." };
  }

  revalidatePath("/dashboard/bank");
  return { success: true };
}

export async function updateBankAccountCsvMapping(
  accountId: string,
  preset: CsvMappingPreset | null,
): Promise<ActionResult> {
  const t = await requireTenant();

  let value: CsvMappingPreset | null;
  if (preset === null) {
    value = null;
  } else {
    const parsed = parseCsvMappingPreset(preset);
    if (!parsed) return { success: false, error: "Invalid CSV mapping preset." };
    value = parsed;
  }

  try {
    const result = await db.bankAccount.updateMany({
      where: { id: accountId, tenantId: t.tenantId },
      data: {
        csvMapping:
          value === null
            ? Prisma.JsonNull
            : (value as unknown as Prisma.InputJsonValue),
      },
    });
    if (result.count === 0) return { success: false, error: "Not found." };
    await createAuditLog({
      action: "BANK_ACCOUNT_UPDATED",
      tenantId: t.tenantId,
      userId: t.userId,
      entityType: "BankAccount",
      entityId: accountId,
    });
  } catch (err) {
    console.error("[updateBankAccountCsvMapping] fehlgeschlagen:", err);
    return { success: false, error: "Failed to update CSV mapping." };
  }

  revalidatePath("/dashboard/bank");
  return { success: true };
}

export async function deleteBankAccount(id: string): Promise<ActionResult> {
  const t = await requireTenant();

  try {
    const result = await db.bankAccount.deleteMany({ where: { id, tenantId: t.tenantId } });
    if (result.count === 0) return { success: false, error: "Not found." };
    await createAuditLog({
      action: "BANK_ACCOUNT_DELETED",
      tenantId: t.tenantId,
      userId: t.userId,
      entityType: "BankAccount",
      entityId: id,
    });
  } catch (err) {
    console.error("[deleteBankAccount] fehlgeschlagen:", err);
    return { success: false, error: "Failed to delete bank account." };
  }

  revalidatePath("/dashboard/bank");
  return { success: true };
}

// ─── Bank Transactions ────────────────────────────────────────────────────────

export async function createTransaction(data: {
  bankAccountId: string;
  date: string;
  valueDate?: string | null;
  amount: number;
  currency?: string;
  counterpartName?: string | null;
  counterpartIban?: string | null;
  purpose?: string | null;
  category?: string | null;
}): Promise<ActionResult> {
  const t = await requireTenant();

  const txDate = new Date(data.date);
  if (isNaN(txDate.getTime())) return { success: false, error: "Invalid date." };

  // Verify the bank account belongs to this tenant
  const account = await db.bankAccount.findFirst({
    where: { id: data.bankAccountId, tenantId: t.tenantId },
    select: { id: true },
  });
  if (!account) return { success: false, error: "Bank account not found." };

  try {
    const tx = await db.bankTransaction.create({
      data: {
        tenantId: t.tenantId,
        bankAccountId: data.bankAccountId,
        date: txDate,
        valueDate: data.valueDate ? new Date(data.valueDate) : null,
        amount: data.amount,
        currency: data.currency || "EUR",
        counterpartName: data.counterpartName?.trim() || null,
        counterpartIban: data.counterpartIban?.replace(/\s/g, "").toUpperCase() || null,
        purpose: data.purpose?.trim() || null,
        category: data.category?.trim() || null,
        importSource: ImportSource.MANUAL,
        status: TransactionStatus.UNMATCHED,
      },
    });
    await createAuditLog({
      action: "BANK_TRANSACTION_CREATED",
      tenantId: t.tenantId,
      userId: t.userId,
      entityType: "BankTransaction",
      entityId: tx.id,
    });
  } catch (err) {
    console.error("[createTransaction] fehlgeschlagen:", err);
    return { success: false, error: "Failed to create transaction." };
  }

  revalidatePath("/dashboard/bank");
  return { success: true };
}

export async function deleteTransaction(id: string): Promise<ActionResult> {
  const t = await requireTenant();

  try {
    // If the tx is matched to an invoice/document, unmatch it first so the
    // payment posting + status flip back to SENT/DONE happens. After that
    // the actual delete runs against an unmatched row, and we just need to
    // reverse any private-movement entry that might still hang on the
    // BANK_TRANSACTION sourceId.
    const tx = await db.bankTransaction.findFirst({
      where: { id, tenantId: t.tenantId },
      select: { id: true, status: true },
    });
    if (!tx) return { success: false, error: "Not found." };

    if (tx.status === TransactionStatus.MATCHED) {
      const r = await unmatchTransaction(id);
      if (!r.success) return r;
    }

    await reverseBankPrivateMovement(t.tenantId, id, t.userId);
    await db.bankTransaction.deleteMany({ where: { id, tenantId: t.tenantId } });
  } catch (err) {
    console.error("[deleteTransaction] fehlgeschlagen:", err);
    return { success: false, error: "Failed to delete transaction." };
  }

  revalidatePath("/dashboard/bank");
  return { success: true };
}

export async function matchTransactionToDocument(
  transactionId: string,
  documentId: string,
  options?: { auto?: boolean },
): Promise<ActionResult> {
  const t = await requireTenant();
  const auto = options?.auto === true;

  try {
    const [tx, doc] = await Promise.all([
      db.bankTransaction.findFirst({
        where: { id: transactionId, tenantId: t.tenantId },
        select: { id: true, amount: true, date: true, bankAccountId: true },
      }),
      db.document.findFirst({
        where: { id: documentId, tenantId: t.tenantId, deletedAt: null },
        select: { id: true, status: true, documentType: true, payment: { select: { id: true } } },
      }),
    ]);

    if (!tx) return { success: false, error: "Transaction not found." };
    if (!doc) return { success: false, error: "Document not found." };

    const txAmount = Number(tx.amount);
    if (doc.documentType === "INCOME" && txAmount < 0) {
      return {
        success: false,
        error:
          "Sign mismatch: this receipt is classified as income and requires an incoming (positive) transaction.",
      };
    }
    if (doc.documentType === "EXPENSE" && txAmount > 0) {
      return {
        success: false,
        error:
          "Sign mismatch: this receipt is classified as an expense and requires an outgoing (negative) transaction.",
      };
    }

    // Bank-driven payment flow: matching the tx makes the document PAID.
    // We also need a DocumentPayment record (used elsewhere as "is paid?"
    // marker) and a DOCUMENT booking entry in the journal if the doc was
    // still in DRAFT — otherwise the payment posting has nothing to clear.
    const wasAlreadyPaid = doc.status === DocumentStatus.PAID;
    const needsBooking =
      doc.status === DocumentStatus.DRAFT || doc.status === DocumentStatus.PENDING;

    await db.$transaction([
      db.bankTransaction.update({
        where: { id: transactionId },
        data: { documentId, invoiceId: null, status: TransactionStatus.MATCHED, autoMatched: auto },
      }),
      ...(wasAlreadyPaid
        ? []
        : [
            db.documentPayment.upsert({
              where: { documentId },
              create: {
                documentId,
                paidAt: tx.date,
                method: PaymentMethod.BANK_TRANSFER,
                amount: Math.abs(txAmount),
                bankAccountId: tx.bankAccountId,
              },
              update: {
                paidAt: tx.date,
                method: PaymentMethod.BANK_TRANSFER,
                amount: Math.abs(txAmount),
                bankAccountId: tx.bankAccountId,
              },
            }),
            db.document.update({
              where: { id: documentId },
              data: { status: DocumentStatus.PAID },
            }),
          ]),
    ]);

    await createAuditLog({
      action: auto ? "BANK_TRANSACTION_AUTO_MATCHED" : "BANK_TRANSACTION_MATCHED",
      tenantId: t.tenantId,
      userId: t.userId,
      entityType: "BankTransaction",
      entityId: transactionId,
      details: { documentId, autoMarkedPaid: !wasAlreadyPaid, auto },
    });

    if (!wasAlreadyPaid) {
      // Book the document expense if it wasn't booked yet (recordDocumentBooked
      // is idempotent — it reverses any prior DOCUMENT entry and reposts the
      // current state), then book the payment so the cash side closes out.
      if (needsBooking) {
        await recordDocumentBooked(t.tenantId, documentId, t.userId);
      }
      await recordDocumentPaid(
        t.tenantId,
        documentId,
        tx.date,
        PaymentMethod.BANK_TRANSFER,
        t.userId,
      );
    }
  } catch (err) {
    console.error("[matchTransactionToDocument] fehlgeschlagen:", err);
    return { success: false, error: "Failed to match transaction." };
  }

  revalidatePath("/dashboard/bank");
  revalidatePath(`/dashboard/documents/${documentId}`);
  return { success: true };
}

export async function matchTransactionToInvoice(
  transactionId: string,
  invoiceId: string,
  options?: { auto?: boolean },
): Promise<ActionResult> {
  const t = await requireTenant();
  const auto = options?.auto === true;

  try {
    const [tx, invoice] = await Promise.all([
      db.bankTransaction.findFirst({
        where: { id: transactionId, tenantId: t.tenantId },
        select: { id: true, amount: true, date: true },
      }),
      db.invoice.findFirst({
        where: { id: invoiceId, tenantId: t.tenantId },
        select: { id: true, type: true, status: true, finalizedAt: true, total: true },
      }),
    ]);

    if (!tx) return { success: false, error: "Transaction not found." };
    if (!invoice) return { success: false, error: "Invoice not found." };
    if (invoice.status === InvoiceStatus.CANCELLED) {
      return { success: false, error: "Cannot match a bank transaction to a cancelled invoice." };
    }

    const txAmount = Number(tx.amount);
    // Corrections carry the full corrected total — the customer still owes
    // money against them, so they behave like a regular invoice for the
    // bank match's direction check.
    const expectIncoming = invoice.type === "INVOICE" || invoice.type === "CORRECTION";
    const expectOutgoing = invoice.type === "CREDIT_NOTE";

    if (expectIncoming && txAmount < 0) {
      return {
        success: false,
        error:
          "Sign mismatch: an outgoing invoice requires an incoming (positive) bank transaction. " +
          "If this is a refund, create a credit note instead.",
      };
    }
    if (expectOutgoing && txAmount > 0) {
      return {
        success: false,
        error:
          "Sign mismatch: a credit note requires an outgoing (negative) bank transaction.",
      };
    }

    // Status transition logic — see comment in matchTransactionToDocument for
    // the rationale. A DRAFT invoice needs to be finalized first so the
    // payment posting has a receivable to clear; otherwise we'd journal a
    // payment without an underlying invoice entry.
    const wasAlreadyPaid = invoice.status === InvoiceStatus.PAID;
    const needsFinalization = invoice.status === InvoiceStatus.DRAFT;
    const now = new Date();

    await db.$transaction([
      db.bankTransaction.update({
        where: { id: transactionId },
        data: { invoiceId, documentId: null, status: TransactionStatus.MATCHED, autoMatched: auto },
      }),
      ...(wasAlreadyPaid
        ? []
        : [
            db.invoice.update({
              where: { id: invoiceId },
              data: {
                status: InvoiceStatus.PAID,
                paidAt: tx.date,
                paymentMethod: PaymentMethod.BANK_TRANSFER,
                ...(needsFinalization && !invoice.finalizedAt ? { finalizedAt: now } : {}),
              },
            }),
          ]),
    ]);

    await createAuditLog({
      action: auto ? "BANK_TRANSACTION_AUTO_MATCHED" : "BANK_TRANSACTION_MATCHED",
      tenantId: t.tenantId,
      userId: t.userId,
      entityType: "BankTransaction",
      entityId: transactionId,
      details: { invoiceId, autoMarkedPaid: !wasAlreadyPaid, auto },
    });

    if (!wasAlreadyPaid) {
      // If the invoice never went through "Mark as Sent" / email send, we
      // still need an INVOICE journal entry so the payment has its receivable
      // counterleg. recordInvoiceIssued doesn't auto-reverse — guard with the
      // finalization check so we don't double-post when the user previously
      // finalized via the regular SENT flow.
      if (needsFinalization && !invoice.finalizedAt) {
        await recordInvoiceIssued(t.tenantId, invoiceId, t.userId);
      }
      await recordInvoicePaid(
        t.tenantId,
        invoiceId,
        tx.date,
        PaymentMethod.BANK_TRANSFER,
        t.userId,
      );
    }
  } catch (err) {
    console.error("[matchTransactionToInvoice] fehlgeschlagen:", err);
    return { success: false, error: "Failed to match transaction to invoice." };
  }

  revalidatePath("/dashboard/bank");
  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  return { success: true };
}

export async function unmatchTransaction(transactionId: string): Promise<ActionResult> {
  const t = await requireTenant();

  try {
    // Capture the previous match (if any) before clearing it — we need the
    // ids to reverse the payment posting and roll the linked invoice/document
    // back from PAID. We only auto-revert when this tx was the *exclusive*
    // payment source for that invoice/document; if another MATCHED tx is
    // still linked, the entity stays PAID.
    const previous = await db.bankTransaction.findFirst({
      where: { id: transactionId, tenantId: t.tenantId },
      select: { invoiceId: true, documentId: true },
    });
    if (!previous) return { success: false, error: "Transaction not found." };

    await db.bankTransaction.updateMany({
      where: { id: transactionId, tenantId: t.tenantId },
      data: {
        documentId: null,
        invoiceId: null,
        status: TransactionStatus.UNMATCHED,
        autoMatched: false,
      },
    });

    // Revert invoice → SENT if this was the only matching tx.
    if (previous.invoiceId) {
      const otherMatches = await db.bankTransaction.count({
        where: {
          tenantId: t.tenantId,
          invoiceId: previous.invoiceId,
          status: TransactionStatus.MATCHED,
        },
      });
      if (otherMatches === 0) {
        await db.invoice.update({
          where: { id: previous.invoiceId },
          data: {
            status: InvoiceStatus.SENT,
            paidAt: null,
            paymentMethod: null,
          },
        });
        await reverseInvoicePayment(t.tenantId, previous.invoiceId, t.userId);
        revalidatePath(`/dashboard/invoices/${previous.invoiceId}`);
      }
    }

    // Revert document → DONE if no other tx still matches it.
    if (previous.documentId) {
      const otherMatches = await db.bankTransaction.count({
        where: {
          tenantId: t.tenantId,
          documentId: previous.documentId,
          status: TransactionStatus.MATCHED,
        },
      });
      if (otherMatches === 0) {
        await db.$transaction([
          db.documentPayment.deleteMany({ where: { documentId: previous.documentId } }),
          db.document.update({
            where: { id: previous.documentId },
            data: { status: DocumentStatus.DONE },
          }),
        ]);
        await reverseDocumentPayment(t.tenantId, previous.documentId, t.userId);
        revalidatePath(`/dashboard/documents/${previous.documentId}`);
      }
    }
  } catch (err) {
    console.error("[unmatchTransaction] fehlgeschlagen:", err);
    return { success: false, error: "Failed to unmatch transaction." };
  }

  revalidatePath("/dashboard/bank");
  return { success: true };
}

export async function flipTransactionSign(
  transactionId: string,
): Promise<ActionResult> {
  const t = await requireTenant();

  try {
    const tx = await db.bankTransaction.findFirst({
      where: { id: transactionId, tenantId: t.tenantId },
      select: { amount: true, status: true, isPrivate: true },
    });
    if (!tx) return { success: false, error: "Transaction not found." };

    // Matched tx with flipped sign no longer makes sense — unmatch first so
    // the linked invoice/document is rolled back from PAID. Then flip.
    if (tx.status === TransactionStatus.MATCHED) {
      const r = await unmatchTransaction(transactionId);
      if (!r.success) return r;
    }

    const flipped = Number(tx.amount) * -1;
    await db.bankTransaction.update({
      where: { id: transactionId },
      data: { amount: flipped },
    });

    // Private movement entry needs to be re-posted with the new sign.
    if (tx.isPrivate) {
      await recordBankPrivateMovement(t.tenantId, transactionId, t.userId);
    }
  } catch (err) {
    console.error("[flipTransactionSign] fehlgeschlagen:", err);
    return { success: false, error: "Failed to flip transaction sign." };
  }

  revalidatePath("/dashboard/bank");
  return { success: true };
}

export async function ignoreTransaction(transactionId: string): Promise<ActionResult> {
  const t = await requireTenant();

  try {
    // Ignoring a matched tx should also revert the linked entity — same
    // contract as unmatch. Re-use the helper so the rollback paths stay in
    // one place, then flip the status from UNMATCHED to IGNORED.
    const tx = await db.bankTransaction.findFirst({
      where: { id: transactionId, tenantId: t.tenantId },
      select: { status: true, isPrivate: true },
    });
    if (!tx) return { success: false, error: "Not found." };

    if (tx.status === TransactionStatus.MATCHED) {
      const r = await unmatchTransaction(transactionId);
      if (!r.success) return r;
    }
    // A private-movement journal entry doesn't belong on an IGNORED tx —
    // ignore means "this didn't happen for accounting purposes".
    if (tx.isPrivate) {
      await reverseBankPrivateMovement(t.tenantId, transactionId, t.userId);
    }

    await db.bankTransaction.updateMany({
      where: { id: transactionId, tenantId: t.tenantId },
      data: { status: TransactionStatus.IGNORED },
    });
  } catch (err) {
    console.error("[ignoreTransaction] fehlgeschlagen:", err);
    return { success: false, error: "Failed to ignore transaction." };
  }

  revalidatePath("/dashboard/bank");
  return { success: true };
}

export async function unignoreTransaction(transactionId: string): Promise<ActionResult> {
  const t = await requireTenant();

  try {
    await db.bankTransaction.updateMany({
      where: { id: transactionId, tenantId: t.tenantId },
      data: { status: TransactionStatus.UNMATCHED },
    });
    // If the tx is private, restore its journal entry so the books reflect
    // the movement again.
    await recordBankPrivateMovement(t.tenantId, transactionId, t.userId);
  } catch (err) {
    console.error("[unignoreTransaction] fehlgeschlagen:", err);
    return { success: false, error: "Failed to restore transaction." };
  }

  revalidatePath("/dashboard/bank");
  return { success: true };
}

export async function togglePrivateTransaction(
  transactionId: string,
  isPrivate: boolean,
): Promise<ActionResult> {
  const t = await requireTenant();

  try {
    await db.bankTransaction.updateMany({
      where: { id: transactionId, tenantId: t.tenantId },
      data: { isPrivate },
    });
    // recordBankPrivateMovement is idempotent — it reverses any prior entry
    // and only re-posts when the tx is currently flagged as private. So this
    // call cleanly handles both transitions (false→true and true→false).
    await recordBankPrivateMovement(t.tenantId, transactionId, t.userId);
  } catch (err) {
    console.error("[togglePrivateTransaction] fehlgeschlagen:", err);
    return { success: false, error: "Failed to update transaction." };
  }

  revalidatePath("/dashboard/bank");
  return { success: true };
}

export async function createReceiptFromTransaction(
  transactionId: string,
): Promise<{ success: true; documentId: string } | { success: false; error: string }> {
  const t = await requireTenant();

  const tx = await db.bankTransaction.findFirst({
    where: { id: transactionId, tenantId: t.tenantId },
  });
  if (!tx) return { success: false, error: "Transaction not found." };

  const absAmount = Math.abs(Number(tx.amount));
  const isIncome = Number(tx.amount) > 0;

  try {
    const doc = await db.document.create({
      data: {
        tenantId: t.tenantId,
        fileName: `Beleg – ${tx.counterpartName ?? "Unbekannt"} – ${tx.date
          .toISOString()
          .slice(0, 10)}`,
        fileType: "application/octet-stream",
        fileSize: 0,
        storagePath: "",
        status: "DRAFT",
        category: isIncome ? "INVOICE_INCOMING" : "RECEIPT",
        documentType: isIncome ? "INCOME" : "EXPENSE",
        recognizedAmount: absAmount,
        recognizedDate: tx.date,
        recognizedSupplier: tx.counterpartName,
        uploadedById: t.userId,
      },
    });

    await db.bankTransaction.update({
      where: { id: transactionId },
      data: {
        documentId: doc.id,
        invoiceId: null,
        status: TransactionStatus.MATCHED,
      },
    });

    await createAuditLog({
      action: "BANK_TRANSACTION_MATCHED",
      tenantId: t.tenantId,
      userId: t.userId,
      entityType: "BankTransaction",
      entityId: transactionId,
      details: { documentId: doc.id, createdFromTransaction: true },
    });

    revalidatePath("/dashboard/bank");
    return { success: true, documentId: doc.id };
  } catch (err) {
    console.error("[createReceiptFromTransaction] fehlgeschlagen:", err);
    return { success: false, error: "Failed to create receipt." };
  }
}

// ─── Matching candidates (Documents + Invoices) ──────────────────────────────

export interface MatchCandidate {
  kind: "document" | "invoice";
  id: string;
  label: string;
  sublabel: string | null;
  amount: number | null;
  date: string | null;
  invoiceType: "INVOICE" | "CREDIT_NOTE" | "CORRECTION" | null;
  documentType: "INCOME" | "EXPENSE" | null;
}

export async function listMatchCandidates(query?: string): Promise<MatchCandidate[]> {
  const t = await requireTenant();

  const q = query?.trim().toLowerCase() || "";

  const documents = await db.document.findMany({
    where: {
      tenantId: t.tenantId,
      deletedAt: null,
      AND: [
        { status: { not: "PAID" } },
        { payment: null },
        { transactions: { none: {} } },
        ...(q
          ? [
              {
                OR: [
                  { recognizedSupplier: { contains: q, mode: "insensitive" as const } },
                  { fileName: { contains: q, mode: "insensitive" as const } },
                  { documentNumber: { contains: q, mode: "insensitive" as const } },
                ],
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      fileName: true,
      recognizedSupplier: true,
      recognizedAmount: true,
      recognizedDate: true,
      category: true,
      documentType: true,
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  const invoices = await db.invoice.findMany({
    where: {
      tenantId: t.tenantId,
      AND: [
        { status: { notIn: ["PAID", "CANCELLED"] } },
        { transactions: { none: {} } },
        ...(q
          ? [
              {
                OR: [
                  { number: { contains: q, mode: "insensitive" as const } },
                  { contact: { is: { name: { contains: q, mode: "insensitive" as const } } } },
                ],
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      number: true,
      total: true,
      issueDate: true,
      status: true,
      type: true,
      contact: { select: { name: true } },
    },
    orderBy: { issueDate: "desc" },
    take: 25,
  });

  const docCandidates: MatchCandidate[] = documents.map((d) => ({
    kind: "document",
    id: d.id,
    label: d.recognizedSupplier || d.fileName,
    sublabel: d.category ? d.category.toString() : d.fileName,
    amount: d.recognizedAmount ? Number(d.recognizedAmount) : null,
    date: d.recognizedDate ? d.recognizedDate.toISOString() : null,
    invoiceType: null,
    documentType: d.documentType ?? null,
  }));

  const invCandidates: MatchCandidate[] = invoices.map((i) => ({
    kind: "invoice",
    id: i.id,
    label: i.number,
    sublabel: i.contact?.name ?? null,
    amount: Number(i.total),
    date: i.issueDate.toISOString(),
    invoiceType: i.type,
    documentType: null,
  }));

  return [...docCandidates, ...invCandidates];
}

// ─── Scored candidates for a specific transaction ─────────────────────────────

export interface ScoredMatchCandidate extends MatchCandidate {
  score: number;
  /** True when this candidate sits above the SUGGEST_THRESHOLD and ranks
   * within the top suggestion slot — used by the picker to render the
   * "Vorschlag" badge. */
  isSuggestion: boolean;
}

/**
 * Score the open documents/invoices against a given transaction and return
 * them sorted best-first. Sign-incompatible candidates are scored as 0 and
 * pushed to the bottom (matching the picker's existing UX).
 */
export async function listScoredMatchCandidates(
  transactionId: string,
  query?: string,
): Promise<ScoredMatchCandidate[]> {
  const t = await requireTenant();

  const tx = await db.bankTransaction.findFirst({
    where: { id: transactionId, tenantId: t.tenantId },
    select: {
      amount: true,
      counterpartName: true,
      purpose: true,
      date: true,
    },
  });
  if (!tx) return [];

  const candidates = await loadOpenCandidates(t.tenantId, query?.trim().toLowerCase() || "");
  return scoreAndRank(
    {
      amount: Number(tx.amount),
      counterpartName: tx.counterpartName,
      purpose: tx.purpose,
      date: tx.date,
    },
    candidates,
  );
}

function scoreAndRank(
  tx: ScoreInputTx,
  candidates: (MatchCandidate & { documentNumber?: string | null })[],
): ScoredMatchCandidate[] {
  const scored: ScoredMatchCandidate[] = candidates.map((c) => {
    const s = scoreCandidate(tx, c as ScoreInputCandidate);
    return {
      ...c,
      score: s ?? 0,
      isSuggestion: false,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  // Mark the single top candidate as "suggestion" when it crosses the
  // suggest threshold. We don't mark multiple — the UI affordance reads
  // best when it points at one row.
  if (scored.length > 0 && scored[0].score >= SUGGEST_THRESHOLD) {
    scored[0].isSuggestion = true;
  }
  return scored;
}

/**
 * Load the same open documents + invoices as listMatchCandidates but
 * include documentNumber so the scorer can match against Verwendungszweck.
 * Returned objects are MatchCandidate-shaped with an extra documentNumber.
 */
async function loadOpenCandidates(
  tenantId: string,
  q: string,
): Promise<(MatchCandidate & { documentNumber?: string | null })[]> {
  const documents = await db.document.findMany({
    where: {
      tenantId,
      deletedAt: null,
      AND: [
        { status: { not: "PAID" } },
        { payment: null },
        { transactions: { none: {} } },
        ...(q
          ? [
              {
                OR: [
                  { recognizedSupplier: { contains: q, mode: "insensitive" as const } },
                  { fileName: { contains: q, mode: "insensitive" as const } },
                  { documentNumber: { contains: q, mode: "insensitive" as const } },
                ],
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      fileName: true,
      recognizedSupplier: true,
      recognizedAmount: true,
      recognizedDate: true,
      category: true,
      documentType: true,
      documentNumber: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const invoices = await db.invoice.findMany({
    where: {
      tenantId,
      AND: [
        { status: { notIn: ["PAID", "CANCELLED"] } },
        { transactions: { none: {} } },
        ...(q
          ? [
              {
                OR: [
                  { number: { contains: q, mode: "insensitive" as const } },
                  { contact: { is: { name: { contains: q, mode: "insensitive" as const } } } },
                ],
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      number: true,
      total: true,
      issueDate: true,
      status: true,
      type: true,
      contact: { select: { name: true } },
    },
    orderBy: { issueDate: "desc" },
    take: 50,
  });

  const docs = documents.map((d) => ({
    kind: "document" as const,
    id: d.id,
    label: d.recognizedSupplier || d.fileName,
    sublabel: d.category ? d.category.toString() : d.fileName,
    amount: d.recognizedAmount ? Number(d.recognizedAmount) : null,
    date: d.recognizedDate ? d.recognizedDate.toISOString() : null,
    invoiceType: null,
    documentType: d.documentType ?? null,
    documentNumber: d.documentNumber,
  }));

  const invs = invoices.map((i) => ({
    kind: "invoice" as const,
    id: i.id,
    label: i.number,
    sublabel: i.contact?.name ?? null,
    amount: Number(i.total),
    date: i.issueDate.toISOString(),
    invoiceType: i.type,
    documentType: null,
    documentNumber: null,
  }));

  return [...docs, ...invs];
}

// ─── Auto-Match routine ───────────────────────────────────────────────────────

export interface AutoMatchResult {
  /** UNMATCHED transactions processed (excludes IGNORED + already MATCHED). */
  scanned: number;
  /** Transactions that were auto-linked. */
  matched: number;
  /** Transactions with a likely-but-not-confident candidate (UI banner / picker hint). */
  suggestions: number;
  /** Transactions with no candidate above SUGGEST_THRESHOLD. */
  unresolved: number;
}

/**
 * Walk every UNMATCHED transaction on the given bank account and try to
 * auto-link it to an open document/invoice. Sign-incompatible candidates
 * are excluded by the scorer. We only auto-link when:
 *   1. The best candidate's score is >= AUTO_THRESHOLD, AND
 *   2. The gap to the runner-up is >= AUTO_GAP (no ambiguous picks).
 *
 * A "taken" set prevents two transactions from being auto-linked to the
 * same candidate within one pass.
 */
export async function autoMatchBankAccount(
  bankAccountId: string,
): Promise<{ success: true; result: AutoMatchResult } | { success: false; error: string }> {
  const t = await requireTenant();

  const account = await db.bankAccount.findFirst({
    where: { id: bankAccountId, tenantId: t.tenantId },
    select: { id: true },
  });
  if (!account) return { success: false, error: "Bank account not found." };

  const unmatched = await db.bankTransaction.findMany({
    where: {
      bankAccountId,
      tenantId: t.tenantId,
      status: TransactionStatus.UNMATCHED,
      isPrivate: false,
    },
    select: {
      id: true,
      amount: true,
      counterpartName: true,
      purpose: true,
      date: true,
    },
    orderBy: { date: "desc" },
  });

  // Load the candidate pool ONCE per run. Re-querying per transaction
  // would be O(N·M) and the pool only changes when we actually link, so
  // we maintain a `taken` set instead.
  const pool = await loadOpenCandidates(t.tenantId, "");
  const taken = new Set<string>();

  const result: AutoMatchResult = {
    scanned: unmatched.length,
    matched: 0,
    suggestions: 0,
    unresolved: 0,
  };

  for (const tx of unmatched) {
    const available = pool.filter((c) => !taken.has(`${c.kind}:${c.id}`));
    const scored = scoreAndRank(
      {
        amount: Number(tx.amount),
        counterpartName: tx.counterpartName,
        purpose: tx.purpose,
        date: tx.date,
      },
      available,
    );

    const pick = pickAutoMatch(scored);
    if (pick) {
      const res =
        pick.kind === "document"
          ? await matchTransactionToDocument(tx.id, pick.id, { auto: true })
          : await matchTransactionToInvoice(tx.id, pick.id, { auto: true });
      if (res.success) {
        taken.add(`${pick.kind}:${pick.id}`);
        result.matched++;
        continue;
      }
      // Match server-side guard tripped (e.g. sign mismatch on edge cases).
      // Fall through to "unresolved" so the counter stays honest.
    }

    if (scored.length > 0 && scored[0].isSuggestion) {
      result.suggestions++;
    } else {
      result.unresolved++;
    }
  }

  await createAuditLog({
    action: "BANK_TRANSACTION_AUTO_MATCHED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "BankAccount",
    entityId: bankAccountId,
    details: {
      bulkRun: true,
      ...result,
    },
  });

  revalidatePath("/dashboard/bank");
  return { success: true, result };
}

// ─── Import Transactions (bulk) ───────────────────────────────────────────────

export interface ParsedTransaction {
  date: string;
  valueDate?: string | null;
  amount: number;
  counterpartName?: string | null;
  counterpartIban?: string | null;
  purpose?: string | null;
  externalId?: string | null;
}

export async function importTransactions(
  bankAccountId: string,
  transactions: ParsedTransaction[],
  source: "CSV" | "MT940" | "CAMT053",
): Promise<{ success: true; imported: number; skipped: number } | { success: false; error: string }> {
  const t = await requireTenant();

  if (!transactions.length) return { success: false, error: "No transactions to import." };

  // Verify the bank account belongs to this tenant
  const account = await db.bankAccount.findFirst({
    where: { id: bankAccountId, tenantId: t.tenantId },
    select: { id: true },
  });
  if (!account) return { success: false, error: "Bank account not found." };

  let imported = 0;
  let skipped = 0;

  try {
    for (const tx of transactions) {
      const txDate = new Date(tx.date);
      if (isNaN(txDate.getTime())) {
        skipped++;
        continue;
      }

      if (tx.externalId) {
        const existing = await db.bankTransaction.findUnique({
          where: {
            bankAccountId_externalId: {
              bankAccountId,
              externalId: tx.externalId,
            },
          },
        });
        if (existing) {
          skipped++;
          continue;
        }
      }

      await db.bankTransaction.create({
        data: {
          tenantId: t.tenantId,
          bankAccountId,
          date: txDate,
          valueDate: tx.valueDate ? new Date(tx.valueDate) : null,
          amount: tx.amount,
          counterpartName: tx.counterpartName?.trim() || null,
          counterpartIban: tx.counterpartIban?.replace(/\s/g, "").toUpperCase() || null,
          purpose: tx.purpose?.trim() || null,
          importSource: ImportSource[source],
          externalId: tx.externalId || null,
          status: TransactionStatus.UNMATCHED,
        },
      });
      imported++;
    }

    await createAuditLog({
      action: "BANK_TRANSACTION_IMPORTED",
      tenantId: t.tenantId,
      userId: t.userId,
      entityType: "BankAccount",
      entityId: bankAccountId,
      details: { source, imported, skipped },
    });
  } catch (err) {
    console.error("[importTransactions] fehlgeschlagen:", err);
    return { success: false, error: "Failed to import transactions." };
  }

  revalidatePath("/dashboard/bank");
  return { success: true, imported, skipped };
}

// ─── Cashbook ─────────────────────────────────────────────────────────────────

export async function upsertCashbookEntry(data: {
  id?: string;
  date: string;
  amount: number;
  entryType: "INCOME" | "EXPENSE";
  description: string;
  category?: string | null;
  /** Umsatzsteuersatz in Prozent. Null/0 = ohne Steuer. */
  vatRate?: number | null;
  documentId?: string | null;
}): Promise<ActionResult> {
  const t = await requireTenant();

  const entryDate = new Date(data.date);
  if (isNaN(entryDate.getTime())) return { success: false, error: "Invalid date." };
  if (data.amount <= 0) return { success: false, error: "Amount must be positive." };
  if (!data.description.trim()) return { success: false, error: "Description is required." };

  try {
    let entryId: string;
    if (data.id) {
      const result = await db.cashbookEntry.updateMany({
        where: { id: data.id, tenantId: t.tenantId },
        data: {
          date: entryDate,
          amount: data.amount,
          entryType: CashbookEntryType[data.entryType],
          description: data.description.trim(),
          category: data.category?.trim() || null,
          vatRate: data.vatRate ? data.vatRate : null,
          documentId: data.documentId || null,
        },
      });
      if (result.count === 0) return { success: false, error: "Not found." };
      entryId = data.id;
      await createAuditLog({
        action: "CASHBOOK_ENTRY_UPDATED",
        tenantId: t.tenantId,
        userId: t.userId,
        entityType: "CashbookEntry",
        entityId: data.id,
      });
    } else {
      const entry = await db.cashbookEntry.create({
        data: {
          tenantId: t.tenantId,
          date: entryDate,
          amount: data.amount,
          entryType: CashbookEntryType[data.entryType],
          description: data.description.trim(),
          category: data.category?.trim() || null,
          vatRate: data.vatRate ? data.vatRate : null,
          documentId: data.documentId || null,
        },
      });
      entryId = entry.id;
      await createAuditLog({
        action: "CASHBOOK_ENTRY_CREATED",
        tenantId: t.tenantId,
        userId: t.userId,
        entityType: "CashbookEntry",
        entityId: entry.id,
      });
    }
    // Mirror the cashbook entry into the journal. Idempotent: reverses any
    // prior posting on update, then reposts the current state.
    await recordCashbookEntry(t.tenantId, entryId, t.userId);
  } catch (err) {
    console.error("[upsertCashbookEntry] fehlgeschlagen:", err);
    return { success: false, error: "Failed to save cashbook entry." };
  }

  revalidatePath("/dashboard/bank");
  return { success: true };
}

export async function deleteCashbookEntry(id: string): Promise<ActionResult> {
  const t = await requireTenant();

  try {
    await reverseCashbookEntry(t.tenantId, id, t.userId);
    await db.cashbookEntry.deleteMany({ where: { id, tenantId: t.tenantId } });
    await createAuditLog({
      action: "CASHBOOK_ENTRY_DELETED",
      tenantId: t.tenantId,
      userId: t.userId,
      entityType: "CashbookEntry",
      entityId: id,
    });
  } catch (err) {
    console.error("[deleteCashbookEntry] fehlgeschlagen:", err);
    return { success: false, error: "Failed to delete cashbook entry." };
  }

  revalidatePath("/dashboard/bank");
  return { success: true };
}
