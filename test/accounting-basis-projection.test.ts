import { describe, expect, it } from "vitest";

import { projectCashBasisApplication } from "../src/accounting-basis-projection.js";
import type { LedgerPosting } from "../src/canonical-model.js";

const common = {
  tenantId: "tenant-1", sourceId: "native", transactionId: "invoice-1",
  postingDate: "2026-01-01", accountingBasis: "accrual" as const,
  currencyCode: "USD", dimensionHash: "dimension", dimensionRefs: [{ dimensionKind: "department", sourceDimensionId: "security" }],
  importBatchId: "original-batch"
};

const postings: readonly LedgerPosting[] = [
  { ...common, postingId: "ar", sourcePostingId: "ar", accountId: "ar", debitAmount: "100.00", creditAmount: "0.00", netAmount: "100.00" },
  { ...common, postingId: "revenue-1", sourcePostingId: "revenue-1", accountId: "revenue", debitAmount: "0.00", creditAmount: "60.00", netAmount: "-60.00" },
  { ...common, postingId: "revenue-2", sourcePostingId: "revenue-2", accountId: "revenue", debitAmount: "0.00", creditAmount: "40.00", netAmount: "-40.00" }
];

describe("cash-basis application projection", () => {
  it("recognizes partial applications proportionally and preserves dimensions", () => {
    const result = projectCashBasisApplication({
      applicationId: "application-1", applicationType: "customer_payment_to_invoice", action: "recognize",
      appliedAmount: "33.33", effectiveDate: "2026-02-01", importBatchId: "projection-batch", accrualPostings: postings
    });
    expect(result.map(({ debitAmount, creditAmount }) => [debitAmount, creditAmount])).toEqual([
      ["33.33", "0.00"], ["0.00", "20.00"], ["0.00", "13.33"]
    ]);
    expect(result[1]).toMatchObject({ accountingBasis: "cash", postingDate: "2026-02-01", dimensionHash: "dimension", dimensionRefs: common.dimensionRefs });
  });

  it("creates equal and opposite deterministic reversal postings", () => {
    const recognize = projectCashBasisApplication({ applicationId: "application-1", applicationType: "customer_payment_to_invoice", action: "recognize", appliedAmount: "33.33", effectiveDate: "2026-02-01", importBatchId: "batch", accrualPostings: postings });
    const reverse = projectCashBasisApplication({ applicationId: "application-1", applicationType: "customer_payment_to_invoice", action: "reverse", appliedAmount: "33.33", effectiveDate: "2026-03-01", importBatchId: "batch", accrualPostings: postings });
    expect(reverse.map(({ debitAmount, creditAmount }) => [debitAmount, creditAmount])).toEqual(recognize.map(({ debitAmount, creditAmount }) => [creditAmount, debitAmount]));
    expect(reverse[0]?.postingId).toBeDefined();
    expect(reverse[0]?.postingId).not.toBe(recognize[0]?.postingId);
  });

  it("rejects unsafe source journals and over-applications", () => {
    expect(() => projectCashBasisApplication({ applicationId: "x", applicationType: "bill_payment_to_bill", action: "recognize", appliedAmount: "100.01", effectiveDate: "2026-01-01", importBatchId: "batch", accrualPostings: postings })).toThrow(/no greater/);
    const firstPosting = postings[0];
    if (firstPosting === undefined) throw new Error("projection fixture requires a posting");
    expect(() => projectCashBasisApplication({ applicationId: "x", applicationType: "bill_payment_to_bill", action: "recognize", appliedAmount: "1.00", effectiveDate: "2026-01-01", importBatchId: "batch", accrualPostings: [{ ...firstPosting, accountingBasis: "cash" }] })).toThrow(/accrual postings only/);
  });
});
