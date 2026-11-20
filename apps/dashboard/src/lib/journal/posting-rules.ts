// Posting rules: convert business events into JournalEntry drafts.
//
// One function per economic event. Each rule respects accountingMode:
// - DOUBLE_ENTRY → balanced debit/credit lines (Doppik)
// - SINGLE_ENTRY → one line per category (cash/EÜR style)
//
// All rules are pure: they take a record + context and return an EntryDraft
// (or null if nothing should be posted, e.g. Kleinunternehmer + invoice).

import type {
  Invoice,
  InvoiceLineItem,
  Document,
  DocumentLineItem,
  PaymentMethod,
  BankTransaction,
  CashbookEntry,
} from "@prisma/client";
import type { EntryDraft, LineDraft, PostingContext } from "./types";
import { round2 } from "./types";
import {
  inputVatAccount,
  inputVatCode,
  reverseChargeVatAccount,
  reverseChargeVatCode,
  reverseChargeInputVatAccount,
  reverseChargeInputVatCode,
  salesVatAccount,
  salesVatCode,
  salesVatCodeForRegulation,
  revenueAccountForRegulation,
  defaultRevenueAccount,
  defaultExpenseAccount,
  receivableAccount,
  payableAccount,
  bankAccount,
  cashAccount,
} from "./accounts";

// ── Helpers ─────────────────────────────────────────────────────────────────

function paymentAccount(skr: PostingContext["skrType"], method: PaymentMethod): string {
  if (method === "CASH") return cashAccount(skr);
  return bankAccount(skr); // BANK_TRANSFER, CREDIT_CARD, PAYPAL → bank-like
}

// ── Invoice issued (Ausgangsrechnung wird verschickt) ────────────────────────

type InvoiceForPosting = Invoice & { lineItems: InvoiceLineItem[] };

export function buildInvoiceIssuedEntry(
  invoice: InvoiceForPosting,
  ctx: PostingContext,
): EntryDraft | null {
  // Kleinunternehmer: no VAT — still record revenue, but skip VAT lines.
  // Non-standard regulations (reverse charge, intra-community, etc.) are
  // handled simplistically in Phase 1 — refine in Phase 2.
  const isCreditNote = invoice.type === "CREDIT_NOTE";
  const isCorrection = invoice.type === "CORRECTION";
  // Credit notes are stored with NEGATIVE amounts throughout (line items,
  // subtotal, total — see createCreditNote). Corrections store the *delta*
  // — negated originals plus the new positives, so the net can be positive
  // (under-billed → owed more) or negative (over-billed → refund due).
  // Either way the signs flow straight through here: a negative net puts
  // revenue on the debit side
  // and the receivable on the credit side, i.e. a correct reversal of the
  // original invoice's entry. No extra sign flip — that would double-negate.

  // Aggregate line items by VAT rate.
  const byRate = new Map<number, { net: number; vat: number }>();
  // Kleinunternehmer (§19 UStG) never charge VAT — normalise rate to 0
  // regardless of the invoice's vatRegulation setting so reports aggregate
  // cleanly. Also: non-STANDARD regulations (reverse charge, §13b, etc.)
  // don't carry VAT on the invoice.
  const effectiveRegulation = ctx.taxMode === "SMALL_BUSINESS" ? "NONE" : invoice.vatRegulation;
  for (const li of invoice.lineItems) {
    const net = Number(li.amount);
    const rate = effectiveRegulation === "STANDARD" ? li.vatRate : 0;
    const vat = (net * rate) / 100;
    const sub = byRate.get(rate) ?? { net: 0, vat: 0 };
    sub.net += net;
    sub.vat += vat;
    byRate.set(rate, sub);
  }

  const totalGross = [...byRate.values()].reduce((s, b) => s + b.net + b.vat, 0);
  if (Math.abs(totalGross) < 0.005) return null;

  // For non-STANDARD regulations (IG-Lieferung, §13b, §18b, Export, …) the
  // revenue is tax-free but must still surface in the UStVA under its own
  // Kennzahl. We resolve a regulation-specific revenue account + a 0%-tag
  // (`USt0:<TAG>`) once here so the rate=0 bucket below picks them up.
  // Kleinunternehmer (effectiveRegulation === "NONE") deliberately stays
  // on the generic 0% revenue account without a tag.
  const isSpecialRegulation =
    effectiveRegulation !== "NONE" &&
    effectiveRegulation !== "STANDARD" &&
    effectiveRegulation !== "SMALL_BUSINESS_19";
  const specialRevenueAccount = isSpecialRegulation
    ? revenueAccountForRegulation(ctx.skrType, effectiveRegulation)
    : null;
  const specialVatCode = isSpecialRegulation
    ? salesVatCodeForRegulation(effectiveRegulation)
    : null;

  const revenueAccountFor = (rate: number) =>
    rate === 0 && specialRevenueAccount
      ? specialRevenueAccount
      : defaultRevenueAccount(ctx.skrType, rate);

  const revenueVatCodeFor = (rate: number) =>
    rate === 0 && specialVatCode
      ? specialVatCode
      : rate > 0
        ? salesVatCode(rate) // SINGLE_ENTRY uses this; DOUBLE_ENTRY VAT is on its own line
        : null;

  const lines: LineDraft[] = [];

  if (ctx.accountingMode === "DOUBLE_ENTRY") {
    // Soll: Forderung (Bruttobetrag)
    lines.push({
      accountCode: receivableAccount(ctx.skrType),
      debit: round2(Math.abs(totalGross)) * (totalGross >= 0 ? 1 : 0),
      credit: round2(Math.abs(totalGross)) * (totalGross < 0 ? 1 : 0),
      description: `Forderung ${invoice.number}`,
    });
    // Haben: Erlöse + USt pro Satz
    for (const [rate, b] of byRate) {
      if (Math.abs(b.net) >= 0.005) {
        // Tag the revenue line for special regulations (0% turnover with
        // its own UStVA Kennzahl) so vat-return aggregation can find it.
        const tag = rate === 0 ? specialVatCode : null;
        lines.push({
          accountCode: revenueAccountFor(rate),
          debit: b.net < 0 ? round2(Math.abs(b.net)) : 0,
          credit: b.net >= 0 ? round2(Math.abs(b.net)) : 0,
          vatCode: tag,
          vatAmount: tag ? 0 : null,
          description: `Erlöse ${rate}%`,
        });
      }
      if (rate > 0 && Math.abs(b.vat) >= 0.005) {
        lines.push({
          accountCode: salesVatAccount(ctx.skrType, rate),
          debit: b.vat < 0 ? round2(Math.abs(b.vat)) : 0,
          credit: b.vat >= 0 ? round2(Math.abs(b.vat)) : 0,
          vatCode: salesVatCode(rate),
          vatAmount: round2(b.vat),
          description: `USt ${rate}%`,
        });
      }
    }
  } else {
    // SINGLE_ENTRY: one line per rate, recording net revenue only.
    for (const [rate, b] of byRate) {
      if (Math.abs(b.net) < 0.005) continue;
      const code = revenueVatCodeFor(rate);
      lines.push({
        accountCode: revenueAccountFor(rate),
        debit: b.net < 0 ? round2(Math.abs(b.net)) : 0,
        credit: b.net >= 0 ? round2(Math.abs(b.net)) : 0,
        vatCode: code,
        vatAmount: rate > 0 ? round2(b.vat) : code ? 0 : null,
        description: `Erlöse ${rate}%`,
      });
    }
  }

  return {
    date: invoice.issueDate,
    description: `${isCreditNote ? "Gutschrift" : isCorrection ? "Rechnungskorrektur" : "Rechnung"} ${invoice.number}`,
    sourceType: "INVOICE",
    sourceId: invoice.id,
    lines,
  };
}

// ── Invoice paid (Zahlungseingang) ───────────────────────────────────────────

export function buildInvoicePaymentEntry(
  invoice: Invoice,
  paidAt: Date,
  method: PaymentMethod,
  ctx: PostingContext,
): EntryDraft | null {
  // Credit notes carry a NEGATIVE total. A negative gross puts the bank
  // account on the credit side (cash outflow / refund) and the receivable
  // on the debit side — the mirror of an invoice payment. No sign flip:
  // the stored amount is already signed correctly.
  const gross = Number(invoice.total);
  if (Math.abs(gross) < 0.005) return null;

  const bank = paymentAccount(ctx.skrType, method);

  if (ctx.accountingMode === "DOUBLE_ENTRY") {
    return {
      date: paidAt,
      description: `Zahlungseingang ${invoice.number}`,
      sourceType: "INVOICE_PAYMENT",
      sourceId: invoice.id,
      lines: [
        {
          accountCode: bank,
          debit: gross >= 0 ? round2(Math.abs(gross)) : 0,
          credit: gross < 0 ? round2(Math.abs(gross)) : 0,
          description: `Bank ${invoice.number}`,
        },
        {
          accountCode: receivableAccount(ctx.skrType),
          debit: gross < 0 ? round2(Math.abs(gross)) : 0,
          credit: gross >= 0 ? round2(Math.abs(gross)) : 0,
          description: `Forderungsausgleich ${invoice.number}`,
        },
      ],
    };
  }

  // SINGLE_ENTRY: cash basis — record income at payment time.
  return {
    date: paidAt,
    description: `Einnahme ${invoice.number}`,
    sourceType: "INVOICE_PAYMENT",
    sourceId: invoice.id,
    lines: [
      {
        accountCode: bank,
        debit: gross >= 0 ? round2(Math.abs(gross)) : 0,
        credit: gross < 0 ? round2(Math.abs(gross)) : 0,
        description: `Einnahme ${invoice.number}`,
      },
    ],
  };
}

// ── Document booked (Eingangsrechnung wird komplett gebucht) ─────────────────

type DocumentForPosting = Document & { lineItems: DocumentLineItem[] };

export function buildDocumentBookedEntry(
  doc: DocumentForPosting,
  ctx: PostingContext,
): EntryDraft | null {
  if (doc.documentType !== "EXPENSE") return null;

  // Umkehr der Steuerschuld (§ 13b UStG, innergemeinschaftlicher Erwerb) und
  // Einfuhrumsatzsteuer laufen über einen eigenen Pfad: dort weist der
  // Lieferant netto aus, die Steuer schulden wir selbst.
  if (doc.inputVatKind) return buildReverseChargeDocumentEntry(doc, ctx);

  // Aggregate line items into per-account net amounts and per-rate VAT totals.
  const byAccount = new Map<string, { net: number; rate: number }>();
  let totalGross = 0;
  let totalVatByRate = new Map<number, number>();

  if (doc.lineItems.length > 0) {
    for (const li of doc.lineItems) {
      const gross = li.total ? Number(li.total) : 0;
      if (gross === 0) continue;
      const rate = li.vatRate ? Number(li.vatRate) : 0;
      // Steht auf dem Beleg ein Steuerbetrag, gilt dieser. Lieferanten dürfen
      // je Position runden (§ 14 UStG), die Summe weicht dann von der
      // Rückrechnung aus dem Brutto ab — und für den Vorsteuerabzug zählt der
      // ausgewiesene Betrag, nicht unsere Rechnung.
      const statedVat = li.vatAmount != null ? Number(li.vatAmount) : null;
      const vat = statedVat ?? (rate > 0 ? gross - gross / (1 + rate / 100) : 0);
      const net = gross - vat;
      const account = li.skrAccount || doc.bookingAccount || defaultExpenseAccount(ctx.skrType);
      const cur = byAccount.get(account) ?? { net: 0, rate };
      cur.net += net;
      byAccount.set(account, cur);
      totalGross += gross;
      if (rate > 0) totalVatByRate.set(rate, (totalVatByRate.get(rate) ?? 0) + vat);
    }
  } else if (doc.recognizedAmount) {
    const gross = Number(doc.recognizedAmount);
    const rate = doc.vatRate ? Number(doc.vatRate) : 0;
    const net = rate > 0 ? gross / (1 + rate / 100) : gross;
    const vat = gross - net;
    const account = doc.bookingAccount || defaultExpenseAccount(ctx.skrType);
    byAccount.set(account, { net, rate });
    totalGross = gross;
    if (rate > 0) totalVatByRate.set(rate, vat);
  }

  if (Math.abs(totalGross) < 0.005) return null;

  // Kleinunternehmer: no input VAT deduction — book everything gross to expense.
  const allowVatDeduction =
    ctx.taxMode === "STANDARD" && ctx.accountingMode === "DOUBLE_ENTRY";

  const lines: LineDraft[] = [];
  const date = doc.deliveryDate ?? doc.recognizedDate ?? doc.createdAt;

  if (ctx.accountingMode === "DOUBLE_ENTRY") {
    // Soll: Aufwand (netto pro Konto) — for Kleinunternehmer use gross
    for (const [account, { net, rate }] of byAccount) {
      const debitAmount = allowVatDeduction ? net : net * (1 + rate / 100);
      if (Math.abs(debitAmount) < 0.005) continue;
      lines.push({
        accountCode: account,
        debit: round2(debitAmount),
        credit: 0,
        description: doc.recognizedSupplier ?? doc.fileName,
      });
    }
    // Soll: Vorsteuer pro Satz (only if deductible)
    if (allowVatDeduction) {
      for (const [rate, vat] of totalVatByRate) {
        if (Math.abs(vat) < 0.005) continue;
        lines.push({
          accountCode: inputVatAccount(ctx.skrType, rate),
          debit: round2(vat),
          credit: 0,
          vatCode: inputVatCode(rate),
          vatAmount: round2(vat),
          description: `Vorsteuer ${rate}%`,
        });
      }
    }
    // Haben: Verbindlichkeit (brutto)
    lines.push({
      accountCode: payableAccount(ctx.skrType),
      debit: 0,
      credit: round2(totalGross),
      description: `Verbindlichkeit ${doc.recognizedSupplier ?? doc.fileName}`,
    });
  } else {
    // SINGLE_ENTRY: one expense line per account (gross). Kleinunternehmer
    // dürfen keine Vorsteuer ziehen — Lines also bewusst ohne vatCode/-Amount,
    // sonst tauchen sie in der UStVA-Aggregation als Vorsteuer auf.
    for (const [account, { net, rate }] of byAccount) {
      const gross = net * (1 + rate / 100);
      if (Math.abs(gross) < 0.005) continue;
      const taggable = rate > 0 && ctx.taxMode === "STANDARD";
      lines.push({
        accountCode: account,
        debit: round2(gross),
        credit: 0,
        vatCode: taggable ? inputVatCode(rate) : null,
        vatAmount: taggable ? round2(gross - net) : null,
        description: doc.recognizedSupplier ?? doc.fileName,
      });
    }
  }

  return {
    date,
    description: `Beleg ${doc.documentNumber ?? doc.fileName}`,
    sourceType: "DOCUMENT",
    sourceId: doc.id,
    lines,
  };
}

// ── Umkehr der Steuerschuld auf der Eingangsseite ────────────────────────────
//
// Betrifft § 13b UStG (der Regelfall bei Software-, Werbe- und Plattform-
// leistungen aus dem EU-Ausland), den innergemeinschaftlichen Erwerb von
// Waren sowie die Einfuhrumsatzsteuer.
//
// Zwei Dinge unterscheiden sich vom Normalfall:
//
// 1. Der Rechnungsbetrag IST das Netto. Der Lieferant weist keine Steuer aus,
//    also darf hier nicht aus dem Brutto herausgerechnet werden.
// 2. Es entstehen zwei Steuerpositionen: die von uns geschuldete Umsatzsteuer
//    (Haben) und — bei Vorsteuerabzugsberechtigung — die abziehbare Vorsteuer
//    in gleicher Höhe (Soll). In der UStVA sind das getrennte Kennzahlen.
//
// Die Aufwandszeile trägt den Steuerschlüssel der geschuldeten Steuer. Sie
// führt damit sowohl die Bemessungsgrundlage (ihr Nettobetrag) als auch den
// Steuerbetrag (`vatAmount`) — genau das Paar, das die UStVA für Kz 46/47,
// 84/85, 73/74 bzw. 89/93 braucht. Die Gegenbuchung auf dem Steuerkonto bleibt
// bewusst ohne Schlüssel, sonst würde der Betrag doppelt gezählt.

function buildReverseChargeDocumentEntry(
  doc: DocumentForPosting,
  ctx: PostingContext,
): EntryDraft | null {
  const kind = doc.inputVatKind;
  if (!kind) return null;

  const date = doc.deliveryDate ?? doc.recognizedDate ?? doc.createdAt;
  const description = doc.recognizedSupplier ?? doc.fileName;
  // Kleinunternehmer schulden die Steuer nach § 13b ebenfalls, dürfen sie aber
  // nicht als Vorsteuer abziehen (§ 19 Absatz 1 UStG). Siehe Anleitung USt 1 E,
  // Hinweise zu den Zeilen 30 bis 32.
  const allowVatDeduction = ctx.taxMode === "STANDARD";

  // ── Einfuhrumsatzsteuer ───────────────────────────────────────────────────
  // Der Beleg ist der Steuerbescheid des Zolls; der ausgewiesene Betrag IST
  // die Steuer. Es gibt keine eigene Umsatzsteuerschuld, nur den Vorsteuerabzug.
  if (kind === "IMPORT_VAT") {
    const amount = round2(
      doc.lineItems.length > 0
        ? doc.lineItems.reduce((s, li) => s + (li.total ? Number(li.total) : 0), 0)
        : Number(doc.recognizedAmount ?? 0),
    );
    if (Math.abs(amount) < 0.005 || !allowVatDeduction) return null;

    return {
      date,
      description: `Einfuhrumsatzsteuer ${doc.documentNumber ?? doc.fileName}`,
      sourceType: "DOCUMENT",
      sourceId: doc.id,
      lines: [
        {
          accountCode: reverseChargeInputVatAccount(ctx.skrType, kind, 0),
          debit: amount,
          credit: 0,
          vatCode: reverseChargeInputVatCode(kind),
          vatAmount: amount,
          description: `Einfuhrumsatzsteuer ${description}`,
        },
        {
          accountCode: payableAccount(ctx.skrType),
          debit: 0,
          credit: amount,
          description: `Verbindlichkeit ${description}`,
        },
      ],
    };
  }

  // ── § 13b / innergemeinschaftlicher Erwerb ────────────────────────────────
  // Netto je Aufwandskonto sammeln. Anders als im Normalfall ist `total` hier
  // bereits der Nettobetrag — der Lieferant hat keine Steuer ausgewiesen.
  const byAccount = new Map<string, { net: number; rate: number }>();

  if (doc.lineItems.length > 0) {
    for (const li of doc.lineItems) {
      const net = li.total ? Number(li.total) : 0;
      if (net === 0) continue;
      const rate = li.vatRate ? Number(li.vatRate) : Number(doc.vatRate ?? 0);
      const account = li.skrAccount || doc.bookingAccount || defaultExpenseAccount(ctx.skrType);
      const cur = byAccount.get(account) ?? { net: 0, rate };
      cur.net += net;
      byAccount.set(account, cur);
    }
  } else if (doc.recognizedAmount) {
    const account = doc.bookingAccount || defaultExpenseAccount(ctx.skrType);
    byAccount.set(account, {
      net: Number(doc.recognizedAmount),
      rate: Number(doc.vatRate ?? 0),
    });
  }

  const totalNet = round2([...byAccount.values()].reduce((s, b) => s + b.net, 0));
  if (Math.abs(totalNet) < 0.005) return null;

  const lines: LineDraft[] = [];
  const taxByRate = new Map<number, number>();

  // Soll: Aufwand netto, mit dem Steuerschlüssel der geschuldeten Steuer.
  for (const [account, { net, rate }] of byAccount) {
    if (Math.abs(net) < 0.005) continue;
    const tax = round2((net * rate) / 100);
    if (rate > 0) taxByRate.set(rate, round2((taxByRate.get(rate) ?? 0) + tax));
    lines.push({
      accountCode: account,
      debit: round2(net),
      credit: 0,
      vatCode: reverseChargeVatCode(kind, rate),
      vatAmount: tax,
      description,
    });
  }

  // Haben: geschuldete Umsatzsteuer. Ohne Steuerschlüssel — die Aufwandszeile
  // trägt den Betrag bereits in die Voranmeldung.
  for (const [rate, tax] of taxByRate) {
    if (Math.abs(tax) < 0.005) continue;
    lines.push({
      accountCode: reverseChargeVatAccount(ctx.skrType, kind, rate),
      debit: 0,
      credit: tax,
      description: `Umsatzsteuer ${rate}% (Steuerschuldumkehr)`,
    });
  }

  // Soll: abziehbare Vorsteuer in gleicher Höhe — nur bei Regelbesteuerung.
  if (allowVatDeduction) {
    for (const [rate, tax] of taxByRate) {
      if (Math.abs(tax) < 0.005) continue;
      lines.push({
        accountCode: reverseChargeInputVatAccount(ctx.skrType, kind, rate),
        debit: tax,
        credit: 0,
        vatCode: reverseChargeInputVatCode(kind),
        vatAmount: tax,
        description: `Vorsteuer ${rate}% (Steuerschuldumkehr)`,
      });
    }
  }

  // Haben: Verbindlichkeit gegenüber dem Lieferanten — netto, denn genau das
  // steht auf der Rechnung.
  lines.push({
    accountCode: payableAccount(ctx.skrType),
    debit: 0,
    credit: round2(totalNet),
    description: `Verbindlichkeit ${description}`,
  });

  return {
    date,
    description: `Beleg ${doc.documentNumber ?? doc.fileName}`,
    sourceType: "DOCUMENT",
    sourceId: doc.id,
    lines,
  };
}

// ── Document paid (Belegzahlung) ─────────────────────────────────────────────

export function buildDocumentPaymentEntry(
  doc: Document,
  paidAt: Date,
  method: PaymentMethod,
  ctx: PostingContext,
): EntryDraft | null {
  const gross = doc.recognizedAmount ? Number(doc.recognizedAmount) : 0;
  if (Math.abs(gross) < 0.005) return null;

  const bank = paymentAccount(ctx.skrType, method);

  if (ctx.accountingMode === "DOUBLE_ENTRY") {
    return {
      date: paidAt,
      description: `Zahlungsausgang Beleg ${doc.documentNumber ?? doc.fileName}`,
      sourceType: "DOCUMENT_PAYMENT",
      sourceId: doc.id,
      lines: [
        {
          accountCode: payableAccount(ctx.skrType),
          debit: round2(gross),
          credit: 0,
          description: `Verbindlichkeitsausgleich`,
        },
        {
          accountCode: bank,
          debit: 0,
          credit: round2(gross),
          description: `Bank`,
        },
      ],
    };
  }

  // SINGLE_ENTRY: nothing extra — expense already booked at DOCUMENT event
  // would double-count. In cash-basis, we skip the booking event itself and
  // only record the payment. Convention for Phase 1: always emit an entry,
  // mark with explicit account so downstream reports can decide.
  return {
    date: paidAt,
    description: `Ausgabe Beleg ${doc.documentNumber ?? doc.fileName}`,
    sourceType: "DOCUMENT_PAYMENT",
    sourceId: doc.id,
    lines: [
      {
        accountCode: bank,
        debit: 0,
        credit: round2(gross),
        description: `Bank`,
      },
    ],
  };
}

// ── Bank: Privatentnahme / Privateinlage ────────────────────────────────────
//
// Wird nur erzeugt wenn `isPrivate=true` auf der BankTransaction gesetzt ist.
// Geschäftliche Bewegungen ohne private Markierung gelangen ausschließlich
// über das Matching zu Invoice/Document ins Journal — das deckt der bestehende
// `buildInvoicePaymentEntry` bzw. `buildDocumentPaymentEntry` ab.
//
// Konten je SKR:
//   SKR03: Privatentnahmen 1800 · Privateinlagen 1890
//   SKR04: Privatentnahmen 2100 · Privateinlagen 2180

function privateWithdrawalAccount(skr: PostingContext["skrType"]): string {
  return skr === "SKR03" ? "1800" : "2100";
}
function privateDepositAccount(skr: PostingContext["skrType"]): string {
  return skr === "SKR03" ? "1890" : "2180";
}

export function buildBankPrivateMovementEntry(
  tx: BankTransaction,
  ctx: PostingContext,
): EntryDraft | null {
  if (!tx.isPrivate) return null;

  const amount = Number(tx.amount);
  if (Math.abs(amount) < 0.005) return null;

  // amount > 0 → Geld auf das Geschäftskonto eingelegt (Einlage)
  // amount < 0 → Geld aus dem Geschäftskonto entnommen (Entnahme)
  const isDeposit = amount > 0;
  const privateAccount = isDeposit
    ? privateDepositAccount(ctx.skrType)
    : privateWithdrawalAccount(ctx.skrType);
  const bank = bankAccount(ctx.skrType);
  const abs = round2(Math.abs(amount));
  const label = isDeposit ? "Privateinlage" : "Privatentnahme";
  const description = `${label}${tx.purpose ? ` — ${tx.purpose}` : ""}`;

  if (ctx.accountingMode === "DOUBLE_ENTRY") {
    return {
      date: tx.date,
      description,
      sourceType: "BANK_TRANSACTION",
      sourceId: tx.id,
      lines: isDeposit
        ? [
            // Einlage: Bank Soll an Privateinlage Haben
            { accountCode: bank, debit: abs, credit: 0, description: label },
            { accountCode: privateAccount, debit: 0, credit: abs, description: label },
          ]
        : [
            // Entnahme: Privatentnahme Soll an Bank Haben
            { accountCode: privateAccount, debit: abs, credit: 0, description: label },
            { accountCode: bank, debit: 0, credit: abs, description: label },
          ],
    };
  }

  // SINGLE_ENTRY: eine Zeile auf dem Privatkonto, damit Privatbewegungen aus
  // dem EÜR-Profit raus aggregiert werden können (sie sind ja per Definition
  // weder Einnahme noch Aufwand).
  return {
    date: tx.date,
    description,
    sourceType: "BANK_TRANSACTION",
    sourceId: tx.id,
    lines: [
      {
        accountCode: privateAccount,
        debit: isDeposit ? 0 : abs,
        credit: isDeposit ? abs : 0,
        description: label,
      },
    ],
  };
}

// ── Cashbook (Kassenbuch) ───────────────────────────────────────────────────
//
// CashbookEntries repräsentieren Bargeldbewegungen — werden gegen das
// Kassenkonto gebucht (SKR03 1000 / SKR04 1600). Wenn die Cashbook-Zeile
// einen `documentId` hat, wird zusätzlich auf das Belegkonto gebucht
// (Aufwand bzw. Erlös). Ohne Beleg fallen wir auf die SKR-Default-Konten
// zurück.
//
// Umsatzsteuer: `amount` ist immer brutto. Trägt der Vorgang einen
// `vatRate`, wird die Steuer abgespalten und mit einem Steuerschlüssel
// versehen, damit sie in der Voranmeldung landet — bei Einnahmen als
// Umsatzsteuer, bei Ausgaben als Vorsteuer. Ohne Satz bleibt es wie bisher
// bei einer reinen Brutto-Buchung; das ist der richtige Fall für
// Privateinlagen, durchlaufende Posten und Kleinunternehmer.
//
// Bei `category` (free-form String) prüfen wir, ob er einer 3- oder
// 4-stelligen SKR-Kontonummer entspricht, sonst Default.

function isSkrCode(s: string): boolean {
  return /^[0-9]{3,4}$/.test(s);
}

export function buildCashbookEntry(
  entry: CashbookEntry,
  ctx: PostingContext,
): EntryDraft | null {
  const amount = Number(entry.amount);
  if (Math.abs(amount) < 0.005) return null;

  const cash = cashAccount(ctx.skrType);
  const isIncome = entry.entryType === "INCOME";
  const categoryAccount = entry.category && isSkrCode(entry.category)
    ? entry.category
    : null;

  // Kleinunternehmer weisen keine Umsatzsteuer aus und dürfen keine Vorsteuer
  // ziehen — ein Steuersatz am Kassenvorgang wird dort ignoriert.
  const rate = ctx.taxMode === "STANDARD" ? Number(entry.vatRate ?? 0) : 0;
  const gross = round2(Math.abs(amount));
  // Steuer laut Beleg hat Vorrang vor der Rückrechnung, gleiche Begründung
  // wie bei Belegpositionen (§ 14 UStG erlaubt positionsweise Rundung).
  const statedVat = entry.vatAmount != null ? Number(entry.vatAmount) : null;
  const vat = rate > 0 ? round2(statedVat ?? gross - gross / (1 + rate / 100)) : 0;
  const net = round2(gross - vat);

  const counterAccount = categoryAccount ??
    (isIncome
      ? defaultRevenueAccount(ctx.skrType, rate)
      : defaultExpenseAccount(ctx.skrType));

  const description = `Kasse: ${entry.description}`;

  if (ctx.accountingMode === "DOUBLE_ENTRY") {
    const lines: LineDraft[] = [];
    if (isIncome) {
      // Kasse Soll (brutto) an Erlös + Umsatzsteuer Haben
      lines.push({ accountCode: cash, debit: gross, credit: 0, description: entry.description });
      lines.push({
        accountCode: counterAccount,
        debit: 0,
        credit: net,
        description: entry.description,
      });
      if (vat > 0) {
        lines.push({
          accountCode: salesVatAccount(ctx.skrType, rate),
          debit: 0,
          credit: vat,
          vatCode: salesVatCode(rate),
          vatAmount: vat,
          description: `USt ${rate}%`,
        });
      }
    } else {
      // Aufwand + Vorsteuer Soll an Kasse Haben (brutto)
      lines.push({
        accountCode: counterAccount,
        debit: net,
        credit: 0,
        description: entry.description,
      });
      if (vat > 0) {
        lines.push({
          accountCode: inputVatAccount(ctx.skrType, rate),
          debit: vat,
          credit: 0,
          vatCode: inputVatCode(rate),
          vatAmount: vat,
          description: `Vorsteuer ${rate}%`,
        });
      }
      lines.push({ accountCode: cash, debit: 0, credit: gross, description: entry.description });
    }
    return {
      date: entry.date,
      description,
      sourceType: "MANUAL",
      sourceId: entry.id,
      lines,
    };
  }

  // SINGLE_ENTRY: cash-basis — eine Zeile auf dem Kassenkonto, Vorzeichen
  // signalisiert Income/Expense für Reports. Der Steuerschlüssel hängt an
  // dieser Zeile, damit die Voranmeldung sie trotzdem findet.
  const code = vat > 0 ? (isIncome ? salesVatCode(rate) : inputVatCode(rate)) : null;
  return {
    date: entry.date,
    description,
    sourceType: "MANUAL",
    sourceId: entry.id,
    lines: [
      {
        accountCode: cash,
        debit: isIncome ? gross : 0,
        credit: isIncome ? 0 : gross,
        vatCode: code,
        vatAmount: code ? vat : null,
        description: entry.description,
      },
    ],
  };
}
