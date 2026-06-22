## Summary

- 

## Validation

- [ ] Targeted tests or checks are listed below, or this change is documentation-only.

## Reporting scalability and freshness review

Complete these checks when a PR changes standard reports, report presentation,
rollups, snapshots, read models, drilldown, or reporting evidence.

- [ ] Production standard-report presentation paths use `buildStandardReportPresentationFromReadModel` backed by snapshots, rollups, or indexed SQL aggregates by default.
- [ ] New multi-column report presentation work does not load raw ledger postings into Node or scan in-memory facts for normal app traffic.
- [ ] Raw posting and in-memory helpers are limited to fixtures, reference formulas, bounded drilldown, snapshot refresh/rebuild, smoke tests, or audited repair workflows.
- [ ] Freshness contracts were reviewed for changed reports, rollups, snapshots, or read models, including the source freshness boundary, snapshot/report freshness rows, `fresh`/`partial`/`stale`/`unknown` states, stale-marker behavior, and bounded evidence.
- [ ] Review evidence avoids raw provider payloads, credentials, unbounded drilldown refs, and copied customer ledger dumps.

