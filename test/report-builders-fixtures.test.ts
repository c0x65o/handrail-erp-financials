import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  buildBalanceSheetReport,
  buildCashFlowReport,
  buildProfitAndLossReport,
  buildTrialBalanceReport
} from "../src/index.js";

import type { BuiltReport } from "../src/index.js";

const fixture = ERP_FINANCIALS_STATEMENT_FIXTURE;

const reportRequest = {
  ...fixture.reportRequest,
  accounts: fixture.accounts,
  postings: fixture.postings,
  freshness: {
    status: "fresh" as const,
    sourceId: fixture.source.sourceId,
    importBatchId: fixture.importBatch.importBatchId,
    checkpointId: fixture.checkpoint.checkpointId,
    freshThrough: "2026-02-01T00:00:00.000Z"
  }
};

describe("deterministic report builders from canonical fixture postings", () => {
  it("builds profit and loss totals with material drilldown evidence", () => {
    const report = buildProfitAndLossReport(reportRequest);

    expectTotals(report, fixture.expectedTotals.profitAndLoss);
    expect(report.snapshot.reportName).toBe("profit_and_loss");
    expect(report.snapshot.snapshotSource).toBe("builder");
    expect(report.metadata.generatedFrom).toBe("ledger_postings");
    expect(report.lines.map((line) => [line.label, line.amount])).toEqual([
      ["4000 Product Revenue", "20000.00"],
      ["5000 Cost of Goods Sold", "3000.00"],
      ["6100 Operating Expense", "3200.00"]
    ]);
    expectEveryMaterialOutputHasDrilldown(report);
  });

  it("builds a balanced balance sheet and includes current period earnings", () => {
    const report = buildBalanceSheetReport(reportRequest);

    expectTotals(report, fixture.expectedTotals.balanceSheet);
    expect(report.snapshot.reconciliationStatus).toBe("balanced");
    expect(report.snapshot.reconciliationDifference).toBe("0.00");
    expect(report.lines.find((line) => line.label === "Current Period Earnings")?.amount).toBe("13800.00");
    expectEveryMaterialOutputHasDrilldown(report);
  });

  it("builds a balanced trial balance from debit and credit postings", () => {
    const report = buildTrialBalanceReport(reportRequest);

    expectTotals(report, fixture.expectedTotals.trialBalance);
    expect(report.snapshot.reconciliationStatus).toBe("balanced");
    expect(report.snapshot.reconciliationDifference).toBe("0.00");
    expect(report.lines.find((line) => line.label === "1000 Operating Cash")?.amount).toBe("53700.00");
    expect(report.lines.find((line) => line.label === "4000 Product Revenue")?.amount).toBe("-20000.00");
    expectEveryMaterialOutputHasDrilldown(report);
  });

  it("builds cash flow with partial support when movement cannot be classified", () => {
    const report = buildCashFlowReport({
      ...reportRequest,
      cashAccountIds: fixture.cashFlow.cashAccountIds,
      activityByAccountId: fixture.cashFlow.activityByAccountId
    });

    expectTotals(report, fixture.expectedTotals.cashFlow);
    expect(report.metadata.cashFlow?.supportStatus).toBe("partial");
    expect(report.metadata.cashFlow?.unsupportedReasons).toEqual(["cash_flow_has_unclassified_cash_movement"]);
    expect(report.metadata.cashFlow?.unclassifiedCashMovementPostingIds).toEqual(["post_unclassified_cash"]);
    expectEveryMaterialOutputHasDrilldown(report);
  });

  it("keeps fixture coverage broad enough for source-neutral reporting tests", () => {
    expect(fixture.accounts.map((account) => account.classification)).toEqual(
      expect.arrayContaining(["asset", "liability", "equity", "income", "cost_of_goods_sold", "expense"])
    );
    expect(fixture.parties.map((party) => party.partyType)).toEqual(
      expect.arrayContaining(["customer", "vendor", "employee", "other"])
    );
    expect(fixture.items.map((item) => item.itemType)).toEqual(expect.arrayContaining(["product", "service", "inventory"]));
    expect(fixture.dimensions.map((dimension) => dimension.dimensionKind)).toEqual(
      expect.arrayContaining(["location", "department"])
    );
    expect(new Set(fixture.postings.map((posting) => posting.dimensionHash)).size).toBeGreaterThan(1);
  });
});

function expectTotals(report: BuiltReport, expectedTotals: Readonly<Record<string, string>>): void {
  const actual = Object.fromEntries(report.totals.map((total) => [total.totalKey, total.amount]));
  expect(actual).toMatchObject(expectedTotals);
}

function expectEveryMaterialOutputHasDrilldown(report: BuiltReport): void {
  for (const line of report.lines.filter((entry) => entry.amount !== "0.00")) {
    expect(line.drilldownRef.token).toContain(report.snapshot.reportName);
    expect(line.drilldownRef.accountIds?.length).toBeGreaterThan(0);
    expect(line.drilldownRef.postingIds?.length).toBeGreaterThan(0);
  }

  for (const total of report.totals.filter((entry) => entry.amount !== "0.00")) {
    expect(total.drilldownRef.token).toContain(report.snapshot.reportName);
    expect(total.drilldownRef.accountIds?.length).toBeGreaterThan(0);
    expect(total.drilldownRef.postingIds?.length).toBeGreaterThan(0);
  }
}
