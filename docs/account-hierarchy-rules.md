# Account Hierarchy Rules

This document is the normative, provider-neutral contract for account
hierarchies in ERP Financials. It applies to every source adapter, report
builder, rollup job, snapshot writer, read-model mapper, drilldown surface, and
validation helper that works with canonical `Account` records.

Provider-specific fields such as QuickBooks parent account refs, native ERP
parent fields, fully qualified account names, display labels, account numbers,
or provider-specific account categories may help a source adapter populate
canonical data. They must not be used by report builders or validation helpers
to infer hierarchy after canonical `Account` records have been created.

## Hierarchy Identity

- `Account.parentAccountId` points to canonical `Account.accountId`.
- `parentAccountId` never points to a provider id such as `sourceAccountId`.
- A parent account link is valid only when the parent account exists in the
  loaded canonical account set and has the same `tenantId` and `sourceId` as the
  child account.
- Cross-tenant and cross-source parent links are invalid hierarchy input before
  report generation, even when the provider `sourceAccountId`, provider display
  name, account number, or other source metadata appears to match.
- Account ids are the only hierarchy edge identity that report builders,
  rollups, snapshots, read models, and drilldown helpers may consume.

Hierarchy links are source-scoped. A tenant may report across multiple sources
at higher orchestration layers, but a canonical account parent edge is valid
only inside the child's tenant/source account set.

## Parent Postings

- Postings directly booked to a parent account are allowed.
- A parent account rollup total includes the parent account's own direct
  postings plus every descendant account posting exactly once.
- A child account line is limited to its own subtree. It must not inherit
  sibling postings, sibling drilldown evidence, or unrelated ancestor evidence
  beyond what is needed to explain its own subtree amount.
- Drilldown refs for parent lines may include the parent account id and all
  descendant account ids needed to explain the parent rollup. Drilldown refs for
  child lines must remain scoped to that child subtree.

## Descendant Totals

- Hierarchy depth is source-neutral. No rule may assume a provider-specific
  maximum depth or infer depth from provider labels, fully qualified names,
  account numbers, or categories.
- Rollup traversal must visit all descendants reachable from each parent through
  canonical `parentAccountId` links.
- Each posting is aggregated once for the posting account's own line and once
  for each valid ancestor path. Because each account has at most one canonical
  parent, a valid hierarchy forms trees within a tenant/source account set.
- Traversal and output must be deterministic. Later builder work should preserve
  stable account line ids and stable ordering for the same canonical account
  set, including when hierarchy depth changes or zero-amount parent visibility
  changes.
- A parent line total must not double count a posting because the posting is
  visible through both a parent direct-posting line and a child line. The parent
  rollup amount is calculated from direct postings plus descendant postings, not
  by summing already-rendered visible rows unless that summation has the same
  no-duplication guarantee.

## Nested Report Line Output

Nested account rollups are emitted as ordinary `ReportSnapshotLine` rows with
hierarchy metadata, not as provider-specific tree objects. Each account line
must carry:

- stable `reportLineId`
- optional `parentReportLineId`
- `section`
- `label`
- `accountId`
- `amount`
- deterministic `sortOrder`
- bounded `drilldownRef`

`reportLineId` stability is based on the report/account identity so comparison
periods, snapshot refreshes, read models, and presentation rows can align the
same account even when a sibling account is absent in one period.

Rows are ordered for presentation as a pre-order hierarchy traversal: parent
account rows precede their visible children. `sortOrder` is the durable ordering
hint inside a report snapshot; consumers must not recover hierarchy by parsing
labels, indentation, account numbers, or provider names.

Standard report presentations project snapshot lines into
`StandardReportPresentationRow` values. Hierarchy-participating line rows expose
a stable `rowId`, optional `parentRowId`, optional `hierarchyDepth`, `section`,
and `cells`. `hierarchyDepth` is presentation metadata derived from
`parentReportLineId`; it is not a hierarchy authority. Flat rows that are not in
a parent/child relationship may omit `hierarchyDepth`.

Total rows remain separate `ReportSnapshotTotal` / presentation `kind: "total"`
rows. Totals do not receive `parentRowId`, do not become children of the last
account row in a section, and remain independent of hierarchy depth.

## Inactive Accounts And Parents

- `Account.active` is a visibility hint, not a hierarchy edge breaker.
- Inactive accounts remain available for historical reporting when they have
  in-period postings, as-of balances, or visible descendants.
- Inactive parent accounts continue to roll up active and inactive descendants.
  Inactive status must not re-root children, suppress descendant amounts, or
  break drilldown/account evidence for historical reports.
- Inactive zero-amount accounts may be suppressed from a presentation when they
  have no in-period/as-of postings and no visible descendants.
- An inactive zero-amount parent must remain visible when it is needed as the
  visible ancestor for active, material, or otherwise visible descendants.

## Cash Flow Hierarchy Semantics

- Cash flow `cashAccountIds` are canonical account ids. A configured id may be
  a leaf cash account or a parent cash account.
- Before calculating beginning cash, period cash postings, net cash flow, and
  ending cash, report builders must expand configured cash account ids to every
  descendant reachable through validated canonical `Account.parentAccountId`
  links in the same tenant/source scope.
- Cash-to-cash transfers between a configured cash account and any descendant
  cash account are internal cash movement. Those descendant cash accounts must
  be excluded from non-cash offset classification the same way directly
  configured cash accounts are excluded.
- An empty configured `cashAccountIds` list remains unsupported. Cash movement
  whose transaction offsets cannot be classified remains partial and must keep
  reporting unclassified cash posting ids.
- `activityByAccountId` keys are canonical account ids. An exact account mapping
  classifies postings booked to that account. If no exact mapping exists, the
  nearest mapped canonical ancestor classifies postings booked to descendants.
  If no exact or ancestor mapping exists, the offset is unclassified.
- Cash flow activity matching must not infer classification from QuickBooks
  fully qualified names, provider account categories, account numbers, labels,
  or any source-specific hierarchy representation.

## Invalid Hierarchy Input

Hierarchy validation must run before report generation for any report builder,
rollup job, snapshot refresh, or read-model path that consumes nested account
relationships. Invalid hierarchy input must be rejected instead of silently
repairing, re-rooting, or dropping edges in report builders.

Validation diagnostics should use a structured shape that is stable enough for
tests and operators to identify the bad edge:

```ts
type AccountHierarchyDiagnostic = {
  readonly code:
    | "account_parent_orphan"
    | "account_parent_cross_scope"
    | "account_parent_cycle";
  readonly severity: "error";
  readonly tenantId: string;
  readonly sourceId: string;
  readonly accountId: string;
  readonly parentAccountId?: string;
  readonly cycleAccountIds?: readonly string[];
  readonly message: string;
};
```

Validation may add fields, but it must preserve the outcome and enough account
ids to diagnose the bad hierarchy.

### Orphan Parent References

- A `parentAccountId` that does not resolve to an account in the loaded
  same-tenant, same-source canonical account set is invalid.
- Report builders must not silently re-root orphaned children as top-level
  accounts.
- The diagnostic must identify the child `accountId`, the unresolved
  `parentAccountId`, `tenantId`, and `sourceId`.

### Cycles

- Self-parenting is invalid.
- Multi-account cycles are invalid.
- Cycles must be rejected before report generation.
- The diagnostic must include enough canonical account ids to diagnose the
  cycle chain. Prefer returning the repeated chain in `cycleAccountIds` when the
  validator can produce it deterministically.

### Cross-Source Or Cross-Tenant Parent References

- A parent link crossing `sourceId` or `tenantId` boundaries is invalid.
- Cross-scope links remain invalid even when the provider `sourceAccountId`,
  provider display name, account number, or fully qualified name appears to
  match.
- The diagnostic must identify the child `accountId`, referenced
  `parentAccountId`, child `tenantId`, and child `sourceId`. When the referenced
  parent is present but belongs to a different scope, validation should also
  include the parent scope when available.

## Provider Mapping Boundary

- QuickBooks `parentAccountRef`, native ERP parent fields, and future provider
  parent fields may map into canonical `Account.parentAccountId` in source
  adapter work.
- Mapping work must resolve provider parent references to canonical
  `Account.accountId` values before report generation.
- Report builders, rollup helpers, snapshot/read-model code, drilldown helpers,
  and hierarchy validators must operate only on canonical `Account` records and
  canonical ids.
- QuickBooks names, `FullyQualifiedName`, account numbers, categories,
  `sourceAccountId`, OAuth state, raw provider payloads, and other
  provider-owned metadata are not hierarchy authority after canonical mapping.

## Drilldown Semantics

Hierarchy drilldowns explain the same subtree as the visible line amount.

- Parent account line drilldowns include the parent account id plus visible
  descendant account ids that contribute to the parent subtree.
- Parent line evidence may include bounded posting ids, bounded safe source
  refs, and a compact canonical query for the subtree. It must not include raw
  provider payloads or credential-bearing provider state.
- Child account line drilldowns remain scoped to the child subtree. They must
  not inherit sibling account ids, sibling posting ids, or sibling source
  evidence merely because the sibling shares the same parent.
- Totals and reconciliation drilldowns may merge bounded canonical refs or
  compact canonical queries from multiple lines, but they must not serialize raw
  provider payloads.
- Drilldown handlers may resolve safe refs through canonical storage or the
  provider integration service with tenant permission checks. The durable report
  output remains provider-neutral and credential-free.
