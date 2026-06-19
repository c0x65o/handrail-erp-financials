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

## 1. Add the package dependency

Install the package in the host app:

```sh
npm install @handrail/erp-financials
```

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

## 2. Install the canonical schema

Host apps own their database credentials and migration framework. This package
exports the versioned Postgres schema manifest and deterministic SQL renderer:

```ts
import {
  POSTGRES_CANONICAL_SCHEMA_MANIFEST,
  renderPostgresSchemaSql
} from "@handrail/erp-financials";

const statements = renderPostgresSchemaSql(POSTGRES_CANONICAL_SCHEMA_MANIFEST);
```

Commit those statements through the host app migration system, or use the
storage adapter during development to produce the same install plan:

```ts
import { createPostgresStorageAdapter } from "@handrail/erp-financials";

const storage = createPostgresStorageAdapter(postgresClient);
const installPlan = await storage.installSchema({ dryRun: true });
```

`installSchema({ dryRun: true })` must be the default validation path for blank
apps and production audits because it does not mutate the database. Direct
execution should happen only through the host app's explicit migration flow.

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

Fixture smoke tests should assert expected totals, balanced trial balance and
balance sheet reconciliation status, cash-flow support status, and drilldown
refs on every material line and total. The repository's fixture contract is
covered by `test/report-builders-fixtures.test.ts`.

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

## 6. Register scheduled jobs

Host apps or the future Handrail capability should register these jobs:

- `erp-financials-rollup`: build day, month, and fiscal-period buckets with
  `buildRollupBuckets`, then persist them with `storage.writeRollupBuckets`.
- `erp-financials-late-arrival-reprocess`: call `planLateArrivalReprocess` for
  changed or backdated postings, replace affected windows with
  `storage.replaceRollupBucketsForWindows`, and mark affected snapshots stale
  with `storage.markReportSnapshotsStaleForPostingChanges`.
- `erp-financials-snapshot-refresh`: rebuild reports through
  `buildProfitAndLossReport`, `buildBalanceSheetReport`,
  `buildTrialBalanceReport`, or `buildCashFlowReport`, then write snapshots
  with `storage.writeReportSnapshot`.
- `erp-financials-freshness-reconcile`: call `reconcileReportFreshness` or
  `createSnapshotRefreshContract`, then persist rows with
  `storage.writeFreshnessRows`.
- `erp-financials-retention-prune`: prune only host-owned transient import or
  job data. Durable canonical facts, rollups, snapshots, and freshness rows are
  reporting data and need explicit retention policy.

Normal dashboard reads should use report snapshots, rollup buckets, and
freshness rows. They should not scan raw provider objects for routine report
windows.

## 7. Health and freshness checks

Recommended host-app and capability health checks:

- Package version is compatible with the expected manifest version.
- `storage.validateSchema()` returns `compatible: true`.
- Fixture load and smoke reports produce expected deterministic totals.
- Source adapter imports create canonical facts without credential fields.
- Rollup jobs have produced current buckets for configured grains.
- Late-arrival reprocess marks affected snapshots stale and replaces rollup
  windows without duplicate aggregates.
- Freshness rows exist for supported reports, accounting bases, currencies, and
  source boundaries.
- Drilldown refs resolve to canonical posting evidence or compact query tokens.

Operators should start with [rollups-and-snapshots.md](rollups-and-snapshots.md)
for stale report behavior, [canonical-data-model.md](canonical-data-model.md)
for identity and provenance constraints, and [quickbooks-boundary.md](quickbooks-boundary.md)
for provider boundary questions.

## QuickBooks capability separation

`erp_financials` and `quickbooks` are separate capability concerns.

`quickbooks` owns provider access through the Handrail QuickBooks SDK/runtime
contract. Host apps should use `@handrail/sdk-node` helpers and the
Handrail-managed runtime keys:

- `HANDRAIL_QBO_SERVICE_ENV`
- `HANDRAIL_QBO_PROVIDER_MODE`
- `HANDRAIL_QBO_API_KEY`
- `HANDRAIL_QBO_TENANT_ID`

`HANDRAIL_QBO_BASE_URL` is only for local or service override scenarios.

`erp_financials` owns canonical financial schema, deterministic report
builders, rollup/snapshot/freshness contracts, fixtures, and validation. It
must not store Intuit access tokens, Intuit refresh tokens, provider OAuth
secrets, or new QuickBooks credential environment variables. QuickBooks helper
inputs should contain SDK-shaped accounting objects plus safe runtime/source
references only.
