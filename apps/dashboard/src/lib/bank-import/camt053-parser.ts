/**
 * CAMT.053 (ISO 20022) XML parser for bank statements.
 * Extracts transactions from <Ntry> elements.
 */

import type { ParsedTransaction } from "./types";

/** Simple XML text extractor — gets text content of first matching tag. */
function getTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

/** Get all occurrences of a tag block. */
function getBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = [];
  const openTag = `<${tag}`;
  const closeTag = `</${tag}>`;
  let pos = 0;

  while (pos < xml.length) {
    const start = xml.indexOf(openTag, pos);
    if (start === -1) break;
    const end = xml.indexOf(closeTag, start);
    if (end === -1) break;
    blocks.push(xml.slice(start, end + closeTag.length));
    pos = end + closeTag.length;
  }

  return blocks;
}

export function parseCamt053(content: string): {
  transactions: ParsedTransaction[];
  errors: string[];
} {
  const transactions: ParsedTransaction[] = [];
  const errors: string[] = [];

  // Check if this is a CAMT.053 document
  if (!content.includes("camt.053") && !content.includes("Ntry")) {
    errors.push("Not a valid CAMT.053 file.");
    return { transactions, errors };
  }

  const entries = getBlocks(content, "Ntry");

  entries.forEach((entry, idx) => {
    // Date: <BookgDt><Dt> or <ValDt><Dt>
    const bookingDateBlock = getBlocks(entry, "BookgDt")[0];
    const valueDateBlock = getBlocks(entry, "ValDt")[0];
    const date = bookingDateBlock ? getTag(bookingDateBlock, "Dt") : null;
    const valueDate = valueDateBlock ? getTag(valueDateBlock, "Dt") : null;

    if (!date) {
      errors.push(`Entry ${idx + 1}: Missing booking date.`);
      return;
    }

    // Amount: <Amt Ccy="EUR">1234.56</Amt>
    const amountStr = getTag(entry, "Amt");
    if (!amountStr) {
      errors.push(`Entry ${idx + 1}: Missing amount.`);
      return;
    }
    let amount = parseFloat(amountStr);

    // Credit/Debit indicator: <CdtDbtInd>CRDT</CdtDbtInd> or DBIT
    const cdtDbt = getTag(entry, "CdtDbtInd");
    if (cdtDbt === "DBIT") {
      amount = -Math.abs(amount);
    } else {
      amount = Math.abs(amount);
    }

    // Transaction details from <NtryDtls><TxDtls>
    const txDetails = getBlocks(entry, "TxDtls")[0] || "";

    // Counterpart name: <RltdPties><Dbtr|Cdtr><Nm>
    let counterpartName: string | null = null;
    const dbtrBlock = getBlocks(txDetails, "Dbtr")[0];
    const cdtrBlock = getBlocks(txDetails, "Cdtr")[0];
    const partyBlock = amount >= 0 ? dbtrBlock : cdtrBlock;
    if (partyBlock) {
      counterpartName = getTag(partyBlock, "Nm");
    }

    // Counterpart IBAN: <RltdPties><DbtrAcct|CdtrAcct><Id><IBAN>
    let counterpartIban: string | null = null;
    const dbtrAcctBlock = getBlocks(txDetails, "DbtrAcct")[0];
    const cdtrAcctBlock = getBlocks(txDetails, "CdtrAcct")[0];
    const acctBlock = amount >= 0 ? dbtrAcctBlock : cdtrAcctBlock;
    if (acctBlock) {
      counterpartIban = getTag(acctBlock, "IBAN");
    }

    // Purpose: <RmtInf><Ustrd>
    const rmtInf = getBlocks(entry, "RmtInf")[0] || getBlocks(txDetails, "RmtInf")[0] || "";
    const purpose = getTag(rmtInf, "Ustrd");

    // External ID: <AcctSvcrRef> or <TxId>
    const externalId =
      getTag(txDetails, "AcctSvcrRef") ||
      getTag(entry, "AcctSvcrRef") ||
      getTag(txDetails, "TxId") ||
      `camt-${date}-${idx}-${amount}`;

    transactions.push({
      date,
      valueDate: valueDate || null,
      amount,
      counterpartName: counterpartName || null,
      counterpartIban: counterpartIban || null,
      purpose: purpose || null,
      externalId,
    });
  });

  if (transactions.length === 0 && errors.length === 0) {
    errors.push("No transaction entries found in CAMT.053 file.");
  }

  return { transactions, errors };
}
