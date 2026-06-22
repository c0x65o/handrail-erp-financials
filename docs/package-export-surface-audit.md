# Package Export Surface Audit

This audit records the public `@handrail/erp-financials` export surface checked
before the production-readiness gate for the cross-repo source state and
dependency link work.

## Scope

Checked surfaces:

- Canonical schema and canonical model helpers.
- Postgres storage adapter, install, and validation contracts.
- Report builders for profit and loss, balance sheet, trial balance, and cash
  flow.
- QuickBooks normalized resource contracts, SDK/service mapping, sync service
  handlers, provider report parity helpers, and reconciliation evidence helpers.
- Future ERP sandbox replay and sandbox sync worker contracts.
- Rollup, late-arrival, snapshot refresh, and freshness worker contracts.
- Install, fixture smoke, freshness, drilldown, and schema preflight health
  checks.
- Safe source payload refs and compact drilldown refs.

The package manifest exposes only the root package entry point:
`@handrail/erp-financials`. Public compatibility therefore depends on
`src/index.ts` re-exporting consumer-facing values and types.

## Linked Repo Availability

The linked consumer checkouts were not mounted in this worker, so live import
scans against those repositories could not run.

Missing paths:

```text
/opt/handrail/repos/handrail/handrail-quickbooks-integrations
/opt/handrail/repos/hitcents/hitcents-future-erp/hitcents-erp-future
```

No duplicate Future ERP authorization request was made.

## Deterministic ERP-Owned Checks

The audit compared every direct named export in `src/*.ts` against the root
barrel in `src/index.ts`. Result: no repo module export is omitted from the
public root surface.

The audit also compared all ERP-owned references that import from
`@handrail/erp-financials` in `README.md`, `docs/**/*.md`, and
`test/future-erp-consumer-type-imports.ts` against `src/index.ts`. Result: no
referenced public import is missing from the package root.

The in-repo Future ERP consumer type fixture covers these required public
surfaces from the package root:

- Canonical storage: `createPostgresStorageAdapter`,
  `validateFutureErpCanonicalSchemaPreflight`,
  `createFutureErpCanonicalFactPersistenceWorker`, and
  `persistFutureErpCanonicalFacts`.
- QuickBooks mapping and SDK/service contracts:
  `mapHandrailQuickBooksSdkResourcesToCanonicalFacts`,
  `createHandrailQuickBooksFullSyncServiceHandler`,
  `createHandrailQuickBooksSyncClient`, normalized full/incremental sync
  envelopes, provider report result types, and normalized resource sets.
- Reports: `buildProfitAndLossReport`, `buildBalanceSheetReport`,
  `buildTrialBalanceReport`, `buildCashFlowReport`, and
  `buildFutureErpReportFromCanonicalReadModel`.
- Workers: `createFutureErpRollupAndLateArrivalWorker`,
  `createFutureErpSnapshotRefreshAndFreshnessWorker`,
  `createSnapshotRefreshContract`, and `reconcileReportFreshness`.
- Sandbox replay: `runFutureErpQuickBooksSandboxReplay` and related replay
  client/result contracts.
- Safe report and drilldown data: report snapshots, report freshness rows,
  rollup buckets, canonical fact sets, and safe drilldown-compatible read model
  contracts.

## Reported Gaps

No missing public export was found in the deterministic ERP-owned audit.

The remaining unverified area is the live import surface inside the absent
linked repositories. When those paths are mounted, scan their package imports
for `@handrail/erp-financials` and the QuickBooks SDK package before declaring
cross-repo compatibility complete.
