# Source record disposition contract

ERP Financials v0.3.43 consumes the optional per-record disposition evidence
carried by Handrail QuickBooks Integrations v0.1.102 and
`@handrail/quickbooks-node-sdk` v0.1.32. The SDK boundary converts the upstream
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
uncompacted reconciliation first and reconstructs every disposition warning
from the authoritative provider-neutral evidence. When those individual
warnings fit, it retains their complete identity and safe payload reference.
For a larger batch it stores one deterministic SHA-256 commitment over every
disposition, reason, composite source identity, and safe storage reference;
the separate `recordDispositions` contract remains the drilldown evidence.
Canonical mapping recomputes and verifies that commitment before persistence,
so compaction cannot silently separate or alter disposition provenance.

This release does not change schema migrations, credentials, connection mode,
runtime targets, or provider synchronization behavior.
