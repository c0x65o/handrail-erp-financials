import { createHash } from "node:crypto";

import type { DecimalString, IsoDate, LedgerPosting } from "./canonical-model.js";

export type StandardAccountingMethod = "cash" | "accrual";
export type ManualJournalAccountingPolicy = "configured_basis_only" | "mirror_cash_and_accrual";
export type CashBasisApplicationType =
  | "customer_payment_to_invoice"
  | "bill_payment_to_bill"
  | "customer_refund_against_invoice";
export type CashBasisProjectionAction = "recognize" | "reverse";

export type CashBasisApplicationProjectionInput = {
  readonly applicationId: string;
  readonly applicationType: CashBasisApplicationType;
  readonly action: CashBasisProjectionAction;
  readonly appliedAmount: DecimalString;
  readonly effectiveDate: IsoDate;
  readonly importBatchId: string;
  readonly accrualPostings: readonly LedgerPosting[];
};

/**
 * Materializes the cash-basis view of an invoice or bill application. A partial
 * application recognizes each original line proportionally (largest remainder),
 * while retaining its dimensions and source provenance. Unapply/void uses the
 * same deterministic allocation with debit and credit reversed.
 */
export function projectCashBasisApplication(input: CashBasisApplicationProjectionInput): readonly LedgerPosting[] {
  const postings = input.accrualPostings;
  const first = postings[0];
  if (first === undefined) throw new Error("Cash-basis projection requires accrual postings");
  if (postings.some((posting) => posting.accountingBasis !== "accrual")) {
    throw new Error("Cash-basis projection accepts accrual postings only");
  }
  if (postings.some((posting) => posting.tenantId !== first.tenantId || posting.sourceId !== first.sourceId || posting.transactionId !== first.transactionId || posting.currencyCode !== first.currencyCode)) {
    throw new Error("Cash-basis projection postings must share scope, transaction, and currency");
  }
  const debit = postings.reduce((sum, posting) => sum + moneyMinor(posting.debitAmount), 0n);
  const credit = postings.reduce((sum, posting) => sum + moneyMinor(posting.creditAmount), 0n);
  if (debit === 0n || debit !== credit) throw new Error("Cash-basis projection source journal must be balanced");
  const applied = moneyMinor(input.appliedAmount);
  if (applied <= 0n || applied > debit) throw new Error("Applied amount must be positive and no greater than the source journal total");

  const debitAllocations = allocate(postings.map((posting) => moneyMinor(posting.debitAmount)), applied, debit);
  const creditAllocations = allocate(postings.map((posting) => moneyMinor(posting.creditAmount)), applied, credit);
  return postings.flatMap((posting, index) => {
    let projectedDebit = debitAllocations[index] ?? 0n;
    let projectedCredit = creditAllocations[index] ?? 0n;
    if (projectedDebit === 0n && projectedCredit === 0n) return [];
    if (input.action === "reverse") [projectedDebit, projectedCredit] = [projectedCredit, projectedDebit];
    const identity = [input.applicationId, input.action, posting.sourcePostingId].join("\u0000");
    const digest = createHash("sha256").update(identity).digest("hex").slice(0, 24);
    return [{
      ...posting,
      postingId: `posting_cash_${digest}`,
      sourcePostingId: `cash-application:${input.applicationId}:${input.action}:${posting.sourcePostingId}`,
      postingDate: input.effectiveDate,
      accountingBasis: "cash" as const,
      debitAmount: minorMoney(projectedDebit),
      creditAmount: minorMoney(projectedCredit),
      netAmount: minorMoney(projectedDebit - projectedCredit),
      importBatchId: input.importBatchId
    }];
  });
}

function allocate(amounts: readonly bigint[], target: bigint, total: bigint): readonly bigint[] {
  const shares = amounts.map((amount, index) => ({ index, floor: amount * target / total, remainder: amount * target % total }));
  let remaining = target - shares.reduce((sum, share) => sum + share.floor, 0n);
  for (const share of [...shares].sort((left, right) => left.remainder === right.remainder ? left.index - right.index : left.remainder > right.remainder ? -1 : 1)) {
    if (remaining === 0n) break;
    if ((amounts[share.index] ?? 0n) > 0n) { share.floor += 1n; remaining -= 1n; }
  }
  return shares.sort((left, right) => left.index - right.index).map((share) => share.floor);
}

function moneyMinor(value: DecimalString): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (match === null) throw new Error(`Invalid money value: ${value}`);
  const whole = match[2];
  if (whole === undefined) throw new Error(`Invalid money value: ${value}`);
  const amount = BigInt(whole) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  return match[1] === "-" ? -amount : amount;
}

function minorMoney(value: bigint): DecimalString {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${(absolute / 100n).toString()}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
