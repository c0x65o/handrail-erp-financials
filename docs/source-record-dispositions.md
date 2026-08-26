# Source record disposition contract

ERP Financials v0.3.40 consumes the optional per-record disposition evidence
carried by Handrail QuickBooks Integrations v0.1.100 and
`@handrail/quickbooks-node-sdk` v0.1.31. The SDK boundary converts the upstream
field names into this provider-neutral record:

```ts
type SourceRecordDisposition = {
  disposition: "skipped" | "voided";
  reason: string;
  sourceRecordType: string;
  sourceRecordId: string;
  sourcePayloadRef: SafeSourcePayloadRef;
};
```

The disposition list is optional for compatibility with older producers. When
present and non-empty, the root envelope and nested sync job must contain the
same list. Every record must have a canonical zero-effect reason, a unique
source identity, a bounded `raw://` provenance reference consistent with its
import batch and identity, and well-formed batch counters. ERP preserves the
producer's resource and delta counts rather than reclassifying them.

A disposition can bypass canonical financial projection only when it matches
exactly one normalized transaction header with an explicit zero amount and no
normalized line-item or posting records. Nonzero, linked, posted, unmatched,
duplicated, malformed, unknown, or contradictory records fail before full- or
incremental-sync persistence begins. Records without a disposition continue
through the existing validation and persistence paths unchanged.

Accepted dispositions remain visible as import-batch warnings and bounded Core
ERP persistence evidence. The evidence retains disposition, reason, source
record type/id, safe payload provenance, import-batch/checkpoint accounting,
and drilldown source references. Replaying the same envelope preserves the
same idempotency keys, canonical identities, warnings, and evidence.

Consumers that must fit the warning summary inside the canonical 4 KiB JSON
boundary use `compactSourceRecordDispositionWarningSummary`. It validates the
uncompacted reconciliation first, reconstructs every disposition warning from
the authoritative provider-neutral evidence with its complete identity and
safe payload reference, and only then retains other warnings as space permits.
If the disposition evidence itself cannot fit, compaction fails closed instead
of silently separating a disposition from its provenance.

This release does not change schema migrations, credentials, connection mode,
runtime targets, or provider synchronization behavior.
