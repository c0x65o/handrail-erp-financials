# Rollups and Snapshots

ERP reporting cannot query all raw transactions for every dashboard load once a
tenant has years of history. This package should make durable aggregates and
snapshots a default part of the design.

## Read Path

Normal dashboard and AI reads should query:

1. report snapshots for expensive complete statements
2. rollup buckets for time-series and filtered summaries
3. ledger postings only for narrow drilldown and reconciliation windows
4. source/raw provider objects only through explicit drilldown or integration
   tooling

## Rollup Buckets

Rollup buckets aggregate ledger postings by fixed periods and bounded
dimensions.

Recommended bucket levels:

- day
- month
- fiscal period
- fiscal quarter
- fiscal year

Recommended key fields:

- `tenant_id`
- `company_id`
- `accounting_basis`
- `bucket_start`
- `bucket_end`
- `bucket_grain`
- `account_id`
- `account_classification`
- `dimension_hash`
- `currency_code`

Recommended aggregate fields:

- `debit_amount`
- `credit_amount`
- `net_amount`
- `transaction_count`
- `posting_count`
- `first_posting_date`
- `last_posting_date`
- `latest_source_updated_at`

Dimension fields should be bounded and hash-addressed. Do not store arbitrary
large dimension JSON in hot rollup rows.

## Report Snapshots

Report snapshots persist the answer to expensive report requests. They should be
used for:

- profit and loss
- balance sheet
- cash flow
- trial balance
- A/R aging
- A/P aging
- budget versus actual
- management packet reports
- period close evidence

Snapshots should include:

- report name
- period or as-of date
- accounting basis
- currency
- generation time
- freshness evidence
- line rows
- named totals
- drilldown refs
- reconciliation status

Snapshots can be generated from canonical facts, rollup buckets, or provider
report responses. The `snapshot_source` must make that explicit.

## Freshness

Each source and report path should have durable freshness rows.

Freshness should track:

- latest observed source update
- latest imported source update
- latest posting date processed
- fresh-through report boundary
- pending source rows
- failed source rows
- malformed or skipped rows
- last rollup job id
- last snapshot job id
- stale flag and stale reason

Dashboard reads should be able to say whether a report is current without
reading job logs.

## Late Arrivals and Backdated Changes

Accounting data changes historically. Examples:

- a vendor bill is edited after close
- a payment is linked to an old invoice
- an account classification changes
- a QuickBooks CDC event arrives late
- a native ERP transaction is corrected

The rollup writer must support overlap reprocessing. Reruns should upsert
deterministic bucket rows instead of adding duplicate aggregates.

Recommended behavior:

- Process recent windows frequently.
- Reprocess a wider overlap window on a slower cadence.
- Mark affected snapshots stale when postings change inside their period.
- Regenerate stale snapshots asynchronously.
- Keep enough provenance to explain why a report changed.

## Drilldown

Every report line and named total should carry drilldown evidence.

Drilldown refs should be able to resolve to:

- account ids
- transaction ids
- transaction line ids
- posting ids
- party ids
- item ids
- dimension ids
- import batch ids
- checkpoint ids
- source payload refs

Large drilldown sets should be represented by a query token or compact filter
definition rather than embedding thousands of ids in a report row.

## Cash Flow

Cash flow is the report most likely to need explicit evidence and support
status.

The package should distinguish:

- provider-supplied cash flow snapshots
- ERP-derived cash flow from cash account ledger movement
- unsupported or partial cash flow when source data cannot classify movement

Cash flow outputs should include:

- cash account ids used
- derivation method
- unsupported reasons
- unclassified cash movement refs
- operating, investing, and financing totals
- cash at beginning and end of period

## Query Strategy

Use rollups for:

- long date ranges
- trend charts
- dashboard cards
- common filters
- recurring AI questions

Use snapshots for:

- statement reports
- closed periods
- expensive report layouts
- provider reconciliation comparisons

Use postings for:

- transaction drilldown
- narrow date ranges
- reconciliation repair
- ad hoc investigation

Avoid direct raw source queries for normal reporting.
