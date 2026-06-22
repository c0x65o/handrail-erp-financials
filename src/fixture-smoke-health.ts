import { createHash } from "node:crypto";

import { assertNoCredentialKeys } from "./canonical-model.js";
import { ERP_FINANCIALS_STATEMENT_FIXTURE } from "./fixtures.js";
import { createPostgresStorageAdapter } from "./postgres-storage.js";
import {
  buildBalanceSheetReport,
  buildCashFlowReport,
  buildProfitAndLossReport,
  buildTrialBalanceReport
} from "./report-builders.js";
import { POSTGRES_CANONICAL_SCHEMA_MANIFEST } from "./schema-manifest.js";
import { createSnapshotRefreshContract } from "./rollup-jobs.js";

import type { ReportFreshness } from "./canonical-model.js";
import type { StatementFixtureSet } from "./fixtures.js";
import type {
  FixtureLoadResult,
  PostgresQueryClient,
  ReportFreshnessRow
} from "./postgres-storage.js";
import type { BuiltReport, ReportBuilderInput, ReportName } from "./report-builders.js";
import type { PostgresSchemaManifest } from "./schema-manifest.js";

export type ErpFinancialsFixtureSmokeHealthStatus = "healthy" | "degraded";
export type ErpFinancialsFixtureSmokeReportStatus = "pass" | "fail";
export type ErpFinancialsFixtureSmokeStorageMode = "simulated" | "storage";

export type ErpFinancialsFixtureSmokeIssueKind =
  | "fixture_load_failed"
  | "fixture_total_mismatch"
  | "snapshot_id_mismatch"
  | "storage_hooks_incomplete"
  | "snapshot_write_failed"
  | "freshness_write_failed"
  | "credential_boundary_failed";

export type ErpFinancialsFixtureSmokeIssue = {
  readonly kind: ErpFinancialsFixtureSmokeIssueKind;
  readonly reportName?: ReportName;
  readonly message: string;
};

export type ErpFinancialsFixtureSmokeStorageHooks = {
  loadStatementFixture?(fixture: StatementFixtureSet): Promise<FixtureLoadResult>;
  writeReportSnapshot?(report: BuiltReport): Promise<number>;
  writeFreshnessRows?(rows: readonly ReportFreshnessRow[]): Promise<number>;
};

export type ErpFinancialsFixtureSmokeReportSummary = {
  readonly reportName: ReportName;
  readonly status: ErpFinancialsFixtureSmokeReportStatus;
  readonly snapshotId: string;
  readonly freshnessId: string;
  readonly totals: Readonly<Record<string, string>>;
  readonly expectedTotals: Readonly<Record<string, string>>;
  readonly lineCount: number;
  readonly totalCount: number;
  readonly snapshotRowCount: number;
  readonly freshnessRowCount: number;
  readonly snapshotRowsWritten: number;
  readonly freshnessRowsWritten: number;
  readonly reconciliationStatus: BuiltReport["metadata"]["reconciliationStatus"];
  readonly reconciliationDifference: string;
  readonly cashFlowSupportStatus?: NonNullable<BuiltReport["metadata"]["cashFlow"]>["supportStatus"];
  readonly summaryHash: string;
};

export type ErpFinancialsFixtureSmokeRowCounts = {
  readonly fixture: FixtureLoadResult;
  readonly reportSnapshots: number;
  readonly reportSnapshotLines: number;
  readonly reportSnapshotTotals: number;
  readonly reportFreshness: number;
  readonly snapshotRowsWritten: number;
  readonly freshnessRowsWritten: number;
};

export type ErpFinancialsFixtureSmokeHealthResult = {
  readonly status: ErpFinancialsFixtureSmokeHealthStatus;
  readonly storageMode: ErpFinancialsFixtureSmokeStorageMode;
  readonly fixtureName: "ERP_FINANCIALS_STATEMENT_FIXTURE";
  readonly generatedAt: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly sourceId: string;
  readonly accountingBasis: "accrual";
  readonly currencyCode: "USD";
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly asOfDate: string;
  readonly rowCounts: ErpFinancialsFixtureSmokeRowCounts;
  readonly snapshotIds: Readonly<Partial<Record<ReportName, string>>>;
  readonly freshnessIds: Readonly<Partial<Record<ReportName, string>>>;
  readonly totals: Readonly<Partial<Record<ReportName, Readonly<Record<string, string>>>>>;
  readonly reports: Readonly<Partial<Record<ReportName, ErpFinancialsFixtureSmokeReportSummary>>>;
  readonly summaryHash: string;
  readonly issues: readonly ErpFinancialsFixtureSmokeIssue[];
};

export type ErpFinancialsFixtureSmokeHealthOptions = {
  readonly fixture?: StatementFixtureSet;
  readonly client?: PostgresQueryClient;
  readonly manifest?: PostgresSchemaManifest;
  readonly storage?: ErpFinancialsFixtureSmokeStorageHooks;
};

const REPORT_NAMES = ["profit_and_loss", "balance_sheet", "trial_balance", "cash_flow"] as const;

export async function runErpFinancialsFixtureSmokeHealth(
  options: ErpFinancialsFixtureSmokeHealthOptions = {}
): Promise<ErpFinancialsFixtureSmokeHealthResult> {
  const fixture = options.fixture ?? ERP_FINANCIALS_STATEMENT_FIXTURE;
  const storage = fixtureSmokeStorage(options);
  const issues: ErpFinancialsFixtureSmokeIssue[] = [];
  const fixtureRows = await loadOrSimulateFixtureRows(fixture, storage, issues);
  const reports: Partial<Record<ReportName, ErpFinancialsFixtureSmokeReportSummary>> = {};
  const snapshotIds: Partial<Record<ReportName, string>> = {};
  const freshnessIds: Partial<Record<ReportName, string>> = {};
  const totals: Partial<Record<ReportName, Readonly<Record<string, string>>>> = {};

  for (const reportName of REPORT_NAMES) {
    const contract = createFixtureSnapshotContract(fixture, reportName);
    const report = buildFixtureReport(fixture, reportName, contract.freshnessRow);
    const actualTotals = totalsByKey(report);
    const reportIssues = fixtureReportIssues(reportName, report, contract.snapshotId, actualTotals, expectedTotals(fixture, reportName));
    issues.push(...reportIssues);
    const writeResult = await persistFixtureReport(storage, report, contract.freshnessRow, reportName, issues);
    const summary = reportSummary({
      reportName,
      report,
      freshnessId: contract.freshnessRow.freshnessId,
      totals: actualTotals,
      expectedTotals: expectedTotals(fixture, reportName),
      status: reportIssues.length === 0 ? "pass" : "fail",
      snapshotRowsWritten: writeResult.snapshotRowsWritten,
      freshnessRowsWritten: writeResult.freshnessRowsWritten
    });

    reports[reportName] = summary;
    snapshotIds[reportName] = summary.snapshotId;
    freshnessIds[reportName] = summary.freshnessId;
    totals[reportName] = summary.totals;
  }

  const rowCounts = {
    fixture: fixtureRows,
    reportSnapshots: Object.keys(reports).length,
    reportSnapshotLines: Object.values(reports).reduce((sum, report) => sum + report.lineCount, 0),
    reportSnapshotTotals: Object.values(reports).reduce((sum, report) => sum + report.totalCount, 0),
    reportFreshness: Object.keys(reports).length,
    snapshotRowsWritten: Object.values(reports).reduce((sum, report) => sum + report.snapshotRowsWritten, 0),
    freshnessRowsWritten: Object.values(reports).reduce((sum, report) => sum + report.freshnessRowsWritten, 0)
  };
  const resultWithoutHash: Omit<ErpFinancialsFixtureSmokeHealthResult, "summaryHash"> = {
    status: issues.length === 0 ? "healthy" : "degraded",
    storageMode: storage === undefined ? "simulated" : "storage",
    fixtureName: "ERP_FINANCIALS_STATEMENT_FIXTURE" as const,
    generatedAt: fixture.reportRequest.generatedAt,
    tenantId: fixture.reportRequest.tenantId,
    companyId: fixture.company.companyId,
    sourceId: fixture.source.sourceId,
    accountingBasis: fixture.reportRequest.accountingBasis,
    currencyCode: fixture.reportRequest.currencyCode,
    periodStart: fixture.reportRequest.periodStart,
    periodEnd: fixture.reportRequest.periodEnd,
    asOfDate: fixture.reportRequest.asOfDate,
    rowCounts,
    snapshotIds,
    freshnessIds,
    totals,
    reports,
    issues
  };
  const result = {
    ...resultWithoutHash,
    summaryHash: stableHash({
      fixtureName: resultWithoutHash.fixtureName,
      generatedAt: resultWithoutHash.generatedAt,
      tenantId: resultWithoutHash.tenantId,
      companyId: resultWithoutHash.companyId,
      sourceId: resultWithoutHash.sourceId,
      accountingBasis: resultWithoutHash.accountingBasis,
      currencyCode: resultWithoutHash.currencyCode,
      periodStart: resultWithoutHash.periodStart,
      periodEnd: resultWithoutHash.periodEnd,
      asOfDate: resultWithoutHash.asOfDate,
      rowCounts: {
        fixture: resultWithoutHash.rowCounts.fixture,
        reportSnapshots: resultWithoutHash.rowCounts.reportSnapshots,
        reportSnapshotLines: resultWithoutHash.rowCounts.reportSnapshotLines,
        reportSnapshotTotals: resultWithoutHash.rowCounts.reportSnapshotTotals,
        reportFreshness: resultWithoutHash.rowCounts.reportFreshness
      },
      snapshotIds,
      freshnessIds,
      totals,
      reportHashes: Object.fromEntries(
        REPORT_NAMES.map((reportName) => [reportName, reports[reportName]?.summaryHash])
      )
    })
  };

  try {
    assertNoCredentialKeys(result);
  } catch {
    return {
      ...result,
      status: "degraded",
      issues: [
        ...issues,
        {
          kind: "credential_boundary_failed",
          message: "fixture smoke health output contains a credential-like field name"
        }
      ]
    };
  }

  return result;
}

function fixtureSmokeStorage(
  options: ErpFinancialsFixtureSmokeHealthOptions
): ErpFinancialsFixtureSmokeStorageHooks | undefined {
  if (options.storage !== undefined) {
    return options.storage;
  }
  if (options.client === undefined) {
    return undefined;
  }

  return createPostgresStorageAdapter(options.client, options.manifest ?? POSTGRES_CANONICAL_SCHEMA_MANIFEST);
}

async function loadOrSimulateFixtureRows(
  fixture: StatementFixtureSet,
  storage: ErpFinancialsFixtureSmokeStorageHooks | undefined,
  issues: ErpFinancialsFixtureSmokeIssue[]
): Promise<FixtureLoadResult> {
  if (storage?.loadStatementFixture === undefined) {
    return fixtureRowCounts(fixture);
  }

  try {
    return await storage.loadStatementFixture(fixture);
  } catch {
    issues.push({
      kind: "fixture_load_failed",
      message: "statement fixture load failed"
    });
    return fixtureRowCounts(fixture);
  }
}

function createFixtureSnapshotContract(fixture: StatementFixtureSet, reportName: ReportName) {
  return createSnapshotRefreshContract({
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
  });
}

function buildFixtureReport(fixture: StatementFixtureSet, reportName: ReportName, freshnessRow: ReportFreshnessRow): BuiltReport {
  const baseInput: ReportBuilderInput = {
    ...fixture.reportRequest,
    accounts: fixture.accounts,
    postings: fixture.postings,
    sourceId: fixture.source.sourceId,
    freshness: freshnessFromRow(freshnessRow)
  };

  switch (reportName) {
    case "profit_and_loss":
      return buildProfitAndLossReport(baseInput);
    case "balance_sheet":
      return buildBalanceSheetReport(baseInput);
    case "trial_balance":
      return buildTrialBalanceReport(baseInput);
    case "cash_flow":
      return buildCashFlowReport({
        ...baseInput,
        cashAccountIds: fixture.cashFlow.cashAccountIds,
        activityByAccountId: fixture.cashFlow.activityByAccountId
      });
  }
}

function fixtureReportIssues(
  reportName: ReportName,
  report: BuiltReport,
  expectedSnapshotId: string,
  actualTotals: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>
): readonly ErpFinancialsFixtureSmokeIssue[] {
  const issues: ErpFinancialsFixtureSmokeIssue[] = [];

  if (report.snapshot.reportSnapshotId !== expectedSnapshotId) {
    issues.push({
      kind: "snapshot_id_mismatch",
      reportName,
      message: "fixture report snapshot id did not match the deterministic refresh contract"
    });
  }

  for (const [totalKey, expectedAmount] of Object.entries(expected)) {
    if (actualTotals[totalKey] !== expectedAmount) {
      issues.push({
        kind: "fixture_total_mismatch",
        reportName,
        message: `fixture total ${totalKey} did not match expected report-builder amount`
      });
    }
  }

  return issues;
}

async function persistFixtureReport(
  storage: ErpFinancialsFixtureSmokeStorageHooks | undefined,
  report: BuiltReport,
  freshnessRow: ReportFreshnessRow,
  reportName: ReportName,
  issues: ErpFinancialsFixtureSmokeIssue[]
): Promise<{ readonly snapshotRowsWritten: number; readonly freshnessRowsWritten: number }> {
  if (storage === undefined) {
    return { snapshotRowsWritten: 0, freshnessRowsWritten: 0 };
  }
  if (storage.writeReportSnapshot === undefined || storage.writeFreshnessRows === undefined) {
    issues.push({
      kind: "storage_hooks_incomplete",
      reportName,
      message: "fixture smoke storage must supply writeReportSnapshot and writeFreshnessRows to persist reports"
    });
    return { snapshotRowsWritten: 0, freshnessRowsWritten: 0 };
  }

  let snapshotRowsWritten = 0;
  let freshnessRowsWritten = 0;

  try {
    snapshotRowsWritten = await storage.writeReportSnapshot(report);
  } catch {
    issues.push({
      kind: "snapshot_write_failed",
      reportName,
      message: "fixture report snapshot write failed"
    });
  }

  try {
    freshnessRowsWritten = await storage.writeFreshnessRows([freshnessRow]);
  } catch {
    issues.push({
      kind: "freshness_write_failed",
      reportName,
      message: "fixture report freshness write failed"
    });
  }

  return { snapshotRowsWritten, freshnessRowsWritten };
}

function reportSummary(input: {
  readonly reportName: ReportName;
  readonly report: BuiltReport;
  readonly freshnessId: string;
  readonly totals: Readonly<Record<string, string>>;
  readonly expectedTotals: Readonly<Record<string, string>>;
  readonly status: ErpFinancialsFixtureSmokeReportStatus;
  readonly snapshotRowsWritten: number;
  readonly freshnessRowsWritten: number;
}): ErpFinancialsFixtureSmokeReportSummary {
  const summary = {
    reportName: input.reportName,
    status: input.status,
    snapshotId: input.report.snapshot.reportSnapshotId,
    freshnessId: input.freshnessId,
    totals: input.totals,
    expectedTotals: input.expectedTotals,
    lineCount: input.report.lines.length,
    totalCount: input.report.totals.length,
    snapshotRowCount: 1 + input.report.lines.length + input.report.totals.length,
    freshnessRowCount: 1,
    snapshotRowsWritten: input.snapshotRowsWritten,
    freshnessRowsWritten: input.freshnessRowsWritten,
    reconciliationStatus: input.report.metadata.reconciliationStatus,
    reconciliationDifference: input.report.metadata.reconciliationDifference,
    ...(input.report.metadata.cashFlow === undefined
      ? {}
      : { cashFlowSupportStatus: input.report.metadata.cashFlow.supportStatus })
  };

  return {
    ...summary,
    summaryHash: stableHash({
      reportName: summary.reportName,
      status: summary.status,
      snapshotId: summary.snapshotId,
      freshnessId: summary.freshnessId,
      totals: summary.totals,
      expectedTotals: summary.expectedTotals,
      lineCount: summary.lineCount,
      totalCount: summary.totalCount,
      snapshotRowCount: summary.snapshotRowCount,
      freshnessRowCount: summary.freshnessRowCount,
      reconciliationStatus: summary.reconciliationStatus,
      reconciliationDifference: summary.reconciliationDifference,
      ...(summary.cashFlowSupportStatus === undefined ? {} : { cashFlowSupportStatus: summary.cashFlowSupportStatus })
    })
  };
}

function fixtureRowCounts(fixture: StatementFixtureSet): FixtureLoadResult {
  return {
    companies: 1,
    sources: 1,
    importBatches: 1,
    checkpoints: 1,
    accounts: fixture.accounts.length,
    parties: fixture.parties.length,
    items: fixture.items.length,
    dimensions: fixture.dimensions.length,
    transactions: fixture.transactions.length,
    transactionLines: fixture.transactionLines.length,
    postings: fixture.postings.length
  };
}

function expectedTotals(fixture: StatementFixtureSet, reportName: ReportName): Readonly<Record<string, string>> {
  switch (reportName) {
    case "profit_and_loss":
      return fixture.expectedTotals.profitAndLoss;
    case "balance_sheet":
      return fixture.expectedTotals.balanceSheet;
    case "trial_balance":
      return fixture.expectedTotals.trialBalance;
    case "cash_flow":
      return fixture.expectedTotals.cashFlow;
  }
}

function totalsByKey(report: BuiltReport): Readonly<Record<string, string>> {
  return Object.fromEntries(report.totals.map((total) => [total.totalKey, total.amount]));
}

function freshnessFromRow(row: ReportFreshnessRow): ReportFreshness {
  return {
    status: row.status,
    sourceId: row.sourceId,
    ...(row.importBatchId === undefined ? {} : { importBatchId: row.importBatchId }),
    ...(row.checkpointId === undefined ? {} : { checkpointId: row.checkpointId }),
    ...(row.freshThrough === undefined ? {} : { freshThrough: row.freshThrough }),
    ...(row.staleReason === undefined ? {} : { staleReason: row.staleReason })
  };
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }

  return JSON.stringify(value);
}
