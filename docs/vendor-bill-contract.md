# Vendor bill public contract

Version `0.3.1` adds the Bills and Bill detail contract to both public package
entry points. No private ERP Financials table access is required.

## Read surface

Use `sdk.queries` (or `createFinancialReadModels(...)`) for:

- `listVendorBills({ limit, cursor, status, asOfDate, vendorId })`
- `getVendorBill(billId, asOfDate?)`
- `getVendorBillSummary({ asOfDate, periodStart?, periodEnd?, vendorId? })`

The detail result identifies the canonical bill and posting source, returns the
vendor and commercial header, and includes immutable lines and bill-payment
applications. The summary returns as-of balances plus cumulative and selected-period
payment KPIs; the period defaults to the month containing `asOfDate`. Each line reports its canonical account, source account key,
optional reporting-book mapping, and item expense-category provenance.

## Correction surface

New native bills remain posted by `sdk.commands.vendorBills.create(...)`.
Posted facts are never edited or deleted. Correct an unapplied bill with:

- `sdk.commands.vendorBills.voidIssued(...)`
- `sdk.commands.vendorBills.replaceIssued(...)`

The equivalent `voidPosted(...)` and `replacePosted(...)` aliases are retained
for hosts that describe this lifecycle in posting terminology.

Both commands require an independently approved operation context, an
idempotency key, and the current `expectedVersion`. A bill with any active
application must be unapplied first. Replacement preserves the original vendor
and currency and records linked reversal/replacement journals.

## Consumer upgrade and recheck

This repository publishes durable package releases as Git tags. Install the
tagged release directly from the canonical repository:

```bash
npm install --save 'git+https://github.com/c0x65o/handrail-sdk-erp-financials-js.git#v0.3.1'
npm ls @handrail/erp-financials
npx tsc --noEmit
```

For a local pre-release recheck against this workspace:

```bash
npm install --save-exact /opt/handrail/repos/handrail/erp-financials/handrail-sdk-erp-financials-js
npm ls @handrail/erp-financials
npx tsc --noEmit
```

The `npm ls` result must resolve `@handrail/erp-financials@0.3.1`. Recheck the
Bills register against `sdk.queries.listVendorBills(...)`, and Bill detail
against `sdk.queries.getVendorBill(...)`; do not retain fallback queries over
ERP Financials private tables.
