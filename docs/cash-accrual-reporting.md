# Cash and accrual reporting

`@handrail/erp-financials` owns report-time cash/accrual switching. Host apps
only select `accountingMethod`; they must not convert invoices, payments, or
statement totals themselves.

## Query contract

`accountingMethod` is optional on financial statements, the dashboard, General
Ledger pages, and General Ledger summaries. Omission uses the reporting book's
configured `accountingBasis`, preserving existing consumers.

```ts
const profitAndLoss = await sdk.queries.getFinancialStatement({
  reportName: "profit_and_loss",
  periodStart: "2026-01-01",
  periodEnd: "2026-12-31",
  accountingMethod: "cash"
});

const detail = await sdk.queries.listGeneralLedger({
  ...profitAndLoss.lines[0]!.drilldown!,
  limit: 100
});
```

Every returned statement, dashboard summary, ledger summary, ledger line, and
statement drilldown carries or locks the effective basis. Cursor fingerprints
also include the method, so a cash cursor cannot be replayed against accrual.

## Native dual-basis facts

The SDK stores immutable postings for each basis; it never rewrites an accrual
journal while rendering a cash report.

| Native event | Accrual facts | Cash facts |
| --- | --- | --- |
| Invoice/vendor bill | Obligation and revenue/expense on document date | No recognition until applied cash |
| Customer/bill payment | Cash and A/R or A/P clearing | Same clearing journal |
| Partial application | Existing accrual facts remain unchanged | Proportional invoice/bill lines on application date, using largest-remainder cents allocation |
| Credit/vendor credit/write-off application | Reduces the accrual obligation | No cash recognition; it reduces the unpaid amount that can later be recognized |
| Refund related to an invoice | Refund journal on accrual | Cash movement plus proportional reversal of the invoice recognition |
| Unapply/void | Immutable lifecycle/reversal facts | Equal-and-opposite projection on the effective date |
| Deposit/transfer/sales receipt/purchase | Basis-neutral cash movement | Mirrored basis-neutral movement |

Dimensions, party/item references, accounts, currency, and safe provider
provenance are retained by projections. Cross-period applications and reversals
use their own effective date; prior-period postings are not mutated.

Manual journals cannot be converted safely. `accountingPolicy` therefore
defaults to `configured_basis_only`. A caller may use
`mirror_cash_and_accrual` only when the journal is genuinely basis-neutral or
the caller has supplied an accountant-approved entry that is valid on both
bases. Lifecycle reversals preserve that explicit policy.

## Rollups, snapshots, and freshness

Accounting basis is part of rollup identities, snapshot identities, freshness
rows, invalidation filters, and compact drilldown queries. A posting or
projection invalidates only overlapping snapshots on its own basis and
currency. The production read model builds profit and loss, balance sheet, and
trial balance directly from basis-filtered canonical postings; snapshots are a
performance path, not the only supported P&L implementation. The aggregate-first
`buildStandardReportPresentationFromReadModel` path also reads persisted cash or
accrual P&L, balance-sheet, and trial-balance snapshots; hosts do not need a
statement-specific fallback. Dimension-grouped columns currently use rollups
for P&L, while other statement dimensions fail explicitly until a matching
aggregate read model exists.

## Historical QuickBooks backfill

Use `createQuickBooksDualBasisBackfillWorker`. Its provider boundary requests
the QuickBooks detailed General Ledger twice—once for accrual and once for
cash—and requires bounded, balanced posting rows. The worker maps account
source IDs, preserves optional dimensions, produces deterministic canonical
transactions/postings and two backfill batches, then calls one atomic
`replaceDualBasisRange` operation. Use
`createPostgresQuickBooksDualBasisBackfillPersistence(database)` to own the
database transaction across deletion and replacement of both bases. A
`createPostgresStorageAdapter(transactionClient)` also implements the operation
when the caller is already inside a transaction. Both delete only SDK-owned
`QuickBooksGeneralLedger:*` facts in the exact source/date/basis range.

Provider statement totals are deliberately ignored during materialization.
They may be retained separately as reconciliation evidence, but they are never
canonical ledger truth. An unavailable account mapping, out-of-range row,
currency mismatch, unbalanced transaction, oversized response, or failure of
either basis aborts the complete replacement.

For the normalized operational-document import, a balanced provider General
Ledger remains authoritative when QuickBooks omits a commercial line
`AccountRef` and no item-account fallback exists. The SDK retains that journal
and the document header, omits only the unaccounted commercial line, and reports
it through `skippedDocumentLines`; it never invents an account. Missing or
unbalanced canonical journal evidence remains a blocking projection failure.

The provider implementation must supply detailed `ledgerRows` from the
`general_ledger` report response already exposed by
`handrail-service-quickbooks`; the host only adapts that response to
`QuickBooksBackfillReportResponse`. It must not pass OAuth credentials or raw
report bodies into this package.

No schema migration is required: canonical posting uniqueness already includes
`accounting_basis`, and rollup/snapshot tables already key and filter by basis.
