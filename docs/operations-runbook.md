# Operations Runbook: Safe Retry and Evidence

This runbook covers source-level operation of the
`@handrail/erp-financials` contract in host apps and the future Handrail
`erp_financials` capability. It is intentionally bounded to repository-owned
package APIs, deterministic tests, fixture evidence, and handoff notes.

Do not use this runbook to create Handrail platform capabilities, queues,
deployment targets, environment variables, secrets, CI/CD runs, or live
QuickBooks provider actions. Scheduler registration, deploy changes, provider
credential work, and runtime configuration changes remain separately gated
platform or owner-approved work.

## Deterministic Commands

Run these commands from the repository root:

```sh
npm run health:smoke
npm run contract:smoke
npm run typecheck:future-erp-imports
```

Targeted commands for specific operator questions:

```sh
# Rollup, late-arrival, and snapshot contract behavior.
npm exec vitest -- run test/rollup-jobs.test.ts test/future-erp-rollup-workers.test.ts test/future-erp-snapshot-workers.test.ts

# Fixture smoke interpretation.
npm exec vitest -- run test/fixture-smoke-health.test.ts test/future-erp-install-health-preflight.test.ts

# Freshness and drilldown health behavior.
npm exec vitest -- run test/freshness-drilldown-health.test.ts

# QuickBooks normalized contract smoke without live provider credentials.
npm run contract:smoke

# Credential-boundary and serialized evidence checks.
npm exec vitest -- run test/serialized-evidence-boundary.test.ts test/package-boundary.test.ts test/normalized-quickbooks-sync-fixtures.test.ts

# Future ERP fixture replay through package-owned sandbox fixtures.
npm run sandbox:quickbooks:replay
```

`npm run validate` is the full package validation command. Use it for phase
validation or release-candidate review, not as the normal first retry step for a
single operational question.

## Phase Validation Evidence: 2026-06-20

Validation run from the `handrail-erp-financials` repository root in the
queued Codex worker. No production deploy, Handrail platform capability
creation, scheduler registration, runtime configuration change, environment
variable change, secret change, or CI/CD run was performed.

| Command | Result | Evidence |
| --- | --- | --- |
| `npm run validate` | Passed | `lint`, `typecheck`, Vitest `26` files / `148` tests, and `build` completed. |
| `npm run health:smoke` | Passed | Vitest `5` files / `17` tests covering install health, fixture smoke, freshness/drilldown health, aggregate health contract, and Future ERP install-health preflight. |
| `npm run contract:smoke` | Passed | Vitest `1` file / `2` tests covering the normalized QuickBooks contract smoke harness without live provider credentials. |
| `npm exec vitest -- run test/rollup-jobs.test.ts test/future-erp-rollup-workers.test.ts test/future-erp-snapshot-workers.test.ts test/future-erp-preflight.test.ts test/future-erp-install-health-preflight.test.ts` | Passed | Vitest `5` files / `29` tests covering rollup, Future ERP rollup worker, snapshot/freshness worker, preflight, and install-health preflight contracts. |
| `npm run sandbox:quickbooks:replay` | Passed | Vitest `1` file / `2` tests covering package-owned Future ERP QuickBooks sandbox replay fixtures. |
| `npm run typecheck:future-erp-imports` | Passed | TypeScript consumer import contract completed with `tsc --noEmit -p tsconfig.future-erp-consumer.json`. |

Linked-repo validation was skipped because the queued worker mounted only the
primary `handrail-erp-financials` checkout under `/opt/handrail/repos`; the
`handrail-quickbooks-integrations` and `hitcents-future-erp` repositories were
not available as local runtime/package workspaces. The package-owned QuickBooks
contract smoke and Future ERP scheduler/health fixtures above were run instead.

## Evidence Rules

Every retry, fixture smoke, or health result should be recorded as compact
evidence. Evidence must be credential-free and bounded. It may include ids,
counts, statuses, hashes, report names, date windows, checkpoint ids, import
batch ids, and safe source or drilldown refs. It must not include Intuit access
tokens, refresh tokens, client secrets, API keys, raw provider response bodies,
provider client instances, or unbounded payload archives.

Minimum evidence envelope:

| Field | Meaning |
| --- | --- |
| `jobName` or `preflightName` | Package or host scheduler contract name. |
| `tenantId`, `companyId`, `sourceId` | Host-owned accounting scope. |
| `periodStart`, `periodEnd`, `asOfDate` | Report or rollup window. |
| `accountingBasis`, `currencyCode` | Report basis and currency. |
| `generatedAt` | Deterministic generation timestamp supplied by the caller. |
| `status`, `issueCount`, `issues` | Result state and bounded issue list. |
| `importBatchId`, `checkpointId`, `sourceFreshThrough` | Source freshness evidence when available. |
| `summaryHash` | Stable hash for fixture or smoke results when exposed. |

Forbidden evidence for every operation:

- Intuit access tokens, refresh tokens, client secrets, API keys, OAuth grants,
  provider client instances, or secret values.
- Raw QuickBooks request/response bodies, raw provider payload archives,
  unbounded payload previews, or copied customer ledger data outside the
  approved canonical fixture/storage path.
- Production database credentials, runtime env values, queue payload dumps, or
  Handrail platform mutation evidence.

## Retry Evidence Matrix

Use this matrix as the source-level closeout checklist for retry-safe evidence.
Each row must be reproducible from deterministic inputs and compact outputs.

| Operation | Deterministic retry inputs | Expected outputs | Escalate when | Forbidden evidence |
| --- | --- | --- | --- | --- |
| Full sync | Same tenant, company, source, realm, provider environment, `syncMode: "full"`, `cursorKind: "full_scan"`, idempotency key, import batch id, checkpoint id, generated/imported timestamps, accounting basis, currency, and normalized fixture/service envelope. | `CanonicalAccountingFactSet`, persisted company/source/import/checkpoint/fact counts, resource counts, safe source refs, checkpoint `cursorValue`, `freshThrough`, `latestSourceUpdatedAt`, and downstream rollup/snapshot trigger scope. | QuickBooks service health, provider credentials, tenant mapping, runtime env, or live provider access is missing; production data is required; storage schema cannot persist canonical facts. | Provider tokens, client secrets, raw QuickBooks bodies, provider client objects, production customer payloads, or new QuickBooks credential env vars. |
| Incremental sync | Same tenant, company, source, realm, provider environment, `syncMode: "incremental"`, cursor kind/value, optional `resumeFromCheckpointId`, idempotency key, import batch id, checkpoint id, generated/imported timestamps, accounting basis, currency, and normalized delta envelope. | Changed resource actions, import/checkpoint rows, persisted canonical delta fact counts, safe source refs, `freshThrough`, `latestSourceUpdatedAt`, and affected posting/window scope for rollup or late-arrival work. | Previous checkpoint is unavailable, provider/service cursor evidence is missing, tenant mapping is ambiguous, runtime config is absent, or live provider access is required. | Same as full sync, plus raw CDC payload dumps or provider cursor secrets. |
| Rollup | Same tenant, company, source, accounting basis, currency, bucket grains, period window, generated timestamp, import batch id, checkpoint id, and canonical posting set. | Deterministic rollup bucket ids/counts, replacement/upsert write counts, posting counts, per-grain window counts, freshness rows when produced, and source freshness evidence. | Scheduler registration, storage/migration state, or runtime cadence is missing, or formula behavior requires package/owner review. | Raw provider payloads, credentials, duplicated host formulas, or queue dumps containing unbounded postings. |
| Late-arrival reprocess | Same changed posting ids, tenant, company, source, accounting basis, currency, overlap days/windows, report names, updated/generated timestamps, and canonical postings for replacement windows. | Affected windows, replacement rollup bucket counts, stale snapshot markers, stale freshness rows, ordered storage write plan, and bounded issue list. | Host cannot identify changed postings, overlap policy is undecided, scheduler cadence must change, or storage stale-marker support is missing. | Raw provider CDC bodies, credentials, unapproved customer-data excerpts, or manual formula patches. |
| Snapshot refresh | Same tenant, company, source, report name, period, as-of date, accounting basis, currency, generated timestamp, source freshness, import batch id, checkpoint id, and `forceRefresh` choice. | Reused or rebuilt action, deterministic snapshot id, freshness id, line/total counts, write counts, reconciliation status, cash-flow support status, and safe drilldown refs. | Builder input cannot load, storage writes are unavailable, host deploy is needed, or product owners must approve force-refresh policy. | Raw provider reports as durable report storage, credentials, unbounded drilldown refs, or copied provider payloads. |
| Freshness reconciliation | Same tenant, company, source, report scope, accounting basis, currency, source freshness, snapshot freshness, checkpoint evidence, stale thresholds, and generated/updated timestamps. | Deterministic freshness id/status, stale reason when not fresh, source/snapshot timestamp evidence, freshness write count, and bounded issues. | Provider checkpoint, service health, tenant mapping, runtime config, or stale-threshold policy is missing. | Tokens, secret env values, raw provider status payloads, or hidden production config. |
| Fixture smoke | Same fixture name, fixture version, tenant/company/source fixture ids, storage mode, generated timestamp, package version, and schema manifest. | Health status, summary hash, row counts, report statuses, snapshot/freshness ids, write counts, checks, and bounded issues. | Schema/migration install is incompatible, package exports are missing, or host preflight route/worker deploy is required. | Live provider credentials, production data, raw provider payloads, or fixture output with credential-shaped key paths. |
| Drilldown health | Same fixture/report scope, tenant/source, period, basis, currency, max ref byte limit, expected freshness rows, and compact source/drilldown refs. | Freshness coverage, reports checked, refs checked, max serialized bytes, compacted posting/source ref counts, checks, and bounded issues. | Missing upstream source evidence, schema/storage gaps, read API gaps, or deploy/config gaps prevent bounded refs. | Raw provider bodies, credential-shaped keys, unbounded ref lists, or secret-bearing query payloads. |

## Rollback and Stop Rules

Source-level rollback means returning to the last deterministic package inputs
and rerunning idempotent writes for the same scope, or stopping with `blocked`
evidence when a prerequisite is missing. It does not mean mutating Handrail
queues, deploy targets, runtime env, provider credentials, production data, or
capability rows from this repo.

Use these stop rules before any rollback or repair:

- If the missing input is a QuickBooks credential, provider service health
  value, tenant/realm mapping, production data set, runtime env value, queue
  registration, deploy target, or formal `erp_financials` capability, stop and
  raise the corresponding owner/platform blocker.
- If canonical facts, rollup buckets, snapshots, or freshness rows were written
  from deterministic fixture/package inputs, retry with the same ids and
  replacement/upsert semantics instead of deleting ad hoc rows.
- If a host needs a destructive database rollback, use the host app's approved
  migration/backup procedure. This package runbook may provide affected ids,
  windows, hashes, and row counts, but it should not perform live database
  mutation outside a repo-owned test fixture.

## QuickBooks Full Sync Retry

Full sync imports the first complete normalized QuickBooks baseline through the
Handrail QuickBooks SDK/service boundary. The ERP Financials package only sees
`NormalizedQuickBooksFullSyncResponseEnvelope` and normalized resources; it
does not call Intuit or own provider credentials.

Safe retry behavior:

- Retry with the same tenant, company, source, realm, provider environment,
  `syncMode: "full"`, `cursorKind: "full_scan"`, idempotency key, import batch
  id, checkpoint id, generated/imported timestamp, accounting basis, and
  currency.
- Use the same normalized full-sync envelope when replaying source-level
  evidence. In runtime, the QuickBooks SDK/service owns any provider retry and
  returns the normalized envelope.
- Persistence should upsert the same company, source, import batch,
  checkpoint, account, party, item, dimension, transaction, line, and posting
  identities. A retry must not append duplicate canonical postings.

Expected evidence fields:

| Field | Notes |
| --- | --- |
| `syncMode`, `cursorKind` | `full` and `full_scan`. |
| `tenantId`, `companyId`, `sourceId`, `realmId`, `providerEnvironment` | Source identity. |
| `idempotencyKey`, `importBatchId`, `checkpointId` | Retry identity and source cursor. |
| `resourceCounts`, `canonicalRowCounts` | Normalized input counts and persisted canonical row counts. |
| `cursorValue`, `freshThrough`, `latestSourceUpdatedAt` | Checkpoint/freshness evidence, never credential material. |
| `safeSourceRefCount`, `maxSerializedBytes` | Bounded source-ref evidence. |
| `status`, `issueCount`, `issues` | Result state and bounded issue list. |

Escalate to the QuickBooks service or host configuration owner if the retry
needs live provider credentials, service health repair, tenant/realm mapping,
runtime env changes, or production data. Escalate to host migration work if
canonical storage cannot persist the package schema. Do not add Intuit
credentials, direct provider clients, raw provider payload tables, or new
QuickBooks credential env vars to ERP Financials or Future ERP.

## QuickBooks Incremental Sync Retry

Incremental sync imports normalized changed, deleted, voided, or skipped
QuickBooks resources after a prior checkpoint. It is the source of affected
posting/window evidence for downstream rollup, late-arrival, snapshot, and
freshness work.

Safe retry behavior:

- Retry with the same tenant, company, source, realm, provider environment,
  `syncMode: "incremental"`, cursor kind/value, optional
  `resumeFromCheckpointId`, idempotency key, import batch id, checkpoint id,
  generated/imported timestamp, accounting basis, and currency.
- Preserve `changedResourceActions` from the same normalized delta envelope so
  downstream affected windows are reproducible.
- Persistence should upsert the same import batch, checkpoint, and canonical
  delta identities. A retry must not duplicate ledger postings or promote
  downstream rollup/snapshot work before the checkpoint evidence is stored.

Expected evidence fields:

| Field | Notes |
| --- | --- |
| `syncMode`, `cursorKind`, `cursorValue`, `resumeFromCheckpointId` | Incremental cursor identity. |
| `tenantId`, `companyId`, `sourceId`, `realmId`, `providerEnvironment` | Source identity. |
| `idempotencyKey`, `importBatchId`, `checkpointId` | Retry identity and checkpoint. |
| `resourceCounts`, `changedResourceActions`, `canonicalRowCounts` | Delta input, affected resources, and persisted rows. |
| `freshThrough`, `latestSourceUpdatedAt` | Source freshness evidence. |
| `affectedPostingCount`, `affectedWindowCount` | Downstream rollup/snapshot scope when available. |
| `status`, `issueCount`, `issues` | Result state and bounded issue list. |

Escalate if the previous checkpoint is unavailable, the service cannot provide
cursor evidence, tenant mapping is ambiguous, runtime configuration is absent,
or live provider access is required. Do not serialize provider cursor secrets,
raw CDC payloads, OAuth material, direct provider clients, or unbounded
QuickBooks response bodies as evidence.

## Normal Rollup Cadence

Normal rollup work should run after canonical facts land and on a short
catch-up cadence for active tenants. The package-level contract is
`erp-financials-rollup`; the Future ERP handoff name is
`future_erp.erp_financials.rollup`.

Expected cadence:

- After a full or incremental import persists canonical facts.
- Periodic catch-up for recent active windows, such as every 15 minutes in
  active tenants.
- Include only configured bucket grains and bounded period windows.

Safe retry behavior:

- Retry with the same tenant, company, source, accounting basis, currency,
  bucket grains, period window, import batch, checkpoint, and canonical posting
  set.
- Storage should upsert or replace deterministic rollup buckets for the same
  keys. It should not append duplicate aggregate rows.
- If schema or storage prerequisites are missing, stop and record `blocked`
  evidence instead of falling back to duplicated formulas.

Expected evidence fields:

| Field | Notes |
| --- | --- |
| `jobName` | `erp-financials-rollup` or `future_erp.erp_financials.rollup`. |
| `windowStart`, `windowEnd`, `grain` | Rollup bucket scope. |
| `postingCount`, `rollupBucketCount`, `rollupBucketsWritten` | Row-count evidence. |
| `freshnessRowsWritten` | Freshness rows produced by the rollup path, if any. |
| `sourceFreshThrough`, `importBatchId`, `checkpointId` | Source evidence, not credentials. |
| `status`, `issueCount` | `pass`, `healthy`, `degraded`, or `blocked` style result. |

Escalate only when the evidence indicates missing scheduler registration,
unsupported storage configuration, missing migration/schema state, or a deploy
gap. The escalation should ask for gated config/deploy work; this repository
should not perform that work directly.

## Wider Late-Arrival Overlap Cadence

Late-arrival reprocess handles changed or backdated canonical postings. The
package-level contract is `erp-financials-late-arrival-reprocess`; the Future
ERP handoff name is `future_erp.erp_financials.late_arrival_reprocess`.

Expected cadence:

- Event-driven after changed historical postings are detected.
- After incremental sync when provider evidence indicates backdated changes.
- A slower bounded overlap sweep, such as daily, for a wider host-defined
  overlap window.

Safe retry behavior:

- Retry with the same changed posting ids, overlap days, tenant, company,
  source, accounting basis, currency, and generated timestamp.
- The package plan rewrites affected rollup windows, marks overlapping
  snapshots stale, and writes stale freshness rows in a deterministic order.
- Re-marking the same snapshots stale on retry is expected.

Expected evidence fields:

| Field | Notes |
| --- | --- |
| `changedPostingCount`, `changedPostingIds` | Changed canonical posting scope. |
| `affectedWindowCount`, `windows` | Replacement rollup windows. |
| `rollupBucketsWritten` | Replacement bucket write count. |
| `staleSnapshotCount` | Snapshot staleness marker count. |
| `freshnessRowsWritten` | Stale freshness rows written. |
| `status`, `issueCount` | Retry outcome. |

Escalate if the host cannot identify changed posting ids, if the configured
overlap window is a product/runtime policy decision, or if scheduler cadence
must change in managed infrastructure.

## Stale Snapshot Refresh Retry

Snapshot refresh rebuilds durable report snapshots from canonical facts when a
snapshot is missing, stale, partial, or unknown. The package-level contract is
`erp-financials-snapshot-refresh`; the Future ERP handoff name is
`future_erp.erp_financials.snapshot_refresh`.

Expected cadence:

- After rollup or late-arrival completion for affected reports.
- A periodic stale-snapshot sweep, such as hourly, for reports that still carry
  stale freshness evidence.

Safe retry behavior:

- Retry with the same report name, period, as-of date, accounting basis,
  currency, tenant, company, source, import evidence, and checkpoint evidence.
- A fresh matching snapshot may return `action: "reused"` with no writes.
- A stale or missing snapshot rebuilds through package report builders and
  writes the same deterministic `snapshotId` and `freshnessId`.
- Use `forceRefresh` only as an explicit host-app repair choice, not as the
  default retry behavior.

Expected evidence fields:

| Field | Notes |
| --- | --- |
| `reportName`, `periodStart`, `periodEnd`, `asOfDate` | Snapshot request identity. |
| `snapshotId`, `freshnessId` | Deterministic persisted ids. |
| `lineCount`, `totalCount` | Report shape. |
| `snapshotRowsWritten`, `freshnessRowsWritten` | Storage write counts. |
| `reconciliationStatus`, `cashFlowSupportStatus` | Report-specific health. |
| `status`, `issueCount` | Refresh result. |

Escalate if the report cannot load canonical builder input, if storage writes
are unavailable, if a host deploy is needed to expose the refreshed snapshot, or
if product owners must decide whether to force-refresh otherwise fresh
snapshots.

## Freshness Reconciliation Behavior

Freshness reconciliation updates durable freshness rows so dashboards and AI
tools can explain whether reports are current without reading job logs. The
package APIs are `reconcileReportFreshness`,
`createSnapshotRefreshContract`, and
`createFutureErpSnapshotRefreshAndFreshnessWorker(...).runFreshnessReconciliation(...)`.
The Future ERP handoff name is
`future_erp.erp_financials.freshness_reconciliation`.

Expected cadence:

- After import, rollup, snapshot refresh, provider parity checks, and source
  checkpoint updates.
- A small periodic sweep, such as every 15 minutes, for active tenants.

Safe retry behavior:

- Retry with the same report scope, source freshness, snapshot freshness, and
  checkpoint evidence.
- Retries should move evidence to the same or a newer freshness state.
- Do not downgrade a report to `fresh` when source freshness, snapshot
  generation, or checkpoint evidence is incomplete.

Expected evidence fields:

| Field | Notes |
| --- | --- |
| `freshnessId`, `freshnessStatus` | Durable freshness identity and state. |
| `sourceFreshThrough`, `latestSourceUpdatedAt` | Source-side freshness evidence. |
| `snapshotGeneratedAt` | Snapshot-side freshness evidence. |
| `staleReason` | Required when marking stale or degraded. |
| `freshnessRowsWritten` | Storage write count. |
| `status`, `issueCount` | Reconciliation outcome. |

Escalate if the missing input is a provider checkpoint, service health signal,
tenant mapping, or runtime config value. Those are QuickBooks service or host
configuration questions, not ERP Financials formula changes.

## Fixture Smoke Interpretation

Fixture smoke proves that package fixtures, schema support, report builders,
snapshot persistence hooks, freshness rows, and bounded drilldown refs still
work without live provider credentials. The package API is
`runErpFinancialsFixtureSmokeHealth`; Future ERP preflight may also call
`preflightFutureErpInstallHealth` or
`createFutureErpInstallHealthPreflightWorker(...).preflight(...)`.

Interpretation:

- `healthy` means deterministic fixtures built all supported report outputs and
  produced expected ids, row counts, freshness rows, and summary hash.
- `degraded` means bounded evidence was produced but at least one check warned
  or failed. Keep the evidence and inspect `checks` and `issues`.
- `blocked` means an install, schema, package boundary, or storage hook
  prerequisite is missing. Do not work around this by copying formulas into the
  host app.

Expected evidence fields:

| Field | Notes |
| --- | --- |
| `fixtureName`, `storageMode` | Fixture and persistence mode. |
| `tenantId`, `companyId`, `sourceId` | Fixture scope. |
| `summaryHash` | Stable fixture result hash. |
| `rowCounts` | Fixture, snapshot, and freshness counts. |
| `reportStatuses` | Per-report support or health status. |
| `snapshotIds`, `freshnessIds` | Deterministic ids. |
| `checks`, `issues` | Bounded interpretation details. |

Escalate schema or migration incompatibility to host migration work. Escalate
runtime deploy gaps only when a host app must expose a preflight route or worker
that is not currently deployed.

## Drilldown Health Failures

Drilldown health checks confirm that report lines, totals, reconciliation
differences, source payload refs, and compact drilldown refs are safe and
bounded. The package API is
`checkErpFinancialsFreshnessAndDrilldownHealth`.

Failure interpretation:

- Missing freshness rows usually means import, rollup, snapshot refresh, or
  freshness reconciliation has not completed for the requested scope.
- Missing drilldown refs mean report builders or adapter inputs are not
  preserving canonical posting evidence.
- Oversized refs mean the caller should emit compact tokens or bounded query
  filters instead of embedding large id sets.
- Raw provider payloads or credential-shaped keys are boundary failures.

Expected evidence fields:

| Field | Notes |
| --- | --- |
| `freshness.expectedRows`, `freshness.presentRows`, `freshness.missingRows` | Freshness coverage. |
| `drilldown.reportsChecked`, `drilldown.refsChecked` | Health scope. |
| `drilldown.maxSerializedBytes` | Bounded-ref size evidence. |
| `drilldown.compactedPostingRefCount` | Count of compact posting refs. |
| `drilldown.compactedSourceRefCount` | Count of compact source refs. |
| `checks`, `issues` | Failure details. |

Escalate only after the deterministic health command identifies whether the
problem is schema/storage, missing upstream source evidence, a host read API
gap, or a deploy/configuration gap.

## Credential-Boundary Checks

ERP Financials owns canonical financial storage and report formulas. It does
not own provider OAuth, provider token custody, raw provider payload storage, or
QuickBooks runtime credentials.

Boundary checks should confirm:

- No financial schema column stores access tokens, refresh tokens, client
  secrets, API keys, OAuth grants, or provider credential material.
- Normalized QuickBooks fixtures use safe source refs and bounded previews.
- Fixture and smoke outputs serialize without credential-like key paths.
- Host-app config uses Handrail QuickBooks capability-managed runtime
  references for provider access, not new ERP Financials credential vars.

Expected evidence fields:

| Field | Notes |
| --- | --- |
| `forbiddenKeyPaths` | Must be empty. |
| `credentialColumnIssues` | Must be empty for financial tables. |
| `sourceRefCount` | Count of bounded source refs inspected. |
| `maxSerializedBytes` | Size bound for evidence refs. |
| `runtimeEnvKeys` | Names only, never secret values. |
| `status`, `issueCount` | Boundary result. |

Escalate missing or invalid `HANDRAIL_QBO_*` runtime references to the
QuickBooks capability or host app configuration owner. Do not add Intuit
credentials, token env vars, secret values, or raw provider payload tables in
this package or in Future ERP as part of ERP Financials feature work.

## Escalation Matrix

| Evidence condition | Escalation point | Do not do in this repo |
| --- | --- | --- |
| Scheduler name or cadence is not registered in managed runtime. | Host scheduler/platform configuration approval. | Do not create queues, cron jobs, or Handrail capability rows. |
| Schema validation is incompatible or migration is missing. | Host migration owner with package manifest evidence. | Do not mutate live databases outside the host migration path. |
| QuickBooks service health is unavailable or runtime keys are missing. | Handrail QuickBooks capability/config owner. | Do not add Intuit credentials or direct provider clients. |
| A route, worker, or health endpoint is not deployed. | Host deploy approval. | Do not deploy, promote, or change deployment targets. |
| Fixture or drilldown health fails deterministically. | Package or host app code owner, using the failing command output. | Do not bypass package formulas or store raw provider payloads. |
| Product policy is required for overlap days, force refresh, retention, or stale thresholds. | Product/owner decision with compact evidence fields. | Do not encode unapproved runtime policy as hidden defaults. |
