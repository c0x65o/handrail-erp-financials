# handrail-erp-financials

Provider-neutral TypeScript foundation for reusable ERP financial reporting.
This package is intended to give host ERP apps a shared kernel for canonical
accounting facts, schema and migration manifests, deterministic report builders,
rollups, snapshots, freshness tracking, fixtures, and validation utilities.

The package boundary follows the repository docs:

```text
source adapters -> canonical accounting facts -> rollup/snapshot engine -> report APIs -> app UI and AI tools
```

QuickBooks is the first adapter target, but it is not a package dependency or a
credential owner. Host apps should use the Handrail QuickBooks SDK/runtime
contract for provider access and pass safe source references plus normalized
accounting facts into this package. This repository must not store Intuit tokens
or define new QuickBooks credential environment variables.

## Install

```sh
npm install
```

The published package entry point is `@handrail/erp-financials`; local
development builds emit ESM JavaScript and TypeScript declarations to `dist/`.

```ts
import {
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  POSTGRES_CANONICAL_SCHEMA_MANIFEST,
  buildProfitAndLossReport,
  createPostgresStorageAdapter,
  describePackageBoundary,
  renderPostgresSchemaSql
} from "@handrail/erp-financials";

const boundary = describePackageBoundary();
const manifest = POSTGRES_CANONICAL_SCHEMA_MANIFEST;
const sql = renderPostgresSchemaSql(manifest);
const profitAndLoss = buildProfitAndLossReport({
  ...ERP_FINANCIALS_STATEMENT_FIXTURE.reportRequest,
  accounts: ERP_FINANCIALS_STATEMENT_FIXTURE.accounts,
  postings: ERP_FINANCIALS_STATEMENT_FIXTURE.postings
});
```

The initial schema foundation exports provider-neutral canonical accounting
types plus a versioned Postgres manifest for host-app installs. The manifest
covers companies, sources, accounts, parties, items, dimensions, transactions,
transaction lines, ledger postings, import batches, sync checkpoints, and report
snapshot tables. It intentionally stores safe source references and bounded JSON
refs, not provider OAuth tokens or raw unbounded provider payloads.

The first deterministic fixture set exports representative companies, sources,
accounts, parties, items, dimensions, transactions, transaction lines, and
ledger postings. The report builders currently calculate profit and loss,
balance sheet, trial balance, and cash flow from canonical postings. Results
emit snapshot metadata, line rows, named totals, freshness/reconciliation
fields, and compact drilldown refs for app UI and AI-safe report APIs. Cash flow
uses cash-account ledger movement and marks output `partial` when fixture or
host data cannot classify a cash movement.

## Postgres Storage Boundary

Host apps provide their own Postgres connection object; this package does not
own database credentials, provider OAuth, or runtime env vars. Any client with a
`query(sql, params)` method can be adapted:

```ts
const storage = createPostgresStorageAdapter(postgresClient);

const installPlan = await storage.installSchema({ dryRun: true });
const validation = await storage.validateSchema();

if (!validation.compatible) {
  console.log(validation.issues);
}

await storage.upsertAccountingCompany(ERP_FINANCIALS_STATEMENT_FIXTURE.company);
await storage.upsertAccountingSource(ERP_FINANCIALS_STATEMENT_FIXTURE.source);
await storage.upsertLedgerPostings(ERP_FINANCIALS_STATEMENT_FIXTURE.postings);
await storage.writeReportSnapshot(profitAndLoss);
```

`installSchema({ dryRun: true })` returns the deterministic DDL statements
without mutating a database. `validateSchema()` reads Postgres catalogs and
reports missing schema, tables, columns, indexes, constraints, and fixture-loader
support. Fixture loading, rollup writes, freshness writes, and stale snapshot
marking are explicit mutating methods so validation can be run safely against a
host production database.

The idempotent upsert helpers use tenant/source identities from the manifest,
for example ledger postings conflict on `(tenant_id, source_id,
accounting_basis, source_posting_id)`. This lets import jobs reprocess late or
backdated source facts without duplicating canonical postings.

For the complete blank-host install sequence, fixture smoke test path,
scheduled job expectations, freshness checks, and future Handrail capability
validation checklist, see [docs/host-app-install.md](docs/host-app-install.md).
For the worker-facing QuickBooks SDK/service to host-app storage contract, see
[docs/storage-host-app-handoff.md](docs/storage-host-app-handoff.md).

## Source Adapters

Provider inputs land in report builders through the same canonical fact set.
The package exports generic adapter contracts plus helper foundations for native
ERP ledgers and QuickBooks SDK-shaped journal entry data:

```ts
import {
  ERP_FINANCIALS_QUICKBOOKS_ADAPTER_FIXTURE,
  mapHandrailQuickBooksSdkResourcesToCanonicalFacts,
  mapNativeLedgerToCanonicalFacts,
  mapQuickBooksJournalEntriesToCanonicalFacts
} from "@handrail/erp-financials";

const nativeFacts = mapNativeLedgerToCanonicalFacts(nativeLedgerInput);
const quickBooksFacts = mapQuickBooksJournalEntriesToCanonicalFacts(quickBooksSdkInput);
const quickBooksResourceFacts = mapHandrailQuickBooksSdkResourcesToCanonicalFacts(handrailQuickBooksResourcesInput);
const quickBooksEvidence = ERP_FINANCIALS_QUICKBOOKS_ADAPTER_FIXTURE.providerReportEvidence;
```

For service and SDK boundaries, the package also exports normalized QuickBooks
resource contracts such as `NormalizedQuickBooksResourceSet`,
`NormalizedQuickBooksCompanyInfoResource`, `NormalizedQuickBooksAccountResource`,
`NormalizedQuickBooksLedgerTransactionResource`, and
`NormalizedQuickBooksLedgerPostingResource`. These contracts carry tenant/source
identity, realm/provider environment, sync mode, import batch id, checkpoint id,
source update timestamps, safe drilldown refs, provider report refs, and bounded
reconciliation evidence without exposing provider clients or credential fields.

The QuickBooks helper preserves tenant id, source id, provider environment,
realm id, source object type/id, source update timestamps, import batch ids,
checkpoint ids, and safe source payload refs for idempotency and drilldown. It
expects host apps to fetch provider data through the Handrail QuickBooks
SDK/runtime config. Host apps that receive normalized Handrail QuickBooks
resource wrappers can pass them through
`mapHandrailQuickBooksSdkResourcesToCanonicalFacts`, which validates
realm/environment identity and carries bounded SDK/service source refs into the
canonical facts. ERP Financials does not store Intuit access or refresh tokens
and does not introduce QuickBooks credential environment variables.

`ERP_FINANCIALS_QUICKBOOKS_ADAPTER_FIXTURE` proves the same path with
deterministic QuickBooks-shaped SDK resources: adapter input maps to canonical
facts, those facts build P&L, balance sheet, and trial balance reports, and the
fixture carries bounded provider-total reconciliation evidence with safe
QuickBooks report refs.

`createQuickBooksContractSmokeHarness()` is the local contract smoke harness for
Future ERP adoption. It starts from
`ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.fullSync.response.resources`,
adapts the normalized resource envelopes into the
`mapHandrailQuickBooksSdkResourcesToCanonicalFacts` input shape, builds
canonical facts and P&L/balance sheet/trial balance reports, and returns a
compact deterministic snapshot plus SHA-256 hash. The snapshot also records the
ERP freshness row, snapshot refresh contract, monthly rollup summary, and
QuickBooks service-health evidence derived from the normalized fixture boundary.
The harness uses only fixture data and provider report fixture summaries; it
does not require QuickBooks credentials, call Intuit, store Intuit
access/refresh tokens, or retain raw unbounded provider payloads. Cash-flow
reports remain buildable from canonical facts, while QuickBooks provider
cash-flow parity is intentionally documented as unsupported in the deterministic
provider-report fixture.

## Validation

Run the deterministic package checks from a clean checkout:

```sh
npm run lint
npm run typecheck
npm run test
npm run build
```

`npm run validate` runs the same commands in sequence for local package
verification.

For targeted schema work, the canonical manifest contract is covered by:

```sh
npx vitest run test/canonical-schema-manifest.test.ts
```

For targeted report-builder work, the deterministic fixture contract is covered
by:

```sh
npx vitest run test/report-builders-fixtures.test.ts
```

For targeted Postgres storage adapter work, run:

```sh
npx vitest run test/postgres-storage.test.ts
```

For targeted source adapter work, run:

```sh
npx vitest run test/source-adapters.test.ts
```

For the normalized QuickBooks handoff smoke harness, run:

```sh
npm run contract:smoke
```

For the reusable install/schema/fixture/freshness/drilldown health contract that
host apps and the future `erp_financials` capability can run without provider
credentials, run:

```sh
npm run health:smoke
```

## Current Scaffold

- `src/` contains the public TypeScript exports for host ERP apps, including
  canonical model types, the versioned Postgres schema manifest, source adapter
  contracts/helpers, deterministic fixture data, report builders, and the
  host-provided Postgres storage adapter.
- `test/` contains deterministic Vitest coverage for the current public API.
- `tsconfig*.json`, `eslint.config.mjs`, and `vitest.config.ts` define the
  lint, typecheck, test, and build path.
- `docs/` remains the implementation contract for the next schema, fixture,
  adapter, rollup, snapshot, and freshness tasks.
