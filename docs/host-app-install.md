# Host App Install, Validation, and Operations

This guide is the current host-app path for installing
`@handrail/erp-financials` into a blank ERP app. It translates the package
boundary in [architecture.md](architecture.md), the future capability role in
[handrail-capability-plan.md](handrail-capability-plan.md), and roadmap phases
3-6 in [adoption-roadmap.md](adoption-roadmap.md) into concrete package APIs.

The package remains the source of truth for canonical financial formulas,
fixtures, migration manifests, rollup contracts, snapshot contracts, and
freshness contracts. A future Handrail `erp_financials` capability should
install, validate, schedule, and report health for these APIs; it should not
move report formulas into platform-only code.

Provider credentials are outside the `erp_financials` config contract. Keep
QuickBooks and other provider OAuth material in their provider capability or
integration service.

For worker-to-worker implementation details between the QuickBooks SDK/service,
Future ERP orchestration, and canonical storage, use
[storage-host-app-handoff.md](storage-host-app-handoff.md).
For the Future ERP-specific local package/link setup and validation handoff,
use [future-erp-dependency-handoff.md](future-erp-dependency-handoff.md).
For native posting rules, transaction matching, payment applications, and the
approved proposal-to-ledger workflow, use
[transaction-matching-integration.md](transaction-matching-integration.md).
For safe retry cadence, deterministic evidence fields, fixture smoke
interpretation, drilldown health failure handling, and escalation boundaries,
use [operations-runbook.md](operations-runbook.md).

## Supported adoption APIs

New host apps should import the cohesive contract from
`@handrail/erp-financials/sdk`. Migration, storage, provider adapters, workers,
health, and compatibility APIs remain available from the root
`@handrail/erp-financials` entry point. The package manifest publishes no other
supported subpaths. Imports from undeclared package subpaths, copied package
folders, generated `dist/` internals, `src` internals, or host-app compatibility
shims are unsupported.

Host apps should call these exported `@handrail/erp-financials` APIs directly:

| Contract area | Exported API |
| --- | --- |
| New ERP/FRM host façade | `createErpFinancialsSdk` from `@handrail/erp-financials/sdk`; use `books`, `invoices`, `paymentMatching`, `bankReconciliation`, `queries`, `outbox`, `createRuntime`, and the advanced `commands` escape hatch |
| Canonical schema, migration, and health | `POSTGRES_MIGRATIONS`, `planPostgresMigrations`, `migratePostgresSchema`, `validatePostgresMigrationHistory`, `POSTGRES_CANONICAL_SCHEMA_MANIFEST`, `createPostgresStorageAdapter(...).validateSchema()`, `validatePostgresSchema`, `checkErpFinancialsInstallHealth`, `validateFutureErpCanonicalSchemaPreflight`, `preflightFutureErpInstallHealth`, `createFutureErpInstallHealthPreflightWorker` |
| Storage adapter and persistence | `createPostgresStorageAdapter`, `createFutureErpCanonicalFactPersistenceWorker`, `persistFutureErpCanonicalFacts` |
| Native financial operations | `createErpFinancials`; use `accounts`, `journalEntries`, `fiscalPeriods`, receivable/payable/cash document services, and `paymentApplications` with a `FinancialOperationContext` on every mutation |
| Posting rules and transaction matching | `evaluatePostingRules`, `PostingRule`, `PostingRuleEvaluationInput`, `TransactionMatchCandidate`, `TransactionMatchDecision`, `PaymentApplication`, `createPostgresStorageAdapter(...).upsertPostingRules()`, `createPostgresStorageAdapter(...).upsertTransactionMatchCandidates()`, `createPostgresStorageAdapter(...).recordTransactionMatchDecisions()`, `createPostgresStorageAdapter(...).upsertPaymentApplications()` |
| QuickBooks normalized mapping | `HandrailQuickBooksSdkResourcesAdapterInput`, `mapHandrailQuickBooksSdkResourcesToCanonicalFacts`, `mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts`, `mapNormalizedQuickBooksIncrementalSyncResponseToCanonicalFacts` |
| QuickBooks sync worker contracts | `createFutureErpQuickBooksFullSyncWorker`, `createFutureErpQuickBooksIncrementalSyncWorker`, `NormalizedQuickBooksFullSyncRequestEnvelope`, `NormalizedQuickBooksFullSyncResponseEnvelope`, `NormalizedQuickBooksIncrementalSyncRequestEnvelope`, `NormalizedQuickBooksIncrementalSyncResponseEnvelope`, `createHandrailQuickBooksFullSyncServiceHandler`, `createHandrailQuickBooksSyncClient`, `HandrailQuickBooksSyncClient`, `HandrailQuickBooksSyncClientTransport` |
| Fixture/reference report formulas and persisted report flow | `buildProfitAndLossReport`, `buildBalanceSheetReport`, `buildTrialBalanceReport`, `buildCashFlowReport`, `buildReferenceStandardReportPresentationFromFacts`, `buildStandardReportPresentationFromReadModel`, `buildFutureErpReportFromCanonicalReadModel`, `createSnapshotRefreshContract`, `reconcileReportFreshness`, `createFutureErpRollupAndLateArrivalWorker`, `createFutureErpSnapshotRefreshAndFreshnessWorker` |
| Schedule descriptor | `buildScheduledRollupJobResult`, `buildLateArrivalReprocessExecutionContract`, `executeLateArrivalReprocess`, `executeSnapshotRefresh`, `ScheduledRollupJobName`, `LateArrivalReprocessJobName`, `SnapshotRefreshJobName`, `ScheduledRollupJobRequest`, `SnapshotRefreshRequest`, `FreshnessReconcileInput` |
| Fixture smoke | `runErpFinancialsFixtureSmokeHealth` |
| Drilldown health | `checkErpFinancialsFreshnessAndDrilldownHealth`, `assertSafeDrilldownRef`, `assertSafeSourcePayloadRef` |

Host apps should not bypass the SDK, `createPostgresStorageAdapter`, or the
persistence workers for financial fact writes except through explicit
package-compatible migrations or audited backfills. New operational ERP screens
should use the SDK's book-aware query and summary APIs. Snapshot/report-center
flows should use canonical report snapshots, rollups, freshness rows, and safe
drilldown refs produced by this package.

The schedule descriptor is executable package code plus exported request/result
types. It lets a host app or separately approved platform capability register
jobs with deterministic names and evidence fields, but this repository change
does not create Handrail platform capabilities, project tasks, deployment
targets, env vars, secrets, or CI/CD runs.

## 1. Add the package dependency

Install the package in the host app:

```sh
npm install @handrail/erp-financials
```

Future ERP should also depend on the Handrail QuickBooks SDK/service client
using its existing package-manager convention. In the current Handrail runtime
contract that means the QuickBooks-specific service client plus
capability-managed QuickBooks env references, not Intuit credentials or new
provider OAuth vars:

```sh
npm install @handrail/quickbooks-node-sdk
```

When `@handrail/erp-financials` is not published in the dev environment, use a
local file link to this checkout and build the package declarations before
running the host app typecheck:

```sh
# from /opt/handrail/repos/handrail/erp-financials/handrail-sdk-erp-financials-js
npm install
npm run build
npm run typecheck:future-erp-imports

# from /opt/handrail/repos/hitcents/hitcents-future-erp/hitcents-erp-future
npm install @handrail/erp-financials@file:/opt/handrail/repos/handrail/erp-financials/handrail-sdk-erp-financials-js
npm install @handrail/quickbooks-node-sdk@file:/opt/handrail/repos/handrail/handrail-quickbooks-integrations/handrail-sdk-quickbooks-node
npm run typecheck
```

If Future ERP is using a workspace protocol instead of direct npm install,
preserve that convention and wire the same two dependencies in package metadata:

```json
{
  "dependencies": {
    "@handrail/erp-financials": "file:/opt/handrail/repos/handrail/erp-financials/handrail-sdk-erp-financials-js",
    "@handrail/quickbooks-node-sdk": "file:/opt/handrail/repos/handrail/handrail-quickbooks-integrations/handrail-sdk-quickbooks-node"
  }
}
```

The targeted package-side acceptance check is:

```sh
npm run typecheck:future-erp-imports
```

It compiles a Future ERP-shaped consumer import harness through the public
`@handrail/erp-financials` entry point and verifies TypeScript can resolve
`createPostgresStorageAdapter`,
`mapHandrailQuickBooksSdkResourcesToCanonicalFacts`,
`buildProfitAndLossReport`, `buildBalanceSheetReport`,
`buildTrialBalanceReport`, `buildCashFlowReport`,
`createSnapshotRefreshContract`, `reconcileReportFreshness`, the local
QuickBooks sync client facade, and normalized QuickBooks sync/report envelope
types.

The four raw-posting report builders above are fixture/reference formula
helpers for deterministic smoke checks, snapshot refresh/rebuild, and bounded
repair flows. Production standard-report presentation should use
`buildStandardReportPresentationFromReadModel` with snapshots, rollups, or SQL
aggregates. `buildReferenceStandardReportPresentationFromFacts` is the
in-memory fixture/reference presentation helper; the older
`buildStandardReportPresentationFromFacts` name is a deprecated compatibility
alias only.

For local package development from this repository, validate a clean checkout
with:

```sh
npm run validate
```

The deterministic package scripts are also available individually:

```sh
npm run lint
npm run typecheck
npm run test
npm run build
```

For the QuickBooks SDK/service handoff specifically, use the deterministic
contract smoke command. It does not need live QuickBooks credentials:

```sh
npm run contract:smoke
```

For the reusable ERP Financials install/schema/fixture/freshness/drilldown
health contract, use:

```sh
npm run health:smoke
```

`npm run health:smoke` is fixture-based by default. It validates the package
health APIs without live QuickBooks credentials, production data, deployment
state, or external provider calls.

## 2. Migrate the canonical schema

Host apps own their database credentials. The package owns the ordered,
checksummed financial schema upgrade path:

```ts
import {
  createPostgresTransactionRunner,
  migratePostgresSchema
} from "@handrail/erp-financials";

const database = createPostgresTransactionRunner(postgresPool);
const result = await migratePostgresSchema(database, {
  appliedByRef: "deployment:future-erp-2026-08-12"
});
```

The migration runner obtains a Postgres advisory transaction lock, adopts a
supported unversioned legacy baseline, records immutable checksums in
`erp_financials.schema_migrations`, runs the remaining path atomically, and
validates the final manifest. Use a read-only deployment preview when needed:

```ts
import { planPostgresMigrations } from "@handrail/erp-financials";

const plan = await database.transaction((client) =>
  planPostgresMigrations(client)
);
```

`renderPostgresSchemaSql(...)` and `storage.installSchema({ dryRun: true })`
remain deterministic development/compatibility surfaces. They do not carry
ordered history or lifecycle triggers and must not replace
`migratePostgresSchema(...)` in production. Never edit or copy a previously
released migration; add a new registry entry.

See [prime-time-financial-kernel.md](prime-time-financial-kernel.md) for fiscal,
audit, journal lifecycle, subledger, and real-Postgres acceptance contracts.

## 3. Validate the installed schema

After migrations run, validate the database against the package manifest:

```ts
const validation = await storage.validateSchema();

if (!validation.compatible) {
  throw new Error(
    validation.issues.map((issue) => issue.message).join("\n")
  );
}
```

Validation checks schema, tables, columns, indexes, constraints,
fixture-loader support, and the no-provider-credential boundary. Financial
tables must store safe source references and bounded JSON refs only.

The exported schema health APIs are
`createPostgresStorageAdapter(...).validateSchema()`, `validatePostgresSchema`,
and `checkErpFinancialsInstallHealth`. Use `checkErpFinancialsInstallHealth`
when the caller needs package name, package version, manifest version, fixture
support, and no-credential-column evidence in one health result.

Import jobs should use the packaged Future ERP preflight before persisting
canonical facts so incompatible installs fail deterministically with structured
issue details:

```ts
import { validateFutureErpCanonicalSchemaPreflight } from "@handrail/erp-financials";

await validateFutureErpCanonicalSchemaPreflight(postgresClient, {
  jobName: "quickbooks-full-import"
});
```

## 4. Load fixtures and run smoke reports

Use the package fixture to prove the host app can write canonical facts and
consume report APIs:

```ts
import {
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  buildBalanceSheetReport,
  buildCashFlowReport,
  buildProfitAndLossReport,
  buildTrialBalanceReport
} from "@handrail/erp-financials";

await storage.loadStatementFixture(ERP_FINANCIALS_STATEMENT_FIXTURE);

const request = ERP_FINANCIALS_STATEMENT_FIXTURE.reportRequest;
const accounts = ERP_FINANCIALS_STATEMENT_FIXTURE.accounts;
const postings = ERP_FINANCIALS_STATEMENT_FIXTURE.postings;

const reports = [
  buildProfitAndLossReport({ ...request, accounts, postings }),
  buildBalanceSheetReport({ ...request, accounts, postings }),
  buildTrialBalanceReport({ ...request, accounts, postings }),
  buildCashFlowReport({
    ...request,
    accounts,
    postings,
    cashAccountIds: ERP_FINANCIALS_STATEMENT_FIXTURE.cashFlow.cashAccountIds,
    activityByAccountId:
      ERP_FINANCIALS_STATEMENT_FIXTURE.cashFlow.activityByAccountId
  })
];

for (const report of reports) {
  await storage.writeReportSnapshot(report);
}
```

These raw-posting builders are intentionally used here because fixture smoke and
snapshot rebuilds need deterministic formula coverage from canonical postings.
They are not the production multi-column presentation path; standard report
presentation should read prepared report sets through
`buildStandardReportPresentationFromReadModel`.

Fixture smoke tests should assert expected totals, balanced trial balance and
balance sheet reconciliation status, cash-flow support status, and drilldown
refs on every material line and total. The repository's fixture contract is
covered by `runErpFinancialsFixtureSmokeHealth` and
`test/fixture-smoke-health.test.ts`. The fixture smoke API uses the package
report builders, so host apps and future platform capability code do not need
to duplicate P&L, balance sheet, trial balance, or cash-flow formulas.

## 5. Configure source adapters

Report builders consume canonical facts, not provider payloads. Host apps can
land source data through either native ERP input or provider-specific helpers:

```ts
import {
  mapNativeLedgerToCanonicalFacts,
  mapQuickBooksJournalEntriesToCanonicalFacts
} from "@handrail/erp-financials";

const nativeFacts = mapNativeLedgerToCanonicalFacts(nativeInput);
const quickBooksFacts =
  mapQuickBooksJournalEntriesToCanonicalFacts(quickBooksInput);
```

Both helpers return a `CanonicalAccountingFactSet` that can be loaded through
the same storage upsert methods:

```ts
const facts = nativeFacts;

await storage.upsertAccountingCompany(facts.company);
await storage.upsertAccountingSource(facts.source);
await storage.upsertImportBatch(facts.importBatch);
await storage.upsertSyncCheckpoint(facts.checkpoint);
await storage.upsertAccounts(facts.accounts);
await storage.upsertParties(facts.parties);
await storage.upsertItems(facts.items);
await storage.upsertDimensions(facts.dimensions);
await storage.upsertTransactions(facts.transactions);
await storage.upsertTransactionLines(facts.transactionLines);
await storage.upsertLedgerPostings(facts.postings);
```

Idempotency is tenant and source scoped. Reprocessing the same source facts
must update canonical rows instead of duplicating postings.

QuickBooks workers should hand off normalized resource envelopes and safe
runtime/source references only. The ERP Financials adapter contract is
`HandrailQuickBooksSdkResourcesAdapterInput` plus
`mapHandrailQuickBooksSdkResourcesToCanonicalFacts`, which returns the
`CanonicalAccountingFactSet` used by the storage methods above. Future ERP
should call the Handrail QuickBooks SDK/service for full sync, incremental
sync, and provider report parity, then pass only normalized resources and safe
source refs into this package. See
[storage-host-app-handoff.md](storage-host-app-handoff.md) for full and
incremental sync usage, checkpoint semantics, provider report reconciliation,
safe drilldown refs, validation commands, and the acceptance checklist.

## 6. Register scheduled jobs

Host apps or the future Handrail capability should register these jobs:

- `erp-financials-rollup`: call `buildScheduledRollupJobResult` with tenant,
  company, source, accounting basis, grains, period bounds, `generatedAt`, and
  compact source/import/checkpoint evidence. Pass either canonical postings or
  a host read interface. Persist the returned write-ready buckets with
  `storage.writeRollupBuckets`.
- `erp-financials-late-arrival-reprocess`: call `planLateArrivalReprocess` for
  changed or backdated postings, or call
  `buildLateArrivalReprocessExecutionContract` to get affected windows, stale
  snapshot update inputs, freshness rows, rebuilt replacement buckets, and the
  ordered storage write plan. Persist through `executeLateArrivalReprocess` or
  apply the plan in order: `storage.replaceRollupBucketsForWindows`,
  `storage.markReportSnapshotsStaleForPostingChanges`, then
  `storage.writeFreshnessRows`.
- `erp-financials-snapshot-refresh`: call `executeSnapshotRefresh` with tenant,
  company, source, report request bounds, freshness evidence, optional cash
  flow classification options, and a storage adapter. Fresh stored snapshots
  are reused without writes; stale or missing snapshots are rebuilt through the
  package report builders, then persisted with `storage.writeReportSnapshot`
  and `storage.writeFreshnessRows`.
- `erp-financials-freshness-reconcile`: call `reconcileReportFreshness` or
  `createSnapshotRefreshContract`, then persist rows with
  `storage.writeFreshnessRows`.
- `erp-financials-retention-prune`: prune only host-owned transient import or
  job data. Durable canonical facts, rollups, snapshots, and freshness rows are
  reporting data and need explicit retention policy.

Normal dashboard reads should use report snapshots, rollup buckets, and
freshness rows. They should not scan raw provider objects for routine report
windows.

For Future ERP, the exported schedule binding is
`createFutureErpRollupAndLateArrivalWorker` for rollup and late-arrival
reprocess work, and `createFutureErpSnapshotRefreshAndFreshnessWorker` for
snapshot refresh and freshness reconciliation work. See
[future-erp-scheduler-handoff.md](future-erp-scheduler-handoff.md) for the
host-owned schedule names, retry semantics, expected cadence notes, and evidence
fields, and [operations-runbook.md](operations-runbook.md) for the source-level
operator runbook. Those docs are descriptors for host scheduler registration;
they do not authorize platform queue creation or deployment/config changes.

Example rollup job handler:

```ts
import { buildScheduledRollupJobResult } from "@handrail/erp-financials";

const result = await buildScheduledRollupJobResult({
  tenantId,
  companyId,
  sourceId,
  accountingBasis: "accrual",
  bucketGrains: ["day", "month", "fiscal_period"],
  periodStart: "2026-01-01",
  periodEnd: "2026-01-31",
  fiscalYearStartMonth,
  generatedAt: new Date().toISOString(),
  importEvidence: { importBatchId },
  checkpointEvidence: { checkpointId, freshThrough },
  postingReader: {
    readCanonicalPostingsForRollup: (request) =>
      hostCanonicalStore.readLedgerPostings(request)
  }
});

await storage.writeRollupBuckets(result.buckets);
hostLogger.info({ rollupSummary: result.summary });
```

`result.summary` is compact and credential-free. It is suitable for host job
logs or health dashboards, while durable financial facts remain in rollup,
snapshot, and freshness tables.

## 7. Health and freshness checks

Recommended host-app and capability health checks:

- Package version is compatible with the expected manifest version.
- `checkErpFinancialsInstallHealth` returns `status: "healthy"`.
- `storage.validateSchema()` or `validatePostgresSchema` returns
  `compatible: true`.
- `runErpFinancialsFixtureSmokeHealth` returns `status: "healthy"` with stable
  report totals, snapshot ids, freshness ids, and summary hash.
- Source adapter imports create canonical facts without credential fields.
- Rollup jobs have produced current buckets for configured grains.
- Late-arrival reprocess marks affected snapshots stale and replaces rollup
  windows without duplicate aggregates.
- `reconcileReportFreshness` produces rows for supported reports, accounting
  bases, currencies, and source boundaries.
- `checkErpFinancialsFreshnessAndDrilldownHealth` confirms freshness rows exist
  and drilldown refs resolve to canonical posting evidence or compact query
  tokens.

Operators should start with [rollups-and-snapshots.md](rollups-and-snapshots.md)
for stale report behavior, [canonical-data-model.md](canonical-data-model.md)
for identity and provenance constraints, and [quickbooks-boundary.md](quickbooks-boundary.md)
for provider boundary questions. Use
[operations-runbook.md](operations-runbook.md) when deciding whether to retry,
record degraded evidence, or escalate config, deploy, or credential work.

## QuickBooks capability separation

`erp_financials` and `quickbooks` are separate capability concerns.

`quickbooks` owns provider access through the Handrail QuickBooks SDK/runtime
contract. QuickBooks OAuth, token custody, raw provider calls, provider
resource normalization, and tenant/provider access stay inside the integration
service. Host apps should use `@handrail/quickbooks-node-sdk` for QuickBooks
service calls and the
Handrail-managed runtime keys:

- `HANDRAIL_QBO_SERVICE_ENV`
- `HANDRAIL_QBO_PROVIDER_MODE`
- `HANDRAIL_QBO_API_KEY`
- `HANDRAIL_QBO_TENANT_ID`

`HANDRAIL_QBO_BASE_URL` is only for local or service override scenarios.

`erp_financials` owns canonical financial schema, deterministic report
builders, storage adapter contracts, rollup/snapshot/freshness contracts,
bounded reconciliation evidence, fixtures, and validation. It must not store
Intuit access tokens, Intuit refresh tokens, provider OAuth secrets, or new
QuickBooks credential environment variables. QuickBooks helper inputs should
contain normalized resources plus safe runtime/source references only. They
must not contain raw unbounded provider payloads. Provider reports are allowed
only as bounded parity evidence; ERP Financials canonical snapshots and
freshness rows are the durable reporting source.
