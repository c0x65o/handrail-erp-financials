import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  runErpFinancialsFixtureSmokeHealth
} from "../src/index.js";

import type {
  BuiltReport,
  ErpFinancialsFixtureSmokeStorageHooks,
  FixtureLoadResult,
  ReportFreshnessRow
} from "../src/index.js";

const PROVIDER_CREDENTIAL_OR_RAW_PAYLOAD_KEY_PATTERN =
  /access[_-]?token|refresh[_-]?token|client[_-]?secret|clientSecret|secret|password|rawPayload|rawProviderPayload|raw_provider_payload|raw_payload/i;

describe("ERP Financials fixture smoke health", () => {
  it("builds deterministic fixture reports without storage, network, or provider credentials", async () => {
    const first = await runErpFinancialsFixtureSmokeHealth();
    const second = await runErpFinancialsFixtureSmokeHealth();

    expect(first).toMatchObject({
      status: "healthy",
      storageMode: "simulated",
      fixtureName: "ERP_FINANCIALS_STATEMENT_FIXTURE",
      generatedAt: "2026-02-01T00:00:00.000Z",
      tenantId: "tenant_fixture",
      companyId: "company_fixture",
      sourceId: "source_native_fixture",
      accountingBasis: "accrual",
      currencyCode: "USD",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      asOfDate: "2026-01-31",
      issues: []
    });
    expect(first.summaryHash).toEqual(second.summaryHash);
    expect(first.reports.profit_and_loss?.summaryHash).toEqual(second.reports.profit_and_loss?.summaryHash);
    expect(first.snapshotIds).toEqual({
      profit_and_loss: "snapshot:tenant_fixture:profit_and_loss:accrual:2026-01-01:2026-01-31:2026-01-31:USD",
      balance_sheet: "snapshot:tenant_fixture:balance_sheet:accrual:2026-01-01:2026-01-31:2026-01-31:USD",
      trial_balance: "snapshot:tenant_fixture:trial_balance:accrual:2026-01-01:2026-01-31:2026-01-31:USD",
      cash_flow: "snapshot:tenant_fixture:cash_flow:accrual:2026-01-01:2026-01-31:2026-01-31:USD"
    });
    expect(first.freshnessIds).toEqual({
      profit_and_loss:
        "freshness:tenant_fixture:company_fixture:source_native_fixture:profit_and_loss:accrual:2026-01-01:2026-01-31:USD",
      balance_sheet:
        "freshness:tenant_fixture:company_fixture:source_native_fixture:balance_sheet:accrual:2026-01-01:2026-01-31:USD",
      trial_balance:
        "freshness:tenant_fixture:company_fixture:source_native_fixture:trial_balance:accrual:2026-01-01:2026-01-31:USD",
      cash_flow:
        "freshness:tenant_fixture:company_fixture:source_native_fixture:cash_flow:accrual:2026-01-01:2026-01-31:USD"
    });
    expect(first.totals.profit_and_loss).toMatchObject(ERP_FINANCIALS_STATEMENT_FIXTURE.expectedTotals.profitAndLoss);
    expect(first.totals.balance_sheet).toMatchObject(ERP_FINANCIALS_STATEMENT_FIXTURE.expectedTotals.balanceSheet);
    expect(first.totals.trial_balance).toMatchObject(ERP_FINANCIALS_STATEMENT_FIXTURE.expectedTotals.trialBalance);
    expect(first.totals.cash_flow).toMatchObject(ERP_FINANCIALS_STATEMENT_FIXTURE.expectedTotals.cashFlow);
    expect(first.reports.cash_flow?.cashFlowSupportStatus).toBe("partial");
    expect(first.rowCounts).toMatchObject({
      fixture: {
        companies: 1,
        sources: 1,
        importBatches: 1,
        checkpoints: 1,
        accounts: 13,
        parties: 5,
        items: 3,
        dimensions: 3,
        transactions: 11,
        transactionLines: 22,
        postings: 22
      },
      reportSnapshots: 4,
      reportFreshness: 4,
      snapshotRowsWritten: 0,
      freshnessRowsWritten: 0
    });
    expect(first.rowCounts.reportSnapshotLines).toBeGreaterThan(0);
    expect(first.rowCounts.reportSnapshotTotals).toBeGreaterThan(0);
    expect(JSON.stringify(first)).not.toMatch(PROVIDER_CREDENTIAL_OR_RAW_PAYLOAD_KEY_PATTERN);
  });

  it("loads fixture rows and writes snapshots plus freshness when storage hooks are supplied", async () => {
    const storage = new FixtureSmokeStorage();

    const health = await runErpFinancialsFixtureSmokeHealth({ storage });

    expect(health.status).toBe("healthy");
    expect(health.storageMode).toBe("storage");
    expect(storage.loadedFixtureRows).toEqual(health.rowCounts.fixture);
    expect(storage.snapshots.map((report) => report.snapshot.reportName)).toEqual([
      "profit_and_loss",
      "balance_sheet",
      "trial_balance",
      "cash_flow"
    ]);
    expect(storage.freshnessRows.map((row) => row.reportName)).toEqual([
      "profit_and_loss",
      "balance_sheet",
      "trial_balance",
      "cash_flow"
    ]);
    expect(health.rowCounts.snapshotRowsWritten).toBe(
      Object.values(health.reports).reduce((sum, report) => sum + report.snapshotRowCount, 0)
    );
    expect(health.rowCounts.freshnessRowsWritten).toBe(4);
    expect(health.reports.profit_and_loss?.snapshotRowsWritten).toBe(
      1 + firstSnapshot(storage).lines.length + firstSnapshot(storage).totals.length
    );
    expect(health.reports.profit_and_loss?.freshnessRowsWritten).toBe(1);
  });

  it("returns degraded bounded issues for incomplete storage hooks", async () => {
    const health = await runErpFinancialsFixtureSmokeHealth({
      storage: {
        loadStatementFixture: () => Promise.resolve(fixtureRowCounts())
      }
    });

    expect(health.status).toBe("degraded");
    expect(health.issues).toHaveLength(4);
    expect(health.issues.map((issue) => issue.kind)).toEqual([
      "storage_hooks_incomplete",
      "storage_hooks_incomplete",
      "storage_hooks_incomplete",
      "storage_hooks_incomplete"
    ]);
    expect(JSON.stringify(health)).not.toMatch(PROVIDER_CREDENTIAL_OR_RAW_PAYLOAD_KEY_PATTERN);
  });
});

class FixtureSmokeStorage implements ErpFinancialsFixtureSmokeStorageHooks {
  readonly snapshots: BuiltReport[] = [];
  readonly freshnessRows: ReportFreshnessRow[] = [];
  loadedFixtureRows?: FixtureLoadResult;

  loadStatementFixture(): Promise<FixtureLoadResult> {
    this.loadedFixtureRows = fixtureRowCounts();
    return Promise.resolve(this.loadedFixtureRows);
  }

  writeReportSnapshot(report: BuiltReport): Promise<number> {
    this.snapshots.push(report);
    return Promise.resolve(1 + report.lines.length + report.totals.length);
  }

  writeFreshnessRows(rows: readonly ReportFreshnessRow[]): Promise<number> {
    this.freshnessRows.push(...rows);
    return Promise.resolve(rows.length);
  }
}

function firstSnapshot(storage: FixtureSmokeStorage): BuiltReport {
  const snapshot = storage.snapshots.at(0);
  if (snapshot === undefined) {
    throw new Error("expected fixture smoke storage to capture a snapshot");
  }

  return snapshot;
}

function fixtureRowCounts(): FixtureLoadResult {
  return {
    companies: 1,
    sources: 1,
    importBatches: 1,
    checkpoints: 1,
    accounts: ERP_FINANCIALS_STATEMENT_FIXTURE.accounts.length,
    parties: ERP_FINANCIALS_STATEMENT_FIXTURE.parties.length,
    items: ERP_FINANCIALS_STATEMENT_FIXTURE.items.length,
    dimensions: ERP_FINANCIALS_STATEMENT_FIXTURE.dimensions.length,
    transactions: ERP_FINANCIALS_STATEMENT_FIXTURE.transactions.length,
    transactionLines: ERP_FINANCIALS_STATEMENT_FIXTURE.transactionLines.length,
    postings: ERP_FINANCIALS_STATEMENT_FIXTURE.postings.length
  };
}
