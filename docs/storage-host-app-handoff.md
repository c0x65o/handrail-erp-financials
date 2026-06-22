# Storage and Host-App Handoff

This is the implementation boundary for workers that connect the Handrail
QuickBooks SDK/service, Future ERP, and `@handrail/erp-financials` storage. It
keeps provider access, canonical financial storage, and host-app operations in
separate layers while giving each worker the same contract to target.

## Responsibility Split

| Layer | Owns | Must not own |
| --- | --- | --- |
| QuickBooks SDK/service | OAuth, token custody, token refresh, realm mapping, QuickBooks API calls, CDC/delta sync, raw provider imports, normalized SDK responses, provider report calls, provider reconciliation helpers | ERP canonical schema, ERP report formulas, host-app database credentials |
| ERP Financials package | Canonical accounting types, source adapter contracts, Postgres schema manifest, storage adapter, report builders, rollups, snapshots, freshness rows, fixtures, validation | Provider OAuth, provider token storage, app UI, tenant permissions, customer workflows |
| Future ERP or another host app | Tenant workflows, user permissions, app database connection, migration execution, job scheduling, QuickBooks SDK calls, source adapter invocation, app-facing report/API routes | Intuit tokens, duplicated financial formulas, raw provider payload tables as the reporting model |

## Handoff Flow

```text
QuickBooks SDK/service
  -> NormalizedQuickBooksResourceSet / NormalizedQuickBooksSyncResourceSet
  -> HandrailQuickBooksSdkResourcesAdapterInput
  -> mapHandrailQuickBooksSdkResourcesToCanonicalFacts(...)
  -> CanonicalAccountingFactSet
  -> createPostgresStorageAdapter(hostPostgresClient)
  -> canonical facts, rollups, snapshots, and freshness rows
  -> Future ERP report screens and AI tools
```

Native ERP data uses the same storage side of the boundary:

```text
Native ERP ledger events
  -> mapNativeLedgerToCanonicalFacts(...)
  -> CanonicalAccountingFactSet
  -> the same storage upsert, rollup, snapshot, and freshness methods
```

## ERP Financials Adapter Contract

The ERP Financials adapter contract for the Handrail QuickBooks SDK/service is:

```ts
import {
  mapHandrailQuickBooksSdkResourcesToCanonicalFacts
} from "@handrail/erp-financials";
import type {
  HandrailQuickBooksSdkResourcesAdapterInput,
  NormalizedQuickBooksResourceSet,
  NormalizedQuickBooksSyncResourceSet
} from "@handrail/erp-financials";

const adapterInput: HandrailQuickBooksSdkResourcesAdapterInput = {
  context,
  resources: normalizedQuickBooksResources
};

const facts = mapHandrailQuickBooksSdkResourcesToCanonicalFacts(adapterInput);
```

`NormalizedQuickBooksResourceSet` is the full-sync resource contract. It
contains source identity, import batch metadata, checkpoint metadata,
CompanyInfo, accounts, ledger transactions or journal entries, ledger postings,
parties/customers/vendors, items, classes/departments/dimensions, provider
report refs, and bounded reconciliation evidence.

`NormalizedQuickBooksSyncResourceSet` is the incremental-sync contract. It uses
the same resource envelopes, but CompanyInfo and accounts are optional because
delta runs may only contain changed, deleted, voided, or skipped resources.

Every normalized resource envelope must preserve:

- `sourceSystem: "quickbooks"`, tenant id, source id, provider environment,
  realm id, resource type, and resource id.
- `importBatchId`, `checkpointId`, source revision, sync action, and source
  update timestamp when available.
- `sourcePayloadRef` for drilldown, using a compact storage/query ref and an
  optional bounded preview.

The adapter output is a `CanonicalAccountingFactSet`. Future ERP stores that
fact set through the ERP Financials storage adapter and builds local reports
from canonical facts, rollups, snapshots, and freshness rows.

## QuickBooks Worker Output

A QuickBooks-facing worker should call the Handrail QuickBooks SDK/service and
produce normalized resource envelopes, not raw QuickBooks response archives.
For full sync, call a transport or service handler that returns
`NormalizedQuickBooksFullSyncResponseEnvelope`. For incremental sync, call one
that returns `NormalizedQuickBooksIncrementalSyncResponseEnvelope`.

The normalized output should include:

- `context.tenantId`, `context.companyId`, `context.sourceId`, and
  `context.realmId`.
- `context.providerEnvironment` as `sandbox` or `production`.
- `context.importBatchId`, `context.checkpointId`, `context.importedAt`, and
  optional source freshness timestamps.
- `context.runtimeConfig` with Handrail QuickBooks runtime references, not
  secrets.
- `companyInfo`, `accounts`, and journal-entry/accounting resources returned by
  the SDK.
- Safe source payload refs for drilldown, such as provider object references or
  bounded previews.

QuickBooks OAuth and token custody stay inside the Handrail QuickBooks
integration service. The SDK/service must not pass Intuit access tokens,
refresh tokens, client secrets, provider clients, raw unbounded QuickBooks
payload archives, or newly invented QuickBooks credential environment variables
into ERP Financials or Future ERP storage.

## Full and Incremental Sync Usage

Future ERP should call the QuickBooks SDK/service through an app-owned worker
or job. The worker should not call Intuit directly.

Full sync usage:

- Send `NormalizedQuickBooksFullSyncRequestEnvelope` with `syncMode: "full"`
  and `cursorKind: "full_scan"`.
- Use stable `idempotencyKey`, `importBatchId`, and `checkpointId` values for
  the request.
- Expect `NormalizedQuickBooksFullSyncResponseEnvelope` with a complete
  `NormalizedQuickBooksResourceSet`, resource counts, import batch metadata,
  and the initial checkpoint.
- Adapt `response.resources` to `HandrailQuickBooksSdkResourcesAdapterInput`
  and persist the resulting `CanonicalAccountingFactSet`.

Incremental sync usage:

- Send `NormalizedQuickBooksIncrementalSyncRequestEnvelope` with
  `syncMode: "incremental"` and `cursorKind: "updated_since"` or
  `cursorKind: "high_watermark"`.
- Include the previous checkpoint cursor value and, when resuming a known
  checkpoint, `resumeFromCheckpointId`.
- Expect `NormalizedQuickBooksIncrementalSyncResponseEnvelope` with a
  `NormalizedQuickBooksSyncResourceSet` that may contain changed, deleted,
  voided, or skipped resources.
- Persist the new import batch and checkpoint before enabling downstream
  rollup/snapshot refresh work for the affected windows.

Checkpoint semantics:

- A checkpoint is a durable source cursor for one tenant/source/realm/resource
  boundary, not a credential or provider session.
- `cursorValue` is the next SDK/service cursor to resume from; `freshThrough`
  is the service's safe freshness boundary for reporting; and
  `latestSourceUpdatedAt` is provider-source evidence for the latest changed
  resource included in the batch.
- Replaying the same import batch and checkpoint must be idempotent. Storage
  upserts use tenant/source/provider object identity, not provider payload
  bytes, to avoid duplicate ledger postings.

## Future ERP Adoption Path

Future ERP should adopt this path in order:

1. Install `@handrail/erp-financials` and run the schema install/validation
   flow in [host-app-install.md](host-app-install.md).
2. Use the Handrail QuickBooks SDK/service as the only QuickBooks provider
   access layer. Keep OAuth authorization, token refresh, token custody, raw
   import ownership, and provider report calls in that service.
3. In a Future ERP import worker, call `fullSync` for first import and
   `incrementalSync` for ongoing CDC/delta imports.
4. Convert `response.resources` to
   `HandrailQuickBooksSdkResourcesAdapterInput`, then call
   `mapHandrailQuickBooksSdkResourcesToCanonicalFacts`.
5. Persist the returned `CanonicalAccountingFactSet` through
   `createPostgresStorageAdapter(hostPostgresClient)`.
6. Run rollup, snapshot, freshness, and reconciliation jobs from this package.
7. Expose Future ERP screens and AI tools from canonical reports and compact
   drilldown refs, not from raw provider payload tables.

The same adoption path works for native ERP data after step 2 by replacing the
QuickBooks adapter with `mapNativeLedgerToCanonicalFacts`.

## Safe Drilldown Refs

Drilldown refs should be compact and bounded. Use `sourcePayloadRef` and report
`drilldownRef` values to point to provider object refs, canonical query tokens,
or short previews. A safe ref may include `provider`, `providerEnvironment`,
`sourceObjectType`, `sourceObjectId`, `sourceLineId`, `storageRef`,
`sourceUpdatedAt`, and a bounded `preview`.

Do not persist raw QuickBooks response bodies, OAuth grants, tokens, provider
client objects, or unlimited request/response archives as drilldown data.
Future ERP drilldown handlers should resolve compact refs through the
QuickBooks service or canonical storage with tenant permission checks.

## Provider Report Reconciliation

QuickBooks provider reports are parity evidence. They help compare local
canonical reports against QuickBooks totals, but they are not the durable ERP
reporting model.

Use the SDK/service report envelopes for provider parity:

- `NormalizedQuickBooksProfitAndLossReportRequestEnvelope`
- `NormalizedQuickBooksBalanceSheetReportRequestEnvelope`
- `NormalizedQuickBooksTrialBalanceReportRequestEnvelope`
- `NormalizedQuickBooksCashFlowParityReportRequestEnvelope`

The package exposes helpers such as
`buildQuickBooksProfitAndLossReconciliationEvidence`,
`buildQuickBooksBalanceSheetReconciliationEvidence`,
`buildQuickBooksTrialBalanceReconciliationEvidence`, and
`buildQuickBooksProviderReportReconciliationEvidence`. Use them to compare
provider totals with canonical totals, persist bounded reconciliation evidence,
and surface freshness/parity status to operators.

QuickBooks cash-flow parity reports may be unsupported. Future ERP should still
build local cash-flow output from canonical postings when sufficient cash
classification data exists, and mark report support/freshness accurately when
it does not.

## Storage Worker Input

A storage-facing worker should receive a `CanonicalAccountingFactSet`, no matter
which source produced it, and persist it with the package storage adapter. Use
the host app's Postgres client and keep database credentials in the host app:

```ts
import { createPostgresStorageAdapter } from "@handrail/erp-financials";

const storage = createPostgresStorageAdapter(hostPostgresClient);

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

The write order follows parent-to-child references in the canonical manifest.
Workers may batch within each method, but they should not bypass the storage
adapter unless a host migration or backfill has an explicit package-compatible
SQL plan.

## Idempotency and Provenance

Source workers must preserve stable source identity so storage workers can
reprocess late, changed, or backdated facts without duplicate postings. At a
minimum, preserve:

- tenant id
- source id
- provider environment
- source company ref, such as QuickBooks realm id
- source object type and id
- source line id where applicable
- accounting basis
- import batch id
- checkpoint id
- source update timestamp when available
- safe source payload ref for drilldown

ERP Financials storage upserts are tenant/source scoped. Ledger postings are
deduplicated by the manifest identity rather than by provider payload content.

## Reports, Rollups, and Freshness

After canonical facts land, Future ERP or the future `erp_financials`
capability should run package-owned report and storage APIs:

- Build durable rollups with `buildRollupBuckets` and
  `storage.writeRollupBuckets`.
- Reprocess changed windows with `planLateArrivalReprocess`,
  `storage.replaceRollupBucketsForWindows`, and
  `storage.markReportSnapshotsStaleForPostingChanges`.
- Build snapshots with the package report builders and
  `storage.writeReportSnapshot`.
- Persist freshness and reconciliation status with
  `storage.writeFreshnessRows`.

Provider reports from QuickBooks are reconciliation evidence and parity inputs.
They are not the durable ERP reporting schema and should not replace canonical
facts, rollups, snapshots, or freshness rows.

## Validation Commands

The normalized QuickBooks contract is reproducible without live QuickBooks
credentials. Use targeted validation during handoff work:

```sh
npm run contract:smoke
npx vitest run test/quickbooks-sync-service.test.ts
npx vitest run test/normalized-quickbooks-sync-fixtures.test.ts
npx vitest run test/normalized-quickbooks-contract-compatibility.test.ts
```

`npm run contract:smoke` exercises the deterministic fixture path:
normalized QuickBooks resources -> ERP Financials adapter contract ->
canonical facts -> P&L, balance sheet, and trial balance snapshots. The smoke
harness uses only fixtures and provider report summaries. It must not require
QuickBooks credentials, call Intuit, or serialize credential-like fields.

Before enabling an import worker against a host database, run the host-app
schema validation from [host-app-install.md](host-app-install.md):

```ts
const validation = await storage.validateSchema();
```

For a full package release gate, use `npm run validate`; queued Handrail runs
may already execute broader project checks, so local workers should prefer the
targeted commands above unless shared infrastructure changed.

## Acceptance Checklist

- QuickBooks code can be removed or replaced without changing canonical report
  formulas.
- Native ERP and QuickBooks imports both produce `CanonicalAccountingFactSet`.
- The named ERP Financials adapter contract is
  `HandrailQuickBooksSdkResourcesAdapterInput` with
  `mapHandrailQuickBooksSdkResourcesToCanonicalFacts`.
- Future ERP calls the QuickBooks SDK/service for full sync, incremental sync,
  and provider report parity instead of calling Intuit directly.
- Future ERP stores only canonical facts, compact source refs, rollups,
  snapshots, and freshness rows for reporting.
- `storage.validateSchema()` passes before import jobs are enabled.
- Re-running the same source batch updates rows instead of duplicating ledger
  postings.
- No ERP Financials table, fixture, env var, or job contains provider OAuth
  tokens or QuickBooks credential material.
- QuickBooks OAuth/token custody remains inside the Handrail QuickBooks
  integration service.
