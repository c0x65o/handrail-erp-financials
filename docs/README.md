# Handrail ERP Financials Docs

This repository is the reusable financial reporting kernel for ERP-style apps.
It exists so each new ERP app does not have to rediscover schema, migrations,
rollups, financial statements, freshness handling, and report drilldown from
scratch.

The intended shape is:

```text
source adapters -> canonical accounting facts -> rollup/snapshot engine -> report APIs -> app UI and AI tools
```

QuickBooks is the first source adapter, but it must not be the only source. A
fresh-start ERP app should be able to write native accounting facts into the
same canonical model.

## Documents

- [architecture.md](architecture.md): System boundaries and package ownership.
- [canonical-data-model.md](canonical-data-model.md): Tables and domain facts
  this package should standardize.
- [rollups-and-snapshots.md](rollups-and-snapshots.md): Performance strategy for
  P&L, balance sheet, cash flow, expenses, and drilldown.
- [quickbooks-boundary.md](quickbooks-boundary.md): How this package should
  consume the existing QuickBooks integration without owning OAuth or tokens.
- [host-app-install.md](host-app-install.md): How a blank host app installs the
  package schema, loads fixtures, runs validation, registers jobs, checks
  freshness, and consumes report APIs.
- [handrail-capability-plan.md](handrail-capability-plan.md): How a future
  Handrail capability should install, configure, and validate this package.
- [adoption-roadmap.md](adoption-roadmap.md): Practical path from Future ERP to a
  reusable package.

## Core Decisions

- Do not clone the first ERP app as the reuse mechanism.
- Do not depend on KB-only instructions and AI reimplementation for migrations.
- Keep provider integrations separate from the financial reporting kernel.
- Make this package own canonical schema manifests, report builders, rollup
  jobs, report snapshots, fixtures, and acceptance tests.
- Use a Handrail capability as the distribution and validation mechanism, not as
  the home for ERP financial domain logic.

## Current Host-App Path

A blank host app should install `@handrail/erp-financials`, commit SQL generated
from `POSTGRES_CANONICAL_SCHEMA_MANIFEST` and `renderPostgresSchemaSql`, validate
the installed database with `createPostgresStorageAdapter(...).validateSchema()`,
load `ERP_FINANCIALS_STATEMENT_FIXTURE`, and smoke-test the exported report
builders before enabling scheduled rollup, snapshot, late-arrival, and
freshness jobs. See [host-app-install.md](host-app-install.md) for the complete
operator path and the future `erp_financials` capability validation checklist.
