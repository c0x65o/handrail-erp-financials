import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  buildProfitAndLossReport,
  checkErpFinancialsFreshnessAndDrilldownHealth,
  createCompactDrilldownRef,
  createSnapshotRefreshContract
} from "../src/index.js";

import type { BuiltReport, DrilldownRef, ReportFreshnessRow } from "../src/index.js";

const PROVIDER_CREDENTIAL_OR_RAW_PAYLOAD_KEY_PATTERN =
  /access[_-]?token|refresh[_-]?token|client[_-]?secret|clientSecret|secret|password|rawPayload|rawProviderPayload|raw_provider_payload|raw_payload|credential/i;

const fixture = ERP_FINANCIALS_STATEMENT_FIXTURE;

describe("ERP Financials freshness and drilldown health", () => {
  it("returns healthy deterministic fixture freshness and drilldown checks by default", () => {
    const first = checkErpFinancialsFreshnessAndDrilldownHealth();
    const second = checkErpFinancialsFreshnessAndDrilldownHealth();

    expect(first).toMatchObject({
      status: "healthy",
      fixtureName: "ERP_FINANCIALS_STATEMENT_FIXTURE",
      tenantId: "tenant_fixture",
      sourceId: "source_native_fixture",
      accountingBasis: "accrual",
      currencyCode: "USD",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      checks: [
        { name: "freshness_rows", status: "pass", issueCount: 0 },
        { name: "drilldown_refs", status: "pass", issueCount: 0 }
      ],
      freshness: {
        expectedRows: 4,
        presentRows: 4,
        missingRows: [],
        checkedReportNames: ["balance_sheet", "cash_flow", "profit_and_loss", "trial_balance"]
      },
      issues: []
    });
    expect(first.summaryHash).toBe(second.summaryHash);
    expect(first.drilldown.reportsChecked).toBe(4);
    expect(first.drilldown.refsChecked).toBe(first.drilldown.lineRefsChecked + first.drilldown.totalRefsChecked);
    expect(first.drilldown.sampleRefs.length).toBeGreaterThan(0);
    expect(first.drilldown.sampleRefs.every((sample) => sample.resolution === "canonical_query")).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(PROVIDER_CREDENTIAL_OR_RAW_PAYLOAD_KEY_PATTERN);
  });

  it("returns actionable degraded status when a configured freshness row is missing", () => {
    const health = checkErpFinancialsFreshnessAndDrilldownHealth({
      freshnessRows: fixtureFreshnessRows().filter((row) => row.reportName !== "cash_flow")
    });

    expect(health.status).toBe("degraded");
    expect(health.checks).toContainEqual({ name: "freshness_rows", status: "fail", issueCount: 1 });
    expect(health.freshness).toMatchObject({
      expectedRows: 4,
      presentRows: 3,
      missingRows: [
        {
          tenantId: "tenant_fixture",
          companyId: "company_fixture",
          sourceId: "source_native_fixture",
          reportName: "cash_flow",
          accountingBasis: "accrual",
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
          currencyCode: "USD"
        }
      ]
    });
    expect(health.issues).toContainEqual({
      kind: "missing_freshness_row",
      reportName: "cash_flow",
      combination: {
        tenantId: "tenant_fixture",
        companyId: "company_fixture",
        sourceId: "source_native_fixture",
        reportName: "cash_flow",
        accountingBasis: "accrual",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        currencyCode: "USD"
      },
      message: "missing freshness row for cash_flow accrual 2026-01-01..2026-01-31 USD"
    });
    expect(JSON.stringify(health)).not.toMatch(PROVIDER_CREDENTIAL_OR_RAW_PAYLOAD_KEY_PATTERN);
  });

  it("accepts compact large drilldown sets without echoing posting identifiers", () => {
    const report = reportWithFirstTotalDrilldown(largeDrilldownRef());

    const health = checkErpFinancialsFreshnessAndDrilldownHealth({
      reports: [report],
      sampleLimit: 20
    });

    expect(health.status).toBe("healthy");
    expect(health.drilldown.compactedPostingRefCount).toBe(1);
    expect(health.drilldown.maxInlinePostingIds).toBeLessThanOrEqual(100);
    expect(health.drilldown.sampleRefs).toContainEqual(
      expect.objectContaining({
        refKind: "total",
        refToken: "profit_and_loss:large_total",
        postingCount: 101,
        inlinePostingCount: 0,
        resolution: "canonical_query"
      })
    );
    expect(JSON.stringify(health)).not.toContain("posting_101");
    expect(JSON.stringify(health)).not.toMatch(PROVIDER_CREDENTIAL_OR_RAW_PAYLOAD_KEY_PATTERN);
  });

  it("degrades when drilldown refs are oversized, unscoped, or not resolvable", () => {
    const health = checkErpFinancialsFreshnessAndDrilldownHealth({
      reports: [reportWithFirstTotalDrilldown(unboundedUnscopedDrilldownRef())]
    });

    expect(health.status).toBe("degraded");
    expect(health.checks).toContainEqual({
      name: "drilldown_refs",
      status: "fail",
      issueCount: 3
    });
    expect(health.issues.map((issue) => issue.kind)).toEqual(
      expect.arrayContaining(["unbounded_drilldown_ref", "unscoped_drilldown_ref", "unresolvable_drilldown_ref"])
    );
    expect(JSON.stringify(health)).not.toMatch(PROVIDER_CREDENTIAL_OR_RAW_PAYLOAD_KEY_PATTERN);
  });
});

function reportWithFirstTotalDrilldown(drilldownRef: DrilldownRef): BuiltReport {
  const report = buildProfitAndLossReport({
    ...fixture.reportRequest,
    accounts: fixture.accounts,
    postings: fixture.postings,
    sourceId: fixture.source.sourceId
  });
  const firstTotal = report.totals[0];

  if (firstTotal === undefined) {
    throw new Error("profit and loss fixture should produce totals");
  }

  return {
    ...report,
    totals: [
      {
        ...firstTotal,
        drilldownRef
      },
      ...report.totals.slice(1)
    ]
  };
}

function largeDrilldownRef(): DrilldownRef {
  return createCompactDrilldownRef({
    token: "profit_and_loss:large_total",
    postingIds: postingIds(101),
    accountIds: ["acct_sales"],
    query: {
      kind: "ledger_postings",
      tenantId: fixture.reportRequest.tenantId,
      sourceId: fixture.source.sourceId,
      accountingBasis: fixture.reportRequest.accountingBasis,
      periodStart: fixture.reportRequest.periodStart,
      periodEnd: fixture.reportRequest.periodEnd,
      accountIds: ["acct_sales"]
    }
  });
}

function unboundedUnscopedDrilldownRef(): DrilldownRef {
  return {
    token: `profit_and_loss:bad_total:${"x".repeat(5000)}`,
    query: {
      kind: "ledger_postings",
      tenantId: "other_tenant",
      sourceId: "other_source",
      accountingBasis: fixture.reportRequest.accountingBasis,
      periodStart: fixture.reportRequest.periodStart,
      periodEnd: fixture.reportRequest.periodEnd
    }
  };
}

function fixtureFreshnessRows(): readonly ReportFreshnessRow[] {
  return (["profit_and_loss", "balance_sheet", "trial_balance", "cash_flow"] as const).map((reportName) =>
    createSnapshotRefreshContract({
      tenantId: fixture.reportRequest.tenantId,
      companyId: fixture.company.companyId,
      sourceId: fixture.source.sourceId,
      reportName,
      accountingBasis: fixture.reportRequest.accountingBasis,
      periodStart: fixture.reportRequest.periodStart,
      periodEnd: fixture.reportRequest.periodEnd,
      asOfDate: fixture.reportRequest.asOfDate,
      currencyCode: fixture.reportRequest.currencyCode,
      generatedAt: fixture.reportRequest.generatedAt,
      ...(fixture.checkpoint.freshThrough === undefined ? {} : { freshThrough: fixture.checkpoint.freshThrough }),
      importBatchId: fixture.importBatch.importBatchId,
      checkpointId: fixture.checkpoint.checkpointId
    }).freshnessRow
  );
}

function postingIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `posting_${(index + 1).toString().padStart(3, "0")}`);
}
