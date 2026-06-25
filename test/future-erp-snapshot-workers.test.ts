import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  buildBalanceSheetReport,
  buildProfitAndLossReport,
  createFutureErpSnapshotRefreshAndFreshnessWorker
} from "../src/index.js";

import type {
  Account,
  BuiltReport,
  FutureErpSnapshotRefreshWorkerStorage,
  LedgerPosting,
  LoadReportBuilderInput,
  LoadReportSnapshotInput,
  ReportBuilderInput,
  ReportFreshnessRow,
  ReportSnapshotLine,
  ReportName,
  SnapshotRefreshResult,
  StoredReportSnapshot
} from "../src/index.js";

type StorageCall =
  | {
      readonly method: "loadLatestReportSnapshot";
      readonly input: LoadReportSnapshotInput;
    }
  | {
      readonly method: "loadReportBuilderInput";
      readonly input: LoadReportBuilderInput;
    }
  | {
      readonly method: "writeReportSnapshot";
      readonly report: BuiltReport;
    }
  | {
      readonly method: "writeFreshnessRows";
      readonly rows: readonly ReportFreshnessRow[];
    };

const fixture = ERP_FINANCIALS_STATEMENT_FIXTURE;
const scope = {
  tenantId: fixture.company.tenantId,
  companyId: fixture.company.companyId,
  sourceId: fixture.source.sourceId
} as const;
const reportNames = ["profit_and_loss", "balance_sheet", "trial_balance", "cash_flow"] as const satisfies readonly ReportName[];

describe("Future ERP snapshot refresh and freshness reconciliation worker bindings", () => {
  it("refreshes P&L, balance sheet, trial balance, and cash flow snapshots through package report builders", async () => {
    const storage = new RecordingSnapshotStorage();
    const worker = createFutureErpSnapshotRefreshAndFreshnessWorker({
      scope,
      storage
    });

    const results: SnapshotRefreshResult[] = [];
    for (const reportName of reportNames) {
      results.push(
        await worker.runStaleSnapshotRefresh({
          reportName,
          accountingBasis: "accrual",
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
          asOfDate: "2026-01-31",
          currencyCode: "USD",
          generatedAt: "2026-02-01T00:00:00.000Z",
          freshThrough: "2026-02-01T00:00:00.000Z",
          importBatchId: fixture.importBatch.importBatchId,
          checkpointId: fixture.checkpoint.checkpointId,
          ...(reportName === "cash_flow" ? { cashFlow: fixture.cashFlow } : {})
        })
      );
    }

    expect(results.map((result) => [result.reportName, result.action])).toEqual([
      ["profit_and_loss", "rebuilt"],
      ["balance_sheet", "rebuilt"],
      ["trial_balance", "rebuilt"],
      ["cash_flow", "rebuilt"]
    ]);
    expect(storage.writtenReports.map((report) => report.snapshot.reportName)).toEqual([...reportNames]);
    expect(storage.writtenReports.map((report) => report.metadata.generatedFrom)).toEqual([
      "ledger_postings",
      "ledger_postings",
      "ledger_postings",
      "ledger_postings"
    ]);
    expect(reportTotals(storage.writtenReports[0])).toMatchObject(fixture.expectedTotals.profitAndLoss);
    expect(reportTotals(storage.writtenReports[1])).toMatchObject(fixture.expectedTotals.balanceSheet);
    expect(reportTotals(storage.writtenReports[2])).toMatchObject(fixture.expectedTotals.trialBalance);
    expect(reportTotals(storage.writtenReports[3])).toMatchObject(fixture.expectedTotals.cashFlow);
    expect(storage.writtenReports[3]?.metadata.cashFlow).toMatchObject({
      supportStatus: "partial",
      unsupportedReasons: ["cash_flow_has_unclassified_cash_movement"],
      unclassifiedCashMovementPostingIds: ["post_unclassified_cash"]
    });
    expect(storage.writtenFreshnessRows.map((row) => [row.reportName, row.status])).toEqual([
      ["profit_and_loss", "fresh"],
      ["balance_sheet", "fresh"],
      ["trial_balance", "fresh"],
      ["cash_flow", "fresh"]
    ]);
    expect(storage.calls.map((call) => call.method)).toEqual([
      "loadLatestReportSnapshot",
      "loadReportBuilderInput",
      "writeReportSnapshot",
      "writeFreshnessRows",
      "loadLatestReportSnapshot",
      "loadReportBuilderInput",
      "writeReportSnapshot",
      "writeFreshnessRows",
      "loadLatestReportSnapshot",
      "loadReportBuilderInput",
      "writeReportSnapshot",
      "writeFreshnessRows",
      "loadLatestReportSnapshot",
      "loadReportBuilderInput",
      "writeReportSnapshot",
      "writeFreshnessRows"
    ]);
    expect(JSON.stringify(results)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i);
  });

  it("rebuilds stale stored snapshots and reuses fresh stored snapshots without duplicating formulas", async () => {
    const staleReport = buildProfitAndLossReport({
      ...baseReportInput(),
      freshness: {
        status: "stale",
        sourceId: scope.sourceId,
        staleReason: "late_arrival_overlap_reprocess"
      }
    });
    const storage = new RecordingSnapshotStorage({
      snapshots: {
        profit_and_loss: {
          snapshot: staleReport.snapshot,
          lines: staleReport.lines,
          totals: staleReport.totals
        },
        balance_sheet: freshStoredSnapshot(
          buildBalanceSheetReport({
            ...baseReportInput(),
            freshness: {
              status: "fresh",
              sourceId: scope.sourceId,
              freshThrough: "2026-02-01T00:00:00.000Z"
            }
          })
        )
      }
    });
    const worker = createFutureErpSnapshotRefreshAndFreshnessWorker({ scope, storage });

    const rebuilt = await worker.runStaleSnapshotRefresh(snapshotRequest("profit_and_loss"));
    const reused = await worker.runStaleSnapshotRefresh(snapshotRequest("balance_sheet"));

    expect(rebuilt.action).toBe("rebuilt");
    expect(rebuilt.report?.metadata.generatedFrom).toBe("ledger_postings");
    expect(rebuilt.snapshot.snapshot.freshness.status).toBe("fresh");
    expect(reused.action).toBe("reused");
    expect(reused.snapshot.snapshot.reportName).toBe("balance_sheet");
    expect(storage.writtenReports).toHaveLength(1);
    expect(storage.writtenReports[0]?.snapshot.reportName).toBe("profit_and_loss");
    expect(storage.calls.map((call) => call.method)).toEqual([
      "loadLatestReportSnapshot",
      "loadReportBuilderInput",
      "writeReportSnapshot",
      "writeFreshnessRows",
      "loadLatestReportSnapshot"
    ]);
  });

  it("preserves nested account snapshot lines when stale and missing snapshots are rebuilt", async () => {
    const nestedInput = nestedAccountReportInput();
    const staleProfitAndLoss = buildProfitAndLossReport({
      ...nestedInput,
      freshness: {
        status: "stale",
        sourceId: scope.sourceId,
        staleReason: "late_arrival_overlap_reprocess"
      }
    });
    const freshBalanceSheet = buildBalanceSheetReport({
      ...nestedInput,
      freshness: {
        status: "fresh",
        sourceId: scope.sourceId,
        freshThrough: "2026-02-01T00:00:00.000Z"
      }
    });
    const storage = new RecordingSnapshotStorage({
      reportInput: nestedInput,
      snapshots: {
        profit_and_loss: {
          snapshot: staleProfitAndLoss.snapshot,
          lines: staleProfitAndLoss.lines,
          totals: staleProfitAndLoss.totals
        },
        balance_sheet: freshStoredSnapshot(freshBalanceSheet)
      }
    });
    const worker = createFutureErpSnapshotRefreshAndFreshnessWorker({ scope, storage });

    const rebuiltProfitAndLoss = await worker.runStaleSnapshotRefresh(snapshotRequest("profit_and_loss"));
    const rebuiltTrialBalance = await worker.runStaleSnapshotRefresh(snapshotRequest("trial_balance"));
    const reusedBalanceSheet = await worker.runStaleSnapshotRefresh(snapshotRequest("balance_sheet"));

    expect(rebuiltProfitAndLoss.action).toBe("rebuilt");
    expect(rebuiltTrialBalance.action).toBe("rebuilt");
    expect(reusedBalanceSheet.action).toBe("reused");
    expect(storage.writtenReports.map((report) => report.snapshot.reportName)).toEqual(["profit_and_loss", "trial_balance"]);
    expect(storage.writtenFreshnessRows.map((row) => [row.reportName, row.status])).toEqual([
      ["profit_and_loss", "fresh"],
      ["trial_balance", "fresh"]
    ]);
    expect(storage.writtenFreshnessRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenantId: scope.tenantId,
          companyId: scope.companyId,
          sourceId: scope.sourceId,
          reportName: "profit_and_loss"
        }),
        expect.objectContaining({
          tenantId: scope.tenantId,
          companyId: scope.companyId,
          sourceId: scope.sourceId,
          reportName: "trial_balance"
        })
      ])
    );

    expectNestedRollupLines(rebuiltProfitAndLoss, storage.writtenReports[0], "profit_and_loss", {
      parentAccountId: "acct_nested_income_parent",
      childAccountId: "acct_nested_income_child",
      grandchildAccountId: "acct_nested_income_grandchild",
      parentAmount: "140.00",
      childAmount: "40.00",
      grandchildAmount: "40.00",
      parentPostingIds: ["post_nested_income_parent", "post_nested_income_grandchild"],
      childPostingIds: ["post_nested_income_grandchild"],
      grandchildPostingIds: ["post_nested_income_grandchild"]
    });
    expectNestedRollupLines(rebuiltTrialBalance, storage.writtenReports[1], "trial_balance", {
      parentAccountId: "acct_nested_asset_parent",
      childAccountId: "acct_nested_asset_child",
      grandchildAccountId: "acct_nested_asset_grandchild",
      parentAmount: "690.00",
      childAmount: "90.00",
      grandchildAmount: "90.00",
      parentPostingIds: ["post_nested_asset_parent", "post_nested_asset_grandchild"],
      childPostingIds: ["post_nested_asset_grandchild"],
      grandchildPostingIds: ["post_nested_asset_grandchild"]
    });

    const reusedParent = requiredLine(reusedBalanceSheet.snapshot.lines, "acct_nested_asset_parent");
    const reusedChild = requiredLine(reusedBalanceSheet.snapshot.lines, "acct_nested_asset_child");
    const reusedGrandchild = requiredLine(reusedBalanceSheet.snapshot.lines, "acct_nested_asset_grandchild");
    expect(reusedChild.parentReportLineId).toBe(reusedParent.reportLineId);
    expect(reusedGrandchild.parentReportLineId).toBe(reusedChild.reportLineId);
    expect(reusedParent.amount).toBe("690.00");
    expect(storage.calls.map((call) => call.method)).toEqual([
      "loadLatestReportSnapshot",
      "loadReportBuilderInput",
      "writeReportSnapshot",
      "writeFreshnessRows",
      "loadLatestReportSnapshot",
      "loadReportBuilderInput",
      "writeReportSnapshot",
      "writeFreshnessRows",
      "loadLatestReportSnapshot"
    ]);
    expect(JSON.stringify([rebuiltProfitAndLoss, rebuiltTrialBalance, reusedBalanceSheet])).not.toMatch(
      /access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i
    );
  });

  it("surfaces stale and partial freshness reconciliation states through package contracts", async () => {
    const storage = new RecordingSnapshotStorage();
    const worker = createFutureErpSnapshotRefreshAndFreshnessWorker({ scope, storage });

    const stale = await worker.runFreshnessReconciliation({
      reportName: "profit_and_loss",
      accountingBasis: "accrual",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      currencyCode: "USD",
      sourceFreshThrough: "2026-02-01T00:00:00.000Z",
      importedThrough: "2026-02-01T00:00:00.000Z",
      staleReasons: ["late_arrival_overlap_reprocess"],
      importBatchId: fixture.importBatch.importBatchId,
      checkpointId: fixture.checkpoint.checkpointId,
      updatedAt: "2026-02-02T00:00:00.000Z"
    });
    const partial = await worker.runFreshnessReconciliation({
      reportName: "trial_balance",
      accountingBasis: "accrual",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      currencyCode: "USD",
      sourceFreshThrough: "2026-02-02T00:00:00.000Z",
      importedThrough: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-02T00:00:00.000Z"
    });

    expect(stale).toMatchObject({
      freshnessRowsWritten: 1,
      freshnessRow: {
        tenantId: scope.tenantId,
        companyId: scope.companyId,
        sourceId: scope.sourceId,
        reportName: "profit_and_loss",
        status: "stale",
        staleReason: "late_arrival_overlap_reprocess",
        freshThrough: "2026-02-01T00:00:00.000Z"
      }
    });
    expect(partial).toMatchObject({
      freshnessRowsWritten: 1,
      freshnessRow: {
        tenantId: scope.tenantId,
        companyId: scope.companyId,
        sourceId: scope.sourceId,
        reportName: "trial_balance",
        status: "partial",
        staleReason: "imported_boundary_behind_source_boundary",
        freshThrough: "2026-02-01T00:00:00.000Z"
      }
    });
    expect(storage.writtenFreshnessRows.map((row) => [row.reportName, row.status])).toEqual([
      ["profit_and_loss", "stale"],
      ["trial_balance", "partial"]
    ]);
    expect(JSON.stringify([stale, partial])).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i);
  });
});

class RecordingSnapshotStorage implements FutureErpSnapshotRefreshWorkerStorage {
  readonly calls: StorageCall[] = [];
  readonly writtenReports: BuiltReport[] = [];
  readonly writtenFreshnessRows: ReportFreshnessRow[] = [];

  constructor(
    private readonly options: {
      readonly snapshots?: Partial<Record<ReportName, StoredReportSnapshot>>;
      readonly reportInput?: ReportBuilderInput;
    } = {}
  ) {}

  loadLatestReportSnapshot(input: LoadReportSnapshotInput): Promise<StoredReportSnapshot | undefined> {
    this.calls.push({ method: "loadLatestReportSnapshot", input });

    return Promise.resolve(this.options.snapshots?.[input.reportName]);
  }

  loadReportBuilderInput(input: LoadReportBuilderInput): Promise<ReportBuilderInput> {
    this.calls.push({ method: "loadReportBuilderInput", input });

    return Promise.resolve({
      ...baseReportInput(),
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      accountingBasis: input.accountingBasis,
      currencyCode: input.currencyCode,
      ...(input.asOfDate === undefined ? {} : { asOfDate: input.asOfDate }),
      ...(input.generatedAt === undefined ? {} : { generatedAt: input.generatedAt }),
      ...this.options.reportInput
    });
  }

  writeReportSnapshot(report: BuiltReport): Promise<number> {
    this.calls.push({ method: "writeReportSnapshot", report });
    this.writtenReports.push(report);

    return Promise.resolve(1 + report.lines.length + report.totals.length);
  }

  writeFreshnessRows(rows: readonly ReportFreshnessRow[]): Promise<number> {
    this.calls.push({ method: "writeFreshnessRows", rows });
    this.writtenFreshnessRows.push(...rows);

    return Promise.resolve(rows.length);
  }
}

function snapshotRequest(reportName: ReportName) {
  return {
    reportName,
    accountingBasis: "accrual" as const,
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    asOfDate: "2026-01-31",
    currencyCode: "USD",
    generatedAt: "2026-02-01T00:00:00.000Z",
    freshThrough: "2026-02-01T00:00:00.000Z",
    importBatchId: fixture.importBatch.importBatchId,
    checkpointId: fixture.checkpoint.checkpointId,
    ...(reportName === "cash_flow" ? { cashFlow: fixture.cashFlow } : {})
  };
}

function baseReportInput(): ReportBuilderInput {
  return {
    ...fixture.reportRequest,
    accounts: fixture.accounts,
    postings: fixture.postings,
    freshness: {
      status: "fresh",
      sourceId: scope.sourceId,
      importBatchId: fixture.importBatch.importBatchId,
      checkpointId: fixture.checkpoint.checkpointId,
      freshThrough: "2026-02-01T00:00:00.000Z"
    }
  };
}

function freshStoredSnapshot(report: BuiltReport): StoredReportSnapshot {
  return {
    snapshot: report.snapshot,
    lines: report.lines,
    totals: report.totals
  };
}

function reportTotals(report: BuiltReport | undefined): Readonly<Record<string, string>> {
  if (report === undefined) {
    throw new Error("expected report");
  }

  return Object.fromEntries(report.totals.map((total) => [total.totalKey, total.amount]));
}

type NestedRollupExpectation = {
  readonly parentAccountId: string;
  readonly childAccountId: string;
  readonly grandchildAccountId: string;
  readonly parentAmount: string;
  readonly childAmount: string;
  readonly grandchildAmount: string;
  readonly parentPostingIds: readonly string[];
  readonly childPostingIds: readonly string[];
  readonly grandchildPostingIds: readonly string[];
};

function expectNestedRollupLines(
  result: SnapshotRefreshResult,
  writtenReport: BuiltReport | undefined,
  reportName: ReportName,
  expected: NestedRollupExpectation
): void {
  if (writtenReport === undefined) {
    throw new Error(`expected ${reportName} to be written`);
  }

  expect(writtenReport.snapshot.reportName).toBe(reportName);
  expect(result.snapshot.lines).toEqual(writtenReport.lines);
  const parent = requiredLine(result.snapshot.lines, expected.parentAccountId);
  const child = requiredLine(result.snapshot.lines, expected.childAccountId);
  const grandchild = requiredLine(result.snapshot.lines, expected.grandchildAccountId);
  const parentIndex = result.snapshot.lines.indexOf(parent);
  const childIndex = result.snapshot.lines.indexOf(child);
  const grandchildIndex = result.snapshot.lines.indexOf(grandchild);

  expect(parentIndex).toBeLessThan(childIndex);
  expect(childIndex).toBeLessThan(grandchildIndex);
  expect(parent.reportLineId).toBe(`${reportName}:line:account:${expected.parentAccountId}`);
  expect(child.reportLineId).toBe(`${reportName}:line:account:${expected.childAccountId}`);
  expect(grandchild.reportLineId).toBe(`${reportName}:line:account:${expected.grandchildAccountId}`);
  expect(child.parentReportLineId).toBe(parent.reportLineId);
  expect(grandchild.parentReportLineId).toBe(child.reportLineId);
  expect(parent.amount).toBe(expected.parentAmount);
  expect(child.amount).toBe(expected.childAmount);
  expect(grandchild.amount).toBe(expected.grandchildAmount);
  expect(parent.sortOrder).toBeLessThan(child.sortOrder);
  expect(child.sortOrder).toBeLessThan(grandchild.sortOrder);
  expectLineDrilldown(parent, [expected.parentAccountId, expected.childAccountId, expected.grandchildAccountId], expected.parentPostingIds);
  expectLineDrilldown(child, [expected.childAccountId, expected.grandchildAccountId], expected.childPostingIds);
  expectLineDrilldown(grandchild, [expected.grandchildAccountId], expected.grandchildPostingIds);
}

function requiredLine(lines: readonly ReportSnapshotLine[], accountId: string): ReportSnapshotLine {
  const line = lines.find((candidate) => candidate.accountId === accountId);
  if (line === undefined) {
    throw new Error(`expected line for account ${accountId}`);
  }
  return line;
}

function expectLineDrilldown(
  line: ReportSnapshotLine,
  expectedAccountIds: readonly string[],
  expectedPostingIds: readonly string[]
): void {
  expect(new Set(line.drilldownRef.accountIds)).toEqual(new Set(expectedAccountIds));
  expect(new Set(line.drilldownRef.query?.accountIds)).toEqual(new Set(expectedAccountIds));
  expect(new Set(line.drilldownRef.postingIds)).toEqual(new Set(expectedPostingIds));
  expect(line.drilldownRef.postingCount).toBe(expectedPostingIds.length);
  expect(line.drilldownRef.sourceRefCount).toBe(expectedPostingIds.length);
  expect(
    (line.drilldownRef.sourceRefs ?? []).map((sourceRef) => [
      sourceRef.sourceObjectType,
      sourceRef.sourceObjectId,
      sourceRef.checksum
    ])
  ).toEqual(
    expect.arrayContaining(
      expectedPostingIds.map((postingId) => ["LedgerPosting", postingId.replace("post_", ""), `sha256:${postingId}`])
    )
  );
  expect(line.drilldownRef.query).toMatchObject({
    kind: "ledger_postings",
    tenantId: scope.tenantId,
    sourceId: scope.sourceId,
    accountingBasis: "accrual",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31"
  });
}

function nestedAccountReportInput(): ReportBuilderInput {
  return {
    ...baseReportInput(),
    accounts: [
      nestedAccount("acct_nested_income_parent", "4000", "Revenue Group", "income"),
      nestedAccount("acct_nested_income_child", "4010", "Services Revenue", "income", "acct_nested_income_parent"),
      nestedAccount(
        "acct_nested_income_grandchild",
        "4011",
        "Implementation Revenue",
        "income",
        "acct_nested_income_child"
      ),
      nestedAccount("acct_nested_asset_parent", "1000", "Cash Group", "asset"),
      nestedAccount("acct_nested_asset_child", "1010", "Operating Cash", "asset", "acct_nested_asset_parent"),
      nestedAccount("acct_nested_asset_grandchild", "1011", "Payroll Cash", "asset", "acct_nested_asset_child")
    ],
    postings: [
      nestedPosting(
        "post_nested_income_parent",
        "txn_nested_income_parent",
        "line_nested_income_parent",
        "acct_nested_income_parent",
        "0.00",
        "100.00"
      ),
      nestedPosting(
        "post_nested_income_grandchild",
        "txn_nested_income_grandchild",
        "line_nested_income_grandchild",
        "acct_nested_income_grandchild",
        "0.00",
        "40.00"
      ),
      nestedPosting(
        "post_nested_asset_parent",
        "txn_nested_asset_parent",
        "line_nested_asset_parent",
        "acct_nested_asset_parent",
        "600.00",
        "0.00"
      ),
      nestedPosting(
        "post_nested_asset_grandchild",
        "txn_nested_asset_grandchild",
        "line_nested_asset_grandchild",
        "acct_nested_asset_grandchild",
        "90.00",
        "0.00"
      )
    ]
  };
}

function nestedAccount(
  accountId: string,
  accountNumber: string,
  name: string,
  classification: Account["classification"],
  parentAccountId?: string
): Account {
  return {
    tenantId: scope.tenantId,
    sourceId: scope.sourceId,
    accountId,
    sourceAccountId: accountId.replace("acct_nested_", ""),
    accountNumber,
    name,
    type: classification,
    subtype: classification,
    classification,
    ...(parentAccountId === undefined ? {} : { parentAccountId }),
    currencyCode: "USD",
    active: true
  };
}

function nestedPosting(
  postingId: string,
  transactionId: string,
  transactionLineId: string,
  accountId: string,
  debitAmount: string,
  creditAmount: string
): LedgerPosting {
  return {
    tenantId: scope.tenantId,
    sourceId: scope.sourceId,
    postingId,
    sourcePostingId: postingId.replace("post_", ""),
    transactionId,
    transactionLineId,
    accountId,
    postingDate: "2026-01-15",
    accountingBasis: "accrual",
    debitAmount,
    creditAmount,
    netAmount: netAmount(debitAmount, creditAmount),
    currencyCode: "USD",
    dimensionHash: "nested_fixture_no_dimensions",
    dimensionRefs: [],
    sourcePayloadRef: {
      sourceObjectType: "LedgerPosting",
      sourceObjectId: postingId.replace("post_", ""),
      sourceUpdatedAt: "2026-01-15T12:00:00.000Z",
      checksum: `sha256:${postingId}`
    },
    importBatchId: fixture.importBatch.importBatchId,
    checkpointId: fixture.checkpoint.checkpointId
  };
}

function netAmount(debitAmount: string, creditAmount: string): string {
  return (Number(debitAmount) - Number(creditAmount)).toFixed(2);
}
