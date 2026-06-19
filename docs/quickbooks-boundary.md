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

## Runtime Contract

Host apps should consume the existing Handrail QuickBooks capability and SDK
env contract for provider access. This package should not invent new QuickBooks
credentials.

Expected app behavior:

- read QuickBooks service config through the SDK/runtime contract
- call SDK methods for provider data
- map SDK output into canonical facts
- store only safe source refs and accounting facts locally
- use provider reports for reconciliation, not as a long-term app schema
