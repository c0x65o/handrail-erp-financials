import { describe, expect, it } from "vitest";

import {
  assertPaymentApplication,
  assertPostingRule,
  assertTransactionMatchCandidate,
  assertTransactionMatchDecision,
  evaluatePostingRules
} from "../src/index.js";

import type {
  PaymentApplication,
  PostingRule,
  PostingRuleAction,
  PostingRuleEvaluationInput,
  TransactionMatchCandidate,
  TransactionMatchDecision
} from "../src/index.js";

const postingRule: PostingRule = {
  postingRuleId: "rule_customer_payment",
  tenantId: "tenant_1",
  sourceId: "source_native_erp",
  ruleCode: "customer-payment-default",
  name: "Customer payment",
  priority: 100,
  status: "active",
  conditionMode: "all",
  conditions: [
    {
      field: "source_transaction_type",
      operator: "equals",
      value: "Payment"
    }
  ],
  actions: [
    {
      kind: "create_posting",
      side: "debit",
      accountId: "acct_operating_cash",
      amount: { kind: "transaction_amount" },
      partySource: "transaction_party"
    },
    {
      kind: "create_posting",
      side: "credit",
      accountId: "acct_accounts_receivable",
      amount: { kind: "transaction_amount" },
      partySource: "transaction_party"
    }
  ],
  effectiveFrom: "2026-01-01",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

const matchCandidate: TransactionMatchCandidate = {
  matchCandidateId: "candidate_payment_invoice",
  tenantId: "tenant_1",
  sourceId: "source_native_erp",
  matchKind: "customer_payment_to_invoice",
  originTransactionId: "txn_payment_1",
  targetTransactionId: "txn_invoice_1",
  matcherVersion: "customer-payment-v1",
  score: "0.95",
  suggestedApplicationAmount: "1250.00",
  currencyCode: "USD",
  status: "suggested",
  evidence: [
    { criterion: "party", matched: true, weight: "0.40", score: "1.00" },
    { criterion: "amount", matched: true, weight: "0.35", score: "1.00" },
    { criterion: "reference", matched: true, weight: "0.25", score: "0.80", detail: "INV-1001" }
  ],
  createdAt: "2026-01-15T12:00:00.000Z",
  expiresAt: "2026-02-15T12:00:00.000Z"
};

const matchDecision: TransactionMatchDecision = {
  matchDecisionId: "decision_payment_invoice",
  matchCandidateId: matchCandidate.matchCandidateId,
  tenantId: matchCandidate.tenantId,
  sourceId: matchCandidate.sourceId,
  decision: "accepted",
  method: "manual",
  decidedAt: "2026-01-15T13:00:00.000Z",
  decidedByRef: "user_42",
  reason: "Remittance reference confirmed"
};

const paymentApplication: PaymentApplication = {
  paymentApplicationId: "application_payment_invoice",
  tenantId: matchCandidate.tenantId,
  sourceId: matchCandidate.sourceId,
  paymentTransactionId: matchCandidate.originTransactionId,
  invoiceTransactionId: matchCandidate.targetTransactionId,
  matchDecisionId: matchDecision.matchDecisionId,
  appliedAmount: matchCandidate.suggestedApplicationAmount,
  currencyCode: matchCandidate.currencyCode,
  applicationDate: "2026-01-15",
  status: "proposed",
  createdAt: "2026-01-15T13:00:00.000Z",
  updatedAt: "2026-01-15T13:00:00.000Z"
};

const firstPostingRuleAction = postingRule.actions[0];
if (firstPostingRuleAction === undefined) {
  throw new Error("posting rule fixture must include an action");
}
const secondPostingRuleAction = postingRule.actions[1];
if (secondPostingRuleAction === undefined) {
  throw new Error("posting rule fixture must include a second action");
}
const credentialBearingAction = {
  ...firstPostingRuleAction,
  access_token: "not allowed"
} as unknown as PostingRuleAction;

const evaluationInput: PostingRuleEvaluationInput = {
  tenantId: postingRule.tenantId,
  sourceId: postingRule.sourceId,
  transactionId: "txn_payment_1",
  sourceTransactionType: "Payment",
  transactionDate: "2026-01-15",
  transactionNumber: "PMT-1001",
  partyId: "party_customer_acme",
  currencyCode: "USD",
  memo: "Payment for INV-1001",
  amount: "1250.00",
  unappliedAmount: "1250.00",
  dimensionRefs: [{ dimensionKind: "location", sourceDimensionId: "chicago" }],
  accounts: [
    {
      tenantId: postingRule.tenantId,
      sourceId: postingRule.sourceId,
      accountId: "acct_operating_cash",
      active: true
    },
    {
      tenantId: postingRule.tenantId,
      sourceId: postingRule.sourceId,
      accountId: "acct_accounts_receivable",
      active: true
    }
  ],
  rules: [postingRule]
};

describe("transaction matching contracts", () => {
  it("accepts a provider-neutral customer-payment posting rule", () => {
    expect(() => {
      assertPostingRule(postingRule);
    }).not.toThrow();
  });

  it("rejects invalid rule ranges, percentages, and credential-bearing configuration", () => {
    expect(() => {
      assertPostingRule({
        ...postingRule,
        effectiveFrom: "2026-02-01",
        effectiveThrough: "2026-01-01"
      });
    }).toThrow("effectiveFrom must be on or before effectiveThrough");

    expect(() => {
      assertPostingRule({
        ...postingRule,
        actions: [
          {
            ...firstPostingRuleAction,
            amount: { kind: "percentage", percentage: "101" }
          }
        ]
      });
    }).toThrow("percentage must be greater than 0 and no more than 100");

    expect(() => {
      assertPostingRule({
        ...postingRule,
        actions: [credentialBearingAction]
      });
    }).toThrow("credential-like field is not allowed");
  });

  it("validates candidate scores, append-only decisions, and payment allocations", () => {
    expect(() => {
      assertTransactionMatchCandidate(matchCandidate);
    }).not.toThrow();
    expect(() => {
      assertTransactionMatchDecision(matchDecision);
    }).not.toThrow();
    expect(() => {
      assertPaymentApplication(paymentApplication);
    }).not.toThrow();

    expect(() => {
      assertTransactionMatchCandidate({ ...matchCandidate, score: "1.01" });
    }).toThrow("match candidate score must be between 0 and 1");
    expect(() => {
      assertPaymentApplication({ ...paymentApplication, appliedAmount: "0.00" });
    }).toThrow("payment application amount must be greater than 0");
    expect(() => {
      assertTransactionMatchDecision({
        ...matchDecision,
        evidence: { refresh_token: "not allowed" }
      });
    }).toThrow("credential-like field is not allowed");
  });

  it("rejects malformed runtime payloads and inconsistent scoring evidence", () => {
    expect(() => {
      assertPostingRule({ ...postingRule, conditions: "not-an-array" });
    }).toThrow("posting rule conditions must be an array");
    expect(() => {
      assertPaymentApplication({ ...paymentApplication, appliedAmount: "1.001" });
    }).toThrow("payment application amount must have at most 2 fractional digits");
    expect(() => {
      assertTransactionMatchCandidate({ ...matchCandidate, score: "0.94" });
    }).toThrow("match candidate score must equal its weighted evidence score");
    expect(() => {
      assertTransactionMatchCandidate({
        ...matchCandidate,
        evidence: [
          { criterion: "party", matched: true, weight: "0.50", score: "1.00" },
          { criterion: "party", matched: true, weight: "0.50", score: "0.90" }
        ]
      });
    }).toThrow("match candidate evidence criterion is duplicated");
  });
});

describe("posting rule evaluator", () => {
  it("selects the only lowest-priority active rule and produces balanced postings", () => {
    const fallbackRule: PostingRule = {
      ...postingRule,
      postingRuleId: "rule_customer_payment_fallback",
      ruleCode: "customer-payment-fallback",
      priority: 200
    };
    const inactiveRule: PostingRule = {
      ...postingRule,
      postingRuleId: "rule_customer_payment_inactive",
      ruleCode: "customer-payment-inactive",
      priority: 1,
      status: "inactive"
    };
    const futureRule: PostingRule = {
      ...postingRule,
      postingRuleId: "rule_customer_payment_future",
      ruleCode: "customer-payment-future",
      priority: 2,
      effectiveFrom: "2027-01-01"
    };
    const result = evaluatePostingRules({
      ...evaluationInput,
      rules: [inactiveRule, futureRule, fallbackRule, postingRule]
    });

    expect(result).toMatchObject({
      status: "matched",
      matchedPostingRuleIds: [postingRule.postingRuleId, fallbackRule.postingRuleId],
      selectedPostingRuleId: postingRule.postingRuleId,
      issues: [],
      proposal: {
        postingRuleId: postingRule.postingRuleId,
        transactionId: evaluationInput.transactionId,
        totalDebit: "1250.00",
        totalCredit: "1250.00"
      }
    });
    expect(result.proposal?.lines).toEqual([
      expect.objectContaining({
        sequence: 1,
        side: "debit",
        accountId: "acct_operating_cash",
        debitAmount: "1250.00",
        creditAmount: "0.00",
        partyId: evaluationInput.partyId
      }),
      expect.objectContaining({
        sequence: 2,
        side: "credit",
        accountId: "acct_accounts_receivable",
        debitAmount: "0.00",
        creditAmount: "1250.00",
        partyId: evaluationInput.partyId
      })
    ]);
  });

  it("refuses ambiguous winning rules instead of silently picking one", () => {
    const competingRule: PostingRule = {
      ...postingRule,
      postingRuleId: "rule_customer_payment_competing",
      ruleCode: "customer-payment-competing"
    };
    const result = evaluatePostingRules({ ...evaluationInput, rules: [postingRule, competingRule] });

    expect(result.status).toBe("ambiguous");
    expect(result.proposal).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "ambiguous_top_priority",
        postingRuleIds: [competingRule.postingRuleId, postingRule.postingRuleId]
      })
    ]);
  });

  it("returns invalid for unbalanced actions and missing required context", () => {
    const unbalancedRule: PostingRule = {
      ...postingRule,
      actions: [
        { ...firstPostingRuleAction, amount: { kind: "fixed_amount", amount: "10.00" } },
        { ...secondPostingRuleAction, amount: { kind: "fixed_amount", amount: "9.99" } }
      ]
    };
    const unbalanced = evaluatePostingRules({ ...evaluationInput, rules: [unbalancedRule] });
    const missingParty = evaluatePostingRules({
      tenantId: postingRule.tenantId,
      sourceId: postingRule.sourceId,
      transactionId: "txn_payment_without_party",
      sourceTransactionType: "Payment",
      transactionDate: "2026-01-15",
      currencyCode: "USD",
      amount: "1250.00",
      accounts: evaluationInput.accounts,
      rules: [postingRule]
    });

    expect(unbalanced).toMatchObject({
      status: "invalid",
      issues: [{ code: "unbalanced_rule_actions" }]
    });
    expect(missingParty).toMatchObject({
      status: "invalid",
      issues: [{ code: "missing_transaction_party" }]
    });
  });

  it("refuses unknown or inactive chart-of-account targets", () => {
    const unknownAccount = evaluatePostingRules({
      ...evaluationInput,
      accounts: evaluationInput.accounts.filter((account) => account.accountId !== "acct_accounts_receivable"),
      rules: [postingRule]
    });
    const inactiveAccount = evaluatePostingRules({
      ...evaluationInput,
      accounts: evaluationInput.accounts.map((account) =>
        account.accountId === "acct_accounts_receivable" ? { ...account, active: false } : account
      ),
      rules: [postingRule]
    });

    expect(unknownAccount).toMatchObject({ status: "invalid", issues: [{ code: "unknown_account" }] });
    expect(inactiveAccount).toMatchObject({ status: "invalid", issues: [{ code: "inactive_account" }] });
  });

  it("uses deterministic half-up cent rounding for percentage actions", () => {
    const percentageRule: PostingRule = {
      ...postingRule,
      actions: postingRule.actions.map((action) => ({
        ...action,
        amount: { kind: "percentage", percentage: "50" }
      }))
    };
    const result = evaluatePostingRules({
      ...evaluationInput,
      amount: "0.01",
      unappliedAmount: "0.01",
      rules: [percentageRule]
    });

    expect(result.proposal).toMatchObject({
      totalDebit: "0.01",
      totalCredit: "0.01"
    });
  });

  it("evaluates amount and text conditions with exact inclusive semantics", () => {
    const constrainedRule: PostingRule = {
      ...postingRule,
      conditions: [
        { field: "amount", operator: "between", value: ["1250.00", "1300.00"] },
        { field: "memo", operator: "contains", value: "INV-1001" }
      ]
    };

    expect(evaluatePostingRules({ ...evaluationInput, rules: [constrainedRule] }).status).toBe("matched");
    expect(
      evaluatePostingRules({
        ...evaluationInput,
        memo: "Payment for inv-1001",
        rules: [constrainedRule]
      }).status
    ).toBe("no_match");
  });
});
