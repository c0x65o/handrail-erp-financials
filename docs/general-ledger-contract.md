# General ledger and reporting-book account contract

The package owns the General ledger list, matching summary, provenance, and
chart-account mutation rules. Host routes must pass the same
`GeneralLedgerFilters` object to `listGeneralLedger` and
`getGeneralLedgerSummary`; they must not calculate cards from a page of rows.

```ts
const filters = {
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  accountKey: "service_revenue",
  sourceId: "native_erp",
  transactionType: "Subledger:invoice",
  classId: "managed_services",
  dimensionKind: "department",
  dimensionId: "security_operations",
  polarity: "credit",
  search: "INV-1001"
} as const;

const [page, summary] = await Promise.all([
  sdk.queries.listGeneralLedger({ ...filters, limit: 50 }),
  sdk.queries.getGeneralLedgerSummary(filters)
]);
```

Dates are strict ISO calendar dates. Limits are integers from 1 through 200.
Search is literal, case-insensitive, and limited to 100 characters. Other
filter values are limited to 200 characters. Generic dimension kind and id
must be supplied together. Class matching accepts either the canonical
`dimensionId` or provider `sourceDimensionId`. A page cursor is scoped to the
book and the normalized filter set, so changing any filter invalidates it.

Each row reports both transaction and posting dates, transaction type, at most
20 canonical dimension references with an omitted count, and bounded source
provenance (source role/system/environment, source transaction/posting ids,
and compact source-object identity when present). Provider payload previews,
storage references, credentials, and raw provider data are never returned.

## Reporting-book account mutations

Every account explicitly declares `accountRole: "header" | "posting"` and
uses optimistic concurrency. Create with `expectedVersion: 0`; use the returned
positive `version` for updates. Retrying the identical operation request and
payload returns the existing version. Reusing that request id with different
input is an idempotency conflict, while a stale version is an
`optimistic_concurrency_conflict`.

```ts
const created = await sdk.books.defineAccount({
  operation,
  bookId: "primary",
  bookAccountKey: "service_revenue",
  accountNumber: "4010",
  name: "Service revenue",
  classification: "income",
  accountRole: "posting",
  parentBookAccountKey: "income",
  expectedVersion: 0
});

await sdk.books.defineAccount({
  ...sameFields,
  operation: nextOperation,
  name: "Consulting revenue",
  expectedVersion: created.version
});
```

Schema version 16 enforces unique non-null account numbers per
tenant/company/book. Parents must be active headers; source mappings may target
only active posting accounts. Accounts with children cannot become posting or
inactive, mapped accounts cannot become header or inactive, and `accountType`
cannot change while children or mappings depend on it. These rules are checked
inside the account/mapping transaction and by database triggers.

## Release and Spartan recheck

The queued Handrail worker leaves versioning, commit, tag, and publication to
the post-agent release flow. Once that flow publishes a tag newer than the
currently released package, update Spartan Cyber ERP v2 from its repository:

```sh
npm install --save 'git+https://github.com/c0x65o/handrail-sdk-erp-financials-js.git#<published-release-tag>'
npm ls @handrail/erp-financials
```

Confirm both `package.json` and `package-lock.json` resolve the new release
commit rather than `b8546a28c2f22be8ae84c6fb10607134b7213528`. Then run the
Spartan focused financial contract/type checks and retry the General ledger
source node. The unblock proof is: schema version 16 is migrated, the public
`GeneralLedgerFilters`/provenance types import successfully, filtered list and
summary totals match, and reporting-book account create/update calls supply
`accountRole` plus `expectedVersion`.
