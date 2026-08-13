# Prime-Time Financial Kernel

`@handrail/erp-financials` is the reusable accounting kernel for ERP host
applications. It owns the hard financial invariants and durable Postgres
contracts. A host owns authentication, authorization policy, UI, workflow
presentation, database credentials, scheduling, and provider credentials.

New applications should configure `createErpFinancialsSdk(...)` from
`@handrail/erp-financials/sdk`. The lower-level `createErpFinancials(...)`
example below remains valid for advanced journal/subledger integrations. The
complete book, invoice, matching, reconciliation, query, error, and runtime
contract is in [sdk-v1-contract.md](sdk-v1-contract.md).

## Required production setup

1. Run the package migration registry through one transaction runner. Do not
   copy the newest rendered schema into a production database or edit a
   migration that has already shipped.
2. Create the accounting company, source, and company/source binding before
   writing scoped financial facts. The packaged persistence workers and fixture
   loader do this automatically.
3. Define fiscal periods before native posting. The default posting policy is
   `enforce_fiscal_periods`; `legacy_unrestricted` is only a temporary migration
   bridge for an existing host.
4. Pass a complete `FinancialOperationContext` to every mutating service call.
   The host decides whether the actor is authorized; the package persists the
   actor, approver, request/correlation IDs, reason, and immutable event.
5. Use journal lifecycle and subledger methods. Never update or delete posted
   journal, application, or audit rows directly.

```ts
import {
  createErpFinancials,
  createPostgresTransactionRunner,
  migratePostgresSchema
} from "@handrail/erp-financials";

const database = createPostgresTransactionRunner(postgresPool);

await migratePostgresSchema(database, {
  appliedByRef: "deployment:erp-api-2026-08-12"
});

const financials = createErpFinancials({
  database,
  tenantId: "tenant_1",
  companyId: "company_1",
  sourceId: "native_ledger",
  currencyCode: "USD"
});

const operation = {
  actorRef: "user:123",
  requestId: "request:7ca4",
  correlationId: "workflow:invoice-1001",
  reasonCode: "invoice_created",
  occurredAt: "2026-08-12T15:00:00.000Z"
} as const;

await financials.fiscalPeriods.define({
  fiscalYear: 2026,
  periodNumber: 8,
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  operation
});

await financials.invoices.create({
  operation,
  idempotencyKey: "invoice:1001",
  date: "2026-08-12",
  dueDate: "2026-09-11",
  customerId: "customer_123",
  receivableAccount: { accountKey: "accounts-receivable" },
  revenueLines: [{ accountKey: "managed-services", amount: "1250.00" }]
});
```

## Migration contract

`POSTGRES_MIGRATIONS` is an ordered, checksummed registry. The runner obtains a
Postgres advisory transaction lock, detects a supported unversioned baseline,
records migration history in `erp_financials.schema_migrations`, applies every
upgrade atomically, and validates the final schema. Checksum, ordering, unknown
migration, stored definition, schema, index, foreign-key, and required-trigger
drift fail closed. The database rejects updates or deletes to migration-history
rows.

Use `planPostgresMigrations(...)` for a read-only plan,
`migratePostgresSchema(...)` for installation/upgrades, and
`validatePostgresMigrationHistory(...)` for operational health. The legacy
`installPostgresSchema(...)`/`storage.installSchema()` renderer remains a
development and compatibility surface; it is not the production upgrade path
because it has no ordered history.

## Financial write contract

- Account-tree writes, journal posting, fiscal controls, journal lifecycle
  actions, subledger documents, and applications run in host-provided database
  transactions.
- Posted journal entries are corrected by `reverse`, `void`, `correct`, or
  `replace`. These create compensating postings and immutable links; they never
  rewrite the original facts.
- Period close requires independent approval and evidence containing a trial
  balance snapshot, reconciliation references, a checklist reference, the
  posting high-water timestamp, and a SHA-256 evidence checksum. Reopen and
  posting-lock changes also require independent approval. Call
  `fiscalPeriods.beginClose(...)` to enter the closing state; ordinary postings
  then stop while independently approved `journalEntries.postAdjustment(...)`
  entries remain available until `fiscalPeriods.close(...)` succeeds. Produce
  the digest with `createFiscalCloseEvidenceChecksum(...)`; close rejects a
  checksum that does not match the supplied evidence fields.
- `invoices`, `customerPayments`, `credits`, `refunds`, `vendorBills`,
  `billPayments`, `writeOffs`, `deposits`, and `transfers` post their journal and
  subledger document atomically.
- `paymentApplications.apply`, `.unapply`, and `.void` enforce company/source,
  party, currency, document-type, available-balance, optimistic-version,
  terminal-state, idempotency, and concurrency invariants in both the service
  and database.

All monetary inputs are fixed-scale decimal strings. The package does not use
binary floating-point arithmetic for journal validation.

Pre-v1 supports one base currency per reporting book and rejects any command
currency that differs. This is an explicit safety boundary until exchange-rate,
revaluation, realized gain/loss, and settlement-rounding behavior is delivered
as one complete multi-currency contract.

## Host responsibilities

The host must authorize the actor before calling the package, provide an
independent approver where required, assign least-privilege database roles,
schedule rollup/snapshot/freshness workers, surface package errors without
silently retrying validation failures, and retain database backups. Provider
OAuth and raw provider payload custody remain outside this package.

## PostgreSQL acceptance test

The real-database suite is opt-in and refuses database names that do not begin
with `erp_financials_test`:

```sh
ERP_FINANCIALS_TEST_DATABASE_URL=postgresql://.../erp_financials_test_local \
  npm run test:postgres
```

It covers blank install, legacy v6 upgrade, rollback, migration locking,
scoped constraints, posted-fact immutability, subledger balance triggers,
repeatable-read snapshot behavior, an important scoped query plan, and a full
host-facing SDK flow through book setup, invoice/payment posting, atomic
matching, bank reconciliation, screen summaries, rollups, and outbox delivery.
