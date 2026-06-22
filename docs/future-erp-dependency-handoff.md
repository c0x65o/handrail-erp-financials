# Future ERP Dependency Handoff

This is the local development handoff for wiring Hitcents Future ERP to
`@handrail/erp-financials` and the Handrail QuickBooks SDK/service client
without changing deploy, runtime, OAuth, or provider configuration.

Use this with [storage-host-app-handoff.md](storage-host-app-handoff.md) for
the worker data flow and [quickbooks-boundary.md](quickbooks-boundary.md) for
provider ownership.

## Local Checkouts

Expected local repo paths:

```text
/opt/handrail/repos/handrail/erp-financials/handrail-erp-financials
/opt/handrail/repos/handrail/handrail-quickbooks-integrations
/opt/handrail/repos/hitcents/hitcents-future-erp/hitcents-erp-future
```

If the Future ERP checkout is not mounted in the worker, update only this repo's
handoff docs and package-side validation harness. Do not invent Future ERP
runtime config or provider credentials.

## Package Link Setup

Build ERP Financials first so the local file dependency exposes `dist` and type
declarations:

```sh
cd /opt/handrail/repos/handrail/erp-financials/handrail-erp-financials
npm install
npm run build
npm run typecheck:future-erp-imports
```

In the Future ERP checkout, preserve its existing package manager. The current
known local npm setup is:

```sh
cd /opt/handrail/repos/hitcents/hitcents-future-erp/hitcents-erp-future
npm install @handrail/erp-financials@file:/opt/handrail/repos/handrail/erp-financials/handrail-erp-financials
npm install @handrail/quickbooks-node-sdk
npm install @handrail/sdk-node
```

If the QuickBooks SDK package is not published in the worker environment, link
the local SDK package from the QuickBooks integration checkout instead of adding
provider credentials or service config. Confirm the package directory from its
`package.json`, then use the repo's existing workspace/file-link convention:

```sh
cd /opt/handrail/repos/handrail/handrail-quickbooks-integrations
rg '"name": "@handrail/quickbooks-node-sdk"' -n -g package.json

cd /opt/handrail/repos/hitcents/hitcents-future-erp/hitcents-erp-future
npm install @handrail/quickbooks-node-sdk@file:/opt/handrail/repos/handrail/handrail-quickbooks-integrations/handrail-integration-quickbooks-node-sdk
```

For a workspace-based Future ERP install, keep the same dependencies in package
metadata but use the workspace's preferred spec:

```json
{
  "dependencies": {
    "@handrail/erp-financials": "file:/opt/handrail/repos/handrail/erp-financials/handrail-erp-financials",
    "@handrail/quickbooks-node-sdk": "<existing registry, workspace, or file-link spec>",
    "@handrail/sdk-node": "<existing registry, workspace, or file-link spec>"
  }
}
```

`@handrail/sdk-node` is for Handrail runtime/capability helpers. The
QuickBooks-specific service client remains `@handrail/quickbooks-node-sdk` or
the equivalent package exported by `handrail-quickbooks-integrations`.

## Validation Commands

Run package-side deterministic checks before switching Future ERP imports:

```sh
cd /opt/handrail/repos/handrail/erp-financials/handrail-erp-financials
npm run typecheck:future-erp-imports
npm run contract:smoke
npx vitest run test/future-erp-canonical-import-smoke.test.ts
npx vitest run test/quickbooks-sync-service.test.ts
npx vitest run test/normalized-quickbooks-contract-compatibility.test.ts
```

Run Future ERP checks after the dependency metadata or lockfile changes:

```sh
cd /opt/handrail/repos/hitcents/hitcents-future-erp/hitcents-erp-future
npm run typecheck
npm run test:quickbooks
```

If Future ERP uses a different package manager, keep the same script names and
swap only the command runner, for example `pnpm typecheck` or
`pnpm test:quickbooks`. Do not replace these with live Intuit probes; the
handoff must validate deterministically from package types, fixtures, and
normalized SDK/service envelopes.

## Validation Run Notes

2026-06-20 UTC / 2026-06-19 America/Chicago queued worker validation:

- `npm run typecheck:future-erp-imports`: passed.
- `npm run contract:smoke`: passed, 1 test in
  `test/normalized-quickbooks-contract-smoke.test.ts`.
- `npx vitest run test/future-erp-canonical-import-smoke.test.ts
  test/future-erp-persistence.test.ts test/future-erp-preflight.test.ts
  test/future-erp-quickbooks-full-sync.test.ts
  test/future-erp-quickbooks-incremental-sync.test.ts
  test/future-erp-reporting-read-model.test.ts
  test/quickbooks-sync-service.test.ts
  test/normalized-quickbooks-sync-fixtures.test.ts
  test/normalized-quickbooks-contract-compatibility.test.ts`: passed, 9 files
  and 60 tests.
- `npm run typecheck`: initially failed on
  `test/future-erp-canonical-import-smoke.test.ts` because the fake Postgres
  result returned `rowCount: undefined` and the report request included
  `sourceFreshThrough: undefined` under `exactOptionalPropertyTypes`. Repo-owned
  fix applied in the smoke test: return `rowCount: null` and omit freshness
  properties when the fixture checkpoint has no value. Rerun passed.
- `npm run build`: passed.

Host-app checks were not runnable in this worker because
`/opt/handrail/repos/hitcents/hitcents-future-erp/hitcents-erp-future` was not
mounted. Next repo-owned Future ERP step once that checkout is available: run
its `npm run typecheck` and `npm run test:quickbooks` after dependency/link
setup, without adding live Intuit credentials or provider probes.

## Phase Handoff Runbook

This phase completed the deterministic Future ERP adoption path in the
`@handrail/erp-financials` package. It did not change Handrail runtime config,
deploy state, CI/CD state, provider credentials, or the Future ERP host repo.
Use the "Deterministic replay evidence closeout" section in
[cross-repo-local-link-validation.md](cross-repo-local-link-validation.md) as
the acceptance matrix for exact replay commands, summary fields, canonical and
provider totals, snapshot/freshness writes, status meanings, and
credential-boundary evidence.

Exact Future ERP package modules touched for the adoption surface:

- `src/future-erp-preflight.ts`: validates host Postgres canonical schema
  readiness with `validateFutureErpCanonicalSchemaPreflight`.
- `src/future-erp-persistence.ts`: persists canonical fact sets through
  Future ERP-owned storage with `createFutureErpCanonicalFactPersistenceWorker`
  and `persistFutureErpCanonicalFacts`.
- `src/future-erp-quickbooks-full-sync.ts`: runs full QuickBooks imports with
  `createFutureErpQuickBooksFullSyncWorker` and maps
  `NormalizedQuickBooksFullSyncResponseEnvelope` values with
  `mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts`.
- `src/future-erp-quickbooks-incremental-sync.ts`: runs incremental QuickBooks
  imports with `createFutureErpQuickBooksIncrementalSyncWorker`, preserving
  `resumeFromCheckpointId` and changed-resource evidence from
  `mapNormalizedQuickBooksIncrementalSyncResponseToCanonicalFacts`.
- `src/future-erp-reporting.ts`: builds Future ERP report read models,
  snapshots, freshness rows, drilldown surfaces, and provider parity snapshots
  with `buildFutureErpReportFromCanonicalReadModel` and
  `fetchFutureErpQuickBooksProviderReportParitySnapshot`.

ERP Financials APIs used by the phase:

- Storage and schema: `createPostgresStorageAdapter`, `installPostgresSchema`,
  `validatePostgresSchema`, `POSTGRES_CANONICAL_SCHEMA_MANIFEST`, and
  `assertManifestHasNoCredentialColumns`.
- Boundary guards: `assertNoCredentialKeys`, `assertSafeSourcePayloadRef`,
  `assertSafeDrilldownRef`, and `createCompactDrilldownRef`.
- Source mapping: `adaptNormalizedQuickBooksResourceSetToAdapterInput`,
  `mapHandrailQuickBooksSdkResourcesToCanonicalFacts`, and
  `handrailQuickBooksSdkResourcesSourceAdapter`.
- Report formulas: `buildProfitAndLossReport`, `buildBalanceSheetReport`,
  `buildTrialBalanceReport`, and `buildCashFlowReport`.
- Snapshot/freshness/rollup support: `createSnapshotRefreshContract`,
  `reconcileReportFreshness`, `buildRollupBuckets`, and
  `planLateArrivalReprocess`.
- Fixture smoke harness: `ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES`
  and `createQuickBooksContractSmokeHarness`.

QuickBooks SDK/service calls represented in the package contract:

- Sync import calls: `HandrailQuickBooksSyncClient.fullSync`,
  `HandrailQuickBooksSyncClient.incrementalSync`, and the corresponding
  `HandrailQuickBooksFullSyncServiceHandler.fullSync` /
  `incrementalSync` methods.
- Provider report calls used only for parity evidence:
  `providerReport`, `profitAndLossReport`, `balanceSheetReport`,
  `trialBalanceReport`, and `cashFlowParityReport`.
- Service-side normalization helpers:
  `createHandrailQuickBooksFullSyncServiceHandler`,
  `buildNormalizedQuickBooksFullSyncResponse`,
  `buildNormalizedQuickBooksIncrementalSyncResponse`,
  `buildNormalizedQuickBooksProviderReportResponse`, and
  `buildUnsupportedQuickBooksCashFlowParityReportResponse`.
- Reconciliation helpers:
  `buildQuickBooksProfitAndLossReconciliationEvidence`,
  `buildQuickBooksBalanceSheetReconciliationEvidence`,
  `buildQuickBooksTrialBalanceReconciliationEvidence`, and
  `buildQuickBooksProviderReportReconciliationEvidence`.

Fixture smoke data now proving deterministic adoption:

- Fixture identity: tenant `tenant_qbo_sync_fixture`, source
  `source_qbo_sync_fixture`, sandbox realm `realm_qbo_sync_fixture`, full sync
  batch `batch_qbo_full_fixture_2026_01`, and checkpoint
  `checkpoint_qbo_full_fixture_2026_01`.
- Normalized full-sync counts: 2 accounts, 1 company info, 1 customer, 1 vendor,
  1 item, 1 department/dimension, and 1 journal entry.
- Canonical persistence counts: 2 accounts, 2 parties, 1 item, 1 dimension,
  1 transaction, 2 transaction lines, and 2 postings.
- Canonical posting totals: debits `500.00`, credits `500.00`, net `0.00`.
- Canonical report totals: P&L net income `500.00`, balance sheet total assets
  `500.00`, total equity `500.00`, total liabilities `0.00`, and trial balance
  debits/credits `500.00`.
- Stable `createQuickBooksContractSmokeHarness` hash:
  `24c6ad7a18b7c1e55ab7ce4a52dcaac0dbddac4225f0e12aef32312b06b7aed7`.
- Stable Future ERP canonical import smoke summary hash:
  `1dc0edecd8fafc852a9935ec0fcd9b652c7b28d4c43176ba537197bd41619075`.
- Provider parity fixture evidence intentionally compares different provider
  report totals for P&L, balance sheet, and trial balance, so the deterministic
  status is `mismatched`; cash flow parity is `unsupported` until QuickBooks
  provider cash-flow support is available.

Next sandbox phase run order:

1. Mount the Future ERP checkout and link/install `@handrail/erp-financials`,
   `@handrail/quickbooks-node-sdk`, and `@handrail/sdk-node` using the local or
   registry specs already described above.
2. Run Future ERP `npm run typecheck` and `npm run test:quickbooks` against the
   normalized fixture/service-contract path before any live sandbox attempt.
3. In dev sandbox runtime, read only Handrail-managed references:
   `HANDRAIL_QBO_SERVICE_ENV`, `HANDRAIL_QBO_PROVIDER_MODE`,
   `HANDRAIL_QBO_API_KEY`, and `HANDRAIL_QBO_TENANT_ID`. These belong to
   Handrail capability configuration, not package source or checked-in docs.
4. Trigger sandbox full sync through the Handrail QuickBooks SDK/service client,
   then pass the normalized response envelope to
   `createFutureErpQuickBooksFullSyncWorker`.
5. Persist facts through `createPostgresStorageAdapter` and
   `createFutureErpCanonicalFactPersistenceWorker`; do not add direct Intuit
   OAuth/token stores or raw QuickBooks payload columns to Future ERP.
6. Generate P&L, balance sheet, trial balance, and cash-flow views through
   `buildFutureErpReportFromCanonicalReadModel`, with
   `persistGeneratedSnapshot: true` when the host storage supports snapshot and
   freshness writes.
7. Fetch provider report parity with
   `fetchFutureErpQuickBooksProviderReportParitySnapshot`; store the bounded
   reconciliation evidence and drilldown refs as parity evidence only.
8. Run incremental sandbox sync through
   `createFutureErpQuickBooksIncrementalSyncWorker` using the last canonical
   checkpoint, then regenerate affected snapshots/freshness. Do not reimplement
   P&L, balance sheet, trial balance, cash-flow, snapshot, freshness, or
   reconciliation formulas in Future ERP.

Remaining blockers and deferred prerequisites:

- The Future ERP checkout path
  `/opt/handrail/repos/hitcents/hitcents-future-erp/hitcents-erp-future` was
  not mounted in this queued worker, so host-app scripts could not be run here.
- Sanitized replay remains runnable by Codex from this repo with
  `npm run sandbox:quickbooks:replay`; live Future ERP QuickBooks sandbox
  execution is not the same path and requires dev QuickBooks capability/runtime
  configuration, provider credential readiness, and tenant/runtime wiring
  outside repo work.
- ERP Financials has no QuickBooks runtime capability configured directly. The
  dev/staging QuickBooks capability is attached to the linked Future ERP
  adoption target and exposes only the `HANDRAIL_QBO_*` contract keys listed
  above.
- Production QuickBooks capability, live Intuit credentials, production data,
  staging deploy, production deploy, and config changes remain out of scope.
  Request those through explicit sidecar configuration/approval requests rather
  than encoding credentials or provider endpoints in this package.
- Do not retry the stale rejected Future ERP repo-mount approval for
  configuration request `44e167d5-313c-41f3-b131-d6815ce1dbab`
  (`owner_approve_configuration_request` fingerprint
  `00d06a110a8f5d3ec0fd02c9318cbbcf58fd20794a56518ef385c868f8c78f59`).
  Future ERP is already linked as the repo-only adoption target; only live
  sandbox runtime/secrets/deploy needs should go through a fresh, explicit
  owner-approved configuration path.
- If the Future ERP sandbox needs a concrete QuickBooks service base URL,
  tenant mapping, API key rotation, provider-mode override, or production
  enablement, raise a sidecar configuration request. Do not modify Handrail DB,
  queue state, deploy state, or app secrets from this repo task.

## Adoption Flow

Future ERP should move QuickBooks data into canonical storage in this order:

1. Read Handrail-managed `HANDRAIL_QBO_*` runtime references through the SDK
   helper contract.
2. Use the Handrail QuickBooks SDK/service for connection status, full sync,
   incremental sync, sandbox replay, and provider report parity.
3. Receive `NormalizedQuickBooksFullSyncResponseEnvelope` or
   `NormalizedQuickBooksIncrementalSyncResponseEnvelope`.
4. Convert `response.resources` into
   `HandrailQuickBooksSdkResourcesAdapterInput`.
5. Call `mapHandrailQuickBooksSdkResourcesToCanonicalFacts`.
6. Persist the returned `CanonicalAccountingFactSet` through
   `createPostgresStorageAdapter(hostPostgresClient)`.
7. Build rollups, snapshots, freshness rows, and reconciliation evidence with
   ERP Financials package APIs.
8. Expose Future ERP screens, read APIs, and AI drilldowns from canonical
   reports and compact drilldown refs.

Provider report responses from QuickBooks are parity evidence. They should be
compared with ERP Financials report output and stored as bounded reconciliation
evidence, not used as the long-term ERP reporting schema.

## Boundary Checklist

Before accepting a Future ERP dependency handoff, verify:

- No Intuit access tokens, refresh tokens, OAuth grants, client secrets, realm
  credential stores, or provider client instances are added to Future ERP.
- No new QuickBooks provider OAuth env vars or Intuit credential env vars are
  introduced in Future ERP, ERP Financials, deployment files, or Handrail
  platform config.
- Future ERP uses the Handrail QuickBooks SDK/service for provider access
  instead of direct Intuit API calls.
- Future ERP storage receives normalized resource envelopes, safe runtime refs,
  safe source refs, and canonical accounting facts only.
- Raw unbounded QuickBooks request/response bodies are not persisted as the
  reporting model or returned through report drilldowns.
- `sourcePayloadRef` and report `drilldownRef` values are compact, bounded,
  tenant-scoped, and safe to resolve through the QuickBooks service or
  canonical storage with Future ERP permissions.
- Reusable financial formulas for P&L, balance sheet, trial balance, cash flow,
  freshness, and reconciliation come from `@handrail/erp-financials`, while
  Future ERP keeps app-specific UX, evidence states, permissions, and job
  orchestration.
- Provider reports remain reconciliation/parity inputs and do not replace
  canonical facts, rollups, snapshots, or freshness rows.

## Credential And Raw Payload Audit

2026-06-20 UTC queued-worker audit scope: `src`, `test`, `migrations`, `docs`,
`README.md`, package fixture data, serialized/generated `dist` artifacts, and
the Future ERP canonical migration snapshot. The audited terms were
`access_token`, `refresh_token`, `client_secret`, `clientSecret`, `token`,
`secret`, `password`, `credential`, `private_key`, `rawPayload`, and
`rawProviderPayload`.

Audit result:

- `assertNoCredentialKeys`, safe source ref validation, schema manifest
  validation, and Postgres row validation reject credential-like fields and raw
  provider payload keys before canonical facts, report refs, freshness rows, or
  reconciliation evidence are persisted or serialized.
- The canonical migration contains only bounded `source_payload_ref` columns with
  4096-byte JSON checks. It does not define token, secret, password,
  credential, private-key, raw-payload, or raw-provider-payload custody columns.
- `rawPayload` and `rawProviderPayload` appearances in tests are negative
  fixtures that prove provider payload bodies are rejected or excluded from
  report/read-model output.
- `access_token`, `client_secret`, and related names in tests are negative
  fixtures or regex coverage only; there are no live Intuit credentials or
  provider credential env vars in package fixtures, snapshots, migrations, or
  reporting paths.

Safe non-provider credential token names:

- `DrilldownRef.token` and `CompactDrilldownRefInput.token` are deterministic
  ERP report drilldown handles, such as `profit_and_loss:acct_sales`. They are
  generated from report names, account buckets, reconciliation buckets, or rollup
  bucket ids and do not carry OAuth/session material.
- The `page_token` `CursorKind` enum value is a cursor-kind label only. It is
  not an Intuit credential field and does not authorize provider access.
- Docs may refer to compact query tokens for large drilldown sets. Those are
  local canonical-query handles resolved through ERP Financials/Future ERP access
  controls, not QuickBooks provider tokens.
