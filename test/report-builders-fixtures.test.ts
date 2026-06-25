import { describe, expect, it } from "vitest";

import {
  AccountHierarchyValidationError,
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  buildBalanceSheetReport,
  buildCashFlowReport,
  buildProfitAndLossReport,
  buildTrialBalanceReport,
  validateAccountHierarchy
} from "../src/index.js";

import type { Account, BuiltReport, LedgerPosting, ReportBuilderInput } from "../src/index.js";

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
      ["6100 Operating Expense", "3200.00"],
      ["6110 Facilities Expense", "1200.00"],
      ["6111 Utilities Expense", "1200.00"]
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

  it("rolls up nested balance sheet accounts without double-counting visible child rows", () => {
    const accounts = [
      accountLike("acct_nested_asset_parent", "1000", "Nested Assets", "asset"),
      accountLike("acct_nested_asset_child", "1100", "Nested Asset Child", "asset", "acct_nested_asset_parent"),
      accountLike("acct_nested_asset_grandchild", "1110", "Nested Asset Grandchild", "asset", "acct_nested_asset_child"),
      accountLike("acct_nested_liability_parent", "2000", "Nested Liabilities", "liability"),
      accountLike(
        "acct_nested_liability_child",
        "2100",
        "Nested Liability Child",
        "liability",
        "acct_nested_liability_parent"
      ),
      accountLike("acct_nested_equity_parent", "3000", "Nested Equity", "equity"),
      accountLike("acct_nested_equity_child", "3100", "Nested Equity Child", "equity", "acct_nested_equity_parent"),
      accountLike("acct_nested_income", "4000", "Nested Income", "income")
    ];
    const postings = [
      postingLike("post_nested_asset_parent", "acct_nested_asset_parent", "100.00", "0.00"),
      postingLike("post_nested_asset_child", "acct_nested_asset_child", "200.00", "0.00"),
      postingLike("post_nested_asset_grandchild", "acct_nested_asset_grandchild", "300.00", "0.00"),
      postingLike("post_nested_liability_parent", "acct_nested_liability_parent", "0.00", "70.00"),
      postingLike("post_nested_liability_child", "acct_nested_liability_child", "0.00", "80.00"),
      postingLike("post_nested_equity_parent", "acct_nested_equity_parent", "0.00", "100.00"),
      postingLike("post_nested_equity_child", "acct_nested_equity_child", "0.00", "200.00"),
      postingLike("post_nested_current_earnings", "acct_nested_income", "0.00", "150.00")
    ];

    const report = buildBalanceSheetReport({ ...reportRequest, accounts, postings });

    expectTotals(report, {
      total_assets: "600.00",
      total_liabilities: "150.00",
      total_equity: "450.00",
      total_liabilities_and_equity: "600.00"
    });
    expect(report.snapshot.reconciliationStatus).toBe("balanced");
    expect(report.snapshot.reconciliationDifference).toBe("0.00");
    expect(lineAmountSum(report, "asset")).toBe("1400.00");
    expect(lineAmountSum(report, "liability")).toBe("230.00");
    expect(lineAmountSum(report, "equity")).toBe("650.00");

    const assetParent = requiredLine(report, "acct_nested_asset_parent");
    const assetChild = requiredLine(report, "acct_nested_asset_child");
    const assetGrandchild = requiredLine(report, "acct_nested_asset_grandchild");
    const liabilityParent = requiredLine(report, "acct_nested_liability_parent");
    const liabilityChild = requiredLine(report, "acct_nested_liability_child");
    const equityParent = requiredLine(report, "acct_nested_equity_parent");
    const equityChild = requiredLine(report, "acct_nested_equity_child");
    const currentEarningsLine = report.lines.find((line) => line.label === "Current Period Earnings");

    expect(assetParent.reportLineId).toBe("balance_sheet:line:account:acct_nested_asset_parent");
    expect(assetParent.amount).toBe("600.00");
    expect(assetChild.parentReportLineId).toBe(assetParent.reportLineId);
    expect(assetChild.amount).toBe("500.00");
    expect(assetGrandchild.parentReportLineId).toBe(assetChild.reportLineId);
    expect(assetGrandchild.amount).toBe("300.00");
    expect(assetParent.drilldownRef.accountIds).toEqual([
      "acct_nested_asset_child",
      "acct_nested_asset_grandchild",
      "acct_nested_asset_parent"
    ]);
    expect(assetParent.drilldownRef.postingIds).toEqual([
      "post_nested_asset_child",
      "post_nested_asset_grandchild",
      "post_nested_asset_parent"
    ]);
    expect(assetChild.drilldownRef.accountIds).toEqual(["acct_nested_asset_child", "acct_nested_asset_grandchild"]);
    expect(assetChild.drilldownRef.postingIds).toEqual(["post_nested_asset_child", "post_nested_asset_grandchild"]);
    expect(assetGrandchild.drilldownRef.accountIds).toEqual(["acct_nested_asset_grandchild"]);
    expect(assetGrandchild.drilldownRef.postingIds).toEqual(["post_nested_asset_grandchild"]);

    expect(liabilityParent.amount).toBe("150.00");
    expect(liabilityChild.parentReportLineId).toBe(liabilityParent.reportLineId);
    expect(liabilityChild.amount).toBe("80.00");
    expect(equityParent.amount).toBe("300.00");
    expect(equityChild.parentReportLineId).toBe(equityParent.reportLineId);
    expect(equityChild.amount).toBe("200.00");

    expect(currentEarningsLine?.amount).toBe("150.00");
    expect(currentEarningsLine?.drilldownRef.accountIds).toEqual(["acct_nested_income"]);
    expect(currentEarningsLine?.drilldownRef.postingIds).toEqual(["post_nested_current_earnings"]);
    expect(report.totals.find((total) => total.totalKey === "total_equity")?.drilldownRef.accountIds).toEqual([
      "acct_nested_equity_child",
      "acct_nested_equity_parent",
      "acct_nested_income"
    ]);
    expect(report.totals.find((total) => total.totalKey === "total_liabilities_and_equity")?.drilldownRef.postingIds).toEqual([
      "post_nested_current_earnings",
      "post_nested_equity_child",
      "post_nested_equity_parent",
      "post_nested_liability_child",
      "post_nested_liability_parent"
    ]);
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

  it("rolls up nested trial balance accounts without double-counting hierarchy lines", () => {
    const accounts = [
      accountLike("acct_tb_asset_parent", "1000", "Trial Balance Assets", "asset"),
      accountLike("acct_tb_asset_child", "1100", "Trial Balance Asset Child", "asset", "acct_tb_asset_parent"),
      accountLike("acct_tb_asset_grandchild", "1110", "Trial Balance Asset Grandchild", "asset", "acct_tb_asset_child"),
      accountLike("acct_tb_liability_parent", "2000", "Trial Balance Liabilities", "liability"),
      accountLike(
        "acct_tb_liability_child",
        "2100",
        "Trial Balance Liability Child",
        "liability",
        "acct_tb_liability_parent"
      ),
      accountLike(
        "acct_tb_liability_grandchild",
        "2110",
        "Trial Balance Liability Grandchild",
        "liability",
        "acct_tb_liability_child"
      )
    ];
    const postings = [
      postingLike("post_tb_asset_parent", "acct_tb_asset_parent", "100.00", "0.00"),
      postingLike("post_tb_asset_grandchild", "acct_tb_asset_grandchild", "200.00", "0.00"),
      postingLike("post_tb_liability_parent", "acct_tb_liability_parent", "0.00", "120.00"),
      postingLike("post_tb_liability_grandchild", "acct_tb_liability_grandchild", "0.00", "180.00")
    ];

    const report = buildTrialBalanceReport({ ...reportRequest, accounts, postings });

    expectTotals(report, {
      total_debits: "300.00",
      total_credits: "300.00"
    });
    expect(report.snapshot.reconciliationStatus).toBe("balanced");
    expect(report.snapshot.reconciliationDifference).toBe("0.00");
    expect(lineAmountSum(report, "debit")).toBe("700.00");
    expect(lineAmountSum(report, "credit")).toBe("-660.00");

    const assetParent = requiredLine(report, "acct_tb_asset_parent");
    const assetChild = requiredLine(report, "acct_tb_asset_child");
    const assetGrandchild = requiredLine(report, "acct_tb_asset_grandchild");
    const liabilityParent = requiredLine(report, "acct_tb_liability_parent");
    const liabilityChild = requiredLine(report, "acct_tb_liability_child");
    const liabilityGrandchild = requiredLine(report, "acct_tb_liability_grandchild");

    expect(assetParent.reportLineId).toBe("trial_balance:line:account:acct_tb_asset_parent");
    expect(assetParent.section).toBe("debit");
    expect(assetParent.amount).toBe("300.00");
    expect(assetParent.parentReportLineId).toBeUndefined();
    expect(assetParent.drilldownRef.accountIds).toEqual([
      "acct_tb_asset_child",
      "acct_tb_asset_grandchild",
      "acct_tb_asset_parent"
    ]);
    expect(assetParent.drilldownRef.postingIds).toEqual(["post_tb_asset_grandchild", "post_tb_asset_parent"]);

    expect(assetChild.parentReportLineId).toBe(assetParent.reportLineId);
    expect(assetChild.section).toBe("debit");
    expect(assetChild.amount).toBe("200.00");
    expect(assetChild.drilldownRef.accountIds).toEqual(["acct_tb_asset_child", "acct_tb_asset_grandchild"]);
    expect(assetChild.drilldownRef.postingIds).toEqual(["post_tb_asset_grandchild"]);

    expect(assetGrandchild.parentReportLineId).toBe(assetChild.reportLineId);
    expect(assetGrandchild.section).toBe("debit");
    expect(assetGrandchild.amount).toBe("200.00");
    expect(assetGrandchild.drilldownRef.accountIds).toEqual(["acct_tb_asset_grandchild"]);
    expect(assetGrandchild.drilldownRef.postingIds).toEqual(["post_tb_asset_grandchild"]);

    expect(liabilityParent.section).toBe("credit");
    expect(liabilityParent.amount).toBe("-300.00");
    expect(liabilityParent.drilldownRef.accountIds).toEqual([
      "acct_tb_liability_child",
      "acct_tb_liability_grandchild",
      "acct_tb_liability_parent"
    ]);
    expect(liabilityParent.drilldownRef.postingIds).toEqual([
      "post_tb_liability_grandchild",
      "post_tb_liability_parent"
    ]);

    expect(liabilityChild.parentReportLineId).toBe(liabilityParent.reportLineId);
    expect(liabilityChild.section).toBe("credit");
    expect(liabilityChild.amount).toBe("-180.00");
    expect(liabilityChild.drilldownRef.accountIds).toEqual([
      "acct_tb_liability_child",
      "acct_tb_liability_grandchild"
    ]);
    expect(liabilityChild.drilldownRef.postingIds).toEqual(["post_tb_liability_grandchild"]);

    expect(liabilityGrandchild.parentReportLineId).toBe(liabilityChild.reportLineId);
    expect(liabilityGrandchild.section).toBe("credit");
    expect(liabilityGrandchild.amount).toBe("-180.00");
    expect(liabilityGrandchild.drilldownRef.accountIds).toEqual(["acct_tb_liability_grandchild"]);
    expect(liabilityGrandchild.drilldownRef.postingIds).toEqual(["post_tb_liability_grandchild"]);
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

  it("includes descendant cash accounts when a cashAccountId points to a parent account", () => {
    const accounts = [
      accountLike("acct_cf_cash_parent", "1000", "Cash Parent", "asset"),
      accountLike("acct_cf_cash_child", "1010", "Cash Child", "asset", "acct_cf_cash_parent"),
      accountLike("acct_cf_revenue", "4000", "Cash Flow Revenue", "income")
    ];
    const beginningCash = { ...postingLike("post_cf_beginning_child_cash", "acct_cf_cash_child", "100.00", "0.00"), postingDate: "2025-12-31" };
    const cashReceipt = {
      ...postingLike("post_cf_child_cash_receipt", "acct_cf_cash_child", "50.00", "0.00"),
      transactionId: "txn_cf_child_cash_receipt"
    };
    const revenue = {
      ...postingLike("post_cf_child_cash_revenue", "acct_cf_revenue", "0.00", "50.00"),
      transactionId: "txn_cf_child_cash_receipt"
    };

    const report = buildCashFlowReport({
      ...reportRequest,
      accounts,
      postings: [beginningCash, cashReceipt, revenue],
      cashAccountIds: ["acct_cf_cash_parent"],
      activityByAccountId: {
        acct_cf_revenue: "operating"
      }
    });

    expectTotals(report, {
      cash_beginning: "100.00",
      net_operating_cash: "50.00",
      net_cash_flow: "50.00",
      cash_ending: "150.00"
    });
    expect(report.lines.find((line) => line.section === "operating")?.drilldownRef.accountIds).toEqual([
      "acct_cf_cash_child"
    ]);
    expect(report.totals.find((total) => total.totalKey === "cash_beginning")?.drilldownRef.accountIds).toEqual([
      "acct_cf_cash_child",
      "acct_cf_cash_parent"
    ]);
    expect(report.metadata.cashFlow?.supportStatus).toBe("supported");
    expect(report.metadata.cashFlow?.cashAccountIds).toEqual(["acct_cf_cash_parent"]);
  });

  it("excludes descendant cash accounts from cash-flow offset classification", () => {
    const accounts = [
      accountLike("acct_cf_transfer_parent_cash", "1000", "Transfer Cash Parent", "asset"),
      accountLike("acct_cf_transfer_child_cash", "1010", "Transfer Cash Child", "asset", "acct_cf_transfer_parent_cash")
    ];
    const parentCashOut = {
      ...postingLike("post_cf_transfer_parent_cash", "acct_cf_transfer_parent_cash", "0.00", "25.00"),
      transactionId: "txn_cf_cash_transfer"
    };
    const childCashIn = {
      ...postingLike("post_cf_transfer_child_cash", "acct_cf_transfer_child_cash", "25.00", "0.00"),
      transactionId: "txn_cf_cash_transfer"
    };

    const report = buildCashFlowReport({
      ...reportRequest,
      accounts,
      postings: [parentCashOut, childCashIn],
      cashAccountIds: ["acct_cf_transfer_parent_cash"],
      activityByAccountId: {
        acct_cf_transfer_child_cash: "operating"
      }
    });

    expect(report.lines.find((line) => line.section === "operating")).toBeUndefined();
    expectTotals(report, {
      net_operating_cash: "0.00",
      net_cash_flow: "0.00",
      cash_ending: "0.00"
    });
    expect(report.metadata.cashFlow?.supportStatus).toBe("supported");
  });

  it("uses the nearest mapped activity ancestor for descendant cash-flow offsets", () => {
    const accounts = [
      accountLike("acct_cf_cash", "1000", "Cash", "asset"),
      accountLike("acct_cf_expense_parent", "6100", "Expense Parent", "expense"),
      accountLike("acct_cf_expense_child", "6110", "Expense Child", "expense", "acct_cf_expense_parent")
    ];
    const cashPayment = {
      ...postingLike("post_cf_ancestor_activity_cash", "acct_cf_cash", "0.00", "40.00"),
      transactionId: "txn_cf_ancestor_activity"
    };
    const expense = {
      ...postingLike("post_cf_ancestor_activity_expense", "acct_cf_expense_child", "40.00", "0.00"),
      transactionId: "txn_cf_ancestor_activity"
    };

    const report = buildCashFlowReport({
      ...reportRequest,
      accounts,
      postings: [cashPayment, expense],
      cashAccountIds: ["acct_cf_cash"],
      activityByAccountId: {
        acct_cf_expense_parent: "operating"
      }
    });

    expectTotals(report, {
      net_operating_cash: "-40.00",
      unclassified_cash_movement: "0.00",
      net_cash_flow: "-40.00"
    });
    expect(report.lines.map((line) => [line.section, line.amount])).toEqual([["operating", "-40.00"]]);
    expect(report.metadata.cashFlow?.supportStatus).toBe("supported");
    expect(report.metadata.cashFlow?.unclassifiedCashMovementPostingIds).toEqual([]);
  });

  it("lets an exact activity mapping override an ancestor activity mapping", () => {
    const accounts = [
      accountLike("acct_cf_override_cash", "1000", "Override Cash", "asset"),
      accountLike("acct_cf_override_parent", "1500", "Investing Parent", "asset"),
      accountLike("acct_cf_override_child", "1510", "Operating Child", "asset", "acct_cf_override_parent")
    ];
    const cashPayment = {
      ...postingLike("post_cf_override_cash", "acct_cf_override_cash", "0.00", "60.00"),
      transactionId: "txn_cf_activity_override"
    };
    const offset = {
      ...postingLike("post_cf_override_offset", "acct_cf_override_child", "60.00", "0.00"),
      transactionId: "txn_cf_activity_override"
    };

    const report = buildCashFlowReport({
      ...reportRequest,
      accounts,
      postings: [cashPayment, offset],
      cashAccountIds: ["acct_cf_override_cash"],
      activityByAccountId: {
        acct_cf_override_parent: "investing",
        acct_cf_override_child: "operating"
      }
    });

    expectTotals(report, {
      net_operating_cash: "-60.00",
      net_investing_cash: "0.00",
      net_cash_flow: "-60.00"
    });
    expect(report.lines.map((line) => [line.section, line.amount])).toEqual([["operating", "-60.00"]]);
    expect(report.metadata.cashFlow?.supportStatus).toBe("supported");
  });

  it("rejects invalid hierarchy before expanding cash-flow account descendants", () => {
    expect(() =>
      buildCashFlowReport({
        ...reportRequest,
        accounts: [
          accountLike("acct_cf_invalid_cash_parent", "1000", "Invalid Cash Parent", "asset", "acct_cf_invalid_cash_child"),
          accountLike("acct_cf_invalid_cash_child", "1010", "Invalid Cash Child", "asset", "acct_cf_invalid_cash_parent")
        ],
        postings: [postingLike("post_cf_invalid_cash", "acct_cf_invalid_cash_child", "1.00", "0.00")],
        cashAccountIds: ["acct_cf_invalid_cash_parent"],
        activityByAccountId: {}
      })
    ).toThrow(AccountHierarchyValidationError);
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

  it("includes a reusable provider-neutral native hierarchy with parent and leaf postings", () => {
    expect(validateAccountHierarchy(fixture.accounts)).toEqual([]);

    const accountById = new Map(fixture.accounts.map((account) => [account.accountId, account]));
    const childAccountIds = new Set(
      fixture.accounts
        .map((account) => account.parentAccountId)
        .filter((parentAccountId): parentAccountId is string => parentAccountId !== undefined)
    );
    const expenseParent = requiredFixtureAccount(accountById, "acct_expense");
    const expenseChild = requiredFixtureAccount(accountById, "acct_expense_facilities");
    const expenseGrandchild = requiredFixtureAccount(accountById, "acct_expense_utilities");

    expect(expenseChild.parentAccountId).toBe(expenseParent.accountId);
    expect(expenseGrandchild.parentAccountId).toBe(expenseChild.accountId);
    expect(accountHierarchyDepth(expenseGrandchild, accountById)).toBeGreaterThanOrEqual(3);
    expect(childAccountIds.has(expenseGrandchild.accountId)).toBe(false);

    expect(fixture.postings.find((posting) => posting.accountId === expenseParent.accountId)?.postingId).toBe(
      "post_rent_expense"
    );
    expect(fixture.postings.find((posting) => posting.accountId === expenseGrandchild.accountId)?.postingId).toBe(
      "post_accrued_bill_expense"
    );
    expect(fixture.transactionLines.find((line) => line.transactionLineId === "line_accrued_bill_expense")?.accountId).toBe(
      expenseGrandchild.accountId
    );

    for (const account of fixture.accounts) {
      expect(account).not.toHaveProperty("parentAccountRef");
      expect(account).not.toHaveProperty("parentAccountSourceId");
    }
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
        ["expense", "6100 Operating Expense", "3250.00"],
        ["expense", "6110 Software Subscriptions", "50.00"],
        ["other_income", "7010 Interest Income", "500.00"],
        ["other_expense", "8010 Tax Penalty", "80.00"]
      ])
    );
  });

  it("rolls up nested P&L account parents without double-counting visible child rows", () => {
    const accounts = [
      accountLike("acct_nested_income_parent", "4100", "Nested Revenue", "income"),
      accountLike("acct_nested_income_child", "4110", "Nested Revenue Child", "income", "acct_nested_income_parent"),
      accountLike("acct_nested_income_grandchild", "4111", "Nested Revenue Grandchild", "income", "acct_nested_income_child"),
      accountLike("acct_nested_cogs_parent", "5100", "Nested COGS", "cost_of_goods_sold"),
      accountLike("acct_nested_cogs_child", "5110", "Nested COGS Child", "cost_of_goods_sold", "acct_nested_cogs_parent"),
      accountLike("acct_nested_cogs_grandchild", "5111", "Nested COGS Grandchild", "cost_of_goods_sold", "acct_nested_cogs_child"),
      accountLike("acct_nested_expense_parent", "6100", "Nested Expenses", "expense"),
      accountLike("acct_nested_expense_child", "6110", "Nested Expenses Child", "expense", "acct_nested_expense_parent"),
      accountLike("acct_nested_expense_grandchild", "6111", "Nested Expenses Grandchild", "expense", "acct_nested_expense_child"),
      accountLike("acct_nested_other_income_parent", "7100", "Nested Other Income", "other_income"),
      accountLike("acct_nested_other_income_child", "7110", "Nested Other Income Child", "other_income", "acct_nested_other_income_parent"),
      accountLike(
        "acct_nested_other_income_grandchild",
        "7111",
        "Nested Other Income Grandchild",
        "other_income",
        "acct_nested_other_income_child"
      ),
      accountLike("acct_nested_other_expense_parent", "8100", "Nested Other Expense", "other_expense"),
      accountLike(
        "acct_nested_other_expense_child",
        "8110",
        "Nested Other Expense Child",
        "other_expense",
        "acct_nested_other_expense_parent"
      ),
      accountLike(
        "acct_nested_other_expense_grandchild",
        "8111",
        "Nested Other Expense Grandchild",
        "other_expense",
        "acct_nested_other_expense_child"
      )
    ];
    const postings = [
      postingLike("post_nested_income_parent", "acct_nested_income_parent", "0.00", "1000.00"),
      postingLike("post_nested_income_child", "acct_nested_income_child", "0.00", "2000.00"),
      postingLike("post_nested_income_grandchild", "acct_nested_income_grandchild", "0.00", "3000.00"),
      postingLike("post_nested_cogs_parent", "acct_nested_cogs_parent", "100.00", "0.00"),
      postingLike("post_nested_cogs_child", "acct_nested_cogs_child", "200.00", "0.00"),
      postingLike("post_nested_cogs_grandchild", "acct_nested_cogs_grandchild", "300.00", "0.00"),
      postingLike("post_nested_expense_parent", "acct_nested_expense_parent", "10.00", "0.00"),
      postingLike("post_nested_expense_child", "acct_nested_expense_child", "20.00", "0.00"),
      postingLike("post_nested_expense_grandchild", "acct_nested_expense_grandchild", "30.00", "0.00"),
      postingLike("post_nested_other_income_parent", "acct_nested_other_income_parent", "0.00", "400.00"),
      postingLike("post_nested_other_income_child", "acct_nested_other_income_child", "0.00", "50.00"),
      postingLike("post_nested_other_income_grandchild", "acct_nested_other_income_grandchild", "0.00", "6.00"),
      postingLike("post_nested_other_expense_parent", "acct_nested_other_expense_parent", "7.00", "0.00"),
      postingLike("post_nested_other_expense_child", "acct_nested_other_expense_child", "8.00", "0.00"),
      postingLike("post_nested_other_expense_grandchild", "acct_nested_other_expense_grandchild", "9.00", "0.00")
    ];

    const report = buildProfitAndLossReport({ ...reportRequest, accounts, postings });

    expectTotals(report, {
      total_income: "6000.00",
      total_cost_of_goods_sold: "600.00",
      gross_profit: "5400.00",
      total_expenses: "60.00",
      net_operating_income: "5340.00",
      total_other_income: "456.00",
      total_other_expense: "24.00",
      net_income: "5772.00"
    });
    expect(report.lines.map((line) => [line.section, line.label, line.amount])).toEqual(
      expect.arrayContaining([
        ["income", "4100 Nested Revenue", "6000.00"],
        ["cost_of_goods_sold", "5100 Nested COGS", "600.00"],
        ["expense", "6100 Nested Expenses", "60.00"],
        ["other_income", "7100 Nested Other Income", "456.00"],
        ["other_expense", "8100 Nested Other Expense", "24.00"]
      ])
    );

    const incomeParent = requiredLine(report, "acct_nested_income_parent");
    const incomeChild = requiredLine(report, "acct_nested_income_child");
    const incomeGrandchild = requiredLine(report, "acct_nested_income_grandchild");

    expect(incomeParent.reportLineId).toBe("profit_and_loss:line:account:acct_nested_income_parent");
    expect(incomeParent.amount).toBe("6000.00");
    expect(incomeParent.parentReportLineId).toBeUndefined();
    expect(incomeParent.drilldownRef.accountIds).toEqual([
      "acct_nested_income_child",
      "acct_nested_income_grandchild",
      "acct_nested_income_parent"
    ]);
    expect(incomeParent.drilldownRef.postingIds).toEqual([
      "post_nested_income_child",
      "post_nested_income_grandchild",
      "post_nested_income_parent"
    ]);
    expect(incomeChild.parentReportLineId).toBe(incomeParent.reportLineId);
    expect(incomeChild.amount).toBe("5000.00");
    expect(incomeChild.drilldownRef.accountIds).toEqual(["acct_nested_income_child", "acct_nested_income_grandchild"]);
    expect(incomeChild.drilldownRef.postingIds).toEqual(["post_nested_income_child", "post_nested_income_grandchild"]);
    expect(incomeGrandchild.parentReportLineId).toBe(incomeChild.reportLineId);
    expect(incomeGrandchild.drilldownRef.accountIds).toEqual(["acct_nested_income_grandchild"]);
    expect(incomeGrandchild.drilldownRef.postingIds).toEqual(["post_nested_income_grandchild"]);
    expect(lineAmountSum(report, "income")).toBe("14000.00");
    expect(report.totals.find((total) => total.totalKey === "total_income")?.amount).toBe("6000.00");
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

  it.each([
    {
      name: "self cycles",
      accounts: () => [accountLike("acct_self_cycle", "6200", "Self Cycle", "expense", "acct_self_cycle")],
      diagnostic: {
        code: "account_parent_cycle",
        accountId: "acct_self_cycle",
        parentAccountId: "acct_self_cycle",
        cycleAccountIds: ["acct_self_cycle"]
      }
    },
    {
      name: "multi-account cycles",
      accounts: () => [
        accountLike("acct_cycle_a", "6201", "Cycle A", "expense", "acct_cycle_b"),
        accountLike("acct_cycle_b", "6202", "Cycle B", "expense", "acct_cycle_c"),
        accountLike("acct_cycle_c", "6203", "Cycle C", "expense", "acct_cycle_a")
      ],
      diagnostic: {
        code: "account_parent_cycle",
        accountId: "acct_cycle_a",
        parentAccountId: "acct_cycle_b",
        cycleAccountIds: ["acct_cycle_a", "acct_cycle_b", "acct_cycle_c"]
      }
    },
    {
      name: "cross-tenant parent links",
      accounts: () => [
        accountLike("acct_cross_parent", "6210", "Cross Tenant Parent", "expense", undefined, { tenantId: "tenant_other" }),
        accountLike("acct_cross_tenant_child", "6211", "Cross Tenant Child", "expense", "acct_cross_parent")
      ],
      diagnostic: {
        code: "account_parent_cross_scope",
        accountId: "acct_cross_tenant_child",
        parentAccountId: "acct_cross_parent",
        parentTenantId: "tenant_other",
        parentSourceId: fixture.source.sourceId
      }
    },
    {
      name: "cross-source parent links",
      accounts: () => [
        accountLike("acct_cross_source_parent", "6220", "Cross Source Parent", "expense", undefined, {
          sourceId: "source_other_fixture"
        }),
        accountLike("acct_cross_source_child", "6221", "Cross Source Child", "expense", "acct_cross_source_parent")
      ],
      diagnostic: {
        code: "account_parent_cross_scope",
        accountId: "acct_cross_source_child",
        parentAccountId: "acct_cross_source_parent",
        parentTenantId: reportRequest.tenantId,
        parentSourceId: "source_other_fixture"
      }
    },
    {
      name: "unresolved orphan parent links",
      accounts: () => [accountLike("acct_orphan_child", "6230", "Orphan Child", "expense", "acct_missing_parent")],
      diagnostic: {
        code: "account_parent_orphan",
        accountId: "acct_orphan_child",
        parentAccountId: "acct_missing_parent"
      }
    }
  ])("rejects invalid hierarchy input for $name before report generation", ({ accounts, diagnostic }) => {
    const invalidInput = {
      ...reportRequest,
      accounts: [...fixture.accounts, ...accounts()]
    };

    expect(validateAccountHierarchy(invalidInput.accounts)).toEqual([expect.objectContaining(diagnostic)]);

    for (const { reportName, build } of reportBuilders()) {
      expectHierarchyRejection(() => build(invalidInput), reportName, diagnostic);
    }
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

function requiredLine(report: BuiltReport, accountId: string): BuiltReport["lines"][number] {
  const line = report.lines.find((entry) => entry.accountId === accountId);
  if (line === undefined) {
    throw new Error(`missing report line for account ${accountId}`);
  }
  return line;
}

function requiredFixtureAccount(accounts: ReadonlyMap<string, Account>, accountId: string): Account {
  const account = accounts.get(accountId);
  if (account === undefined) {
    throw new Error(`fixture is missing account ${accountId}`);
  }
  return account;
}

function accountHierarchyDepth(account: Account, accounts: ReadonlyMap<string, Account>): number {
  let depth = 1;
  let current: Account | undefined = account;

  while (current?.parentAccountId !== undefined) {
    depth += 1;
    current = accounts.get(current.parentAccountId);
  }

  return depth;
}

function lineAmountSum(report: BuiltReport, section: string): string {
  const amountMinor = report.lines
    .filter((line) => line.section === section)
    .reduce((sum, line) => sum + parseCurrencyMinor(line.amount), 0n);
  return formatCurrencyMinor(amountMinor);
}

function reportBuilders(): readonly {
  readonly reportName: string;
  readonly build: (input: ReportBuilderInput) => BuiltReport;
}[] {
  return [
    { reportName: "profit_and_loss", build: buildProfitAndLossReport },
    { reportName: "balance_sheet", build: buildBalanceSheetReport },
    { reportName: "trial_balance", build: buildTrialBalanceReport },
    {
      reportName: "cash_flow",
      build: (input) =>
        buildCashFlowReport({
          ...input,
          cashAccountIds: fixture.cashFlow.cashAccountIds,
          activityByAccountId: fixture.cashFlow.activityByAccountId
        })
    }
  ];
}

function expectHierarchyRejection(
  build: () => BuiltReport,
  reportName: string,
  expectedDiagnostic: Readonly<Record<string, unknown>>
): void {
  try {
    build();
    throw new Error(`${reportName} should reject invalid account hierarchy`);
  } catch (error) {
    expect(error).toBeInstanceOf(AccountHierarchyValidationError);
    const hierarchyError = error as AccountHierarchyValidationError;
    expect(hierarchyError.diagnostics).toEqual([expect.objectContaining(expectedDiagnostic)]);
    expect(hierarchyError.message).toContain("Invalid account hierarchy");
  }
}

function accountLike(
  accountId: string,
  accountNumber: string,
  name: string,
  classification: Account["classification"],
  parentAccountId?: string,
  overrides: Partial<Pick<Account, "tenantId" | "sourceId">> = {}
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
    ...overrides,
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
  return formatCurrencyMinor(amountMinor);
}

function formatCurrencyMinor(amountMinor: bigint): string {
  const sign = amountMinor < 0n ? "-" : "";
  const absolute = amountMinor < 0n ? -amountMinor : amountMinor;
  return `${sign}${(absolute / 100n).toString()}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

function parseCurrencyMinor(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(`invalid test currency value ${value}`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  return sign * (BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0")));
}
