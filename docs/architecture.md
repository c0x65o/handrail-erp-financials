# Architecture

## Purpose

`handrail-erp-financials` should provide the reusable financial core for ERP
apps that either import data from an accounting provider or start fresh with
native ERP data.

The package should standardize:

- canonical accounting facts
- database migration manifests
- report read models
- rollup and snapshot jobs
- freshness and cursor tracking
- drilldown evidence
- report fixtures and deterministic tests
- app-facing and AI-safe report APIs

It should not own app-specific UI, tenant permissions, provider OAuth, provider
token storage, or customer-specific workflows.

## Layered Model

```text
Provider or app source
  -> source adapter
  -> canonical accounting facts
  -> rollup and snapshot writers
  -> report read APIs
  -> ERP app screens, workflows, and AI tools
```

### Source adapters

Source adapters translate external or app-native data into the canonical model.
Examples:

- QuickBooks adapter using the Handrail QuickBooks SDK/service.
- Native ERP adapter for apps that start without QuickBooks.
- CSV/import adapter for one-time migration or historical load.
- Future adapters for other accounting systems.

Adapters are responsible for mapping source identity, timestamps, dimensions,
and audit references. They should not make reporting decisions directly.

### Canonical accounting facts

The canonical model is the durable write/read boundary for reporting. Reports
should not calculate directly from raw QuickBooks payloads or provider-specific
objects. They should calculate from accounts, transactions, postings, parties,
items, and dimensions that have stable tenant-scoped identities.

### Rollup and snapshot engine

The rollup engine turns canonical facts into durable aggregates. The snapshot
engine persists expensive report outputs and their drilldown evidence. These
read models are what dashboards and AI tools query for normal report windows.

### Aggregate-first standard reports

Standard report presentation APIs must use snapshots, rollups, or SQL aggregate
read models by default. They should not load raw ledger postings into Node and
rebuild report columns for normal app traffic.

This rule applies especially to multi-column reports such as two-year P&L
comparisons by month, quarter, year, customer, vendor, employee, or
product/service. Raw ledger postings are appropriate for drilldown, fixtures,
small reference builders, and explicitly bounded repair workflows, but the
primary presentation path should aggregate before formatting rows.

Date-grained columns should be served from report snapshots, rollup buckets, or
equivalent grouped SQL. Party and item display columns need persisted aggregate
grouping keys or grouped SQL reads with indexes that match tenant, source,
accounting basis, date range, currency, and grouping dimensions.

The package naming follows that boundary: production presentation should call
`buildStandardReportPresentationFromReadModel`, while the raw-facts
`buildReferenceStandardReportPresentationFromFacts` helper is reserved for
fixtures and reference formulas. `buildStandardReportPresentationFromFacts`
exists only as a deprecated compatibility alias.

### App layer

Individual ERP apps own:

- user-facing dashboards and workflows
- tenant settings and permissions
- navigation and report UX
- AI tool registration and prompt boundaries
- customer-specific extensions
- app-specific imports that are not generally reusable

Apps consume this package rather than copying schema and report code.

## Package Ownership

This repository should eventually expose:

- TypeScript types for canonical facts, report requests, and report outputs.
- SQL migration manifests or migration generator helpers.
- Postgres storage adapters.
- Deterministic report builders.
- Rollup/snapshot job handlers.
- Test fixtures for common accounting scenarios.
- Validation utilities that prove a host app installed compatible schema.

## Non-Goals

- Do not store QuickBooks OAuth tokens in ERP apps.
- Do not require every host app to use QuickBooks.
- Do not make Handrail platform code the only place financial calculations live.
- Do not make dashboards query raw provider objects for large time windows.
- Do not rely on generated documentation as the primary reuse mechanism.

## Design Pressure

Financial reports must scale across:

- many tenants
- long historical periods
- high transaction volume
- backdated edits and late provider syncs
- multiple accounting bases
- drilldown from aggregate totals to source evidence

That means the core must treat rollups, snapshots, freshness, and idempotent
reprocessing as first-class behavior rather than later optimizations.
