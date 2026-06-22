# Handrail Capability Plan

The recommended long-term platform feature is an `erp_financials` Handrail
capability. The capability should install, configure, validate, and operate this
package in a host app. It should not be the only place financial calculations
exist. The current package APIs and operator path are documented in
[host-app-install.md](host-app-install.md) and the safe retry/evidence runbook
is documented in [operations-runbook.md](operations-runbook.md).

## Capability Role

The capability should provide:

- package dependency guidance
- migration manifest installation or validation
- scheduled job descriptor validation and host scheduler handoff
- env/config contract
- source adapter configuration
- acceptance test registration
- operator runbook links
- health and freshness checks

It should not:

- store provider OAuth tokens
- hide financial formulas in platform-only code
- reimplement financial formulas, fixture expectations, freshness logic, or
  drilldown validation outside `@handrail/erp-financials`
- require QuickBooks
- generate app-specific UX
- mutate production data without explicit migration/job paths

## Capability Type

Candidate type:

```text
erp_financials
```

Candidate provider:

```text
handrail
```

## Capability Config

Recommended non-secret config:

```json
{
  "enabled": true,
  "storage": "postgres",
  "source_adapters": ["quickbooks", "native"],
  "default_accounting_basis": "accrual",
  "supported_accounting_bases": ["accrual", "cash"],
  "rollup_grains": ["day", "month", "fiscal_period", "fiscal_quarter", "fiscal_year"],
  "snapshot_reports": [
    "profit_and_loss",
    "balance_sheet",
    "cash_flow",
    "trial_balance",
    "ar_aging",
    "ap_aging"
  ],
  "late_arrival_reprocess": true,
  "drilldown_enabled": true
}
```

Secret config should usually be empty. Provider credentials belong to provider
capabilities such as `quickbooks`, not `erp_financials`.

The `erp_financials` config must not include Intuit client ids, client secrets,
refresh tokens, access tokens, QuickBooks API keys, or provider OAuth material.

## Generated Env

The capability may expose host-app runtime flags such as:

- `HANDRAIL_ERP_FINANCIALS_ENABLED`
- `HANDRAIL_ERP_FINANCIALS_STORAGE`
- `HANDRAIL_ERP_FINANCIALS_DEFAULT_BASIS`
- `HANDRAIL_ERP_FINANCIALS_ROLLUP_GRAINS`
- `HANDRAIL_ERP_FINANCIALS_SNAPSHOT_REPORTS`

These should be configuration flags only, not provider secrets.

## Executable Package Contract

The future platform capability should wrap the public
`@handrail/erp-financials` package APIs. These APIs are the executable contract;
the platform should validate and schedule them, not fork their implementation:

| Capability concern | Exported package API |
| --- | --- |
| Install validation | `checkErpFinancialsInstallHealth`, `preflightFutureErpInstallHealth`, `createFutureErpInstallHealthPreflightWorker` |
| Schema health | `createPostgresStorageAdapter(...).validateSchema()`, `validatePostgresSchema`, `POSTGRES_CANONICAL_SCHEMA_MANIFEST`, `renderPostgresSchemaSql` |
| Schedule descriptor | `buildScheduledRollupJobResult`, `buildLateArrivalReprocessExecutionContract`, `executeLateArrivalReprocess`, `executeSnapshotRefresh`, `createSnapshotRefreshContract`, `reconcileReportFreshness`, plus the exported job-name/request/result types such as `ScheduledRollupJobName`, `LateArrivalReprocessJobName`, `SnapshotRefreshJobName`, `ScheduledRollupJobRequest`, `SnapshotRefreshRequest`, and `FreshnessReconcileInput` |
| Future ERP scheduler binding | `createFutureErpRollupAndLateArrivalWorker`, `createFutureErpSnapshotRefreshAndFreshnessWorker` |
| Fixture smoke | `runErpFinancialsFixtureSmokeHealth` |
| Freshness reconciliation | `reconcileReportFreshness`, `createSnapshotRefreshContract`, `createFutureErpSnapshotRefreshAndFreshnessWorker(...).runFreshnessReconciliation(...)` |
| Drilldown health | `checkErpFinancialsFreshnessAndDrilldownHealth`, `assertSafeDrilldownRef`, `assertSafeSourcePayloadRef` |

The schedule descriptor is a source-level contract for host schedulers. It names
job ids, request inputs, retry-safe evidence fields, and storage writes. It does
not create Handrail platform capabilities, queues, deployment targets, secrets,
or runtime registrations during Codex feature work.

## Install Plan

The capability should be able to produce a deterministic install plan:

1. Confirm host app has a supported database.
2. Confirm this package is installed at a compatible version.
3. Confirm required migrations are present or can be generated from
   `POSTGRES_CANONICAL_SCHEMA_MANIFEST` / `renderPostgresSchemaSql`.
4. Register scheduled rollup, late-arrival, freshness, and prune jobs.
5. Validate canonical tables, indexes, and constraints with
   `checkErpFinancialsInstallHealth`,
   `createPostgresStorageAdapter(...).validateSchema()`, or
   `validatePostgresSchema`.
6. Run deterministic fixtures with `ERP_FINANCIALS_STATEMENT_FIXTURE` and the
   exported report builders through `runErpFinancialsFixtureSmokeHealth`.
7. Report missing provider adapters or source capabilities without requiring
   QuickBooks for native-only apps.

## Migration Strategy

The package should publish migration manifests. The Handrail capability can
validate and help apply them through the host app's migration system.

Supported approaches:

- generated SQL migration files committed into the host repo
- framework adapters for common migration systems
- manifest validation without direct writes
- migration drift checks against dev/staging targets

The migration source of truth should remain versioned and testable.

## Scheduled Jobs

Recommended job names and package entry points:

- `erp-financials-rollup`: call `buildRollupBuckets` and persist with
  `writeRollupBuckets`, or use `buildScheduledRollupJobResult` for the
  full request/result descriptor.
- `erp-financials-late-arrival-reprocess`: call `planLateArrivalReprocess`,
  replace affected windows, and mark affected snapshots stale.
- `erp-financials-snapshot-refresh`: rebuild package-owned reports and persist
  them with `executeSnapshotRefresh`, which uses the package report builders
  and persists with `writeReportSnapshot`.
- `erp-financials-freshness-reconcile`: call `reconcileReportFreshness` or
  `createSnapshotRefreshContract` and persist freshness rows.
- `erp-financials-retention-prune`: prune only explicitly transient host-owned
  import or job data.

Jobs should write compact summaries only. Durable report facts belong in
rollup, snapshot, and freshness tables, not job result JSON.

The package owns the formulas used by these jobs; the platform capability should
validate the descriptor and register host callbacks without moving formulas into
platform-only code.

## Validation

Validation should check:

- package version compatibility
- manifest version compatibility
- tables and indexes exist
- constraints are present
- no credential-like columns exist in financial tables
- rollup jobs are registered for configured grains
- freshness rows are writable
- fixtures produce expected totals through package report builders
- drilldown refs resolve
- provider source adapters are configured
- no provider credentials are stored in app financial tables

These checks should validate the package implementation. They should not
reimplement P&L, balance sheet, trial balance, or cash-flow formulas inside
Handrail platform code.

For deterministic source-level validation, run `npm run health:smoke`. That
script executes the install health, fixture smoke, freshness, and drilldown
health contract tests without live provider credentials.

For operational interpretation, retry cadence, expected evidence fields, and
escalation points for config/deploy/credential work, use
[operations-runbook.md](operations-runbook.md). The runbook keeps platform
capability creation, scheduler registration, deploy changes, and provider
credential changes outside Codex feature work.

## Relationship to QuickBooks Capability

`quickbooks` and `erp_financials` should be separate capabilities.

`quickbooks` provides:

- SDK/service tenant access
- provider mode
- API key
- tenant id
- QuickBooks integration runtime contract

`erp_financials` provides:

- canonical financial schema
- rollup/snapshot/report machinery
- adapter validation
- report freshness and health

An ERP app may use both, but native-only apps should be able to use
`erp_financials` without `quickbooks`.

When QuickBooks is present, host app code should consume the Handrail
QuickBooks SDK/runtime contract (`HANDRAIL_QBO_SERVICE_ENV`,
`HANDRAIL_QBO_PROVIDER_MODE`, `HANDRAIL_QBO_API_KEY`, and
`HANDRAIL_QBO_TENANT_ID`) through `@handrail/sdk-node` helpers. ERP Financials
must not define new QuickBooks credential env vars or store Intuit access or
refresh tokens.
