# Pre-v1 SDK Contract

`@handrail/erp-financials/sdk` is the preferred integration surface for new ERP
and FRM applications. It is deliberately larger than a formula library: the SDK
owns financial transactions, optimistic concurrency, idempotency, source
cutovers, cross-source account continuity, invoice state, payment allocation,
reconciliation, pagination, integer money arithmetic, and durable downstream
events.

The root package remains backward compatible. Existing canonical persistence,
QuickBooks adapters, raw report builders, rollup workers, health checks, and
source-scoped APIs continue to be exported. New hosts should begin with the SDK
subpath so provider and compatibility utilities do not become accidental app
dependencies.

## Setup order

1. Run `migratePostgresSchema(...)` through schema version 14.
2. Create the canonical company, sources, and company/source bindings.
3. Define one reporting book and its base currency/accounting basis.
4. Bind every provenance source to the book with effective dates.
5. Define the book-owned chart and map source accounts to it.
6. Create the scoped SDK once and inject it into application services.

```ts
import { createErpFinancialsSdk } from "@handrail/erp-financials/sdk";

const sdk = createErpFinancialsSdk({
  database,
  tenantId: "tenant_1",
  companyId: "company_1",
  bookId: "primary_book",
  writeSourceId: "native_erp",
  currencyCode: "USD"
});

await sdk.books.define({
  operation,
  bookId: "primary_book",
  name: "Primary Financial Book",
  baseCurrencyCode: "USD",
  accountingBasis: "accrual"
});

await sdk.books.bindSource({
  operation,
  bookId: "primary_book",
  sourceId: "quickbooks_history",
  sourceRole: "historical",
  effectiveThrough: "2025-12-31"
});

await sdk.books.bindSource({
  operation,
  bookId: "primary_book",
  sourceId: "native_erp",
  sourceRole: "active",
  effectiveFrom: "2026-01-01"
});
```

Historical and active primary-source windows cannot overlap. Adjustment sources
may overlap by design. Reads filter every fact through the effective source
window, which prevents a QuickBooks-to-native cutover from double counting.

## Book identity versus source provenance

A source identifies where a fact originated. A reporting book identifies the
financial ledger users expect to read. They are not interchangeable.

- Every canonical fact retains its source ID and safe provenance reference.
- A book may contain imported history, native activity, and adjustments.
- `reporting_book_accounts` is the authoritative cross-source chart, including
  classification and parent hierarchy.
- A source account maps to one stable book account key. Mapping requires equal
  classifications; incompatible mappings fail closed.
- Unmapped source accounts remain visible under a source-qualified key. They do
  not silently merge with an account from another source.
- Statement and chart read models roll child accounts into their parents. Hosts
  do not implement roll-up arithmetic.

The packaged `ERP_FINANCIALS_SDK_ACCEPTANCE_FIXTURE` demonstrates a nonoverlap
cutover and two source charts mapped onto one book chart.

## Host-facing surface

`createErpFinancialsSdk(...)` returns:

- `commands`: account, journal, fiscal-period, immutable correction, subledger,
  payment, credit, refund, deposit, transfer, and write-off commands.
- `books`: book definition, effective source binding, book chart definition,
  source-account mapping, and scope resolution.
- `invoices`: draft create/update/void, atomic issue, issued-invoice void through
  a full credit/application link, and delivery evidence.
- `paymentMatching`: append-only accept/reject decisions and atomic
  accept-and-apply.
- `bankReconciliation`: idempotent feed ingest, exact bank-posting match,
  approved unmatch, and ignore.
- `queries`: cursor-paginated invoices, payments, general ledger, chart of
  accounts, financial statements, dashboard, A/R and A/P aging, bank review,
  and exact invoice/payment/ledger card summaries for host screens.
- `outbox`: leased claim/publish/fail operations.
- `createRuntime(...)`: bounded event delivery and retry routing for a cron,
  queue worker, or serverless timer.

The query layer returns decimal strings and owns SQL, status derivation,
effective-source filtering, account mapping, hierarchy roll-up, aging buckets,
and dashboard signs. Routes and UI components should call these methods rather
than query financial tables.

The screen summaries have accounting-specific semantics. Invoice outstanding
and overdue totals exclude drafts and voids; unsent draft value is separate;
collected value includes customer-payment applications rather than credits.
Payment summaries return both numerator and denominator for automatic-match
rates, plus unapplied cash and unmatched bank-review counts. General-ledger
summaries return exact cents for debits, credits, and their difference. A host
must format these values, not recompute or round them in route code.

## Invoice lifecycle

Drafts are mutable only through optimistic versioned commands. Issuing a draft
posts the journal, creates the subledger document and immutable lines, links the
draft, records lifecycle evidence, and appends an outbox event in one database
transaction.

Commercial lines retain quantity, unit amount, discount, tax, item, description,
service period, dimensions, account, and final amount. The SDK validates
`amount = round(quantity × unitAmount) - discount + tax` using integer arithmetic.

An entirely open issued invoice can be voided automatically. The SDK recreates
its revenue-line provenance as a credit memo, applies that credit to the invoice,
and records an immutable `invoice_voids` link. A partially paid invoice is not
silently voided; the host must choose an explicit remaining-credit/refund
workflow because customer cash has already changed the accounting outcome.

Invoice list status is derived as draft, open, sent, overdue, partial, paid, or
voided. Delivery attempts are append-only evidence rather than a mutable flag.

## Matching and applications

`paymentMatching.acceptAndApply(...)` is the normal path from a suggested match
to financial allocation. It locks the candidate, appends the decision, changes
candidate state, validates document type/party/currency/amount/version, inserts
the canonical subledger application, updates both open balances through database
triggers, records lifecycle evidence, and appends the outbox event atomically.

`payment_applications` remains in schema v14 only for compatibility with the
older canonical contract. New native writes use `subledger_applications`; hosts
must not write both representations.

## Currency contract

Pre-v1 is intentionally single-currency per reporting book. Every command and
read must use the configured base currency. A different currency produces the
stable `currency_not_supported` error before posting.

This is safer than accepting a foreign currency without owning exchange-rate
sources, functional/reporting currency, realized gains and losses, revaluation,
and settlement rounding. Multi-currency support requires a later complete
contract and migration; it must not be approximated in a host route.

## Errors and retries

Catch `ErpFinancialsError` and branch on `code`, never message text. Codes cover
invalid input, missing scoped entities, currency, fiscal locks, idempotency,
optimistic concurrency, unbalanced posting, reconciliation conflicts, terminal
state, and unsupported operations. `retryable` is true only when retry/refetch is
appropriate. `details` contains bounded scalar context safe for a host API after
the host applies authorization.

All financial mutations still require a `FinancialOperationContext`. The host
owns authorization policy; the SDK owns durable actor, approver, request,
correlation, reason, and event evidence.

## Runtime and rollups

Ledger and hierarchy mutations enqueue a transactional outbox event alongside
the financial write. Invoice, match, application, and reconciliation workflows
do the same. `createRuntime(...)` handles leases, bounded batches, publication,
failure recording, and exponential retry dates. The host supplies only its
domain handlers, such as invoking packaged source rollup/snapshot workers and
invalidating a UI cache.

Runtime registration and cadence remain host/platform operations. Source code
does not claim that a cron or queue has been deployed.

## Compatibility and readiness boundary

Schema v14 is the pre-v1 foundation. Before publishing 1.0, prove this exact SDK
surface in the first ERP application and treat feedback as contract feedback,
not a reason to add host-local SQL. Breaking changes remain possible before 1.0.

Repository-owned behavior is ready for that first adoption. Production use still
requires owner-approved database migration, runtime registration, deployment,
backups, least-privilege roles, and any provider credentials/data access listed
in the production blocker matrix.
