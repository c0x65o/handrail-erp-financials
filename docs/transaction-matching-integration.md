# Transaction Matching and Posting Rule Integration

This guide describes how a host ERP application integrates the provider-neutral
posting-rule, transaction-match, decision-audit, and payment-application
contracts exported by `@handrail/erp-financials`.

There are two related but separate workflows:

1. **Posting-rule evaluation** selects accounts and proposes balanced debit and
   credit lines for an unposted transaction.
2. **Transaction matching** suggests that one transaction should be applied to
   another, such as a customer payment to an invoice, and records the approval
   and resulting allocation.

Matching a payment to an invoice does not choose its general-ledger accounts,
and evaluating a posting rule does not approve or apply a payment. A host may
run both workflows as part of one customer-payment operation, but it must keep
their audit records and state transitions distinct.

## Responsibility Boundary

| Layer | Owns |
| --- | --- |
| ERP Financials | Provider-neutral types, runtime validation, deterministic posting-rule evaluation, canonical schema, and idempotent persistence methods |
| Host ERP | Tenant rule configuration, account selection, transaction reads, match-candidate generation, authorization, review UI, database transaction boundaries, and approved proposal-to-ledger orchestration |
| Provider adapter or service | Provider API access, credentials, normalized source data, and authoritative provider postings |

The package does not currently score payment-to-invoice candidates. A host or a
dedicated matching service creates candidates using the exported
`TransactionMatchCandidate` contract, includes auditable scoring evidence, and
versions the matcher with `matcherVersion`.

Provider postings that are already authoritative, including imported
QuickBooks general-ledger postings, should continue through their source
adapter. Do not run local rules merely to recreate those postings. Local rules
are primarily for native ERP and other unposted inputs.

## 1. Install and Validate the Schema

Use the package manifest through the host application's migration framework.
The current schema includes:

- `posting_rules`
- `transaction_match_candidates`
- `transaction_match_decisions`
- `payment_applications`

For a new installation, follow [host-app-install.md](host-app-install.md). For
an existing installation, apply the equivalent table, constraint, and index
changes from the
[checked Future ERP migration](../migrations/future-erp/20260620000000_create_erp_financials_canonical_schema.sql)
through a new host-owned migration. Do not execute package DDL implicitly at
application startup.

Validate the installed database before enabling matching workers:

```ts
import { createPostgresStorageAdapter } from "@handrail/erp-financials";

const storage = createPostgresStorageAdapter(postgresClient);
const validation = await storage.validateSchema();

if (!validation.compatible) {
  throw new Error(validation.issues.map((issue) => issue.message).join("\n"));
}
```

## 2. Configure Posting Rules

The host owns account selection and must present only accounts from the same
tenant and accounting source as the rule. Store stable `ruleCode` values;
`upsertPostingRules` uses tenant, source, and rule code as its idempotent
identity.

```ts
import type { PostingRule } from "@handrail/erp-financials";

const customerPaymentRule: PostingRule = {
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

await storage.upsertPostingRules([customerPaymentRule]);
```

Use `draft` while a rule is being edited. Activate it only after authorization
and validation. Prefer deactivation or archival over deleting a rule so earlier
decisions remain explainable.

Rules support exact, case-sensitive string conditions and amount conditions.
Lower numeric priority wins. If multiple matching rules have the same winning
priority, the engine returns `ambiguous` and no proposal.

## 3. Evaluate an Unposted Transaction

The evaluator is pure and does not read the database. The host must load the
transaction's tenant/source rules and chart of accounts, then pass both into
`evaluatePostingRules`. In this example, `payment` is the host's unposted
payment command/read model and includes its positive gross and unapplied
amounts.

```ts
import { evaluatePostingRules } from "@handrail/erp-financials";

const result = evaluatePostingRules({
  tenantId: payment.tenantId,
  sourceId: payment.sourceId,
  transactionId: payment.transactionId,
  sourceTransactionType: payment.sourceTransactionType,
  transactionDate: payment.transactionDate,
  transactionNumber: payment.transactionNumber,
  partyId: payment.partyId,
  currencyCode: payment.currencyCode,
  memo: payment.memo,
  amount: payment.amount,
  unappliedAmount: payment.unappliedAmount,
  dimensionRefs: payment.dimensionRefs,
  accounts: sourceAccounts.map((account) => ({
    tenantId: account.tenantId,
    sourceId: account.sourceId,
    accountId: account.accountId,
    active: account.active
  })),
  rules: sourcePostingRules
});
```

Handle every result explicitly:

| Status | Required host behavior |
| --- | --- |
| `matched` | Show or submit `proposal` for the configured approval path. Do not treat evaluation alone as a posted journal entry. |
| `no_match` | Route to manual account selection or a configured suspense workflow. Do not silently invent accounts. |
| `ambiguous` | Require rule-priority/configuration correction or manual review. No proposal is returned. |
| `invalid` | Block posting and surface `issues`; common causes are inactive accounts, missing inputs, zero-rounded actions, or unbalanced actions. |

Successful proposals use exact cent arithmetic, require active tenant/source
accounts, and balance total debits to total credits. Re-evaluate at approval
time if the transaction, account state, or active rule set may have changed
since the proposal was displayed.

## 4. Convert an Approved Proposal to Canonical Ledger Facts

`evaluatePostingRules` returns a proposal; it does not write an
`AccountingTransaction`, `TransactionLine`, or `LedgerPosting`. The host must
map each approved proposal line into its canonical ledger write model and use
stable identifiers derived from the business operation and proposal sequence.

For each proposal line:

- preserve `accountId`, `partyId`, `dimensionRefs`, `debitAmount`, and
  `creditAmount`;
- set `netAmount` to debit minus credit using decimal-safe arithmetic;
- create `dimensionHash` with the package's `createDimensionHash` helper;
- attach the host's import batch or native posting batch identity; and
- use a stable `sourcePostingId` so a retry updates instead of duplicates the
  posting.

Persist the transaction, lines, postings, and any related payment-application
status transition within one host-owned database transaction. Construct the
storage adapter with that transaction's query client. The individual storage
methods validate and upsert their rows, but do not create a multi-call database
transaction for the host.

```ts
await hostDatabase.transaction(async (transactionClient) => {
  const transactionalStorage = createPostgresStorageAdapter(transactionClient);

  await transactionalStorage.upsertTransactions([canonicalTransaction]);
  await transactionalStorage.upsertTransactionLines(canonicalLines);
  await transactionalStorage.upsertLedgerPostings(canonicalPostings);
  await transactionalStorage.upsertPaymentApplications([
    { ...paymentApplication, status: "posted", updatedAt: postedAt }
  ]);
});
```

`hostDatabase.transaction(...)` is pseudocode; use the transaction API supplied
by the host's Postgres library. Mark report snapshots stale and schedule the
normal rollup/freshness workflow after the ledger transaction commits.

## 5. Generate Match Candidates

A candidate links an origin payment to a target invoice or an origin vendor
payment to a target bill. Generate candidates from canonical, tenant-scoped
transaction reads. Keep scoring deterministic and include evidence for every
criterion.

```ts
import type { TransactionMatchCandidate } from "@handrail/erp-financials";

const candidate: TransactionMatchCandidate = {
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
    {
      criterion: "reference",
      matched: true,
      weight: "0.25",
      score: "0.80",
      detail: "INV-1001"
    }
  ],
  createdAt: "2026-01-15T12:00:00.000Z",
  expiresAt: "2026-02-15T12:00:00.000Z"
};

await storage.upsertTransactionMatchCandidates([candidate]);
```

Evidence weights must total `1`, and `score` must equal the weighted evidence
score. Increment `matcherVersion` when scoring behavior or weights change.
Recomputing the same origin, target, match kind, and matcher version updates the
existing candidate instead of duplicating it. Derive `matchCandidateId` from
that stable identity and do not replace the primary id during a retry.

Before offering or automatically accepting a candidate, the host must verify:

- the payment and invoice belong to the same tenant, source, party, and
  currency;
- neither transaction is voided or deleted;
- the candidate is not expired, rejected, or superseded;
- the application is positive and no greater than both the unapplied payment
  balance and open invoice balance; and
- the matcher's score threshold is tenant-configured and authorized for
  automatic decisions.

The package validators validate each record's shape and internal arithmetic;
they do not fetch referenced transactions or calculate their remaining
balances.

## 6. Record a Decision and Payment Application

Decision records are append-only. A manual decision requires `decidedByRef`.
Use a stable decision identity so retries are harmless.

```ts
import type {
  PaymentApplication,
  TransactionMatchDecision
} from "@handrail/erp-financials";

const decision: TransactionMatchDecision = {
  matchDecisionId: "decision_payment_invoice",
  matchCandidateId: candidate.matchCandidateId,
  tenantId: candidate.tenantId,
  sourceId: candidate.sourceId,
  decision: "accepted",
  method: "manual",
  decidedAt: "2026-01-15T13:00:00.000Z",
  decidedByRef: "user_42",
  reason: "Remittance reference confirmed"
};

const application: PaymentApplication = {
  paymentApplicationId: "application_payment_invoice",
  tenantId: candidate.tenantId,
  sourceId: candidate.sourceId,
  paymentTransactionId: candidate.originTransactionId,
  invoiceTransactionId: candidate.targetTransactionId,
  matchDecisionId: decision.matchDecisionId,
  appliedAmount: candidate.suggestedApplicationAmount,
  currencyCode: candidate.currencyCode,
  applicationDate: "2026-01-15",
  status: "proposed",
  createdAt: decision.decidedAt,
  updatedAt: decision.decidedAt
};

await hostDatabase.transaction(async (transactionClient) => {
  const transactionalStorage = createPostgresStorageAdapter(transactionClient);

  await transactionalStorage.recordTransactionMatchDecisions([decision]);
  await transactionalStorage.upsertTransactionMatchCandidates([
    { ...candidate, status: "accepted" }
  ]);
  await transactionalStorage.upsertPaymentApplications([application]);
});
```

Recording a decision does not automatically change the candidate or create an
application. Those are explicit host-owned state transitions. Rejections
should append a rejected decision and update the candidate to `rejected`; they
must not create a payment application.

When posting succeeds, update the application from `proposed` to `posted` in
the same database transaction as the ledger facts. A reversal should create
the host's normal reversing ledger facts and update the application to
`voided`; do not delete the decision audit trail.

## Concurrency, Idempotency, and Authorization

Customer-payment allocation is balance-sensitive. During acceptance and
posting, lock or otherwise serialize the payment and invoice balance rows using
the host database's established concurrency mechanism. Recalculate both
remaining balances inside the transaction before writing the application.
Reject or retry if either balance changed.

Use stable business identities for all retryable writes:

| Record | Idempotent identity |
| --- | --- |
| Posting rule | tenant + source + rule code |
| Match candidate | tenant + source + match kind + origin + target + matcher version |
| Match decision | tenant + source + decision id; conflicts do nothing |
| Payment application | tenant + source + payment transaction + invoice transaction |
| Ledger posting | tenant + source + accounting basis + source posting id |

Keep each record's primary id stable as well as its conflict identity. In
particular, do not send a new `postingRuleId`, `matchCandidateId`, or
`paymentApplicationId` when retrying an existing natural identity.

Authorize rule changes separately from transaction approval. At minimum, audit
who activated or archived a rule in the host application, who manually
accepted a match, and which matcher version produced an automatic decision.
Do not store provider credentials, access tokens, raw unbounded payloads, or
other secrets in rule conditions, actions, candidate evidence, or decision
evidence.

## Minimum Integration Tests

A host integration should cover these cases before enabling production writes:

1. A single active customer-payment rule produces the expected balanced cash
   and accounts-receivable proposal.
2. Two matching rules at the same winning priority return `ambiguous` and write
   no postings.
3. An inactive or cross-source account returns `invalid` and writes no
   postings.
4. Replaying the same candidate, decision, application, and ledger operation
   does not create duplicates.
5. Two concurrent attempts cannot over-apply the same payment or invoice.
6. A rejected or expired candidate cannot create an application.
7. Posting failure leaves the application `proposed` and creates no partial
   ledger facts.
8. Successful posting atomically creates ledger facts and marks the application
   `posted`.
9. Authoritative provider postings bypass local rule evaluation.
10. Credential-like fields and oversized evidence are rejected before storage.

For package-level rule examples, see `test/transaction-matching.test.ts`. For
the broader storage and provider boundary, continue with
[storage-host-app-handoff.md](storage-host-app-handoff.md).
