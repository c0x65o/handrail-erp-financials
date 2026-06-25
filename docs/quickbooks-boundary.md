# QuickBooks Boundary

QuickBooks is the first import provider, but this package should stay
provider-neutral.

## Existing QuickBooks Repos

The current QuickBooks work is split across:

- `handrail-quickbooks-integrations`: integration service and QuickBooks Node SDK.
- `hitcents-future-erp`: first ERP consumer and proving ground.
- `handrail-erp-financials`: reusable financial reporting kernel.

## QuickBooks Integration Owns

The QuickBooks integration service and SDK should own:

- OAuth
- client credentials
- token custody
- token refresh
- realm id mapping
- QuickBooks API calls
- webhooks
- CDC and delta sync
- raw imports
- normalized QuickBooks resource endpoints
- provider report calls
- provider reconciliation helpers
- SDK and CLI utilities

ERP apps and this package should not store Intuit access tokens or refresh
tokens.

## ERP Financials Owns

This package should own:

- provider-neutral canonical accounting facts
- schema and migration manifests for host apps
- adapter contracts for ingesting normalized provider data
- report read models
- rollup and snapshot writers
- freshness/cursor model for reporting
- deterministic financial report fixtures
- AI-safe report API shapes

## Future ERP Owns

The first ERP app should own:

- tenant workflows
- user-facing reporting screens
- tenant permissions
- tenant configuration
- app-specific AI tool registration
- ERP-specific domain logic
- calls into the QuickBooks SDK/service
- calls into this financial package

## Data Flow

```text
QuickBooks API
  -> QuickBooks integration service
  -> QuickBooks SDK typed responses
  -> QuickBooks source adapter in ERP app or this package
  -> canonical accounting facts
  -> rollups and snapshots
  -> Future ERP dashboards and AI tools
```

The implementation handoff for QuickBooks workers, Future ERP workers, and
canonical storage workers is defined in
[storage-host-app-handoff.md](storage-host-app-handoff.md). That document is
the shared contract for source identity, safe source refs, storage write order,
and post-import rollup/snapshot/freshness work.

## Provider Reports

QuickBooks provider reports are useful, but they should not be the only report
path.

Provider reports can be used for:

- initial validation
- reconciliation
- parity fixtures
- source-of-truth comparison
- fast bootstrap before local rollups are warm

Canonical ERP reports should be generated from canonical facts and rollups where
possible. This keeps the reporting model reusable for native ERP data and
non-QuickBooks providers.

## Identity Mapping

The adapter must preserve source identity for idempotency and drilldown.

Recommended identity fields:

- tenant id
- company id
- provider environment
- realm id
- source object kind
- source object id
- source update timestamp
- import batch id
- checkpoint id
- source payload ref

QuickBooks `parentAccountRef` may be resolved by source adapters into canonical
`Account.parentAccountId`, but that is the boundary. Report builders, hierarchy
rollup helpers, snapshot/read-model code, validators, and drilldown helpers must
not infer hierarchy from QuickBooks names, `FullyQualifiedName`, account
numbers, categories, `sourceAccountId`, OAuth state, or raw provider payloads.
The provider-neutral hierarchy and nested report row contract is defined in
[account-hierarchy-rules.md](account-hierarchy-rules.md).

## Public Normalized Contracts

`@handrail/erp-financials` exports normalized QuickBooks resource contracts for
the SDK/service boundary. `NormalizedQuickBooksResourceSet` covers CompanyInfo,
accounts, ledger transactions, ledger postings, parties/customers/vendors,
items, classes, departments, provider report refs, import batch metadata, sync
checkpoint metadata, and bounded reconciliation evidence.

Those contracts are safe handoff shapes. They carry realm id, provider
environment, source update timestamps, safe source refs, sync mode, import batch
ids, and checkpoint ids, but they must not carry Intuit credentials, provider
clients, or raw unbounded provider response bodies.

The same module exports normalized sync envelopes for worker and SDK responses:
`NormalizedQuickBooksFullSyncRequestEnvelope`,
`NormalizedQuickBooksIncrementalSyncResponseEnvelope`,
`NormalizedQuickBooksBackfillSyncRequestEnvelope`,
`NormalizedQuickBooksReprocessSyncRequestEnvelope`,
`NormalizedQuickBooksPaginationRequestEnvelope`,
`NormalizedQuickBooksPaginationResponseEnvelope`, and
`NormalizedQuickBooksCheckpointResumeRequestEnvelope`. These envelopes make sync
mode, import batch id, checkpoint id, cursor kind/value, freshness timestamps,
resource counts, warning/error summaries, and idempotency keys explicit without
exposing provider credentials or raw QuickBooks payloads.

## Runtime Contract

Host apps should consume the existing Handrail QuickBooks capability and SDK
env contract for provider access. This package should not invent new QuickBooks
credentials. QuickBooks OAuth, refresh tokens, access tokens, client secrets,
token refresh, and raw provider import custody stay inside the Handrail
QuickBooks integration service.

Expected app behavior:

- read QuickBooks service config through the SDK/runtime contract
- call SDK/service methods for full sync, incremental sync, and provider report
  parity
- map `NormalizedQuickBooksResourceSet` or
  `NormalizedQuickBooksSyncResourceSet` into canonical facts through the ERP
  Financials adapter contract:
  `HandrailQuickBooksSdkResourcesAdapterInput` and
  `mapHandrailQuickBooksSdkResourcesToCanonicalFacts`
- store only safe source refs and accounting facts locally
- use provider reports for reconciliation, not as a long-term app schema

For implementation details, including checkpoint semantics, safe drilldown
refs, provider report reconciliation helpers, the Future ERP adoption path, and
validation commands such as `npm run contract:smoke`, see
[storage-host-app-handoff.md](storage-host-app-handoff.md).
