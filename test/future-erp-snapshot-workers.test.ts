import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  buildBalanceSheetReport,
  buildProfitAndLossReport,
  createFutureErpSnapshotRefreshAndFreshnessWorker
} from "../src/index.js";

import type {
  BuiltReport,
  FutureErpSnapshotRefreshWorkerStorage,
  LoadReportBuilderInput,
  LoadReportSnapshotInput,
  ReportBuilderInput,
  ReportFreshnessRow,
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
