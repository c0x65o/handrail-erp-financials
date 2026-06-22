import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES,
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  DEFAULT_JSON_REF_MAX_BYTES,
  assertSafeDrilldownRef,
  assertSafeSourcePayloadRef,
  buildBalanceSheetReport,
  buildCashFlowReport,
  buildFutureErpReportFromCanonicalReadModel,
  buildProfitAndLossReport,
  buildTrialBalanceReport,
  createPostgresStorageAdapter,
  fetchFutureErpQuickBooksProviderReportParitySnapshot
} from "../src/index.js";

import type {
  BuiltReport,
  FutureErpCanonicalReportReadModelStorage,
  FutureErpCanonicalReportSnapshotStorage,
  FutureErpQuickBooksProviderReportParityClient,
  FutureErpQuickBooksProviderReportParityResult,
  LoadReportBuilderInput,
  NormalizedQuickBooksBalanceSheetReportRequestEnvelope,
  NormalizedQuickBooksCanonicalReportTotal,
  NormalizedQuickBooksCashFlowParityReportRequestEnvelope,
  NormalizedQuickBooksProfitAndLossReportRequestEnvelope,
  NormalizedQuickBooksProviderReportName,
  NormalizedQuickBooksProviderReportRequestEnvelope,
  NormalizedQuickBooksTrialBalanceReportRequestEnvelope,
  PostgresQueryClient,
  PostgresQueryResult,
  ReportBuilderInput,
  ReportFreshnessRow,
  ReportName,
  RollupBucket,
  StoredReportSnapshot
} from "../src/index.js";

type QueryCall = {
  readonly sql: string;
  readonly params: readonly unknown[];
};

const fixture = ERP_FINANCIALS_STATEMENT_FIXTURE;
const quickBooksFixtures = ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES;
const coreReportCases = [
  {
    reportName: "profit_and_loss",
    buildExpectedReport: buildProfitAndLossReport,
    expectedTotals: fixture.expectedTotals.profitAndLoss
  },
  {
    reportName: "balance_sheet",
    buildExpectedReport: buildBalanceSheetReport,
    expectedTotals: fixture.expectedTotals.balanceSheet
  },
  {
    reportName: "trial_balance",
    buildExpectedReport: buildTrialBalanceReport,
    expectedTotals: fixture.expectedTotals.trialBalance
  }
] satisfies readonly {
  readonly reportName: Exclude<ReportName, "cash_flow">;
  readonly buildExpectedReport: (input: ReportBuilderInput) => BuiltReport;
  readonly expectedTotals: Readonly<Record<string, string>>;
}[];

describe("Future ERP canonical reporting read model", () => {
  it("serves fresh report snapshots without loading provider-shaped import archives", async () => {
    const snapshotReport = buildProfitAndLossReport({
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
    });
    const storage = new RecordingReadModelStorage({
      snapshot: {
        snapshot: snapshotReport.snapshot,
        lines: snapshotReport.lines,
        totals: snapshotReport.totals
      }
    });

    const result = await buildFutureErpReportFromCanonicalReadModel(storage, reportRequest());

    expect(result.source).toBe("report_snapshot");
    expect(result.report.metadata.generatedFrom).toBe("report_snapshot");
    expect(result.report.totals.map((total) => [total.totalKey, total.amount])).toEqual(
      snapshotReport.totals.map((total) => [total.totalKey, total.amount])
    );
    expect(storage.loadedBuilderInput).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/Intuit|OAuth|access[_-]?token|refresh[_-]?token|client[_-]?secret/i);
  });

  it("falls back to canonical accounts, postings, freshness, and rollups when no fresh snapshot exists", async () => {
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
        ...fixture.reportRequest,
        accounts: fixture.accounts,
        postings: fixture.postings,
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

    const result = await buildFutureErpReportFromCanonicalReadModel(storage, {
      ...reportRequest(),
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

    expect(result.source).toBe("canonical_facts");
    expect(result.report.metadata.generatedFrom).toBe("ledger_postings");
    expect(result.report.snapshot.freshness).toMatchObject({
      status: "partial",
      sourceId: fixture.source.sourceId,
      importBatchId: fixture.importBatch.importBatchId,
      checkpointId: fixture.checkpoint.checkpointId
    });
    expect(result.rollupBuckets).toEqual([rollupBucket]);
    expect(storage.loadedBuilderInput).toBe(true);
  });

  it.each(coreReportCases)(
    "builds $reportName from ERP Financials canonical report builders with totals and drilldowns",
    async ({ reportName, buildExpectedReport, expectedTotals }) => {
      const reportInput = {
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
      } satisfies ReportBuilderInput;
      const storage = new RecordingReadModelStorage({
        reportInput
      });

      const result = await buildFutureErpReportFromCanonicalReadModel(storage, {
        ...reportRequest(),
        reportName,
        preferStoredSnapshot: false
      });
      const expectedReport = buildExpectedReport(reportInput);

      expect(result.source).toBe("canonical_facts");
      expect(result.report.metadata.generatedFrom).toBe("ledger_postings");
      expect(result.report.snapshot.reportName).toBe(reportName);
      expect(result.report.snapshot.snapshotSource).toBe("builder");
      expect(reportTotals(result.report)).toMatchObject(expectedTotals);
      expect(reportTotals(result.report)).toEqual(reportTotals(expectedReport));
      expect(reportLineDrilldowns(result.report)).toEqual(reportLineDrilldowns(expectedReport));
      expect(reportTotalDrilldowns(result.report)).toEqual(reportTotalDrilldowns(expectedReport));
      expectEveryMaterialOutputHasDrilldown(result.report);
      expect(result.drilldownSurface).toMatchObject({
        tenantId: fixture.company.tenantId,
        reportSnapshotId: result.report.snapshot.reportSnapshotId,
        reconciliationDifference: {
          status: result.report.snapshot.reconciliationStatus,
          difference: result.report.snapshot.reconciliationDifference
        }
      });
      expect(result.drilldownSurface.reportSnapshotRef).toMatchObject({
        sourceObjectType: "CanonicalReportSnapshot",
        sourceObjectId: result.report.snapshot.reportSnapshotId
      });
      expect(result.drilldownSurface.reconciliationDifference.drilldownRef).toMatchObject({
        token: `${reportName}:reconciliation_difference`,
        query: {
          kind: "ledger_postings",
          tenantId: fixture.company.tenantId,
          accountingBasis: "accrual",
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31"
        }
      });
      expect(JSON.stringify(result.drilldownSurface)).not.toMatch(/Intuit|OAuth|access[_-]?token|refresh[_-]?token|client[_-]?secret|rawPayload/i);
    }
  );

  it("builds supported cash flow from canonical postings and app-owned cash classifications", async () => {
    const reportInput = {
      ...fixture.reportRequest,
      accounts: fixture.accounts,
      postings: fixture.postings.filter((posting) => !posting.postingId.includes("unclassified")),
      freshness: {
        status: "fresh" as const,
        sourceId: fixture.source.sourceId,
        importBatchId: fixture.importBatch.importBatchId,
        checkpointId: fixture.checkpoint.checkpointId,
        freshThrough: "2026-02-01T00:00:00.000Z"
      }
    } satisfies ReportBuilderInput;
    const storage = new RecordingReadModelStorage({ reportInput });

    const result = await buildFutureErpReportFromCanonicalReadModel(storage, {
      ...reportRequest(),
      reportName: "cash_flow",
      preferStoredSnapshot: false,
      cashFlow: fixture.cashFlow
    });
    const expectedReport = buildCashFlowReport({
      ...reportInput,
      cashAccountIds: fixture.cashFlow.cashAccountIds,
      activityByAccountId: fixture.cashFlow.activityByAccountId
    });

    expect(result.source).toBe("canonical_facts");
    expect(result.report.metadata.generatedFrom).toBe("ledger_postings");
    expect(result.report.metadata.cashFlow).toMatchObject({
      supportStatus: "supported",
      derivationMethod: "cash_account_ledger_movement",
      cashAccountIds: fixture.cashFlow.cashAccountIds,
      unsupportedReasons: [],
      unclassifiedCashMovementPostingIds: []
    });
    expect(reportTotals(result.report)).toEqual(reportTotals(expectedReport));
    expect(reportLineDrilldowns(result.report)).toEqual(reportLineDrilldowns(expectedReport));
    expect(reportTotalDrilldowns(result.report)).toEqual(reportTotalDrilldowns(expectedReport));
    expectEveryMaterialOutputHasDrilldown(result.report);
  });

  it("builds partial cash flow when canonical cash movement cannot be classified", async () => {
    const reportInput = {
      ...fixture.reportRequest,
      accounts: fixture.accounts,
      postings: fixture.postings,
      freshness: {
        status: "partial" as const,
        sourceId: fixture.source.sourceId,
        importBatchId: fixture.importBatch.importBatchId,
        checkpointId: fixture.checkpoint.checkpointId,
        freshThrough: "2026-02-01T00:00:00.000Z"
      }
    } satisfies ReportBuilderInput;
    const storage = new RecordingReadModelStorage({ reportInput });

    const result = await buildFutureErpReportFromCanonicalReadModel(storage, {
      ...reportRequest(),
      reportName: "cash_flow",
      preferStoredSnapshot: false,
      cashFlow: fixture.cashFlow
    });

    expect(result.source).toBe("canonical_facts");
    expect(reportTotals(result.report)).toMatchObject(fixture.expectedTotals.cashFlow);
    expect(result.report.metadata.cashFlow).toMatchObject({
      supportStatus: "partial",
      unsupportedReasons: ["cash_flow_has_unclassified_cash_movement"],
      unclassifiedCashMovementPostingIds: ["post_unclassified_cash"]
    });
    expect(result.report.snapshot.freshness.status).toBe("partial");
    expectEveryMaterialOutputHasDrilldown(result.report);
  });

  it("builds unsupported cash flow when app-owned cash account classification is unavailable", async () => {
    const reportInput = {
      ...fixture.reportRequest,
      accounts: fixture.accounts,
      postings: fixture.postings,
      freshness: {
        status: "unknown" as const
      }
    } satisfies ReportBuilderInput;
    const storage = new RecordingReadModelStorage({ reportInput });

    const result = await buildFutureErpReportFromCanonicalReadModel(storage, {
      ...reportRequest(),
      reportName: "cash_flow",
      preferStoredSnapshot: false,
      cashFlow: {
        cashAccountIds: [],
        activityByAccountId: fixture.cashFlow.activityByAccountId
      }
    });

    expect(result.source).toBe("canonical_facts");
    expect(result.report.metadata.cashFlow).toMatchObject({
      supportStatus: "unsupported",
      cashAccountIds: [],
      unsupportedReasons: ["cash_flow_requires_cash_account_ids"],
      unclassifiedCashMovementPostingIds: []
    });
    expect(reportTotals(result.report)).toMatchObject({
      cash_beginning: "0.00",
      net_cash_flow: "0.00",
      cash_ending: "0.00"
    });
    expect(result.report.metadata.reconciliationStatus).toBe("not_reconciled");
  });

  it("persists generated canonical report snapshots and fresh freshness rows with deterministic scope", async () => {
    const reportInput = {
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
    } satisfies ReportBuilderInput;
    const storage = new RecordingSnapshotStorage({ reportInput });

    const result = await buildFutureErpReportFromCanonicalReadModel(storage, {
      ...reportRequest(),
      reportName: "balance_sheet",
      preferStoredSnapshot: false,
      persistGeneratedSnapshot: true,
      sourceFreshThrough: "2026-02-01T00:00:00.000Z",
      importedThrough: "2026-02-01T00:00:00.000Z",
      importBatchId: fixture.importBatch.importBatchId,
      checkpointId: fixture.checkpoint.checkpointId
    });

    expect(result.source).toBe("canonical_facts");
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
    expect(storage.writtenReports[0]?.snapshot).toMatchObject({
      reportSnapshotId: "snapshot:tenant_fixture:balance_sheet:accrual:2026-01-01:2026-01-31:2026-01-31:USD",
      reportName: "balance_sheet",
      accountingBasis: "accrual",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      asOfDate: "2026-01-31",
      currencyCode: "USD",
      freshness: {
        status: "fresh",
        sourceId: "source_native_fixture",
        importBatchId: "batch_fixture_2026_01",
        checkpointId: "checkpoint_fixture_2026_01",
        freshThrough: "2026-02-01T00:00:00.000Z"
      }
    });
    expect(storage.writtenReports[0]?.lines.every((line) => line.reportSnapshotId === result.persistence?.snapshotId)).toBe(true);
    expect(storage.writtenReports[0]?.totals.every((total) => total.reportSnapshotId === result.persistence?.snapshotId)).toBe(true);
    expect(storage.writtenFreshnessRows[0]).toEqual(result.persistence?.freshnessRow);
    expect(result.report.snapshot.freshness.status).toBe("fresh");
  });

  it("persists partial freshness when imported canonical facts lag the source boundary", async () => {
    const storage = new RecordingSnapshotStorage({
      reportInput: {
        ...fixture.reportRequest,
        accounts: fixture.accounts,
        postings: fixture.postings,
        freshness: {
          status: "partial",
          sourceId: fixture.source.sourceId,
          importBatchId: fixture.importBatch.importBatchId,
          checkpointId: fixture.checkpoint.checkpointId,
          freshThrough: "2026-02-01T00:00:00.000Z"
        }
      }
    });

    const result = await buildFutureErpReportFromCanonicalReadModel(storage, {
      ...reportRequest(),
      reportName: "trial_balance",
      preferStoredSnapshot: false,
      persistGeneratedSnapshot: true,
      sourceFreshThrough: "2026-02-02T00:00:00.000Z",
      importedThrough: "2026-02-01T00:00:00.000Z"
    });

    expect(result.persistence?.freshnessRow).toMatchObject({
      freshnessId: "freshness:tenant_fixture:company_fixture:source_native_fixture:trial_balance:accrual:2026-01-01:2026-01-31:USD",
      status: "partial",
      freshThrough: "2026-02-01T00:00:00.000Z",
      staleReason: "imported_boundary_behind_source_boundary",
      importBatchId: "batch_fixture_2026_01",
      checkpointId: "checkpoint_fixture_2026_01"
    });
    expect(storage.writtenReports[0]?.snapshot.freshness).toMatchObject({
      status: "partial",
      staleReason: "imported_boundary_behind_source_boundary"
    });
  });

  it("persists stale freshness rows for generated reports pending refresh", async () => {
    const storage = new RecordingSnapshotStorage({
      reportInput: {
        ...fixture.reportRequest,
        accounts: fixture.accounts,
        postings: fixture.postings,
        freshness: {
          status: "stale",
          sourceId: fixture.source.sourceId,
          importBatchId: fixture.importBatch.importBatchId,
          checkpointId: fixture.checkpoint.checkpointId,
          freshThrough: "2026-02-01T00:00:00.000Z",
          staleReason: "late_arrival_overlap_reprocess"
        }
      }
    });

    const result = await buildFutureErpReportFromCanonicalReadModel(storage, {
      ...reportRequest(),
      preferStoredSnapshot: false,
      persistGeneratedSnapshot: true,
      sourceFreshThrough: "2026-02-01T00:00:00.000Z",
      importedThrough: "2026-02-01T00:00:00.000Z"
    });

    expect(result.persistence?.snapshotId).toBe(
      "snapshot:tenant_fixture:profit_and_loss:accrual:2026-01-01:2026-01-31:2026-01-31:USD"
    );
    expect(result.persistence?.freshnessRow).toMatchObject({
      freshnessId: "freshness:tenant_fixture:company_fixture:source_native_fixture:profit_and_loss:accrual:2026-01-01:2026-01-31:USD",
      status: "stale",
      staleReason: "late_arrival_overlap_reprocess",
      importBatchId: "batch_fixture_2026_01",
      checkpointId: "checkpoint_fixture_2026_01"
    });
    expect(result.report.snapshot.freshness).toMatchObject({
      status: "stale",
      staleReason: "late_arrival_overlap_reprocess"
    });
  });

  it("requires snapshot write hooks when persistence is requested", async () => {
    const storage = new RecordingReadModelStorage({});

    await expect(
      buildFutureErpReportFromCanonicalReadModel(storage, {
        ...reportRequest(),
        preferStoredSnapshot: false,
        persistGeneratedSnapshot: true
      })
    ).rejects.toThrow(/writeReportSnapshot and writeFreshnessRows/);
  });

  it("denies Future ERP report reads outside the tenant/source access scope", async () => {
    const storage = new RecordingReadModelStorage({});

    await expect(
      buildFutureErpReportFromCanonicalReadModel(storage, {
        ...reportRequest(),
        tenantAccess: {
          tenantId: "tenant_other"
        }
      })
    ).rejects.toThrow(/read denied for tenant/);

    await expect(
      buildFutureErpReportFromCanonicalReadModel(storage, {
        ...reportRequest(),
        tenantAccess: {
          tenantId: fixture.company.tenantId,
          sourceIds: ["source_other"]
        }
      })
    ).rejects.toThrow(/read denied for source/);
  });

  it("rejects canonical report rows that storage returns outside the requested tenant scope", async () => {
    const report = buildProfitAndLossReport({
      ...fixture.reportRequest,
      tenantId: "tenant_other",
      accounts: fixture.accounts.map((account) => ({ ...account, tenantId: "tenant_other" })),
      postings: fixture.postings.map((posting) => ({ ...posting, tenantId: "tenant_other" }))
    });
    const storage = new RecordingReadModelStorage({
      snapshot: {
        snapshot: {
          ...report.snapshot,
          freshness: { status: "fresh" }
        },
        lines: report.lines,
        totals: report.totals
      }
    });

    await expect(buildFutureErpReportFromCanonicalReadModel(storage, reportRequest())).rejects.toThrow(/does not match request/);
  });

  it("preserves cash-flow support state when serving a fresh stored snapshot", async () => {
    const snapshotReport = buildCashFlowReport({
      ...fixture.reportRequest,
      accounts: fixture.accounts,
      postings: fixture.postings,
      cashAccountIds: fixture.cashFlow.cashAccountIds,
      activityByAccountId: fixture.cashFlow.activityByAccountId,
      freshness: {
        status: "fresh",
        sourceId: fixture.source.sourceId,
        importBatchId: fixture.importBatch.importBatchId,
        checkpointId: fixture.checkpoint.checkpointId,
        freshThrough: "2026-02-01T00:00:00.000Z"
      }
    });
    const storage = new RecordingReadModelStorage({
      snapshot: {
        snapshot: snapshotReport.snapshot,
        lines: snapshotReport.lines,
        totals: snapshotReport.totals
      }
    });

    const result = await buildFutureErpReportFromCanonicalReadModel(storage, {
      ...reportRequest(),
      reportName: "cash_flow",
      cashFlow: fixture.cashFlow
    });

    expect(result.source).toBe("report_snapshot");
    expect(storage.loadedBuilderInput).toBe(false);
    expect(result.report.metadata.generatedFrom).toBe("report_snapshot");
    expect(result.report.metadata.cashFlow).toMatchObject({
      supportStatus: "partial",
      unsupportedReasons: ["cash_flow_has_unclassified_cash_movement"],
      unclassifiedCashMovementPostingIds: ["post_unclassified_cash"]
    });
  });

  it("rejects cash-flow read-model requests without app-owned classification inputs", async () => {
    const storage = new RecordingReadModelStorage({});

    await expect(
      buildFutureErpReportFromCanonicalReadModel(storage, {
        ...reportRequest(),
        reportName: "cash_flow",
        preferStoredSnapshot: false
      })
    ).rejects.toThrow(/cashFlow account classification options/);
    expect(storage.loadedBuilderInput).toBe(false);
  });

  it("loads report read-model rows only from canonical storage tables", async () => {
    const client = new RecordingClient();
    const adapter = createPostgresStorageAdapter(client);

    await adapter.loadLatestReportSnapshot(reportRequest());
    await adapter.loadReportBuilderInput(reportRequest());
    await adapter.loadRollupBuckets({
      tenantId: fixture.company.tenantId,
      companyId: fixture.company.companyId,
      sourceId: fixture.source.sourceId,
      accountingBasis: "accrual",
      bucketGrain: "month",
      bucketStart: "2026-01-01",
      bucketEnd: "2026-01-31",
      currencyCode: "USD"
    });

    const sql = client.calls.map((call) => call.sql).join("\n");

    expect(sql).toContain('"report_snapshots"');
    expect(sql).toContain('"accounts"');
    expect(sql).toContain('"ledger_postings"');
    expect(sql).toContain('"report_freshness"');
    expect(sql).toContain('"rollup_buckets"');
    expect(sql).not.toMatch(/Intuit|OAuth|access[_-]?token|refresh[_-]?token|client[_-]?secret/i);
    expect(sql).not.toMatch(/quickbooks_.*archive|provider_.*archive|raw_.*payload/i);
  });

  it("requests all normalized QuickBooks provider report envelopes and marks matching canonical totals", async () => {
    const client = new FixtureQuickBooksProviderReportClient();

    const snapshot = await fetchFutureErpQuickBooksProviderReportParitySnapshot({
      ...quickBooksProviderParityRequest(client),
      reports: canonicalReportsForProviderParity()
    });

    expect(client.reportNames).toEqual(["profit_and_loss", "balance_sheet", "trial_balance", "cash_flow"]);
    expect(snapshot.reports.map((report) => [report.reportName, report.status])).toEqual([
      ["profit_and_loss", "matched"],
      ["balance_sheet", "matched"],
      ["trial_balance", "matched"],
      ["cash_flow", "unsupported"]
    ]);
    const profitAndLossTotals = reportParity(snapshot, "profit_and_loss")?.evidence?.totals ?? [];
    expect(
      profitAndLossTotals.map((total) => ({
        totalKey: total.totalKey,
        canonicalAmount: total.canonicalAmount,
        providerAmount: total.providerAmount,
        difference: total.difference,
        status: total.status
      }))
    ).toEqual([
      {
        totalKey: "income",
        canonicalAmount: "20000.00",
        providerAmount: "20000.00",
        difference: "0.00",
        status: "matched"
      },
      {
        totalKey: "expenses",
        canonicalAmount: "6200.00",
        providerAmount: "6200.00",
        difference: "0.00",
        status: "matched"
      },
      {
        totalKey: "net_income",
        canonicalAmount: "13800.00",
        providerAmount: "13800.00",
        difference: "0.00",
        status: "matched"
      }
    ]);
    expect(profitAndLossTotals.map((total) => total.drilldownRef?.sourceObjectType)).toEqual([
      "ReportTotal",
      "ReportTotal",
      "ReportTotal"
    ]);
    expect(reportParity(snapshot, "profit_and_loss")?.reconciliationDifferenceDrilldownRef).toMatchObject({
      token: "profit_and_loss:quickbooks_reconciliation_difference",
      query: {
        kind: "ledger_postings",
        tenantId: quickBooksFixtures.providerReports.profitAndLoss.request.sourceIdentity.tenantId,
        sourceId: quickBooksFixtures.providerReports.profitAndLoss.request.sourceIdentity.sourceId,
        accountingBasis: "accrual",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31"
      }
    });
    expect(reportParity(snapshot, "profit_and_loss")?.providerReportRef).toMatchObject({
      provider: "quickbooks",
      reportName: "profit_and_loss"
    });
    expect(reportParity(snapshot, "profit_and_loss")?.toleranceAmount).toBe("0.00");
    expect(
      reportParity(snapshot, "profit_and_loss")?.deltas?.map((delta) => ({
        totalKey: delta.totalKey,
        status: delta.status,
        canonicalAmount: delta.canonicalAmount,
        providerAmount: delta.providerAmount,
        difference: delta.difference,
        absoluteDifference: delta.absoluteDifference,
        toleranceAmount: delta.toleranceAmount
      }))
    ).toEqual([
      {
        totalKey: "income",
        status: "matched",
        canonicalAmount: "20000.00",
        providerAmount: "20000.00",
        difference: "0.00",
        absoluteDifference: "0.00",
        toleranceAmount: "0.00"
      },
      {
        totalKey: "expenses",
        status: "matched",
        canonicalAmount: "6200.00",
        providerAmount: "6200.00",
        difference: "0.00",
        absoluteDifference: "0.00",
        toleranceAmount: "0.00"
      },
      {
        totalKey: "net_income",
        status: "matched",
        canonicalAmount: "13800.00",
        providerAmount: "13800.00",
        difference: "0.00",
        absoluteDifference: "0.00",
        toleranceAmount: "0.00"
      }
    ]);
    expect(reportParity(snapshot, "profit_and_loss")?.deltas?.[0]?.providerDrilldownRef).toMatchObject({
      sourceObjectType: "ReportTotal"
    });
    const incomeCanonicalDrilldownRef = reportParity(snapshot, "profit_and_loss")?.deltas?.[0]?.canonicalDrilldownRef;
    expect(incomeCanonicalDrilldownRef?.token).toContain("profit_and_loss");
    expect(incomeCanonicalDrilldownRef).toMatchObject({
      query: {
        kind: "ledger_postings",
        tenantId: fixture.company.tenantId,
        sourceId: fixture.source.sourceId,
        accountingBasis: "accrual",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31"
      }
    });
    expect(reportParity(snapshot, "profit_and_loss")?.deltas?.[1]?.canonicalDrilldownRef).toMatchObject({
      token: "profit_and_loss:expenses:canonical_total",
      query: {
        kind: "ledger_postings",
        tenantId: fixture.company.tenantId,
        accountingBasis: "accrual",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31"
      }
    });
    expect(reportParity(snapshot, "profit_and_loss")?.reconciliationDifferenceDrilldownRef?.sourceRefs).toContainEqual(
      expect.objectContaining({
        sourceObjectType: "Report",
        sourceObjectId: "profit_and_loss:2026-01-01:2026-01-31"
      })
    );
    expect(reportParity(snapshot, "balance_sheet")?.evidence?.totals.map((total) => total.totalKey)).toEqual([
      "assets",
      "liabilities",
      "equity"
    ]);
    expect(reportParity(snapshot, "trial_balance")?.evidence?.totals.map((total) => [total.totalKey, total.canonicalAmount])).toEqual([
      ["debits", "81900.00"],
      ["credits", "81900.00"],
      ["net", "0.00"]
    ]);
    expect(reportParity(snapshot, "profit_and_loss")?.request).toMatchObject({
      reportName: "profit_and_loss",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31"
    });
    expect(reportParity(snapshot, "balance_sheet")?.request).toMatchObject({
      reportName: "balance_sheet",
      asOfDate: "2026-01-31"
    });
    for (const reportName of ["profit_and_loss", "balance_sheet", "trial_balance"] as const) {
      expectBoundedParityDrilldownEvidence(reportParity(snapshot, reportName));
    }
    expect(JSON.stringify(snapshot)).not.toMatch(/Intuit|OAuth|access[_-]?token|refresh[_-]?token|client[_-]?secret|rawPayload/i);
  });

  it("honors tolerance when report-derived canonical totals are compared to QuickBooks provider totals", async () => {
    const reports = canonicalReportsForProviderParity();
    const profitAndLoss = reports.profit_and_loss;
    const snapshot = await fetchFutureErpQuickBooksProviderReportParitySnapshot({
      ...quickBooksProviderParityRequest(new FixtureQuickBooksProviderReportClient()),
      toleranceAmount: "0.01",
      reports: {
        profit_and_loss: {
          ...profitAndLoss,
          totals: profitAndLoss.totals.map((total) =>
            total.totalKey === "net_income"
              ? {
                  ...total,
                  amount: "13799.99"
                }
              : total
          )
        }
      }
    });

    const profitAndLossParity = reportParity(snapshot, "profit_and_loss");
    expect(profitAndLossParity).toMatchObject({
      status: "matched",
      reconciliationStatus: "balanced",
      reconciliationDifference: "0.01"
    });
    expect(profitAndLossParity?.evidence?.totals.at(-1)).toMatchObject({
      totalKey: "net_income",
      canonicalAmount: "13799.99",
      providerAmount: "13800.00",
      difference: "0.01",
      status: "matched"
    });
    expect(profitAndLossParity?.deltas?.at(-1)).toMatchObject({
      totalKey: "net_income",
      difference: "0.01",
      absoluteDifference: "0.01",
      toleranceAmount: "0.01",
      status: "matched"
    });
  });

  it("marks provider parity mismatched when fixture provider totals differ from canonical totals", async () => {
    const snapshot = await fetchFutureErpQuickBooksProviderReportParitySnapshot({
      ...quickBooksProviderParityRequest(new FixtureQuickBooksProviderReportClient()),
      canonicalTotalsByReport: {
        profit_and_loss: [
          canonicalTotal("income", "20000.00"),
          canonicalTotal("expenses", "6200.00"),
          canonicalTotal("net_income", "13799.97")
        ]
      }
    });

    const profitAndLoss = reportParity(snapshot, "profit_and_loss");
    expect(profitAndLoss).toMatchObject({
      status: "mismatched",
      reconciliationStatus: "out_of_balance",
      reconciliationDifference: "0.03"
    });
    expect(profitAndLoss?.evidence?.totals.at(-1)).toMatchObject({
      totalKey: "net_income",
      status: "mismatched",
      difference: "0.03"
    });
    expect(profitAndLoss?.deltas?.at(-1)).toMatchObject({
      totalKey: "net_income",
      status: "mismatched",
      difference: "0.03",
      absoluteDifference: "0.03",
      toleranceAmount: "0.00"
    });
  });

  it("distinguishes matched and mismatched provider parity for P&L, balance sheet, and trial balance with bounded drilldown evidence", async () => {
    const reports = canonicalReportsForProviderParity();
    const snapshot = await fetchFutureErpQuickBooksProviderReportParitySnapshot({
      ...quickBooksProviderParityRequest(new FixtureQuickBooksProviderReportClient()),
      reports: {
        profit_and_loss: reportWithTotalAmount(reports.profit_and_loss, "net_income", "13799.97"),
        balance_sheet: reportWithTotalAmount(reports.balance_sheet, "total_assets", "44699.99"),
        trial_balance: reportWithTotalAmount(reports.trial_balance, "total_credits", "81899.98")
      }
    });

    const expectedStatuses = new Map<NormalizedQuickBooksProviderReportName, readonly string[]>([
      ["profit_and_loss", ["matched", "matched", "mismatched"]],
      ["balance_sheet", ["mismatched", "matched", "matched"]],
      ["trial_balance", ["matched", "mismatched", "mismatched"]]
    ]);

    for (const reportName of ["profit_and_loss", "balance_sheet", "trial_balance"] as const) {
      const parity = reportParity(snapshot, reportName);
      expect(parity?.status).toBe("mismatched");
      expect(parity?.reconciliationStatus).toBe("out_of_balance");
      expect(parity?.evidence?.totals.map((total) => total.status)).toEqual(expectedStatuses.get(reportName));
      expectBoundedParityDrilldownEvidence(parity);
    }
  });

  it("marks provider parity partial when a requested canonical total is missing from the provider envelope", async () => {
    const snapshot = await fetchFutureErpQuickBooksProviderReportParitySnapshot({
      ...quickBooksProviderParityRequest(new FixtureQuickBooksProviderReportClient()),
      canonicalTotalsByReport: {
        profit_and_loss: [
          canonicalTotal("income", "20000.00"),
          canonicalTotal("other_income", "25.00")
        ]
      }
    });

    const profitAndLoss = reportParity(snapshot, "profit_and_loss");
    expect(profitAndLoss).toMatchObject({
      status: "partial",
      reconciliationStatus: "out_of_balance",
      reconciliationDifference: "25.00"
    });
    expect(profitAndLoss?.evidence?.totals.at(-1)).toEqual({
      totalKey: "other_income",
      canonicalAmount: "25.00",
      providerAmount: "0.00",
      difference: "-25.00",
      status: "missing"
    });
    expect(profitAndLoss?.deltas?.at(-1)).toMatchObject({
      totalKey: "other_income",
      status: "missing",
      difference: "-25.00",
      absoluteDifference: "25.00",
      toleranceAmount: "0.00"
    });
    expect(profitAndLoss?.deltas?.at(-1)?.providerDrilldownRef).toBeUndefined();
  });

  it("marks missing zero-amount provider totals partial instead of zero-delta matched for P&L, balance sheet, and trial balance", async () => {
    const snapshot = await fetchFutureErpQuickBooksProviderReportParitySnapshot({
      ...quickBooksProviderParityRequest(new FixtureQuickBooksProviderReportClient()),
      canonicalTotalsByReport: {
        profit_and_loss: [canonicalTotal("zero_provider_pl_total", "0.00")],
        balance_sheet: [canonicalTotal("zero_provider_balance_total", "0.00")],
        trial_balance: [canonicalTotal("zero_provider_trial_total", "0.00")]
      }
    });

    for (const [reportName, totalKey] of [
      ["profit_and_loss", "zero_provider_pl_total"],
      ["balance_sheet", "zero_provider_balance_total"],
      ["trial_balance", "zero_provider_trial_total"]
    ] as const) {
      const parity = reportParity(snapshot, reportName);
      expect(parity).toMatchObject({
        status: "partial",
        reconciliationStatus: "out_of_balance",
        reconciliationDifference: "0.00"
      });
      expect(parity?.evidence?.totals).toEqual([
        {
          totalKey,
          canonicalAmount: "0.00",
          providerAmount: "0.00",
          difference: "0.00",
          status: "missing"
        }
      ]);
      expect(parity?.deltas).toEqual([
        {
          totalKey,
          status: "missing",
          canonicalAmount: "0.00",
          providerAmount: "0.00",
          difference: "0.00",
          absoluteDifference: "0.00",
          toleranceAmount: "0.00"
        }
      ]);
    }
  });

  it("bounds provider report evidence and strips raw runtime payload fields from parity results", async () => {
    const snapshot = await fetchFutureErpQuickBooksProviderReportParitySnapshot({
      ...quickBooksProviderParityRequest(
        new FixtureQuickBooksProviderReportClient({
          responseExtras: {
            rawPayload: {
              accessToken: "fixture-access-token",
              reportRows: Array.from({ length: 100 }, (_, index) => ({ index }))
            },
            intuitRefreshToken: "fixture-refresh-token"
          }
        })
      ),
      reports: {
        profit_and_loss: canonicalReportsForProviderParity().profit_and_loss
      }
    });

    const profitAndLoss = reportParity(snapshot, "profit_and_loss");
    expect(profitAndLoss?.status).toBe("matched");
    expect(profitAndLoss?.evidence?.totals).toHaveLength(3);
    expect(profitAndLoss?.providerReport?.totals).toHaveLength(3);
    expect(JSON.stringify(profitAndLoss)).not.toMatch(
      /fixture-access-token|fixture-refresh-token|rawPayload|reportRows|Intuit|OAuth|access[_-]?token|refresh[_-]?token|client[_-]?secret/i
    );
  });

  it("surfaces unsupported QuickBooks cash-flow provider parity without fabricating evidence", async () => {
    const snapshot = await fetchFutureErpQuickBooksProviderReportParitySnapshot({
      ...quickBooksProviderParityRequest(new FixtureQuickBooksProviderReportClient()),
      canonicalTotalsByReport: {
        cash_flow: [canonicalTotal("net_cash_flow", "0.00")]
      }
    });

    const cashFlow = reportParity(snapshot, "cash_flow");
    expect(cashFlow).toMatchObject({
      reportName: "cash_flow",
      status: "unsupported",
      unsupportedReason: "quickbooks_cash_flow_parity_report_not_supported"
    });
    expect(cashFlow?.evidence).toBeUndefined();
    expect(cashFlow?.providerReport?.totals).toEqual([]);
  });

  it.each(["profit_and_loss", "balance_sheet", "trial_balance", "cash_flow"] as const)(
    "marks %s provider parity unavailable when the QuickBooks SDK/service report call is unavailable",
    async (reportName) => {
      const snapshot = await fetchFutureErpQuickBooksProviderReportParitySnapshot({
        ...quickBooksProviderParityRequest(new FixtureQuickBooksProviderReportClient({ unavailableReportName: reportName })),
        canonicalTotalsByReport: {
          [reportName]: canonicalTotalsFromProviderResponse(reportName)
        }
      });

      expect(snapshot.status).toBe("unavailable");
      expect(reportParity(snapshot, reportName)).toMatchObject({
        status: "unavailable",
        unavailableReason: "quickbooks_provider_report_unavailable"
      });
      expect(reportParity(snapshot, reportName)?.providerReport).toBeUndefined();
    }
  );

  it("keeps Future ERP normal reporting imports canonical instead of QuickBooks provider-report shaped", () => {
    const consumerTypes = readFileSync(new URL("./future-erp-consumer-type-imports.ts", import.meta.url), "utf8");

    expect(consumerTypes).toContain("FutureErpCanonicalReportReadModelStorage");
    expect(consumerTypes).toContain("buildFutureErpReportFromCanonicalReadModel");
    expect(consumerTypes).not.toMatch(
      /NormalizedQuickBooks(?:ProfitAndLoss|BalanceSheet|TrialBalance|CashFlowParity|Provider)Report(?:Request|Response)Envelope/
    );
    expect(consumerTypes).not.toMatch(/Intuit|OAuth|access[_-]?token|refresh[_-]?token|client[_-]?secret/i);
  });
});

class RecordingReadModelStorage implements FutureErpCanonicalReportReadModelStorage {
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

    return Promise.resolve(
      this.options.reportInput ?? {
        ...fixture.reportRequest,
        accounts: fixture.accounts,
        postings: fixture.postings
      }
    );
  }

  loadLatestReportSnapshot(): Promise<StoredReportSnapshot | undefined> {
    return Promise.resolve(this.options.snapshot);
  }

  loadRollupBuckets(): Promise<readonly RollupBucket[]> {
    return Promise.resolve(this.options.rollupBuckets ?? []);
  }
}

class RecordingSnapshotStorage extends RecordingReadModelStorage implements FutureErpCanonicalReportSnapshotStorage {
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

class RecordingClient implements PostgresQueryClient {
  readonly calls: QueryCall[] = [];

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ sql, params });

    return Promise.resolve({
      rows: [],
      rowCount: 0
    });
  }
}

class FixtureQuickBooksProviderReportClient implements FutureErpQuickBooksProviderReportParityClient {
  readonly requests: NormalizedQuickBooksProviderReportRequestEnvelope[] = [];

  constructor(
    private readonly options: {
      readonly unavailableReportName?: NormalizedQuickBooksProviderReportName;
      readonly responseExtras?: Readonly<Record<string, unknown>>;
    } = {}
  ) {}

  get reportNames(): readonly NormalizedQuickBooksProviderReportName[] {
    return this.requests.map((request) => request.reportName);
  }

  profitAndLossReport(request: NormalizedQuickBooksProfitAndLossReportRequestEnvelope) {
    this.recordRequest(request);

    return Promise.resolve({
      ...quickBooksFixtures.providerReports.profitAndLoss.response,
      ...this.options.responseExtras
    });
  }

  balanceSheetReport(request: NormalizedQuickBooksBalanceSheetReportRequestEnvelope) {
    this.recordRequest(request);

    return Promise.resolve({
      ...quickBooksFixtures.providerReports.balanceSheet.response,
      ...this.options.responseExtras
    });
  }

  trialBalanceReport(request: NormalizedQuickBooksTrialBalanceReportRequestEnvelope) {
    this.recordRequest(request);

    return Promise.resolve({
      ...quickBooksFixtures.providerReports.trialBalance.response,
      ...this.options.responseExtras
    });
  }

  cashFlowParityReport(request: NormalizedQuickBooksCashFlowParityReportRequestEnvelope) {
    this.recordRequest(request);

    return Promise.resolve({
      ...quickBooksFixtures.providerReports.cashFlow.response,
      ...this.options.responseExtras
    });
  }

  private recordRequest(request: NormalizedQuickBooksProviderReportRequestEnvelope): void {
    this.requests.push(request);
    if (this.options.unavailableReportName === request.reportName) {
      throw new Error("fixture QuickBooks provider report unavailable");
    }
  }
}

function reportRequest(): LoadReportBuilderInput {
  return {
    tenantId: fixture.company.tenantId,
    companyId: fixture.company.companyId,
    sourceId: fixture.source.sourceId,
    reportName: "profit_and_loss",
    accountingBasis: "accrual",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    asOfDate: "2026-01-31",
    currencyCode: "USD",
    generatedAt: "2026-02-01T00:00:00.000Z"
  };
}

function quickBooksProviderParityRequest(client: FutureErpQuickBooksProviderReportParityClient) {
  return {
    client,
    sourceIdentity: quickBooksFixtures.providerReports.profitAndLoss.request.sourceIdentity,
    accountingBasis: "accrual" as const,
    currencyCode: "USD" as const,
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    asOfDate: "2026-01-31",
    requestedAt: "2026-02-01T10:02:00.000Z",
    comparedAt: "2026-02-01T10:03:00.000Z",
    toleranceAmount: "0.00"
  };
}

function canonicalReportsForProviderParity(): {
  readonly profit_and_loss: BuiltReport;
  readonly balance_sheet: BuiltReport;
  readonly trial_balance: BuiltReport;
} {
  const input = {
    ...fixture.reportRequest,
    accounts: fixture.accounts,
    postings: fixture.postings
  };

  return {
    profit_and_loss: buildProfitAndLossReport(input),
    balance_sheet: buildBalanceSheetReport(input),
    trial_balance: buildTrialBalanceReport(input)
  };
}

function reportParity(
  snapshot: Awaited<ReturnType<typeof fetchFutureErpQuickBooksProviderReportParitySnapshot>>,
  reportName: NormalizedQuickBooksProviderReportName
) {
  return snapshot.reports.find((report) => report.reportName === reportName);
}

function canonicalTotalsFromProviderResponse(reportName: NormalizedQuickBooksProviderReportName): readonly NormalizedQuickBooksCanonicalReportTotal[] {
  const providerReport =
    reportName === "profit_and_loss"
      ? quickBooksFixtures.providerReports.profitAndLoss.response
      : reportName === "balance_sheet"
        ? quickBooksFixtures.providerReports.balanceSheet.response
        : reportName === "trial_balance"
          ? quickBooksFixtures.providerReports.trialBalance.response
          : quickBooksFixtures.providerReports.cashFlow.response;

  return providerReport.totals.map((total) => canonicalTotal(total.totalKey, total.amount));
}

function canonicalTotal(totalKey: string, amount: string): NormalizedQuickBooksCanonicalReportTotal {
  return {
    totalKey,
    amount,
    currencyCode: "USD"
  };
}

function reportWithTotalAmount(report: BuiltReport, totalKey: string, amount: string): BuiltReport {
  return {
    ...report,
    totals: report.totals.map((total) => (total.totalKey === totalKey ? { ...total, amount } : total))
  };
}

function expectBoundedParityDrilldownEvidence(parity: FutureErpQuickBooksProviderReportParityResult | undefined): void {
  if (parity === undefined) {
    throw new Error("expected provider parity result");
  }
  expect(parity.status === "matched" || parity.status === "mismatched").toBe(true);
  if (parity.providerReportRef === undefined) {
    throw new Error(`expected provider report ref for ${parity.reportName}`);
  }
  if (parity.reconciliationDifferenceDrilldownRef === undefined) {
    throw new Error(`expected reconciliation drilldown ref for ${parity.reportName}`);
  }
  expectSerializedJsonToBeBounded(parity.providerReportRef);
  expectSerializedJsonToBeBounded(parity.reconciliationDifferenceDrilldownRef);
  assertSafeDrilldownRef(parity.reconciliationDifferenceDrilldownRef);

  for (const total of parity.evidence?.totals ?? []) {
    if (total.drilldownRef === undefined) {
      throw new Error(`expected provider total drilldown ref for ${parity.reportName}:${total.totalKey}`);
    }
    expectSerializedJsonToBeBounded(total.drilldownRef);
    assertSafeSourcePayloadRef(total.drilldownRef);
  }

  for (const delta of parity.deltas ?? []) {
    if (delta.providerDrilldownRef === undefined) {
      throw new Error(`expected provider delta drilldown ref for ${parity.reportName}:${delta.totalKey}`);
    }
    if (delta.canonicalDrilldownRef === undefined) {
      throw new Error(`expected canonical delta drilldown ref for ${parity.reportName}:${delta.totalKey}`);
    }
    expectSerializedJsonToBeBounded(delta.providerDrilldownRef);
    expectSerializedJsonToBeBounded(delta.canonicalDrilldownRef);
    assertSafeSourcePayloadRef(delta.providerDrilldownRef);
    assertSafeDrilldownRef(delta.canonicalDrilldownRef);
  }
}

function expectSerializedJsonToBeBounded(value: unknown): void {
  expect(value).toBeDefined();
  expect(Buffer.byteLength(JSON.stringify(value), "utf8")).toBeLessThanOrEqual(DEFAULT_JSON_REF_MAX_BYTES);
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
      sourceId: fixture.source.sourceId,
      accountingBasis: "accrual",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31"
    });
    expect(line.drilldownRef.sourceRefs?.length).toBeGreaterThan(0);
    for (const sourceRef of line.drilldownRef.sourceRefs ?? []) {
      assertSafeSourcePayloadRef(sourceRef);
      expect(sourceRef.sourceObjectType).toBeTruthy();
      expect(sourceRef.sourceObjectId).toBeTruthy();
    }
  }

  for (const total of report.totals.filter((entry) => entry.amount !== "0.00")) {
    expect(total.drilldownRef.token).toContain(report.snapshot.reportName);
    expect(total.drilldownRef.accountIds?.length).toBeGreaterThan(0);
    expect(total.drilldownRef.postingIds?.length).toBeGreaterThan(0);
    expect(total.drilldownRef.query).toMatchObject({
      kind: "ledger_postings",
      tenantId: fixture.company.tenantId,
      sourceId: fixture.source.sourceId,
      accountingBasis: "accrual",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31"
    });
    expect(total.drilldownRef.sourceRefCount).toBeGreaterThan(0);
    for (const sourceRef of total.drilldownRef.sourceRefs ?? []) {
      assertSafeSourcePayloadRef(sourceRef);
      expect(sourceRef.sourceObjectType).toBeTruthy();
      expect(sourceRef.sourceObjectId).toBeTruthy();
    }
  }
}
