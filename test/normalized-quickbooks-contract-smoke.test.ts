import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES,
  assertNoCredentialKeys,
  createHandrailQuickBooksFullSyncServiceHandler,
  runFutureErpQuickBooksSandboxReplay,
  createQuickBooksContractSmokeHarness
} from "../src/index.js";

import type {
  FutureErpQuickBooksSandboxReplayClient,
  NormalizedQuickBooksProviderReportName,
  NormalizedQuickBooksProviderReportResult
} from "../src/index.js";

describe("normalized QuickBooks contract smoke harness", () => {
  it("emits normalized fixtures, adapts them to ERP Financials input, and verifies stable totals", () => {
    const harness = createQuickBooksContractSmokeHarness();

    expect(harness.normalizedResources.identity).toMatchObject({
      tenantId: "tenant_qbo_sync_fixture",
      sourceId: "source_qbo_sync_fixture",
      sourceSystem: "quickbooks",
      providerEnvironment: "sandbox",
      realmId: "realm_qbo_sync_fixture",
      sourceCompanyRef: "realm_qbo_sync_fixture"
    });
    expect(harness.adapterInput.context).toMatchObject({
      tenantId: "tenant_qbo_sync_fixture",
      sourceId: "source_qbo_sync_fixture",
      providerEnvironment: "sandbox",
      realmId: "realm_qbo_sync_fixture",
      importBatchId: "batch_qbo_full_fixture_2026_01",
      checkpointId: "checkpoint_qbo_full_fixture_2026_01"
    });
    expect(harness.facts.source).toMatchObject({
      sourceSystem: "quickbooks",
      providerEnvironment: "sandbox",
      connectionRef: "handrail-quickbooks-sdk:staging:sandbox:realm:realm_qbo_sync_fixture"
    });
    expect(harness.snapshot).toMatchObject({
      sourceFreshThrough: "2026-02-01T10:00:00.000Z",
      importedThrough: "2026-02-01T10:00:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T09:59:59.000Z"
    });

    expect(harness.snapshot.normalizedResourceCounts).toEqual({
      accounts: 2,
      classes: 0,
      companyInfo: 1,
      customers: 1,
      departments: 1,
      dimensions: 1,
      items: 1,
      journalEntries: 1,
      ledgerPostings: 0,
      ledgerTransactions: 0,
      parties: 0,
      providerReports: 0,
      reconciliationEvidence: 0,
      vendors: 1
    });
    expect(harness.snapshot.canonicalCounts).toEqual({
      accounts: 2,
      dimensions: 1,
      items: 1,
      parties: 2,
      postings: 2,
      transactionLines: 2,
      transactions: 1
    });
    expect(harness.snapshot.canonicalPostingTotals).toEqual({
      creditTotal: "500.00",
      debitTotal: "500.00",
      netTotal: "0.00"
    });
    expect(harness.snapshot.reports).toEqual({
      profitAndLoss: {
        gross_profit: "500.00",
        net_income: "500.00",
        net_operating_income: "500.00",
        total_cost_of_goods_sold: "0.00",
        total_expenses: "0.00",
        total_income: "500.00",
        total_other_expense: "0.00",
        total_other_income: "0.00"
      },
      balanceSheet: {
        total_assets: "500.00",
        total_equity: "500.00",
        total_liabilities: "0.00",
        total_liabilities_and_equity: "500.00"
      },
      trialBalance: {
        total_credits: "500.00",
        total_debits: "500.00"
      }
    });
    expect(harness.snapshot.erpContracts).toEqual({
      freshness: {
        freshnessId:
          "freshness:tenant_qbo_sync_fixture:company_realm_qbo_sync_fixture:source_qbo_sync_fixture:profit_and_loss:accrual:2026-01-01:2026-01-31:USD",
        status: "fresh",
        freshThrough: "2026-02-01T10:00:00.000Z",
        importBatchId: "batch_qbo_full_fixture_2026_01",
        checkpointId: "checkpoint_qbo_full_fixture_2026_01",
        updatedAt: "2026-02-01T10:15:00.000Z"
      },
      snapshotRefresh: {
        snapshotId: "snapshot:tenant_qbo_sync_fixture:profit_and_loss:accrual:2026-01-01:2026-01-31:2026-01-31:USD",
        freshnessId:
          "freshness:tenant_qbo_sync_fixture:company_realm_qbo_sync_fixture:source_qbo_sync_fixture:profit_and_loss:accrual:2026-01-01:2026-01-31:USD",
        status: "fresh",
        freshThrough: "2026-02-01T10:00:00.000Z",
        importBatchId: "batch_qbo_full_fixture_2026_01",
        checkpointId: "checkpoint_qbo_full_fixture_2026_01"
      },
      rollup: {
        bucketGrains: ["month"],
        bucketCount: 2,
        postingCount: 2,
        accountCount: 2,
        dimensionHashCount: 2,
        sourcePostingMaxUpdatedAt: "2026-01-15T16:00:00.000Z",
        bucketSummaries: [
          {
            bucketGrain: "month",
            bucketCount: 2,
            windowCount: 1,
            bucketStartMin: "2026-01-01",
            bucketEndMax: "2026-01-31"
          }
        ]
      },
      health: {
        status: "ready",
        serviceAvailability: "available",
        providerMode: "sandbox",
        serviceEnvironment: "staging",
        capabilityStatuses: {
          fullSync: "ready",
          incrementalSync: "ready",
          providerReports: "ready",
          sandbox: "ready",
          replay: "ready"
        },
        checkpoint: {
          checkpointId: "checkpoint_qbo_full_fixture_2026_01",
          status: "current",
          sourceFreshThrough: "2026-02-01T10:00:00.000Z",
          importedThrough: "2026-02-01T10:00:00.000Z",
          latestSourceUpdatedAt: "2026-02-01T09:59:59.000Z"
        },
        issueCount: 0
      }
    });
    expect(harness.snapshot.providerReports).toEqual([
      {
        reportName: "profit_and_loss",
        supportStatus: "supported",
        providerEnvironment: "sandbox",
        importBatchId: "batch_qbo_full_fixture_2026_01",
        checkpointId: "checkpoint_qbo_full_fixture_2026_01",
        sourceFreshThrough: "2026-02-01T10:01:00.000Z",
        importedThrough: "2026-02-01T10:00:00.000Z",
        latestSourceUpdatedAt: "2026-02-01T10:01:00.000Z",
        totalCount: 3,
        totals: {
          expenses: "6200.00",
          income: "20000.00",
          net_income: "13800.00"
        }
      },
      {
        reportName: "balance_sheet",
        supportStatus: "supported",
        providerEnvironment: "sandbox",
        importBatchId: "batch_qbo_full_fixture_2026_01",
        checkpointId: "checkpoint_qbo_full_fixture_2026_01",
        sourceFreshThrough: "2026-02-01T10:01:00.000Z",
        importedThrough: "2026-02-01T10:00:00.000Z",
        latestSourceUpdatedAt: "2026-02-01T10:01:00.000Z",
        totalCount: 3,
        totals: {
          assets: "74000.00",
          equity: "62800.00",
          liabilities: "11200.00"
        }
      },
      {
        reportName: "trial_balance",
        supportStatus: "supported",
        providerEnvironment: "sandbox",
        importBatchId: "batch_qbo_full_fixture_2026_01",
        checkpointId: "checkpoint_qbo_full_fixture_2026_01",
        sourceFreshThrough: "2026-02-01T10:01:00.000Z",
        importedThrough: "2026-02-01T10:00:00.000Z",
        latestSourceUpdatedAt: "2026-02-01T10:01:00.000Z",
        totalCount: 3,
        totals: {
          credits: "81900.00",
          debits: "81900.00",
          net: "0.00"
        }
      },
      {
        reportName: "cash_flow",
        supportStatus: "unsupported",
        unsupportedReason: "quickbooks_cash_flow_parity_report_not_supported",
        providerEnvironment: "sandbox",
        importBatchId: "batch_qbo_full_fixture_2026_01",
        checkpointId: "checkpoint_qbo_full_fixture_2026_01",
        sourceFreshThrough: "2026-02-01T10:00:00.000Z",
        importedThrough: "2026-02-01T10:00:00.000Z",
        latestSourceUpdatedAt: "2026-02-01T09:59:59.000Z",
        totalCount: 0,
        totals: {}
      }
    ]);
    expect(harness.snapshot.unsupportedProviderStates).toEqual([
      {
        reportName: "cash_flow",
        supportStatus: "unsupported",
        unsupportedReason: "quickbooks_cash_flow_parity_report_not_supported",
        documentedBehavior:
          "ERP Financials can build cash_flow from canonical facts, but QuickBooks provider cash-flow parity is intentionally unsupported in deterministic contract fixtures."
      }
    ]);
    expect(harness.snapshotHash).toBe("e24fe29a70b655fea68615a79b7dd038d74b7007402bcc19301cb59f5cd932b3");
    expect(JSON.stringify(harness)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|clientSecret|rawPayload/i);
    assertNoCredentialKeys(harness.snapshot);
  });

  it("consumes QuickBooks SDK/service output through the ERP Financials sandbox replay harness", async () => {
    const requestedProviderReports: NormalizedQuickBooksProviderReportName[] = [];
    const quickBooksSdkService: FutureErpQuickBooksSandboxReplayClient = createHandrailQuickBooksFullSyncServiceHandler({
      loadFullSyncResources(request) {
        expect(request).toEqual(ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.fullSync.request);

        return ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.fullSync.resources;
      },
      loadProviderReport(request) {
        requestedProviderReports.push(request.reportName);

        return providerReportResult(request.reportName);
      }
    });

    const replay = await runFutureErpQuickBooksSandboxReplay({ quickBooksClient: quickBooksSdkService });

    expect(replay.importBatchId).toBe("batch_qbo_full_fixture_2026_01");
    expect(replay.canonicalRowCounts).toEqual({
      companies: 1,
      sources: 1,
      importBatches: 1,
      checkpoints: 1,
      accounts: 2,
      parties: 2,
      items: 1,
      dimensions: 1,
      transactions: 1,
      transactionLines: 2,
      postings: 2
    });
    expect(replay.reportStatuses).toEqual({
      profit_and_loss: "generated",
      balance_sheet: "generated",
      trial_balance: "generated",
      cash_flow: "supported"
    });
    expect(replay.providerParity.reports.map((report) => [report.reportName, report.status, report.evidenceTotalCount])).toEqual([
      ["profit_and_loss", "mismatched", 3],
      ["balance_sheet", "mismatched", 3],
      ["trial_balance", "mismatched", 3],
      ["cash_flow", "unsupported", 0]
    ]);
    expect(requestedProviderReports).toEqual(["profit_and_loss", "balance_sheet", "trial_balance"]);
    expect(JSON.stringify(replay)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|clientSecret|rawPayload/i);
    assertNoCredentialKeys(replay);
  });
});

function providerReportResult(reportName: NormalizedQuickBooksProviderReportName): NormalizedQuickBooksProviderReportResult {
  const { providerReports } = ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES;

  switch (reportName) {
    case "profit_and_loss":
      return providerReports.profitAndLoss.providerResult;
    case "balance_sheet":
      return providerReports.balanceSheet.providerResult;
    case "trial_balance":
      return providerReports.trialBalance.providerResult;
    case "cash_flow":
      throw new Error("cash_flow parity is returned by the SDK/service unsupported-report path");
  }
}
