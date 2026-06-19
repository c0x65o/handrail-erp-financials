# Handrail Capability Plan

The recommended long-term platform feature is an `erp_financials` Handrail
capability. The capability should install, configure, validate, and operate this
package in a host app. It should not be the only place financial calculations
exist.

## Capability Role

The capability should provide:

- package dependency guidance
- migration manifest installation or validation
- scheduled job registration
- env/config contract
- source adapter configuration
- acceptance test registration
- operator runbook links
- health and freshness checks

It should not:

- store provider OAuth tokens
- hide financial formulas in platform-only code
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
  "rollup_grains": ["day", "month", "fiscal_period", "fiscal_year"],
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

## Generated Env

The capability may expose host-app runtime flags such as:

- `HANDRAIL_ERP_FINANCIALS_ENABLED`
- `HANDRAIL_ERP_FINANCIALS_STORAGE`
- `HANDRAIL_ERP_FINANCIALS_DEFAULT_BASIS`
- `HANDRAIL_ERP_FINANCIALS_ROLLUP_GRAINS`
- `HANDRAIL_ERP_FINANCIALS_SNAPSHOT_REPORTS`

These should be configuration flags only, not provider secrets.

## Install Plan

The capability should be able to produce a deterministic install plan:

1. Confirm host app has a supported database.
2. Confirm this package is installed at a compatible version.
3. Confirm required migrations are present or can be generated.
4. Register scheduled rollup, late-arrival, freshness, and prune jobs.
5. Validate canonical tables and indexes.
6. Run deterministic fixtures.
7. Report missing provider adapters or source capabilities.

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

Recommended jobs:

- `erp-financials-rollup`
- `erp-financials-late-arrival-reprocess`
- `erp-financials-snapshot-refresh`
- `erp-financials-freshness-reconcile`
- `erp-financials-retention-prune`

Jobs should write compact summaries only. Durable report facts belong in
rollup, snapshot, and freshness tables, not job result JSON.

## Validation

Validation should check:

- package version compatibility
- tables and indexes exist
- constraints are present
- rollup jobs are registered
- freshness rows are writable
- fixtures produce expected totals
- drilldown refs resolve
- provider source adapters are configured
- no provider credentials are stored in app financial tables

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
