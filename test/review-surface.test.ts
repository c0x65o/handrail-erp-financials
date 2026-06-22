import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("code review surface", () => {
  it("keeps reporting scalability and freshness contracts visible in the PR checklist", () => {
    const template = readFileSync(new URL("../.github/PULL_REQUEST_TEMPLATE.md", import.meta.url), "utf8");

    expect(template).toContain("buildStandardReportPresentationFromReadModel");
    expect(template).toMatch(/snapshots, rollups, or indexed SQL aggregates/i);
    expect(template).toMatch(/multi-column report presentation/i);
    expect(template).toMatch(/does not load raw ledger postings into Node/i);
    expect(template).toMatch(/scan in-memory facts for normal app traffic/i);
    expect(template).toMatch(/fixtures, reference formulas, bounded drilldown/i);
    expect(template).toMatch(/snapshot refresh\/rebuild, smoke tests, or audited repair workflows/i);
    expect(template).toMatch(/source freshness boundary/i);
    expect(template).toMatch(/snapshot\/report freshness rows/i);
    expect(template).toMatch(/fresh.*partial.*stale.*unknown/i);
    expect(template).toMatch(/stale-marker behavior/i);
    expect(template).toMatch(/bounded evidence/i);
    expect(template).toMatch(/raw provider payloads, credentials, unbounded drilldown refs/i);
    expect(template).toMatch(/copied customer ledger dumps/i);
  });
});

