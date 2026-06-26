import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CORE_ERP_CANONICAL_REPORT_NAMES,
  DEFAULT_JSON_REF_MAX_BYTES,
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  assertSafeDrilldownRef,
  assertSafeSourcePayloadRef,
  buildBalanceSheetReport,
  buildCashFlowReport,
  buildCoreErpReportFromCanonicalReadModel,
  buildProfitAndLossReport,
  buildTrialBalanceReport
} from "../src/index.js";

import type {
  BuiltReport,
  CoreErpCanonicalReportGenerationRequest,
  CoreErpCanonicalReportReadModelStorage,
  CoreErpCanonicalReportSnapshotStorage,
  ReportBuilderInput,
  ReportFreshnessRow,
  ReportName,
  RollupBucket,
  StoredReportSnapshot
} from "../src/index.js";

const fixture = ERP_FINANCIALS_STATEMENT_FIXTURE;

const reportCases = [
  {
    reportName: "profit_and_loss",
    expectedTotals: fixture.expectedTotals.profitAndLoss,
    buildExpectedReport: buildProfitAndLossReport
  },
  {
    reportName: "balance_sheet",
    expectedTotals: fixture.expectedTotals.balanceSheet,
    buildExpectedReport: buildBalanceSheetReport
  },
  {
    reportName: "trial_balance",
    expectedTotals: fixture.expectedTotals.trialBalance,
    buildExpectedReport: buildTrialBalanceReport
  },
  {
    reportName: "cash_flow",
    expectedTotals: fixture.expectedTotals.cashFlow,
    buildExpectedReport: (input: ReportBuilderInput) =>
      buildCashFlowReport({
        ...input,
        cashAccountIds: fixture.cashFlow.cashAccountIds,
        activityByAccountId: fixture.cashFlow.activityByAccountId
      }),
    requestCashFlow: fixture.cashFlow
  }
] satisfies readonly {
  readonly reportName: ReportName;
  readonly expectedTotals: Readonly<Record<string, string>>;
  readonly buildExpectedReport: (input: ReportBuilderInput) => BuiltReport;
  readonly requestCashFlow?: CoreErpCanonicalReportGenerationRequest["cashFlow"];
}[];

describe("Core ERP canonical reporting read model", () => {
  it("serves fresh canonical report snapshots without loading provider-shaped payloads", async () => {
    const snapshotReport = buildProfitAndLossReport(reportInput());
    const storage = new RecordingReadModelStorage({
      snapshot: {
        snapshot: {
          ...snapshotReport.snapshot,
          freshness: {
            status: "fresh",
            sourceId: fixture.source.sourceId,
            importBatchId: fixture.importBatch.importBatchId,
            checkpointId: fixture.checkpoint.checkpointId,
            freshThrough: "2026-02-01T00:00:00.000Z"
          }
        },
        lines: snapshotReport.lines,
        totals: snapshotReport.totals
      }
    });

    const result = await buildCoreErpReportFromCanonicalReadModel(storage, reportRequest());

    expect(result.source).toBe("report_snapshot");
    expect(result.report.metadata.generatedFrom).toBe("report_snapshot");
    expect(reportTotals(result.report)).toEqual(reportTotals(snapshotReport));
    expect(storage.loadedBuilderInput).toBe(false);
    expect(result.freshness).toMatchObject({
      status: "fresh",
      importBatchId: fixture.importBatch.importBatchId,
      checkpointId: fixture.checkpoint.checkpointId
    });
    expectSafeReportReadModel(result);
  });

  it.each(reportCases)(
    "builds $reportName totals and drilldowns through Core ERP exports",
    async ({ reportName, expectedTotals, buildExpectedReport, requestCashFlow }) => {
      const input = reportInput();
      const storage = new RecordingReadModelStorage({ reportInput: input });

      const result = await buildCoreErpReportFromCanonicalReadModel(storage, {
        ...reportRequest(),
        reportName,
        preferStoredSnapshot: false,
        ...(requestCashFlow === undefined ? {} : { cashFlow: requestCashFlow })
      });
      const expectedReport = buildExpectedReport(input);

      expect(result.source).toBe("canonical_facts");
      expect(result.report.metadata.generatedFrom).toBe("ledger_postings");
      expect(result.report.snapshot.reportName).toBe(reportName);
      expect(reportTotals(result.report)).toMatchObject(expectedTotals);
      expect(reportTotals(result.report)).toEqual(reportTotals(expectedReport));
      expect(reportLineDrilldowns(result.report)).toEqual(reportLineDrilldowns(expectedReport));
      expect(reportTotalDrilldowns(result.report)).toEqual(reportTotalDrilldowns(expectedReport));
      expect(result.drilldownSurface.reportSnapshotId).toBe(result.report.snapshot.reportSnapshotId);
      expectEveryMaterialOutputHasDrilldown(result.report);
      expectSafeReportReadModel(result);
    }
  );

  it("returns freshness, rollup buckets, and bounded drilldown refs for Core ERP read models", async () => {
    const rollupBucket = {
      rollupBucketId: "rollup_fixture_sales_jan",
      tenantId: fixture.company.tenantId,
      companyId: fixture.company.companyId,
      sourceId: fixture.source.sourceId,
      accountId: "acct_sales",
      accountingBasis: "accrual",
      bucketGrain: "month",
      bucketStart: "2026-01-01",
      bucketEnd: "2026-01-31",
      currencyCode: "USD",
      dimensionHash: fixture.postings[0]?.dimensionHash ?? "",
      debitAmount: "0.00",
      creditAmount: "20000.00",
      netAmount: "-20000.00",
      postingCount: 2,
      importBatchId: fixture.importBatch.importBatchId,
      generatedAt: "2026-02-01T00:00:00.000Z"
    } satisfies RollupBucket;
    const storage = new RecordingReadModelStorage({
      reportInput: {
        ...reportInput(),
        freshness: {
          status: "partial",
          sourceId: fixture.source.sourceId,
          importBatchId: fixture.importBatch.importBatchId,
          checkpointId: fixture.checkpoint.checkpointId,
          freshThrough: "2026-02-01T00:00:00.000Z"
        }
      },
      rollupBuckets: [rollupBucket]
    });

    const result = await buildCoreErpReportFromCanonicalReadModel(storage, {
      ...reportRequest(),
      preferStoredSnapshot: false,
      rollupBucketRequest: {
        tenantId: fixture.company.tenantId,
        companyId: fixture.company.companyId,
        sourceId: fixture.source.sourceId,
        accountingBasis: "accrual",
        bucketGrain: "month",
        bucketStart: "2026-01-01",
        bucketEnd: "2026-01-31",
        currencyCode: "USD"
      }
    });

    expect(result.freshness).toMatchObject({
      status: "partial",
      sourceId: fixture.source.sourceId,
      importBatchId: fixture.importBatch.importBatchId,
      checkpointId: fixture.checkpoint.checkpointId
    });
    expect(result.rollupBuckets).toEqual([rollupBucket]);
    expect(result.drilldownSurface.reconciliationDifference.drilldownRef).toMatchObject({
      token: "profit_and_loss:reconciliation_difference",
      query: {
        kind: "ledger_postings",
        tenantId: fixture.company.tenantId,
        sourceId: fixture.source.sourceId,
        accountingBasis: "accrual",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31"
      }
    });
    expectSafeReportReadModel(result);
  });

  it("persists generated Core ERP snapshots and freshness rows through snapshot storage hooks", async () => {
    const storage = new RecordingSnapshotStorage({ reportInput: reportInput() });

    const result = await buildCoreErpReportFromCanonicalReadModel(storage, {
      ...reportRequest(),
      reportName: "balance_sheet",
      preferStoredSnapshot: false,
      persistGeneratedSnapshot: true,
      sourceFreshThrough: "2026-02-01T00:00:00.000Z",
      importedThrough: "2026-02-01T00:00:00.000Z",
      importBatchId: fixture.importBatch.importBatchId,
      checkpointId: fixture.checkpoint.checkpointId
    });

    expect(result.persistence).toMatchObject({
      snapshotId: "snapshot:tenant_fixture:balance_sheet:accrual:2026-01-01:2026-01-31:2026-01-31:USD",
      freshnessRow: {
        freshnessId: "freshness:tenant_fixture:company_fixture:source_native_fixture:balance_sheet:accrual:2026-01-01:2026-01-31:USD",
        status: "fresh",
        freshThrough: "2026-02-01T00:00:00.000Z",
        importBatchId: "batch_fixture_2026_01",
        checkpointId: "checkpoint_fixture_2026_01"
      }
    });
    expect(storage.writtenReports).toHaveLength(1);
    expect(storage.writtenFreshnessRows).toHaveLength(1);
    expect(storage.writtenReports[0]?.snapshot.reportSnapshotId).toBe(result.persistence?.snapshotId);
    expect(storage.writtenReports[0]?.lines.every((line) => line.reportSnapshotId === result.persistence?.snapshotId)).toBe(true);
    expect(storage.writtenReports[0]?.totals.every((total) => total.reportSnapshotId === result.persistence?.snapshotId)).toBe(true);
    expect(storage.writtenFreshnessRows[0]).toEqual(result.persistence?.freshnessRow);
    expectSafeReportReadModel(result);
  });

  it("denies Core ERP report reads outside tenant and source access scope", async () => {
    const storage = new RecordingReadModelStorage({});

    await expect(
      buildCoreErpReportFromCanonicalReadModel(storage, {
        ...reportRequest(),
        tenantAccess: {
          tenantId: "tenant_other"
        }
      })
    ).rejects.toThrow(/read denied for tenant/);

    await expect(
      buildCoreErpReportFromCanonicalReadModel(storage, {
        ...reportRequest(),
        tenantAccess: {
          tenantId: fixture.company.tenantId,
          sourceIds: ["source_other"]
        }
      })
    ).rejects.toThrow(/read denied for source/);
  });

  it("keeps Core ERP consumer imports on canonical report helpers and all supported reports", () => {
    const consumerTypes = readFileSync(new URL("./core-erp-consumer-type-imports.ts", import.meta.url), "utf8");

    expect(CORE_ERP_CANONICAL_REPORT_NAMES).toEqual(["profit_and_loss", "balance_sheet", "trial_balance", "cash_flow"]);
    expect(consumerTypes).toContain("buildCoreErpReportFromCanonicalReadModel");
    expect(consumerTypes).toContain("CoreErpCanonicalReportReadModelStorage");
    expect(consumerTypes).toContain("CoreErpCanonicalReportGenerationRequest");
    expect(consumerTypes).toContain("CoreErpReportFreshness");
    expect(consumerTypes).toContain("CoreErpReportDrilldownSurface");
    for (const reportName of CORE_ERP_CANONICAL_REPORT_NAMES) {
      expect(consumerTypes).toContain(reportName);
    }
    expect(consumerTypes).not.toMatch(
      /NormalizedQuickBooks(?:ProfitAndLoss|BalanceSheet|TrialBalance|CashFlowParity|Provider)Report(?:Request|Response)Envelope/
    );
    expect(consumerTypes).not.toMatch(/Intuit|OAuth|access[_-]?token|refresh[_-]?token|client[_-]?secret/i);
  });
});

class RecordingReadModelStorage implements CoreErpCanonicalReportReadModelStorage {
  loadedBuilderInput = false;

  constructor(
    private readonly options: {
      readonly snapshot?: StoredReportSnapshot;
      readonly reportInput?: ReportBuilderInput;
      readonly rollupBuckets?: readonly RollupBucket[];
    }
  ) {}

  loadReportBuilderInput(): Promise<ReportBuilderInput> {
    this.loadedBuilderInput = true;

    return Promise.resolve(this.options.reportInput ?? reportInput());
  }

  loadLatestReportSnapshot(): Promise<StoredReportSnapshot | undefined> {
    return Promise.resolve(this.options.snapshot);
  }

  loadRollupBuckets(): Promise<readonly RollupBucket[]> {
    return Promise.resolve(this.options.rollupBuckets ?? []);
  }
}

class RecordingSnapshotStorage extends RecordingReadModelStorage implements CoreErpCanonicalReportSnapshotStorage {
  readonly writtenReports: BuiltReport[] = [];
  readonly writtenFreshnessRows: ReportFreshnessRow[] = [];

  writeReportSnapshot(report: BuiltReport): Promise<number> {
    this.writtenReports.push(report);

    return Promise.resolve(1 + report.lines.length + report.totals.length);
  }

  writeFreshnessRows(rows: readonly ReportFreshnessRow[]): Promise<number> {
    this.writtenFreshnessRows.push(...rows);

    return Promise.resolve(rows.length);
  }
}

function reportRequest(): CoreErpCanonicalReportGenerationRequest {
  return {
    tenantId: fixture.company.tenantId,
    companyId: fixture.company.companyId,
    sourceId: fixture.source.sourceId,
    tenantAccess: {
      tenantId: fixture.company.tenantId,
      sourceIds: [fixture.source.sourceId]
    },
    reportName: "profit_and_loss",
    accountingBasis: "accrual",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    asOfDate: "2026-01-31",
    currencyCode: "USD",
    generatedAt: "2026-02-01T00:00:00.000Z"
  };
}

function reportInput(): ReportBuilderInput {
  return {
    ...fixture.reportRequest,
    accounts: fixture.accounts,
    postings: fixture.postings,
    freshness: {
      status: "fresh",
      sourceId: fixture.source.sourceId,
      importBatchId: fixture.importBatch.importBatchId,
      checkpointId: fixture.checkpoint.checkpointId,
      freshThrough: "2026-02-01T00:00:00.000Z"
    }
  };
}

function reportTotals(report: BuiltReport): Record<string, string> {
  return Object.fromEntries(report.totals.map((total) => [total.totalKey, total.amount]));
}

function reportLineDrilldowns(report: BuiltReport): Record<string, unknown> {
  return Object.fromEntries(
    report.lines.map((line) => [
      line.reportLineId,
      {
        label: line.label,
        amount: line.amount,
        drilldownRef: line.drilldownRef
      }
    ])
  );
}

function reportTotalDrilldowns(report: BuiltReport): Record<string, unknown> {
  return Object.fromEntries(
    report.totals.map((total) => [
      total.totalKey,
      {
        amount: total.amount,
        drilldownRef: total.drilldownRef
      }
    ])
  );
}

function expectEveryMaterialOutputHasDrilldown(report: BuiltReport): void {
  for (const line of report.lines.filter((entry) => entry.amount !== "0.00")) {
    expect(line.drilldownRef.token).toContain(report.snapshot.reportName);
    expect(line.drilldownRef.accountIds?.length).toBeGreaterThan(0);
    expect(line.drilldownRef.postingIds?.length).toBeGreaterThan(0);
    expect(line.drilldownRef.query).toMatchObject({
      kind: "ledger_postings",
      tenantId: fixture.company.tenantId,
      accountingBasis: "accrual",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31"
    });
  }

  for (const total of report.totals.filter((entry) => entry.amount !== "0.00")) {
    expect(total.drilldownRef.token).toContain(report.snapshot.reportName);
    expect(total.drilldownRef.postingIds?.length).toBeGreaterThan(0);
  }
}

function expectSafeReportReadModel(result: Awaited<ReturnType<typeof buildCoreErpReportFromCanonicalReadModel>>): void {
  assertSafeSourcePayloadRef(result.drilldownSurface.reportSnapshotRef);
  assertSafeDrilldownRef(result.drilldownSurface.reconciliationDifference.drilldownRef);
  expectSerializedJsonToBeBounded(result.drilldownSurface.reportSnapshotRef);
  expectSerializedJsonToBeBounded(result.drilldownSurface.reconciliationDifference.drilldownRef);

  for (const entry of [...result.drilldownSurface.lines, ...result.drilldownSurface.totals]) {
    assertSafeDrilldownRef(entry.drilldownRef);
    expectSerializedJsonToBeBounded(entry.drilldownRef);
  }

  expect(JSON.stringify(result)).not.toMatch(
    /Intuit|OAuth|access[_-]?token|refresh[_-]?token|client[_-]?secret|rawPayload|providerPayload/i
  );
}

function expectSerializedJsonToBeBounded(value: unknown): void {
  expect(value).toBeDefined();
  expect(Buffer.byteLength(JSON.stringify(value), "utf8")).toBeLessThanOrEqual(DEFAULT_JSON_REF_MAX_BYTES);
}
