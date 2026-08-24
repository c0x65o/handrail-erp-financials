# BLU Adapter Contract (Pre-v1)

This document defines the supported boundary between BLU and
`@handrail/erp-financials`. It is an adoption contract for one BLU server-side
adapter, not an instruction to expose SDK objects directly to BLU routes or
React code.

The executable source of truth is
[`test/blu-erp-consumer-type-imports.ts`](../test/blu-erp-consumer-type-imports.ts).
That harness imports only `@handrail/erp-financials/sdk` and is compiled by
[`tsconfig.blu-erp-consumer.json`](../tsconfig.blu-erp-consumer.json).
[`test/package-boundary.test.ts`](../test/package-boundary.test.ts) verifies that
the harness and its TypeScript path mapping use declared package exports rather
than `src`, `dist`, or another private path. The tables below name only that
proven public surface.

## One scoped SDK

BLU creates one SDK instance at server composition time and injects it into its
finance services. Scope is stable configuration, not route input.

| BLU adapter value | SDK field | Contract |
|---|---|---|
| Stable BLU tenant identity | `tenantId` | `tenant_blu` in the harness; never accepted from an untrusted route parameter. |
| Stable BLU company identity | `companyId` | `company_blu`; BLU is one company today but the identity remains explicit. |
| Primary reporting book | `bookId` | `book_blu_usd_accrual`; all canonical reads resolve through this book. |
| Native BLU provenance source | `writeSourceId` | `source_blu_native`; every new BLU accounting fact retains this source identity. |
| Book currency | `currencyCode` | `USD`; pre-v1 does not approximate foreign-currency accounting. |
| Accounting basis | `accountingBasis` | `accrual`. |
| Posting enforcement | `postingPolicy` | `enforce_fiscal_periods`; BLU must not use `legacy_unrestricted` to bypass close controls. |
| Database boundary | `database` | BLU supplies its server-side Postgres pool or transaction runner; database installation and runtime registration are separate operational gates. |

The supported factory shape is `createErpFinancialsSdk({ database,
...stableScope })`, as demonstrated by `createBluFinancialsSdk(...)` in the
harness. BLU must not create different books or sources per request to simulate
route-local ledgers.

## Money and identity adapters

BLU owns conversion from its integer-cents representation to the SDK's fixed
decimal strings. Conversion must operate on integer or string digits—such as
splitting a `bigint` into sign, whole cents divided by 100, and a two-digit
remainder—and must never pass through a JavaScript floating-point `number`.
For example, `125000n` becomes `"1250.00"`. The reverse route adapter parses
SDK decimal strings losslessly before producing any BLU cents field. Display
formatting and rounding are presentation concerns and cannot feed accounting
writes. Quantities and unit amounts also cross the SDK boundary as decimal
strings at the scale required by their SDK fields.

The harness deliberately rejects an integer `number` as SDK money and asserts
decimal-string types for command amounts, ledger lines, statement totals,
aging totals, and reconciliation totals.

| Identity | BLU-to-SDK mapping rule |
|---|---|
| Account | Keep stable BLU source account IDs and stable reporting `accountKey` values. Define the book chart once, then map each source `accountId` to its book key; do not map by display name. |
| Party | Keep stable `customerId` and `vendorId` values across invoices, receipts, applications, bills, payments, backfills, and retries. |
| Document | Preserve stable invoice draft, issued invoice, customer-payment, vendor-bill, and bill-payment IDs or deterministic source crosswalks. Preserve document numbers as business evidence, not as the only identity. |
| Transaction | Preserve the canonical `transactionId` returned or crosswalked for journal detail, reversal, correction, and statement-line matching. |
| Application | Preserve `paymentApplicationId`; apply/unapply addresses the canonical application rather than editing balances locally. |
| Statement line | Keep the bank feed's stable `externalLineId`, the canonical `bankStatementLineId`, and the resulting `bankReconciliationMatchId`. A monthly statement balance alone is not reconciliation identity. |
| Idempotency | Derive one stable `idempotencyKey` for each logical command and reuse it for an identical retry. Do not generate a new key merely because an HTTP request was retried. |
| Request and correlation | Every mutation carries a stable `operation.requestId` and an end-to-end `operation.correlationId`; BLU may also keep its HTTP identifiers in its route layer. |
| Actor | Set `operation.actorRef` to the authenticated BLU principal after BLU authorization. Never accept the durable actor solely from request JSON. |
| Independent approver | Commands requiring approval carry `operation.approverRef` for a different, independently authorized principal. BLU's approval evidence must be resolved before calling the approved SDK operation. |
| Optimistic version | Read and retain canonical versions, then pass the applicable `expectedVersion`; on conflict BLU refetches and presents the error rather than overwriting state. |

## Supported command mapping

### Book and chart setup

| BLU responsibility | Public SDK operation | Adapter requirement |
|---|---|---|
| Define the USD accrual reporting book | `sdk.books.define` | Stable book identity, `USD`, accrual basis, and active status. |
| Bind the native source | `sdk.books.bindSource` | Stable source role and non-overlapping effective dates. |
| Define reporting-book accounts | `sdk.books.defineAccount` | Stable book account key, classification, role, currency, and optimistic version. |
| Map BLU source accounts | `sdk.books.mapAccount` | Stable source account ID to stable book account key. |
| Upsert the native account tree | `sdk.commands.accounts.upsertTree` | Parent/child keys and classifications; ERP Financials validates hierarchy and invalidates affected reads. |

### Accounting lifecycles

| BLU intent | Public SDK operation | Boundary behavior |
|---|---|---|
| Post a balanced journal | `sdk.commands.journalEntries.post` | BLU supplies stable idempotency and decimal-string debit/credit lines; ERP Financials enforces balance and fiscal state. |
| Reverse a journal | `sdk.commands.journalEntries.reverse` | Approved compensating entry against the stable original transaction. |
| Correct and replace a journal | `sdk.commands.journalEntries.correct` | Approved immutable correction plus a balanced replacement; never edit posted rows. |
| Define a fiscal period | `sdk.commands.fiscalPeriods.define` | Stable year, period number, and inclusive dates. |
| Begin close | `sdk.commands.fiscalPeriods.beginClose` | Independent approval and optimistic version. |
| Close a period | `sdk.commands.fiscalPeriods.close` | Independent approval plus BLU checklist reference and canonical trial-balance/reconciliation evidence. |
| Reopen a period | `sdk.commands.fiscalPeriods.reopen` | Independent approval and optimistic version. |
| Set a posting lock | `sdk.commands.fiscalPeriods.setPostingLockDate` | Independent approval and optimistic version; BLU does not enforce a weaker parallel lock. |
| Create or update an invoice draft | `sdk.invoices.createDraft`, `sdk.invoices.updateDraft` | Stable customer/order crosswalks, decimal commercial lines, and expected version on update. |
| Void a draft | `sdk.invoices.voidDraft` | Optimistic lifecycle transition before posting. |
| Issue a draft | `sdk.invoices.issue` | Stable idempotency; ERP Financials posts the canonical invoice atomically. |
| Void an issued invoice | `sdk.invoices.voidIssued` | Independent approval and compensating canonical workflow. |
| Record invoice delivery | `sdk.invoices.recordDelivery` | Append-only delivery status, channel, safe recipient reference, and occurrence time. BLU still sends/presents the invoice. |
| Record customer cash | `sdk.commands.customerPayments.record` | Stable customer, cash/receivable accounts, idempotency, and decimal amount. |
| Apply or unapply customer cash | `sdk.commands.paymentApplications.apply`, `sdk.commands.paymentApplications.unapply` | Stable documents/application, exact amount, expected versions, and approved effective-date unapplication. |
| Post an approved vendor bill | `sdk.commands.vendorBills.create` | Call only after BLU's approval/hold/release workflow permits posting. The SDK command creates the posted accounting bill; BLU must not maintain a second posted bill ledger. |
| Void or replace a posted vendor bill | `sdk.commands.vendorBills.voidPosted`, `sdk.commands.vendorBills.replacePosted` | Independent approval, expected version, idempotency, and immutable compensation/replacement. |
| Record and apply an immediate bill payment | `sdk.commands.billPayments.recordAndApply` | Call only for a BLU-authorized payment; allocations carry stable bill IDs, exact amounts, and expected bill versions. |
| Schedule, clear, or cancel a bill payment | `sdk.commands.billPayments.schedule`, `sdk.commands.billPayments.clear`, `sdk.commands.billPayments.cancel` | Keep instruction and accounting lifecycle canonical; clearing is the posting transition. |
| Void and unapply a bill payment | `sdk.commands.billPayments.voidAndUnapply` | Independent approval and one compensating canonical operation. |
| Ingest a bank statement line | `sdk.bankReconciliation.ingest` | Stable external line ID, account, date, currency, and decimal amount. |
| Match, unmatch, or ignore a statement line | `sdk.bankReconciliation.match`, `sdk.bankReconciliation.unmatch`, `sdk.bankReconciliation.ignore` | Match individual canonical statement lines to transactions; unmatch requires independent approval. BLU's period-close UI references this evidence rather than replacing it with statement-level totals. |

The harness is the allowlist. Other SDK features are not part of the approved
BLU adapter contract until the harness and this document are deliberately
extended together.

## Supported read mapping

BLU adapts these canonical results into its existing route response shapes. It
must preserve the SDK's filters, cursors, limits, decimal totals, statuses,
versions, and evidence rather than loading a broad fact set and recomputing the
same accounting result in application code.

| BLU surface | Public SDK query | Canonical result |
|---|---|---|
| Chart of accounts | `sdk.queries.listChartOfAccounts` | Book-mapped, hierarchical chart as of a date. |
| Journal register and detail | `sdk.queries.listJournalEntries`, `sdk.queries.getJournalEntry` | Bounded journal page and exact transaction lifecycle/posting detail. |
| Fiscal periods and posting lock | `sdk.queries.listFiscalPeriods`, `sdk.queries.getPostingLock` | Canonical period states/versions and source posting lock. |
| General ledger and totals | `sdk.queries.listGeneralLedger`, `sdk.queries.getGeneralLedgerSummary` | Bounded ledger page plus independently aggregated debit, credit, and difference totals. |
| Invoice register, detail, and totals | `sdk.queries.listInvoices`, `sdk.queries.getInvoice`, `sdk.queries.getInvoiceSummary` | As-of canonical status, balance, detail, and complete filtered summary. |
| Customer statement | `sdk.queries.getCustomerStatement` | Bounded as-of invoice rows, application evidence, source identity, and statement totals for one customer. |
| Vendor-bill register, detail, and totals | `sdk.queries.listVendorBills`, `sdk.queries.getVendorBill`, `sdk.queries.getVendorBillSummary` | As-of posted bill lifecycle/open balances and complete filtered summary. |
| Customer-payment register and detail | `sdk.queries.listPayments`, `sdk.queries.getCustomerPayment` | Filtered customer-payment page and exact canonical receipt/application evidence. |
| Bill-payment register, detail, and totals | `sdk.queries.listBillPayments`, `sdk.queries.getBillPayment`, `sdk.queries.getBillPaymentSummary` | Bounded disbursement lifecycle, allocations, posting evidence, and complete filtered summary. |
| Payment applications and totals | `sdk.queries.listPaymentApplications`, `sdk.queries.getPaymentApplication`, `sdk.queries.getPaymentSummary` | Bounded application evidence and complete filtered payment KPIs. |
| Reconciliation review and totals | `sdk.queries.listBankReconciliation`, `sdk.queries.getBankReconciliationSummary` | Bounded individual-line review plus complete canonical reconciliation totals. |
| Profit and loss | `sdk.queries.getFinancialStatement({ reportName: "profit_and_loss", ... })` | Canonical statement lines and totals for the requested period. |
| Balance sheet | `sdk.queries.getFinancialStatement({ reportName: "balance_sheet", ... })` | Canonical as-of book balances. |
| Trial balance | `sdk.queries.getFinancialStatement({ reportName: "trial_balance", ... })` | Canonical debit/credit balance evidence. |
| Receivables and payables aging | `sdk.queries.getAging({ kind: "receivables" | "payables", ... })` | As-of buckets, rows, and totals. |
| Financial dashboard | `sdk.queries.getDashboardSummary` | Bounded period/as-of canonical KPIs. |

Every summary query is separate from its paginated register. BLU must not sum
only the current page. Operational reports such as labor, production, and web
projections remain BLU calculations and are not advertised as SDK reads.

## Ownership boundary

| Owner | Owns | Does not own |
|---|---|---|
| BLU | React FRM workspaces; existing route response shapes; authentication and authorization; order, customer, vendor, PO, and receipt relationships; bill approval/hold/release; operational reports; close-checklist presentation; cents/decimal conversion; HTTP and error presentation; runtime/job registration; calls to the Handrail QuickBooks service. | Accounting invariants or a second ledger; host-local standard-statement SQL; Intuit credentials; raw unbounded provider payloads. |
| ERP Financials | Accounting persistence and invariants; reporting books and chart mapping; balanced posting; lifecycle state; optimistic concurrency; idempotency; fiscal locks; immutable corrections; applications; reconciliation evidence; bounded SQL reads and complete totals; outbox records; rollups, snapshots, and freshness; canonical QuickBooks facts after normalized handoff. | BLU UI/routes/authorization/workflows; OAuth, tokens, provider clients, or direct QuickBooks API calls; raw unbounded provider payloads. |
| Handrail QuickBooks integration | OAuth and token custody; provider clients and API calls; normalized full/incremental responses; sync checkpoints; provider-report calls and parity evidence. | BLU workflow state or canonical accounting persistence. |

The normalized provider handoff follows
[`quickbooks-boundary.md`](quickbooks-boundary.md): BLU calls the Handrail
service, then passes bounded normalized responses into ERP Financials. Neither
BLU nor ERP Financials stores Intuit credentials or raw, unbounded QuickBooks
responses.

## Pre-v1 adoption and release rules

- BLU compiles only against declared package exports. The approved adapter uses
  `@handrail/erp-financials/sdk`; it never imports package `src`, `dist`, or an
  undeclared subpath.
- BLU pins the exact published tag that actually contains and passes the
  approved BLU harness. Package version `0.3.32` is the first release of this
  contract, published as the immutable `v0.3.32` Git tag.
- Breaking contract changes remain possible before 1.0. A gap found during BLU
  adoption is ERP Financials contract work: extend the public SDK, its harness,
  and tests here instead of adding BLU-local accounting SQL or a second ledger.
- Migration may use a short, explicitly bounded parity period, but must not
  become indefinite dual-writing. Backfill, replay, parity evidence, command/read
  cutover, and retirement of legacy accounting writes are separately planned.
- Database migrations, backfill/parity, runtime registration, provider
  configuration, deployment, backups, and production-readiness review remain
  separately gated operational work. This document authorizes none of them.
- Install and migration code follows the current
  `POSTGRES_CANONICAL_SCHEMA_MANIFEST`; documentation must not assume an older
  hard-coded schema version.

This contract does not implement BLU application code, QuickBooks clients,
deployment/configuration, UI changes, migrations, or a package release.

## Related boundaries

- [`sdk-v1-contract.md`](sdk-v1-contract.md) defines the generic pre-v1 SDK
  lifecycle, error, retry, currency, runtime, and readiness rules.
- [`architecture.md`](architecture.md) assigns UI, permissions, navigation, and
  customer-specific workflows to host applications.
- [`quickbooks-boundary.md`](quickbooks-boundary.md) assigns provider access,
  credentials, normalized responses, and provider evidence to the Handrail
  QuickBooks integration.
