import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  buildBalanceSheetReport,
  buildCashFlowReport,
  buildProfitAndLossReport,
  buildTrialBalanceReport
} from "../src/index.js";

import type { Account, BuiltReport, LedgerPosting } from "../src/index.js";

const fixture = ERP_FINANCIALS_STATEMENT_FIXTURE;

const reportRequest = {
  ...fixture.reportRequest,
  sourceId: fixture.source.sourceId,
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

describe("deterministic fixture/reference report builders from canonical postings", () => {
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

  it("builds generic P&L sections for refunds, other income, other expense, and nested accounts", () => {
    const accounts = [
      ...fixture.accounts,
      accountLike("acct_interest_income", "7010", "Interest Income", "other_income"),
      accountLike("acct_tax_penalty", "8010", "Tax Penalty", "other_expense"),
      accountLike("acct_software", "6110", "Software Subscriptions", "expense", "acct_expense")
    ];
    const postings = [
      ...fixture.postings,
      postingLike("post_refund_sales", "acct_sales", "200.00", "0.00"),
      postingLike("post_refund_cash", "acct_cash", "0.00", "200.00"),
      postingLike("post_interest_cash", "acct_cash", "500.00", "0.00"),
      postingLike("post_interest_income", "acct_interest_income", "0.00", "500.00"),
      postingLike("post_tax_penalty", "acct_tax_penalty", "80.00", "0.00"),
      postingLike("post_tax_penalty_cash", "acct_cash", "0.00", "80.00"),
      postingLike("post_software", "acct_software", "50.00", "0.00"),
      postingLike("post_software_cash", "acct_cash", "0.00", "50.00")
    ];

    const report = buildProfitAndLossReport({ ...reportRequest, accounts, postings });

    expectTotals(report, {
      total_income: "19800.00",
      total_cost_of_goods_sold: "3000.00",
      gross_profit: "16800.00",
      total_expenses: "3250.00",
      net_operating_income: "13550.00",
      total_other_income: "500.00",
      total_other_expense: "80.00",
      net_income: "13970.00"
    });
    expect(report.lines.map((line) => [line.section, line.label, line.amount])).toEqual(
      expect.arrayContaining([
        ["income", "4000 Product Revenue", "19800.00"],
        ["expense", "6110 Software Subscriptions", "50.00"],
        ["other_income", "7010 Interest Income", "500.00"],
        ["other_expense", "8010 Tax Penalty", "80.00"]
      ])
    );
  });

  it("rejects incomplete normalized report input instead of silently dropping postings", () => {
    expect(() =>
      buildProfitAndLossReport({
        ...reportRequest,
        postings: fixture.postings.map((posting) =>
          posting.postingId === "post_cash_sale_revenue" ? { ...posting, accountId: "acct_missing" } : posting
        )
      })
    ).toThrow(/references missing account acct_missing/);

    expect(() =>
      buildProfitAndLossReport({
        ...reportRequest,
        postings: fixture.postings.map((posting) =>
          posting.postingId === "post_cash_sale_revenue" ? { ...posting, netAmount: "999.00" } : posting
        )
      })
    ).toThrow(/inconsistent netAmount/);

    expect(() =>
      buildProfitAndLossReport({
        ...reportRequest,
        postings: fixture.postings.map((posting) =>
          posting.postingId === "post_cash_sale_revenue"
            ? {
                ...posting,
                sourcePayloadRef: {
                  sourceObjectType: "FixtureLine",
                  sourceObjectId: "post_cash_sale_revenue",
                  preview: { accessToken: "not-allowed" }
                }
              }
            : posting
        )
      })
    ).toThrow(/credential-like field/);
  });

  it("keeps source-scoped report builders from mixing same-tenant postings across sources", () => {
    const otherSourcePosting = {
      ...postingLike("post_other_source_revenue", "acct_sales", "0.00", "999.00"),
      sourceId: "source_other_fixture"
    };
    const report = buildProfitAndLossReport({
      ...reportRequest,
      postings: [...fixture.postings, otherSourcePosting]
    });

    expectTotals(report, fixture.expectedTotals.profitAndLoss);
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

function decimalDifference(debitAmount: string, creditAmount: string): string {
  const amountMinor = parseCurrencyMinor(debitAmount) - parseCurrencyMinor(creditAmount);
  const sign = amountMinor < 0n ? "-" : "";
  const absolute = amountMinor < 0n ? -amountMinor : amountMinor;
  return `${sign}${(absolute / 100n).toString()}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

function parseCurrencyMinor(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (match === null || match[1] === undefined) {
    throw new Error(`invalid test currency value ${value}`);
  }
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}
