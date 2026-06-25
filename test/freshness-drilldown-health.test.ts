import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  buildProfitAndLossReport,
  checkErpFinancialsFreshnessAndDrilldownHealth,
  createCompactDrilldownRef,
  createSnapshotRefreshContract
} from "../src/index.js";

import type { Account, BuiltReport, DrilldownRef, LedgerPosting, ReportFreshnessRow } from "../src/index.js";

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

  it("treats nested account hierarchy line drilldown refs as healthy when compact and source scoped", () => {
    const report = nestedProfitAndLossReport();
    const parent = requiredLine(report, "acct_health_income_parent");
    const child = requiredLine(report, "acct_health_income_child");
    const grandchild = requiredLine(report, "acct_health_income_grandchild");

    expect(parent.parentReportLineId).toBeUndefined();
    expect(child.parentReportLineId).toBe(parent.reportLineId);
    expect(grandchild.parentReportLineId).toBe(child.reportLineId);
    expect(parent.drilldownRef.accountIds).toEqual([
      "acct_health_income_child",
      "acct_health_income_grandchild",
      "acct_health_income_parent",
      "acct_health_income_sibling"
    ]);
    expect(parent.drilldownRef.query?.accountIds).toEqual(parent.drilldownRef.accountIds);
    expect(parent.drilldownRef.postingIds).toEqual([
      "post_health_income_child",
      "post_health_income_grandchild",
      "post_health_income_parent",
      "post_health_income_sibling"
    ]);
    expect(child.drilldownRef.accountIds).toEqual(["acct_health_income_child", "acct_health_income_grandchild"]);
    expect(child.drilldownRef.query?.accountIds).toEqual(child.drilldownRef.accountIds);
    expect(child.drilldownRef.postingIds).toEqual(["post_health_income_child", "post_health_income_grandchild"]);
    expect(child.drilldownRef.accountIds).not.toContain("acct_health_income_sibling");
    expect(child.drilldownRef.postingIds).not.toContain("post_health_income_sibling");
    expect(grandchild.drilldownRef.accountIds).toEqual(["acct_health_income_grandchild"]);
    expect(grandchild.drilldownRef.query?.accountIds).toEqual(grandchild.drilldownRef.accountIds);
    expect(grandchild.drilldownRef.postingIds).toEqual(["post_health_income_grandchild"]);

    for (const line of [parent, child, grandchild]) {
      expect(line.drilldownRef.query).toMatchObject({
        tenantId: fixture.reportRequest.tenantId,
        sourceId: fixture.source.sourceId,
        accountingBasis: fixture.reportRequest.accountingBasis,
        periodStart: fixture.reportRequest.periodStart,
        periodEnd: fixture.reportRequest.periodEnd
      });
    }

    const health = checkErpFinancialsFreshnessAndDrilldownHealth({
      reports: [report],
      sampleLimit: 20
    });

    expect(health.status).toBe("healthy");
    expect(health.checks).toContainEqual({ name: "drilldown_refs", status: "pass", issueCount: 0 });
    expect(health.drilldown.reportsChecked).toBe(1);
    expect(health.drilldown.lineRefsChecked).toBe(report.lines.length);
    expect(health.drilldown.maxSerializedBytes).toBeLessThanOrEqual(4096);
    expect(health.drilldown.maxInlinePostingIds).toBeLessThanOrEqual(100);
    expect(health.drilldown.maxInlineSourceRefs).toBeLessThanOrEqual(25);
    expect(health.drilldown.sampleRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          refKind: "line",
          refId: parent.reportLineId,
          refToken: parent.drilldownRef.token,
          postingCount: 4,
          inlinePostingCount: 4,
          resolution: "canonical_query"
        }),
        expect.objectContaining({
          refKind: "line",
          refId: child.reportLineId,
          refToken: child.drilldownRef.token,
          postingCount: 2,
          inlinePostingCount: 2,
          resolution: "canonical_query"
        }),
        expect.objectContaining({
          refKind: "line",
          refId: grandchild.reportLineId,
          refToken: grandchild.drilldownRef.token,
          postingCount: 1,
          inlinePostingCount: 1,
          resolution: "canonical_query"
        })
      ])
    );
    expect(JSON.stringify(health)).not.toContain("post_health_income_parent");
    expect(JSON.stringify(health)).not.toContain("post_health_income_sibling");
    expect(JSON.stringify(health)).not.toMatch(PROVIDER_CREDENTIAL_OR_RAW_PAYLOAD_KEY_PATTERN);
  });

  it("degrades when a nested line drilldown ref is unbounded, unscoped, and not resolvable", () => {
    const report = reportWithNestedLineDrilldown(
      "acct_health_income_child",
      unboundedUnscopedNestedLineDrilldownRef()
    );

    const health = checkErpFinancialsFreshnessAndDrilldownHealth({
      reports: [report]
    });

    expect(health.status).toBe("degraded");
    expect(health.checks).toContainEqual({
      name: "drilldown_refs",
      status: "fail",
      issueCount: 3
    });
    expect(health.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "unbounded_drilldown_ref",
          refKind: "line",
          refId: "profit_and_loss:line:account:acct_health_income_child"
        }),
        expect.objectContaining({
          kind: "unscoped_drilldown_ref",
          refKind: "line",
          refId: "profit_and_loss:line:account:acct_health_income_child"
        }),
        expect.objectContaining({
          kind: "unresolvable_drilldown_ref",
          refKind: "line",
          refId: "profit_and_loss:line:account:acct_health_income_child"
        })
      ])
    );
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

function nestedProfitAndLossReport(): BuiltReport {
  return buildProfitAndLossReport({
    ...fixture.reportRequest,
    sourceId: fixture.source.sourceId,
    accounts: [
      accountLike("acct_health_income_parent", "4100", "Health Revenue", "income"),
      accountLike("acct_health_income_child", "4110", "Health Revenue Child", "income", "acct_health_income_parent"),
      accountLike(
        "acct_health_income_grandchild",
        "4111",
        "Health Revenue Grandchild",
        "income",
        "acct_health_income_child"
      ),
      accountLike("acct_health_income_sibling", "4120", "Health Revenue Sibling", "income", "acct_health_income_parent")
    ],
    postings: [
      postingLike("post_health_income_parent", "acct_health_income_parent", "0.00", "100.00"),
      postingLike("post_health_income_child", "acct_health_income_child", "0.00", "200.00"),
      postingLike("post_health_income_grandchild", "acct_health_income_grandchild", "0.00", "300.00"),
      postingLike("post_health_income_sibling", "acct_health_income_sibling", "0.00", "400.00")
    ]
  });
}

function reportWithNestedLineDrilldown(accountId: string, drilldownRef: DrilldownRef): BuiltReport {
  const report = nestedProfitAndLossReport();

  return {
    ...report,
    lines: report.lines.map((line) => (line.accountId === accountId ? { ...line, drilldownRef } : line))
  };
}

function requiredLine(report: BuiltReport, accountId: string) {
  const line = report.lines.find((candidate) => candidate.accountId === accountId);

  if (line === undefined) {
    throw new Error(`nested health report should produce account line ${accountId}`);
  }

  return line;
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

function unboundedUnscopedNestedLineDrilldownRef(): DrilldownRef {
  return {
    token: `profit_and_loss:bad_nested_line:${"x".repeat(5000)}`,
    query: {
      kind: "ledger_postings",
      tenantId: "other_tenant",
      sourceId: "other_source",
      accountingBasis: fixture.reportRequest.accountingBasis,
      periodStart: fixture.reportRequest.periodStart,
      periodEnd: fixture.reportRequest.periodEnd,
      accountIds: ["acct_health_income_child", "acct_health_income_sibling"]
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

function accountLike(
  accountId: string,
  accountNumber: string,
  name: string,
  classification: Account["classification"],
  parentAccountId?: string
): Account {
  const baseAccount = fixture.accounts[0];
  if (baseAccount === undefined) {
    throw new Error("fixture must include an account");
  }

  return {
    ...baseAccount,
    accountId,
    sourceAccountId: accountId.replace("acct_", ""),
    accountNumber,
    name,
    type: classification,
    subtype: classification,
    classification,
    ...(parentAccountId === undefined ? {} : { parentAccountId })
  };
}

function postingLike(postingId: string, accountId: string, debitAmount: string, creditAmount: string): LedgerPosting {
  const basePosting = fixture.postings[0];
  if (basePosting === undefined) {
    throw new Error("fixture must include a posting");
  }

  return {
    ...basePosting,
    postingId,
    sourcePostingId: postingId.replace("post_", ""),
    transactionId: `txn_${postingId.replace("post_", "")}`,
    transactionLineId: `line_${postingId.replace("post_", "")}`,
    accountId,
    postingDate: "2026-01-22",
    debitAmount,
    creditAmount,
    netAmount: decimalDifference(debitAmount, creditAmount)
  };
}

function decimalDifference(left: string, right: string): string {
  return (Number(left) - Number(right)).toFixed(2);
}
