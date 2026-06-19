# Adoption Roadmap

This roadmap turns the first Future ERP implementation into a reusable package
without over-abstracting before the first real app proves the domain model.

## Phase 1: Prove in Future ERP

Goal: make the first ERP app work end to end while keeping the extraction seam
clear.

Build or keep app-local versions of:

- canonical accounting fact types
- Postgres storage migration manifest
- QuickBooks source adapter
- report read models
- P&L, balance sheet, trial balance, and cash flow builders
- report snapshots
- drilldown refs
- fixtures comparing provider reports and ERP-derived reports

Done when:

- Future ERP can import QuickBooks-backed data.
- Reports can be generated from local canonical facts.
- Large report windows can use snapshots or rollups.
- Every report number has drilldown evidence.
- Provider report comparisons catch mismatches.

## Phase 2: Extract Package Boundaries

Goal: move provider-neutral code into this repository.

Extract:

- canonical types
- schema manifest builder
- SQL migration generator
- report read model types
- report builder functions
- rollup writer contracts
- snapshot writer contracts
- freshness model
- deterministic accounting fixtures
- validation utilities

Leave in Future ERP:

- UI
- tenant permission checks
- tenant settings screens
- route handlers that are app-specific
- AI tool registration
- QuickBooks connection UX

Done when:

- Future ERP imports this package for core reporting behavior.
- Future ERP contains only app-specific adapters and UX.
- Package tests pass without Future ERP.

## Phase 3: Add Storage Adapters

Goal: make host-app installation predictable.

Add:

- Postgres storage adapter
- migration manifest versioning
- schema compatibility checks
- idempotent upsert helpers
- fixture loader
- report snapshot writer
- rollup bucket writer
- freshness writer

Done when:

- A blank app can install schema from this package.
- A fixture dataset can be loaded into canonical facts.
- Report outputs match expected fixture totals.

## Phase 4: Add Source Adapter Contracts

Goal: support QuickBooks and native ERP data through the same reporting path.

Add:

- adapter interface
- QuickBooks mapping helpers
- native transaction/posting input helpers
- source identity and idempotency helpers
- source payload ref helpers

Done when:

- QuickBooks import and native ERP entry can both produce canonical postings.
- Report builders do not know which source produced the data.

## Phase 5: Add Rollup and Snapshot Jobs

Goal: make reports scalable by default.

Add:

- rollup job handler
- late-arrival reprocess job
- snapshot refresh job
- freshness reconcile job
- retention/prune job if transient import tables exist

Done when:

- Dashboard reads can avoid scanning all postings for common windows.
- Late historical changes update affected rollups deterministically.
- Stale snapshots can be detected and regenerated.

## Phase 6: Add Handrail Capability

Goal: make installation repeatable across future ERP apps.

Add a Handrail capability that can:

- configure the package
- validate installed schema
- check migrations
- register scheduled jobs
- run fixture smoke tests
- report freshness/health
- link operator docs

Done when:

- A future ERP app can opt into the capability.
- The capability can report exactly what is installed and what is missing.
- App-specific code does not need to copy Future ERP migrations manually.

## Phase 7: Broaden Reports

Goal: expand beyond first financial statements.

Add reusable support for:

- A/R aging
- A/P aging
- customer revenue
- vendor spend
- product/service revenue
- class/location/project reporting
- budget versus actual
- variance explanations
- management reporting packets
- close checklist evidence

Done when:

- New reports reuse the same facts, rollups, freshness, and drilldown model.
- AI tools can cite report snapshots and source evidence.
