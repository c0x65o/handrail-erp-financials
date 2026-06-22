# Cross-Repo Local Link Validation

This runbook proves the current ERP Financials, Handrail QuickBooks
Integrations, and Hitcents Future ERP phase with deterministic fixtures first.
It is intentionally local-only: do not mutate CI/CD, deploy, create work
requests, add provider credentials, or change Handrail runtime configuration.

Use this with [repo-collaboration-map.md](repo-collaboration-map.md),
[future-erp-dependency-handoff.md](future-erp-dependency-handoff.md),
[storage-host-app-handoff.md](storage-host-app-handoff.md), and
[production-blocker-matrix.md](production-blocker-matrix.md).

## Repo Paths

Expected local checkouts:

```sh
ERP=/opt/handrail/repos/handrail/erp-financials/handrail-erp-financials
QBO=/opt/handrail/repos/handrail/handrail-quickbooks-integrations
FUTURE=/opt/handrail/repos/hitcents/hitcents-future-erp/hitcents-erp-future
```

Before running cross-repo validation, capture which repos are mounted:

```sh
test -d "$ERP" && echo "mounted: $ERP" || echo "missing: $ERP"
test -d "$QBO" && echo "mounted: $QBO" || echo "missing: $QBO"
test -d "$FUTURE" && echo "mounted: $FUTURE" || echo "missing: $FUTURE"
```

If `QBO` or `FUTURE` is missing, do not invent replacement runtime config or
provider credentials. Leave the exact commands below and the missing path
evidence in the worker summary.

## Source-Level Closeout Evidence: 2026-06-20

This table is the reproducible source-level gate for the current Owner Goal
phase. It separates green repo validation from owner-gated runtime, deploy,
credential, and capability decisions. Evidence comes from the local checkout,
`package-lock.json`, and completed Handrail work-request result summaries for
Owner Goal `a2563e60-1598-47ef-a3e3-8e9b382bc73d`; it does not rely on live
provider credentials, hidden platform state, production data, or CI/CD.

### Mounted Repo Evidence

| Repo | Expected path | Evidence command | 2026-06-20 result |
| --- | --- | --- | --- |
| ERP Financials | `/opt/handrail/repos/handrail/erp-financials/handrail-erp-financials` | `test -d "$ERP"` | Mounted. This is the only repo validated directly in this worker filesystem. |
| Handrail QuickBooks Integrations | `/opt/handrail/repos/handrail/handrail-quickbooks-integrations` | `test -d "$QBO"` and `find /opt/handrail/repos -maxdepth 5 -type d -iname '*quickbooks*'` | Missing. SDK/service repo install, build, and tests were not executed. |
| Hitcents Future ERP | `/opt/handrail/repos/hitcents/hitcents-future-erp/hitcents-erp-future` | `test -d "$FUTURE"` and `find /opt/handrail/repos -maxdepth 5 -type d -iname '*future*'` | Missing. Host-app `npm run typecheck` / `npm run test:quickbooks` were not executed. |

### Package and Tool Versions

| Item | Exact source | Version/evidence |
| --- | --- | --- |
| Package | `package.json` | `@handrail/erp-financials@0.1.1` |
| Node engine | `package.json` | `>=20.11.0` |
| Lockfile | `package-lock.json` | lockfileVersion `3` |
| `@eslint/js` | `package-lock.json` | `9.39.4` |
| `@types/node` | `package-lock.json` | `24.13.2` |
| `eslint` | `package-lock.json` | `9.39.4` |
| `typescript` | `package-lock.json` | `5.9.3` |
| `typescript-eslint` | `package-lock.json` | `8.61.1` |
| `vitest` | `package-lock.json` | `3.2.6` |

### Validation Evidence Table

| Scope | Exact command | Result | Count/build evidence | Source-level conclusion |
| --- | --- | --- | --- | --- |
| ERP Financials full package gate | `cd "$ERP" && npm run validate` | Passed | `lint`, `typecheck`, Vitest `26` files / `148` tests, and `build` completed. | Package lint, typecheck, tests, and distributable build are green. |
| Future ERP public import contract | `cd "$ERP" && npm run typecheck:future-erp-imports` | Passed | TypeScript `tsc --noEmit -p tsconfig.future-erp-consumer.json`; no Vitest count. | Future ERP-shaped public imports compile against package exports. |
| Normalized QuickBooks contract smoke | `cd "$ERP" && npm run contract:smoke` | Passed | Vitest `1` file / `2` tests. | Normalized SDK/service-shaped QuickBooks resources map through the package without live Intuit credentials. |
| Deterministic sandbox replay | `cd "$ERP" && npm run sandbox:quickbooks:replay` | Passed | Vitest `1` file / `2` tests. Replay evidence hash `58c60bb19d80807e36f5bd4de9f563af3e7c8eef0d894465bf18a6a13f27aec5`. | Package-owned Future ERP QuickBooks replay is deterministic, token-free, and bounded. |
| Health and preflight smoke | `cd "$ERP" && npm run health:smoke` | Passed | Vitest `5` files / `17` tests. | Install health, fixture smoke, freshness/drilldown health, aggregate health contract, and Future ERP install-health preflight are green. |
| Schema and serialized evidence boundary | `cd "$ERP" && npx vitest run test/serialized-evidence-boundary.test.ts test/canonical-schema-manifest.test.ts` | Passed | Vitest `2` files / `13` tests. | Canonical schema, migration SQL, normalized fixtures, replay summary, and captured Postgres write params reject credential and raw-payload fields. |
| QuickBooks custody-boundary contract surfaces in ERP Financials | `cd "$ERP" && npx vitest run test/quickbooks-sync-service.test.ts` | Passed | Vitest `1` file / `28` tests. | Mounted SDK/service contract surfaces cover health, full sync, incremental sync, provider reports, reconciliation evidence, checkpoints, and safe refs without credential custody. |
| QuickBooks custody-boundary lint | `cd "$ERP" && npx eslint src/canonical-model.ts test/quickbooks-sync-service.test.ts --max-warnings=0` | Passed | ESLint targeted files; no Vitest count. | Credential/raw-payload key blocker remains lint-clean on the changed contract surfaces. |
| Future ERP app-owned storage/reporting audit | `cd "$ERP" && npx vitest run test/future-erp-app-owned-boundary-audit.test.ts` | Passed | Vitest `1` file / `7` tests. | Future ERP migration/read-model/replay/preflight surfaces stay app-owned and do not add Intuit token, secret, credential, or raw-provider-payload custody. |
| Future ERP app-owned audit lint | `cd "$ERP" && npx eslint test/future-erp-app-owned-boundary-audit.test.ts --max-warnings=0` | Passed | ESLint targeted file; no Vitest count. | Boundary audit test is lint-clean. |
| Future ERP adoption package gate | `cd "$ERP" && npm run typecheck:future-erp-imports && npm run contract:smoke && npm run sandbox:quickbooks:replay` plus the targeted Future ERP adoption suites | Passed | Import typecheck passed; contract smoke `1` file / `2` tests; replay `1` file / `2` tests; targeted adoption suite `13` files / `83` tests; extra boundary/worker/preflight suite `3` files / `15` tests. | ERP Financials package-level Future ERP consumer, storage, reporting, snapshot/freshness, reconciliation/parity, drilldown, scheduler/worker, install-health, and app-owned boundary contracts are green. |
| Provider parity semantics | `cd "$ERP" && npx vitest run test/future-erp-reporting-read-model.test.ts` | Passed | Vitest `30` tests. | P&L, balance sheet, trial balance, and cash flow parity states cover `matched`, `mismatched`, `partial`, and `unavailable`; missing zero-amount provider data remains `partial`/`missing`, not falsely `matched`. |
| Provider parity lint | `cd "$ERP" && npx eslint test/future-erp-reporting-read-model.test.ts --max-warnings=0` | Passed | ESLint targeted file; no Vitest count. | Parity semantics coverage is lint-clean. |
| Future ERP mounted-flow equivalent through package API | `cd "$ERP" && npx vitest run test/future-erp-sandbox-sync-worker.test.ts` | Passed | Vitest `1` file / `6` tests. Owner evidence hash `9a5af739bb621b9f358cbba3ff4a5dcd9b9b85e7b4ff5f419380082997619401`. | Future ERP-shaped worker evidence covers canonical writes, four report snapshots, four freshness rows, SDK parity statuses, bounded refs, and credential/raw-payload exclusion. |
| Future ERP mounted-flow follow-up checks | `cd "$ERP" && npm run sandbox:quickbooks:replay && npm run typecheck:future-erp-imports && npx eslint src/future-erp-sandbox-sync-worker.ts src/index.ts test/future-erp-sandbox-sync-worker.test.ts test/future-erp-consumer-type-imports.ts --max-warnings=0` | Passed | Replay `1` file / `2` tests; import typecheck passed; targeted ESLint passed. | New Future ERP-shaped helper/type export remains replay-safe, import-safe, and lint-clean. |
| QuickBooks integration repo gate | `cd "$QBO" && npm install && npm run build && npm run test` | Not executed | `$QBO` was not mounted. | This is not a green repo validation row; it is a reproducibility boundary for a later mounted linked-repo run. |
| Future ERP host repo gate | `cd "$FUTURE" && npm run typecheck && npm run test:quickbooks` | Not executed | `$FUTURE` was not mounted. | This is not a green repo validation row; it remains a later mounted linked-repo validation step. |

### Deterministic Replay IDs and Statuses

| Evidence field | Expected value |
| --- | --- |
| Replay evidence hash | `58c60bb19d80807e36f5bd4de9f563af3e7c8eef0d894465bf18a6a13f27aec5` |
| Future ERP-shaped owner evidence hash | `9a5af739bb621b9f358cbba3ff4a5dcd9b9b85e7b4ff5f419380082997619401` |
| Tenant | `tenant_qbo_sync_fixture` |
| Company | `company_future_erp_qbo_fixture` |
| Source | `source_qbo_sync_fixture` |
| Source system | `quickbooks` |
| Provider environment | `sandbox` |
| Realm/source company ref | `realm_qbo_sync_fixture` |
| Connection ref | `handrail-quickbooks-sdk:staging:sandbox:realm:realm_qbo_sync_fixture` |
| Import batch | `batch_qbo_full_fixture_2026_01` |
| Checkpoint | `checkpoint_qbo_full_fixture_2026_01` |
| Period | `2026-01-01` through `2026-01-31` |
| As-of date | `2026-01-31` |
| Basis/currency | `accrual` / `USD` |

| Report | Canonical report status | Freshness status / rows | Reconciliation status / difference | Provider parity status / evidence totals |
| --- | --- | --- | --- | --- |
| `profit_and_loss` | `generated` | `fresh` / `1` | `not_reconciled` / `0.00` | `mismatched` / `3` |
| `balance_sheet` | `generated` | `fresh` / `1` | `balanced` / `0.00` | `mismatched` / `3` |
| `trial_balance` | `generated` | `fresh` / `1` | `balanced` / `0.00` | `mismatched` / `3` |
| `cash_flow` | `supported` | `fresh` / `1` | `not_reconciled` / `0.00` | `unsupported` / `0` |

Credential-boundary audit result:

- No source-level validation row required production credentials, live Intuit
  OAuth, provider tokens, client secrets, raw QuickBooks payloads, deploys,
  CI/CD mutation, scheduler/runtime registration, queue mutation, or Handrail
  platform configuration mutation.
- ERP Financials had no configured Handrail capabilities in the active context.
- Hitcents Future ERP had Handrail-managed QuickBooks env names for dev/staging
  only: `HANDRAIL_QBO_SERVICE_ENV`, `HANDRAIL_QBO_PROVIDER_MODE`,
  `HANDRAIL_QBO_API_KEY`, and `HANDRAIL_QBO_TENANT_ID`; production QuickBooks
  capability/env was not configured in the active context and was not changed.
- Formal `erp_financials` capability creation, production QuickBooks
  credentials, production data, staging/production deploy/config changes, and
  scheduler/runtime registration remain owner-gated sidecar decisions, not repo
  validation tasks. See [production-blocker-matrix.md](production-blocker-matrix.md)
  for the separate blocker matrix.

## Link and Install Commands

Build ERP Financials before any host app file-link install so `dist` and
declaration files exist:

```sh
cd "$ERP"
npm install
npm run build
```

If the QuickBooks integration repo is mounted, install and validate its local
packages before linking them into Future ERP:

```sh
cd "$QBO"
npm install
npm run build
npm run test
```

The expected local QuickBooks SDK package path is:

```sh
$QBO/handrail-integration-quickbooks-node-sdk
```

Confirm the SDK package name before linking:

```sh
cd "$QBO"
rg '"name": "@handrail/quickbooks-node-sdk"' -n -g package.json
```

If Future ERP is mounted, install the local ERP Financials package and preserve
Future ERP's existing package manager. The current known npm path is:

```sh
cd "$FUTURE"
npm install @handrail/erp-financials@file:/opt/handrail/repos/handrail/erp-financials/handrail-erp-financials
```

When the QuickBooks integration repo is mounted, link the local SDK package:

```sh
cd "$FUTURE"
npm install @handrail/quickbooks-node-sdk@file:/opt/handrail/repos/handrail/handrail-quickbooks-integrations/handrail-integration-quickbooks-node-sdk
```

When the QuickBooks integration repo is not mounted but registry access is
available, install the published SDK instead:

```sh
cd "$FUTURE"
npm install @handrail/quickbooks-node-sdk
```

Install the Handrail runtime helper package only through Future ERP's package
manager. Do not add Intuit OAuth, token, client-secret, or raw provider-payload
environment variables:

```sh
cd "$FUTURE"
npm install @handrail/sdk-node
```

For workspace-based Future ERP installs, keep the same dependency identities in
package metadata while using the host repo's existing workspace/file spec:

```json
{
  "dependencies": {
    "@handrail/erp-financials": "file:/opt/handrail/repos/handrail/erp-financials/handrail-erp-financials",
    "@handrail/quickbooks-node-sdk": "file:/opt/handrail/repos/handrail/handrail-quickbooks-integrations/handrail-integration-quickbooks-node-sdk",
    "@handrail/sdk-node": "<existing registry, workspace, or file-link spec>"
  }
}
```

## Deterministic Validation Order

Run validation in this order. Stop at the first failure, record the exact
command, file or test name, and the shortest useful error excerpt, then leave
the workspace unchanged except for repo-owned fixes in scope.

### 1. ERP Financials package replay

These commands require no production credentials and must not call Intuit:

```sh
cd "$ERP"
npm run typecheck:future-erp-imports
npm run contract:smoke
npm run sandbox:quickbooks:replay
npx vitest run test/serialized-evidence-boundary.test.ts
```

Expected evidence:

- Future ERP-shaped public imports compile through
  `tsconfig.future-erp-consumer.json`.
- `test/normalized-quickbooks-contract-smoke.test.ts` passes.
- `test/future-erp-sandbox-replay.test.ts` passes.
- `test/serialized-evidence-boundary.test.ts` passes and proves the canonical
  schema, Future ERP migration SQL, normalized fixtures, sandbox replay result,
  serialized replay summary, and captured Postgres write params do not include
  provider credential fields or raw provider payload fields.
- The replay uses package fixtures and normalized envelopes only.

For a full package gate, use `npm run validate`; queued Handrail workers may
already run broader checks, so prefer the targeted commands above unless the
task explicitly asks for the full suite.

#### Deterministic replay evidence closeout

`npm run sandbox:quickbooks:replay` is the current end-to-end sandbox evidence
command for this package. It runs
`vitest run test/future-erp-sandbox-replay.test.ts` and proves the sanitized
fixture flow below without live Intuit calls:

```text
Normalized QuickBooks fixture full sync response
  -> createFutureErpQuickBooksFullSyncWorker(...)
  -> map normalized resources into CanonicalAccountingFactSet
  -> createPostgresStorageAdapter(...)
  -> canonical company/source/import/checkpoint/fact upserts
  -> buildFutureErpReportFromCanonicalReadModel(...)
  -> writeReportSnapshot(...) and writeFreshnessRows(...)
  -> fetchFutureErpQuickBooksProviderReportParitySnapshot(...)
  -> bounded replay summary with no credential or raw-payload fields
```

The deterministic fixture identity is:

| Field | Expected value |
| --- | --- |
| Tenant | `tenant_qbo_sync_fixture` |
| Company | `company_future_erp_qbo_fixture` |
| Source | `source_qbo_sync_fixture` |
| Source system | `quickbooks` |
| Provider environment | `sandbox` |
| Realm/source company ref | `realm_qbo_sync_fixture` |
| Connection ref | `handrail-quickbooks-sdk:staging:sandbox:realm:realm_qbo_sync_fixture` |
| Import batch | `batch_qbo_full_fixture_2026_01` |
| Checkpoint | `checkpoint_qbo_full_fixture_2026_01` |
| Period | `2026-01-01` through `2026-01-31` |
| As-of date | `2026-01-31` |
| Basis/currency | `accrual` / `USD` |

The replay summary returned by `runFutureErpQuickBooksSandboxReplay()` is the
human-readable evidence envelope. It contains these top-level fields:

| Summary field | Evidence meaning |
| --- | --- |
| `importBatchId` / `checkpointId` | Stable ids for the replayed full-sync batch and cursor. |
| `sourceIdentity` | Safe tenant/source/realm/service metadata only; no provider credentials. |
| `importBatch` | `mode`, `status`, `startedAt`, and `completedAt` from the canonical import batch. |
| `checkpoint` | `sourceObject`, `cursorKind`, `cursorValue`, `freshThrough`, `latestSourceUpdatedAt`, and `status`. |
| `normalizedResourceCounts` | Counts received from the normalized QuickBooks service envelope. |
| `canonicalRowCounts` | Counts persisted through ERP Financials canonical storage. |
| `reportStatuses` / `reports` | Per-report generated/support, freshness, reconciliation, snapshot, freshness, line, total, and bounded drilldown evidence. |
| `snapshotIds` / `freshnessIds` | Stable deterministic ids for all generated report snapshots and freshness rows. |
| `parityStatuses` / `providerParity` | Bounded QuickBooks provider report comparison statuses and evidence total counts. |
| `safeDrilldownRefs` | Bounded report, line, total, and reconciliation drilldown refs. |

Expected normalized resource counts:

| Resource | Count |
| --- | ---: |
| `companyInfo` | 1 |
| `accounts` | 2 |
| `classes` | 0 |
| `journalEntries` | 1 |
| `ledgerEntries` | 1 |
| `ledgerTransactions` | 0 |
| `ledgerPostings` | 2 |
| `customers` | 1 |
| `vendors` | 1 |
| `items` | 1 |
| `departments` | 1 |
| `dimensions` | 1 |
| `parties` | 0 |
| `providerReports` | 0 |
| `reconciliationEvidence` | 0 |

Expected canonical row counts:

| Canonical row type | Count |
| --- | ---: |
| `companies` | 1 |
| `sources` | 1 |
| `importBatches` | 1 |
| `checkpoints` | 1 |
| `accounts` | 2 |
| `parties` | 2 |
| `items` | 1 |
| `dimensions` | 1 |
| `transactions` | 1 |
| `transactionLines` | 2 |
| `postings` | 2 |

Expected canonical posting and report totals from
`createQuickBooksContractSmokeHarness()`:

| Evidence | Totals |
| --- | --- |
| Posting totals | debits `500.00`, credits `500.00`, net `0.00` |
| P&L | `gross_profit=500.00`, `net_income=500.00`, `net_operating_income=500.00`, `total_income=500.00`, `total_cost_of_goods_sold=0.00`, `total_expenses=0.00`, `total_other_income=0.00`, `total_other_expense=0.00` |
| Balance sheet | `total_assets=500.00`, `total_equity=500.00`, `total_liabilities=0.00`, `total_liabilities_and_equity=500.00` |
| Trial balance | `total_debits=500.00`, `total_credits=500.00` |
| Cash flow | replay status `supported`; generated from canonical cash account movement for the fixture |

Expected fixture provider parity totals are intentionally different for P&L,
balance sheet, and trial balance so the replay proves mismatch handling rather
than a fabricated match:

| Provider report | Fixture provider totals | Replay parity status |
| --- | --- | --- |
| `profit_and_loss` | `income=20000.00`, `expenses=6200.00`, `net_income=13800.00` | `mismatched` |
| `balance_sheet` | `assets=74000.00`, `liabilities=11200.00`, `equity=62800.00` | `mismatched` |
| `trial_balance` | `debits=81900.00`, `credits=81900.00`, `net=0.00` | `mismatched` |
| `cash_flow` | no totals; QuickBooks parity unsupported in the fixture | `unsupported` |

Expected report snapshot and freshness ids:

| Report | Snapshot id | Freshness id |
| --- | --- | --- |
| `profit_and_loss` | `snapshot:tenant_qbo_sync_fixture:profit_and_loss:accrual:2026-01-01:2026-01-31:2026-01-31:USD` | `freshness:tenant_qbo_sync_fixture:company_future_erp_qbo_fixture:source_qbo_sync_fixture:profit_and_loss:accrual:2026-01-01:2026-01-31:USD` |
| `balance_sheet` | `snapshot:tenant_qbo_sync_fixture:balance_sheet:accrual:2026-01-01:2026-01-31:2026-01-31:USD` | `freshness:tenant_qbo_sync_fixture:company_future_erp_qbo_fixture:source_qbo_sync_fixture:balance_sheet:accrual:2026-01-01:2026-01-31:USD` |
| `trial_balance` | `snapshot:tenant_qbo_sync_fixture:trial_balance:accrual:2026-01-01:2026-01-31:2026-01-31:USD` | `freshness:tenant_qbo_sync_fixture:company_future_erp_qbo_fixture:source_qbo_sync_fixture:trial_balance:accrual:2026-01-01:2026-01-31:USD` |
| `cash_flow` | `snapshot:tenant_qbo_sync_fixture:cash_flow:accrual:2026-01-01:2026-01-31:2026-01-31:USD` | `freshness:tenant_qbo_sync_fixture:company_future_erp_qbo_fixture:source_qbo_sync_fixture:cash_flow:accrual:2026-01-01:2026-01-31:USD` |

The replay writes in this deterministic order and then repeats the same
identities on a second replay, proving idempotent `on conflict` upsert behavior:

```text
upsertAccountingCompany       -> accounting_companies
upsertAccountingSource        -> accounting_sources
upsertImportBatch             -> import_batches
upsertSyncCheckpoint          -> sync_checkpoints
upsertAccounts                -> accounts
upsertParties                 -> parties
upsertItems                   -> items
upsertDimensions              -> accounting_dimensions
upsertTransactions            -> transactions
upsertTransactionLines        -> transaction_lines
upsertLedgerPostings          -> ledger_postings

For each report in profit_and_loss, balance_sheet, trial_balance, cash_flow:
writeReportSnapshot           -> report_snapshots
                              -> report_snapshot_lines
                              -> report_snapshot_totals
writeFreshnessRows            -> report_freshness
```

Each replay-generated report writes one freshness row. In the deterministic
replay all four report freshness statuses are `fresh` and all four
`freshnessRowsWritten` values are `1`.

Status meanings for handoff summaries:

| Status field | Values | Meaning |
| --- | --- | --- |
| `reportStatuses` | `generated`, `supported`, `partial`, `unsupported` | Canonical report generation/support. P&L, balance sheet, and trial balance are `generated`; cash flow is `supported` when app-owned cash classification is sufficient. |
| `freshnessStatus` | `fresh`, `partial`, `stale`, `unknown` | `fresh` means imported canonical facts cover the source boundary; `partial` means `importedThrough` lags `sourceFreshThrough`; `stale` marks generated output pending refresh after late-arrival overlap; `unknown` means no source boundary is available. |
| `reconciliationStatus` | `balanced`, `out_of_balance`, `not_reconciled` | `balanced` means report formula totals reconcile, such as trial balance debits equaling credits; `out_of_balance` means formula or provider totals differ beyond tolerance; `not_reconciled` means no reconciliation basis was available, such as unsupported cash flow. |
| `parityStatuses` | `matched`, `mismatched`, `partial`, `unsupported`, `unavailable` | `matched` means every compared provider total is within tolerance; `mismatched` means compared totals differ; `partial` means at least one canonical total is missing from provider evidence; `unsupported` means the SDK/service says the report is not supported; `unavailable` means the provider report call failed or reported unavailable. |

Current phase acceptance matrix:

| Acceptance criterion | Deterministic evidence |
| --- | --- |
| Future ERP can consume the package through public imports. | `npm run typecheck:future-erp-imports` compiles `tsconfig.future-erp-consumer.json`. |
| Replay is deterministic and token-free. | `npm run sandbox:quickbooks:replay` uses `ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES`, returns stable ids above, and `assertNoCredentialKeys` passes. |
| Normalized QuickBooks contracts map to canonical facts. | `npm run contract:smoke` and `test/future-erp-sandbox-replay.test.ts` assert normalized and canonical counts. |
| Canonical facts persist through ERP Financials storage. | Replay write-order assertions cover canonical company/source/import/checkpoint/accounts/parties/items/dimensions/transactions/lines/postings writes. |
| Reports are ERP-owned, not provider-report shaped storage. | Replay builds P&L, balance sheet, trial balance, and cash flow through `buildFutureErpReportFromCanonicalReadModel` and writes canonical snapshots/freshness. |
| Snapshot and freshness writes are present and stable. | Replay asserts four stable snapshot ids, four stable freshness ids, and one freshness row per report. |
| Provider reports are reconciliation evidence only. | Provider parity assertions compare bounded totals and expose `mismatched`/`unsupported` statuses without replacing canonical reports. |
| Drilldown evidence is safe and bounded. | Replay asserts safe report, line, total, and reconciliation drilldown refs with a max of four line refs and four total refs per report. |
| Raw payloads and credentials are excluded. | `test/serialized-evidence-boundary.test.ts` plus replay JSON checks reject token, credential, `rawPayload`, and `rawProviderPayload` fields. |
| Unsupported states are explicit. | Cash-flow provider parity is `unsupported`; separate read-model tests cover `partial`, `stale`, `not_reconciled`, and `unavailable` meanings. |

### 2. QuickBooks integration deterministic package checks

Run this only when `$QBO` is mounted:

```sh
cd "$QBO"
npm install
npm run build
npm run test
```

If package-specific commands exist for normalized full sync, provider reports,
reconciliation, or sandbox replay fixtures, run them after the root test
command and record the script names from `package.json`:

```sh
cd "$QBO"
npm run
```

Expected evidence:

- `@handrail/quickbooks-node-sdk` builds or typechecks.
- Normalized full-sync and incremental-sync envelopes are covered by local
  tests or fixture replay.
- Provider report responses are validated as reconciliation evidence, not as
  ERP Financials report storage.
- Sandbox replay uses sanitized dev fixtures unless live sandbox execution is
  explicitly configured.

### 3. Future ERP linked dependency checks

Run this only when `$FUTURE` is mounted after the dependency installs above:

```sh
cd "$FUTURE"
npm run typecheck
npm run test:quickbooks
```

If Future ERP uses `pnpm`, `yarn`, or another package manager, keep the same
script names and swap only the command runner, for example:

```sh
cd "$FUTURE"
pnpm typecheck
pnpm test:quickbooks
```

Expected evidence:

- Future ERP resolves `@handrail/erp-financials` from the local checkout or
  intended package source.
- Future ERP resolves `@handrail/quickbooks-node-sdk` from the local
  QuickBooks integration checkout or intended package source.
- Future ERP imports normalized QuickBooks sync responses, maps them through
  ERP Financials, persists canonical facts, builds reports/snapshots/freshness
  from canonical storage, and compares provider reports as bounded parity
  evidence.

Credential/raw-payload boundary search for Future ERP, when mounted:

```sh
cd "$FUTURE"
rg -n -S "access[_-]?token|refresh[_-]?token|client[_-]?secret|clientSecret|credential|rawPayload|rawProviderPayload|raw_provider_payload|raw_payload" src test migrations prisma db docs README.md package.json
```

Expected evidence:

- App-owned financial migrations/tables/read models do not define provider
  credential columns, credential JSON fields, `rawPayload`, or
  `rawProviderPayload`.
- Any matches are limited to negative tests, documentation, or Handrail-managed
  service references; no Intuit token custody, client-secret custody, raw
  QuickBooks payload archive, or unbounded provider-payload output store is
  introduced in Future ERP.

### 4. Live sandbox gate

Live sandbox execution is not part of deterministic local replay. Only run it
when the active project/runtime has explicit Handrail-managed configuration for
the Future ERP app and the task asks for sandbox execution.

Codex can safely rerun sanitized replay with `npm run sandbox:quickbooks:replay`
inside ERP Financials because it uses package fixtures and normalized
QuickBooks-shaped envelopes only. A live Future ERP QuickBooks sandbox run is a
different path: it requires dev QuickBooks capability/runtime configuration,
provider credential readiness, and tenant/runtime wiring that live outside this
repo task. Do not add credentials, mutate Handrail configuration, or retry stale
repo-mount approval requests from this runbook.

Specifically, do not request the rejected Future ERP repo-mount approval again:
fingerprint
`00d06a110a8f5d3ec0fd02c9318cbbcf58fd20794a56518ef385c868f8c78f59`
covered the stale `owner_approve_configuration_request` path for configuration
request `44e167d5-313c-41f3-b131-d6815ce1dbab`. The safe retry path is to use
the already linked Future ERP adoption target for repo-only work, then raise a
separate owner-approved configuration request only for missing live sandbox
runtime, secrets, provider credentials, staging deploy, or production deploy
needs.

Allowed Future ERP runtime references are Handrail-managed values:

```text
HANDRAIL_QBO_SERVICE_ENV
HANDRAIL_QBO_PROVIDER_MODE
HANDRAIL_QBO_API_KEY
HANDRAIL_QBO_TENANT_ID
```

Do not add or serialize Intuit access tokens, refresh tokens, client secrets,
OAuth grants, raw provider clients, or unbounded QuickBooks request/response
payloads in ERP Financials or Future ERP evidence.

## Worker Evidence Checklist

Every worker that uses this runbook should leave:

- Mounted or missing evidence for `$ERP`, `$QBO`, and `$FUTURE`.
- Exact install/link commands run.
- Exact validation commands run, in order.
- Pass/fail status for each command.
- For failures, the failing file/test/script and concise error evidence.
- Confirmation that no production credentials, deploys, CI/CD changes, or
  Handrail runtime configuration mutations were used for deterministic replay.
