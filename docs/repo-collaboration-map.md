# Repo Collaboration Map

This document tracks how the QuickBooks integration service, ERP Financials
package, and Hitcents Future ERP should work together to show accounting
details with or without QuickBooks.

The target owner outcome is:

```text
Future ERP can connect to QuickBooks sandbox, sync representative accounting
data, build local ERP financial records, and show reports that match
QuickBooks. After migration, the tenant can stop syncing QuickBooks and operate
from native ERP financial data through the same report path.
```

## Repos

### handrail-quickbooks-integrations

Path:

```text
/opt/handrail/repos/handrail/handrail-quickbooks-integrations
```

Primary packages:

```text
handrail-integration-quickbooks
handrail-integration-quickbooks-node-sdk
```

Owns:

- Intuit OAuth and reconnect flows.
- Intuit token custody, refresh, sealing, and rotation.
- QuickBooks tenant, realm, and company mapping.
- Live full sync and delta sync.
- Sandbox replay for token-free Future ERP smoke data.
- Raw import batches and sync checkpoints.
- Normalized QuickBooks accounting resources.
- Provider report calls for P&L, balance sheet, trial balance, cash flow, AR
  aging, AP aging, and general ledger.
- Provider reconciliation/drilldown response contracts.
- The `@handrail/quickbooks-node-sdk` package.

Must not own:

- Future ERP tenant UI.
- Host app database credentials.
- ERP canonical schema and report formulas.
- Native ERP accounting entry after a tenant leaves QuickBooks.

Important existing surfaces:

```text
POST /v1/tenants/:tenantId/quickbooks/sync-jobs
POST /v1/tenants/:tenantId/quickbooks/sandbox-replay
GET  /v1/tenants/:tenantId/quickbooks/import-batches
GET  /v1/tenants/:tenantId/quickbooks/checkpoints
GET  /v1/tenants/:tenantId/accounting/accounts
GET  /v1/tenants/:tenantId/accounting/items
GET  /v1/tenants/:tenantId/accounting/classes
GET  /v1/tenants/:tenantId/accounting/locations
GET  /v1/tenants/:tenantId/accounting/parties
GET  /v1/tenants/:tenantId/accounting/transactions
GET  /v1/tenants/:tenantId/accounting/ledger-entries
POST /v1/tenants/:tenantId/accounting/ledger-entries/search
POST /v1/tenants/:tenantId/accounting/reports/profit-and-loss
POST /v1/tenants/:tenantId/accounting/reports/balance-sheet
POST /v1/tenants/:tenantId/accounting/reports/cash-flow
POST /v1/tenants/:tenantId/quickbooks/reports/trial-balance
```

Current sandbox support:

- The deterministic dev fixture tenant is
  `future-erp-dev-sandbox-tenant`.
- For non-production service runtimes, that tenant can report a connected
  sandbox connection and run sanitized replay without live Intuit OAuth tokens.
- The replay path imports Account, Item, Class, Department, Customer, Vendor,
  Invoice, Bill, Payment, Deposit, and JournalEntry fixture data through the
  same raw import, checkpoint, and normalized resource stores used by live sync.

### handrail-erp-financials

Path:

```text
/opt/handrail/repos/handrail/erp-financials/handrail-erp-financials
```

Package:

```text
@handrail/erp-financials
```

Owns:

- Provider-neutral canonical accounting types.
- Source adapter contracts.
- Native ERP ledger adapter.
- QuickBooks adapter helpers.
- Postgres schema manifest and storage adapter.
- Report builders for P&L, balance sheet, trial balance, and cash flow.
- Rollup, snapshot, freshness, and late-arrival job contracts.
- Deterministic fixtures and report parity helpers.

Must not own:

- Intuit OAuth or tokens.
- QuickBooks API calls.
- Future ERP UI, permissions, or customer workflows.
- Provider-specific credentials.

Current adapter contract:

```text
Handrail QuickBooks normalized resources
  -> HandrailQuickBooksSdkResourcesAdapterInput
  -> mapHandrailQuickBooksSdkResourcesToCanonicalFacts(...)
  -> CanonicalAccountingFactSet
```

The adapter accepts:

- connection and source scope
- company info
- normalized accounts
- normalized items
- normalized classes and locations as dimensions
- normalized parties
- normalized transactions
- normalized ledger entries
- import batch ids
- checkpoint ids
- safe source payload refs

Future ERP should call the Handrail QuickBooks SDK/service for full sync,
incremental sync, and provider report parity, then hand normalized resources to
this adapter. QuickBooks OAuth/token custody, provider clients, raw unbounded
provider payloads, and Intuit credential material stay inside the integration
service.
- safe source payload refs

The adapter should produce:

- accounting company
- accounting source
- import batch
- checkpoint
- canonical accounts
- parties
- items
- dimensions
- transactions
- transaction lines when source detail is available
- ledger postings

### hitcents-future-erp

Path:

```text
/opt/handrail/repos/hitcents/hitcents-future-erp/hitcents-erp-future
```

Owns:

- Future ERP tenant workflows.
- Owner-facing QuickBooks sandbox operations page.
- Future ERP app database connection.
- Host app migration execution.
- Calls into the QuickBooks SDK/service.
- Calls into ERP Financials after the package is installed.
- Report comparison and owner acceptance evidence.
- Future native ERP accounting entry when the tenant leaves QuickBooks.

Must not own:

- Intuit OAuth callbacks.
- Intuit tokens or client secrets.
- Direct QuickBooks API calls.
- Duplicated long-term financial formulas after ERP Financials owns them.
- Raw provider payload tables as the reporting model.

Current existing surfaces:

```text
npm run dev:quickbooks-ops
npm run dev:quickbooks-sandbox
npm run migrate:quickbooks-storage
npm run test
npm run test:quickbooks
```

Important existing app modules:

```text
src/server/quickbooks/import-runner.ts
src/server/quickbooks/sandbox-sync-orchestrator.ts
src/server/quickbooks/provider-report-snapshots.ts
src/server/quickbooks/report-comparisons.ts
src/server/quickbooks/report-read-models.ts
src/server/quickbooks/app-storage.ts
src/server/quickbooks/app-storage-migration.ts
src/server/quickbooks/read-api.ts
```

Future ERP already has app-local storage and report comparison machinery. The
long-term direction is to migrate reusable pieces into
`@handrail/erp-financials` while leaving app UX and owner evidence in Future
ERP.

## End-to-End QuickBooks Sandbox Flow

The desired sandbox path is:

```text
1. Future ERP reads HANDRAIL_QBO_* server env.
2. Future ERP creates @handrail/quickbooks-node-sdk client.
3. Future ERP preflights sandbox connection status.
4. Future ERP starts a full QuickBooks sync or sandbox replay.
5. QuickBooks service returns import batch, job, checkpoint, and normalized resources.
6. Future ERP imports normalized resources.
7. Future ERP maps normalized resources through @handrail/erp-financials.
8. Future ERP persists canonical facts with ERP Financials storage.
9. ERP Financials builds P&L, balance sheet, trial balance, and cash flow.
10. Future ERP fetches QuickBooks provider reports through the SDK.
11. Future ERP compares ERP-generated reports against QuickBooks provider reports.
12. Future ERP shows owner evidence with matched/mismatched/partial/unavailable states.
```

Acceptance for "matches QuickBooks":

- The same tenant, realm/company, provider environment, accounting basis, and
  period/as-of date are used on both sides.
- P&L named totals match within configured tolerance.
- Balance sheet named totals match and the accounting equation is balanced.
- Trial balance total debits and credits match provider evidence.
- Cash flow is either matched, or explicitly partial/unsupported with evidence.
- AR/AP aging are either matched, or explicitly unsupported/unavailable with
  evidence.
- Every matched or mismatched report carries safe drilldown refs.
- Missing data is never interpreted as a zero-delta match.

## Leaving QuickBooks

The migration path off QuickBooks should be intentional:

```text
1. Initial full sync imports the QuickBooks historical baseline.
2. A small number of delta syncs catch up edits and late changes.
3. Future ERP validates parity against QuickBooks provider reports.
4. Tenant marks QuickBooks source paused or archived.
5. Future ERP switches ongoing entry to native ERP ledger events.
6. Native ERP events use the same ERP Financials canonical model.
7. Reports continue through the same rollups, snapshots, freshness, and
   drilldown path.
```

After QuickBooks is paused or archived:

- Historical QuickBooks-sourced facts remain immutable except explicit repair or
  reimport work.
- New native ERP facts land with `sourceSystem = native_erp`.
- Reports can include QuickBooks historical facts and native facts in the same
  tenant/company timeline.
- Drilldown must show whether a posting came from QuickBooks or native ERP.
- The app should no longer require live QuickBooks connection status for normal
  reporting.

## Work Still Needed Outside ERP Financials

### Handrail platform

- Add or extend package install-state detection for `@handrail/erp-financials`.
- Keep `@handrail/quickbooks-node-sdk` install-state detection active for
  Future ERP.
- Add an eventual `erp_financials` capability that validates package version,
  schema manifest, scheduled jobs, fixtures, freshness, and adapter status.
- Seed KB entries for host-app install, QuickBooks adapter, native adapter,
  report parity, and off-QuickBooks migration.

### QuickBooks integration service and SDK

- Keep normalized resource contracts stable for accounts, items, classes,
  locations, parties, transactions, and ledger entries.
- Keep sandbox replay deterministic enough for Future ERP parity checks.
- Expose enough source refs and checkpoint/import-batch evidence for canonical
  drilldown.
- Avoid making provider reports the only report source; they are parity and
  reconciliation evidence.

### Future ERP

- Install `@handrail/erp-financials`.
- Replace reusable app-local schema/report code with package APIs over time.
- Add a worker that maps QuickBooks normalized SDK resources into
  `CanonicalAccountingFactSet`.
- Persist canonical facts through ERP Financials storage.
- Build ERP reports through ERP Financials report builders/snapshots.
- Compare those reports to QuickBooks provider report snapshots.
- Keep sandbox operations owner-facing and sanitized.
- Add the native ERP posting path so the tenant can stop syncing QuickBooks.

## Immediate Next Step

The highest-leverage next step is to implement the normalized QuickBooks
resource adapter in `@handrail/erp-financials` and wire Future ERP sandbox sync
through it.

That creates the proof path:

```text
QuickBooks sandbox replay/live sync
  -> normalized SDK resources
  -> ERP Financials canonical facts
  -> ERP Financials reports
  -> compare to QuickBooks provider reports
  -> owner sees matched accounting details in Future ERP
```
