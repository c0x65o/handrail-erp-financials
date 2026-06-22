# Future ERP QuickBooks and Reporting Surface Inventory

This note records the Future ERP surfaces named by the ERP Financials handoff
docs so the dependency wireup can target the right replacement points. The
Hitcents Future ERP checkout path documented in
[repo-collaboration-map.md](repo-collaboration-map.md) is:

```text
/opt/handrail/repos/hitcents/hitcents-future-erp/hitcents-erp-future
```

In the queued worker that created this note, that checkout was not mounted, so
this inventory is based on the ERP Financials repo-owned handoff contracts and
must be verified against the actual Future ERP files once the repo is present.

## Boundary Confirmation

No planned adoption step moves Intuit OAuth callbacks, Intuit access tokens,
refresh tokens, client secrets, provider clients, raw QuickBooks API calls, or
unbounded raw provider payload ownership into Future ERP. Future ERP should use
the Handrail QuickBooks SDK/service for provider access, then pass normalized
SDK/service resources into `@handrail/erp-financials`.

Future ERP remains responsible for app concerns: tenant workflows, permissions,
job scheduling, app database connection ownership, migration execution,
operator evidence, UI routes, API read routes, and AI tool registration.

## Named Future ERP Surfaces

| Future ERP file | Current responsibility to verify | ERP Financials replacement point |
| --- | --- | --- |
| `src/server/quickbooks/import-runner.ts` | App-owned import job orchestration. It should call the QuickBooks SDK/service and import normalized full or incremental sync envelopes. | Convert `response.resources` to `HandrailQuickBooksSdkResourcesAdapterInput`, call `mapHandrailQuickBooksSdkResourcesToCanonicalFacts`, persist with `createPostgresStorageAdapter`, then trigger rollup, snapshot, and freshness work. |
| `src/server/quickbooks/sandbox-sync-orchestrator.ts` | Owner-facing sandbox preflight, replay, and sync orchestration. Provider access should stay behind the SDK/service. | Use normalized sandbox sync responses as the only provider input to canonical fact mapping. Keep sandbox replay deterministic and token-free from the Future ERP side. |
| `src/server/quickbooks/provider-report-snapshots.ts` | App-local bounded provider report snapshot/evidence storage for parity checks. | Treat provider reports as reconciliation evidence only. Use SDK/service report envelopes and ERP Financials reconciliation helpers instead of raw provider report payloads as durable report state. |
| `src/server/quickbooks/report-comparisons.ts` | Provider comparison logic and owner acceptance states such as matched, mismatched, partial, or unavailable. | Replace duplicated comparison formulas with ERP Financials report builders and reconciliation helpers: `buildProfitAndLossReport`, `buildBalanceSheetReport`, `buildTrialBalanceReport`, `buildCashFlowReport`, and QuickBooks reconciliation evidence helpers. |
| `src/server/quickbooks/report-read-models.ts` | App/UI reporting read models and any local financial statement shaping. | Read from canonical reports, rollups, snapshots, freshness rows, and compact drilldown refs produced by ERP Financials. Long-term financial statement formulas belong in `@handrail/erp-financials`, not Future ERP. |
| `src/server/quickbooks/app-storage.ts` | Future ERP database access for import state, app evidence, and app-facing reads. | Keep the host app database connection here, but route canonical fact, rollup, snapshot, and freshness persistence through `createPostgresStorageAdapter(hostPostgresClient)`. Do not add Intuit token or raw provider payload tables. |
| `src/server/quickbooks/app-storage-migration.ts` | Host app migration execution for existing QuickBooks storage tables. | Add ERP Financials schema installation/validation through the package manifest or rendered SQL. Migrations should install canonical storage, not provider credential custody. |
| `src/server/quickbooks/read-api.ts` | Server read API for Future ERP screens, operator evidence, and AI drilldowns if present. | Expose ERP Financials report output and compact drilldown refs. Drilldown handlers may resolve refs through the QuickBooks service or canonical storage with tenant permission checks, not by returning raw provider archives. |

## Formula Replacement Points

The likely duplicated financial-reporting code lives in
`report-comparisons.ts` and `report-read-models.ts`, with supporting persistence
in `provider-report-snapshots.ts` and `app-storage.ts`. During dependency
wireup, replace app-local P&L, balance sheet, trial balance, cash-flow,
freshness, and comparison calculations with ERP Financials package exports.
Future ERP can keep presentation-specific shaping and owner evidence state, but
the reusable accounting formulas should move to or be consumed from
`@handrail/erp-financials`.

## Verification Needed In Future ERP

When the Future ERP checkout is available, inspect the named files for:

- Direct Intuit or QuickBooks provider client imports.
- OAuth callback, token refresh, access-token, refresh-token, or client-secret
  persistence.
- Raw provider payload tables or unlimited request/response archives used as
  the reporting model.
- Local formulas for P&L, balance sheet, trial balance, cash flow, freshness,
  or reconciliation that should be replaced with ERP Financials exports.
- Existing package manager and workspace/link conventions for the dependency
  wireup task that follows this inventory.
