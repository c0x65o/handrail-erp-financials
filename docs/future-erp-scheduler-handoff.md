# Future ERP Scheduler Handoff

This handoff documents how Hitcents Future ERP should wire its own scheduler or
worker source code to `@handrail/erp-financials`. It is not a deployment plan.
Scheduler registration, cadence changes in managed infrastructure, secrets,
provider credentials, staging deploys, production deploys, and Handrail runtime
configuration remain separately gated work.

Future ERP should call these package APIs from repo-owned job handlers and use
the Handrail QuickBooks SDK/service boundary for provider access. Do not add
Intuit OAuth/token custody, direct Intuit clients, raw QuickBooks provider
payload tables, or duplicated financial formulas to Future ERP.

## Job Matrix

The job names below are the expected Future ERP scheduler names. They can be
implemented as queue job names, cron task names, route-handler names, or CLI
subcommands as long as the job evidence keeps the same fields.

| Job name | Expected cadence | Package API | Safe retry behavior | Required evidence fields |
| --- | --- | --- | --- | --- |
| `future_erp.erp_financials.rollup` | After canonical facts land, plus a periodic catch-up window such as every 15 minutes in active tenants. | `createFutureErpRollupAndLateArrivalWorker(...).runScheduledRollup(...)`, backed by `buildScheduledRollupJobResult`, `buildRollupBuckets`, `reconcileReportFreshness`, and `createPostgresStorageAdapter`. | Idempotent when retried with the same tenant, company, source, report window, grain, accounting basis, and canonical posting set. Storage should replace or upsert the same rollup buckets rather than append duplicate totals. | `jobName`, `tenantId`, `companyId`, `sourceId`, `windowStart`, `windowEnd`, `grain`, `accountingBasis`, `currencyCode`, `postingCount`, `rollupBucketCount`, `rollupBucketsWritten`, `freshnessRowsWritten`, `sourceFreshThrough`, `generatedAt`, `status`, `issueCount`. |
| `future_erp.erp_financials.late_arrival_reprocess` | On changed historical postings and as a bounded catch-up pass after incremental sync, usually event-driven with a short delayed retry. | `createFutureErpRollupAndLateArrivalWorker(...).runLateArrivalReprocess(...)`, backed by `executeLateArrivalReprocess`, `planLateArrivalReprocess`, and package storage stale-snapshot marking. | Retry with the same changed posting ids and reprocess windows. The worker rejects postings outside the tenant/source scope and should rewrite affected rollup windows and stale markers deterministically. | `jobName`, `tenantId`, `companyId`, `sourceId`, `changedPostingCount`, `changedPostingIds`, `affectedWindowCount`, `windows`, `rollupBucketsWritten`, `staleSnapshotCount`, `freshnessRowsWritten`, `status`, `issueCount`. |
| `future_erp.erp_financials.snapshot_refresh` | After rollup or late-arrival completion for stale reports, plus a periodic stale-snapshot sweep such as hourly. | `createFutureErpSnapshotRefreshAndFreshnessWorker(...).runStaleSnapshotRefresh(...)`, backed by `executeSnapshotRefresh`, `createSnapshotRefreshContract`, report builders, and `createPostgresStorageAdapter`. | Safe to retry for the same report name, period, as-of date, basis, currency, tenant, company, and source. The package builds the same snapshot id/freshness id and storage should replace or upsert that report snapshot. | `jobName`, `tenantId`, `companyId`, `sourceId`, `reportName`, `periodStart`, `periodEnd`, `asOfDate`, `accountingBasis`, `currencyCode`, `snapshotId`, `freshnessId`, `lineCount`, `totalCount`, `snapshotRowsWritten`, `freshnessRowsWritten`, `reconciliationStatus`, `cashFlowSupportStatus`, `status`, `issueCount`. |
| `future_erp.erp_financials.freshness_reconciliation` | After import, rollup, snapshot refresh, provider parity checks, and any source checkpoint update; also as a small periodic sweep such as every 15 minutes. | `createFutureErpSnapshotRefreshAndFreshnessWorker(...).runFreshnessReconciliation(...)`, backed by `reconcileReportFreshness` and package freshness storage. Rollup jobs may also pass `freshnessReconciliations` to `runScheduledRollup(...)`. | Idempotent for the same tenant, company, source, report window, basis, currency, source freshness, and snapshot freshness inputs. Later retries should only move evidence to the same or newer freshness state. | `jobName`, `tenantId`, `companyId`, `sourceId`, `reportName`, `periodStart`, `periodEnd`, `accountingBasis`, `currencyCode`, `freshnessId`, `freshnessStatus`, `sourceFreshThrough`, `snapshotGeneratedAt`, `staleReason`, `freshnessRowsWritten`, `status`, `issueCount`. |
| `future_erp.erp_financials.fixture_smoke` | Dev/test preflight, dependency upgrades, schema migration review, and release-candidate validation. Do not run as a production data repair job. | `runErpFinancialsFixtureSmokeHealth(...)`; Future ERP dev/test preflight may call `createFutureErpInstallHealthPreflightWorker(...).preflight(...)` or `preflightFutureErpInstallHealth(...)` to combine install health and fixture smoke. | Safe to retry because it uses deterministic package fixtures or caller-provided fixture hooks. Storage-backed smoke runs should write only fixture-scoped rows and should be isolated from live tenant data. | `jobName`, `preflightName`, `executionEnvironment`, `status`, `fixtureName`, `storageMode`, `tenantId`, `companyId`, `sourceId`, `summaryHash`, `rowCounts`, `reportStatuses`, `snapshotIds`, `freshnessIds`, `snapshotRowsWritten`, `freshnessRowsWritten`, `checks`, `issues`. |
| `future_erp.erp_financials.drilldown_health` | Dev/test preflight, release-candidate validation, and after changes to report builders, read APIs, or drilldown resolvers. Production runtime should expose bounded health evidence only after separately gated deploy work. | `checkErpFinancialsFreshnessAndDrilldownHealth(...)`, backed by package report builders, fixture freshness rows, and safe drilldown ref validation. | Safe to retry because it is read-only unless Future ERP wraps it with its own evidence writer. It must validate compact refs and should never resolve or emit raw provider bodies. | `jobName`, `status`, `fixtureName`, `tenantId`, `sourceId`, `accountingBasis`, `currencyCode`, `periodStart`, `periodEnd`, `summaryHash`, `freshness.expectedRows`, `freshness.presentRows`, `freshness.missingRows`, `drilldown.reportsChecked`, `drilldown.refsChecked`, `drilldown.maxSerializedBytes`, `drilldown.compactedPostingRefCount`, `drilldown.compactedSourceRefCount`, `checks`, `issues`. |

## Worker Inputs

Each scheduled handler should derive scope from Future ERP's own tenant/company
context and pass only package-safe values to `@handrail/erp-financials`:

- `tenantId`, `companyId`, and `sourceId` owned by the Future ERP app.
- A host Postgres query client wrapped with `createPostgresStorageAdapter`, or a
  test storage adapter that implements the same methods.
- Canonical postings and report builder inputs already landed from normalized
  QuickBooks SDK/service envelopes.
- Source freshness and checkpoint fields from the Handrail QuickBooks service,
  such as `sourceFreshThrough`, `importedThrough`, `latestSourceUpdatedAt`, and
  checkpoint ids.
- Safe source payload refs and compact drilldown refs only.

Do not pass provider access tokens, refresh tokens, client secrets, raw Intuit
request/response bodies, or direct provider client instances into these jobs.
QuickBooks service health and provider report parity belong at the Handrail
QuickBooks SDK/service boundary and should be stored only as bounded evidence.

## Retry And Failure Semantics

Retries should be bounded by Future ERP's scheduler policy and keyed by the
tenant/company/source/report/window inputs listed above. Prefer retrying failed
jobs with the same idempotency key over creating overlapping jobs for the same
scope.

- `blocked`: schema, storage, package boundary, or service health prerequisites
  are missing. Stop the job and surface evidence; do not fall back to duplicated
  formulas or direct provider calls.
- `degraded`: deterministic health or parity evidence was produced but one or
  more checks warned or failed. Persist evidence and let the operator decide the
  next gated action.
- `healthy` or `pass`: the package contract completed with no issues.

Late-arrival and snapshot-refresh retries may re-mark snapshots stale and
rewrite the same snapshot/freshness ids. That is expected. Durable evidence
should record final row counts and issue counts, not every internal retry
attempt.

## Gated Work

The repo-owned work is limited to source, tests, fixtures, deterministic worker
harnesses, and docs. The following are separate approval/configuration tasks:

- Registering these names in a managed scheduler or queue.
- Changing production, staging, or Handrail deploy configuration.
- Enabling live sandbox or production QuickBooks capability configuration.
- Rotating or adding Handrail-managed `HANDRAIL_QBO_*` runtime references.
- Adding service endpoints, tenant mappings, provider-mode overrides, or API
  keys outside the existing Handrail capability contract.

If a scheduler handoff needs any of those changes, request the gated work
explicitly. Do not encode runtime secrets, Intuit credentials, raw provider
payload storage, or deploy assumptions in the Future ERP repository.
