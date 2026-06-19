import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  buildProfitAndLossReport,
  buildRollupBuckets,
  createPostgresStorageAdapter,
  createSnapshotRefreshContract,
  planLateArrivalReprocess,
  reconcileReportFreshness
} from "../src/index.js";

import type { LedgerPosting, PostgresQueryClient, PostgresQueryResult } from "../src/index.js";

type QueryCall = {
  readonly sql: string;
  readonly params: readonly unknown[];
};

const fixture = ERP_FINANCIALS_STATEMENT_FIXTURE;

describe("rollup, snapshot, freshness, and late-arrival job contracts", () => {
  it("aggregates postings into deterministic day, month, and fiscal-period rollup buckets", () => {
    const input = {
      companyId: fixture.company.companyId,
      postings: fixture.postings,
      bucketGrains: ["day", "month", "fiscal_period"] as const,
      fiscalYearStartMonth: fixture.company.fiscalYearStartMonth,
      generatedAt: "2026-02-01T00:00:00.000Z"
    };
    const firstRun = buildRollupBuckets(input);
    const secondRun = buildRollupBuckets(input);
    const monthlySales = firstRun.find(
      (bucket) =>
        bucket.bucketGrain === "month" &&
        bucket.bucketStart === "2026-01-01" &&
        bucket.accountId === "acct_sales" &&
        bucket.dimensionHash === fixture.postings[3]?.dimensionHash
    );
    const salesDimensionHash = fixture.postings[3]?.dimensionHash;
    if (salesDimensionHash === undefined) {
      throw new Error("fixture must include sales posting dimension hash");
    }
    const dailyCashSaleRevenue = firstRun.find(
      (bucket) => bucket.bucketGrain === "day" && bucket.bucketStart === "2026-01-05" && bucket.accountId === "acct_sales"
    );
    const fiscalSales = firstRun.find(
      (bucket) => bucket.bucketGrain === "fiscal_period" && bucket.bucketStart === "2026-01-01" && bucket.accountId === "acct_sales"
    );

    expect(secondRun).toEqual(firstRun);
    expect(monthlySales).toMatchObject({
      rollupBucketId: `rollup:${fixture.company.tenantId}:${fixture.company.companyId}:${fixture.source.sourceId}:accrual:month:2026-01-01:2026-01-31:acct_sales:USD:${salesDimensionHash}`,
      debitAmount: "0.00",
      creditAmount: "20000.00",
      netAmount: "-20000.00",
      postingCount: 2
    });
    expect(monthlySales?.drilldownRef.postingIds).toEqual(["post_cash_sale_revenue", "post_invoice_revenue"]);
    expect(monthlySales?.drilldownRef.query).toMatchObject({
      kind: "ledger_postings",
      tenantId: fixture.company.tenantId,
      sourceId: fixture.source.sourceId,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31"
    });
    expect(dailyCashSaleRevenue?.creditAmount).toBe("12000.00");
    expect(fiscalSales?.bucketEnd).toBe("2026-01-31");
  });

  it("plans deterministic overlap reprocessing and dashboard-readable stale freshness rows", () => {
    const changedPostings = fixture.postings.filter((posting) =>
      ["post_rent_expense", "post_rent_cash"].includes(posting.postingId)
    );
    const plan = planLateArrivalReprocess({
      tenantId: fixture.company.tenantId,
      companyId: fixture.company.companyId,
      changedPostings,
      bucketGrains: ["day", "month"],
      fiscalYearStartMonth: fixture.company.fiscalYearStartMonth,
      overlapDays: 7,
      reportNames: ["profit_and_loss", "balance_sheet"],
      updatedAt: "2026-02-02T00:00:00.000Z",
      staleReason: "late_arrival_overlap_reprocess",
      freshThrough: "2026-02-01T00:00:00.000Z",
      importBatchId: "batch_delta_late",
      checkpointId: fixture.checkpoint.checkpointId
    });

    expect(plan.affectedStart).toBe("2026-01-05");
    expect(plan.affectedEnd).toBe("2026-01-12");
    expect(plan.windows).toHaveLength(9);
    expect(plan.windows[0]).toMatchObject({
      bucketGrain: "day",
      bucketStart: "2026-01-05",
      bucketEnd: "2026-01-05"
    });
    expect(plan.windows.some((window) => window.bucketGrain === "month" && window.bucketStart === "2026-01-01")).toBe(true);
    expect(plan.staleSnapshots).toMatchObject({
      tenantId: fixture.company.tenantId,
      affectedStart: "2026-01-05",
      affectedEnd: "2026-01-12",
      staleReason: "late_arrival_overlap_reprocess",
      reportNames: ["profit_and_loss", "balance_sheet"]
    });
    expect(plan.freshnessRows).toHaveLength(2);
    expect(plan.freshnessRows[0]).toMatchObject({
      status: "stale",
      staleReason: "late_arrival_overlap_reprocess",
      periodStart: "2026-01-05",
      periodEnd: "2026-01-12"
    });
  });

  it("replaces reprocess windows before upserting rollups and marks affected snapshots stale by date overlap", async () => {
    const client = new RecordingClient();
    const adapter = createPostgresStorageAdapter(client);
    const buckets = buildRollupBuckets({
      companyId: fixture.company.companyId,
      postings: fixture.postings,
      bucketGrains: ["month"],
      fiscalYearStartMonth: fixture.company.fiscalYearStartMonth,
      generatedAt: "2026-02-01T00:00:00.000Z"
    });

    await adapter.replaceRollupBucketsForWindows({
      windows: [
        {
          tenantId: fixture.company.tenantId,
          companyId: fixture.company.companyId,
          sourceId: fixture.source.sourceId,
          accountingBasis: "accrual",
          bucketGrain: "month",
          bucketStart: "2026-01-01",
          bucketEnd: "2026-01-31",
          currencyCode: "USD"
        }
      ],
      buckets
    });
    await adapter.markReportSnapshotsStaleForPostingChanges({
      tenantId: fixture.company.tenantId,
      affectedStart: "2026-01-05",
      affectedEnd: "2026-01-12",
      staleReason: "late_arrival_overlap_reprocess",
      reportNames: ["profit_and_loss"],
      accountingBasis: "accrual",
      currencyCode: "USD"
    });

    expect(client.calls[0]?.sql).toContain('delete from "erp_financials"."rollup_buckets"');
    expect(client.calls[0]?.params).toEqual(
      expect.arrayContaining([fixture.company.tenantId, fixture.company.companyId, fixture.source.sourceId, "month"])
    );
    expect(client.calls[1]?.sql).toContain('insert into "erp_financials"."rollup_buckets"');
    expect(client.calls[1]?.sql).toContain(
      'on conflict ("tenant_id", "company_id", "source_id", "accounting_basis", "bucket_grain", "bucket_start", "bucket_end", "account_id", "currency_code", "dimension_hash") do update'
    );
    expect(client.calls[2]?.sql).toContain('update "erp_financials"."report_snapshots"');
    expect(client.calls[2]?.sql).toContain('"report_name" = any($5::text[])');
    expect(client.calls[2]?.params).toEqual(
      expect.arrayContaining(["2026-01-05", "2026-01-12", "late_arrival_overlap_reprocess", ["profit_and_loss"]])
    );
  });

  it("reconciles freshness boundaries without reading job logs", () => {
    const partial = reconcileReportFreshness({
      tenantId: fixture.company.tenantId,
      companyId: fixture.company.companyId,
      sourceId: fixture.source.sourceId,
      reportName: "profit_and_loss",
      accountingBasis: "accrual",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      currencyCode: "USD",
      sourceFreshThrough: "2026-02-02T00:00:00.000Z",
      importedThrough: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-02T00:00:00.000Z"
    });
    const stale = reconcileReportFreshness({
      ...partial,
      reportName: "balance_sheet",
      staleReasons: ["affected_snapshot_pending_refresh"],
      updatedAt: "2026-02-03T00:00:00.000Z"
    });
    const snapshotContract = createSnapshotRefreshContract({
      tenantId: fixture.company.tenantId,
      companyId: fixture.company.companyId,
      sourceId: fixture.source.sourceId,
      reportName: "trial_balance",
      accountingBasis: "accrual",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      asOfDate: "2026-01-31",
      currencyCode: "USD",
      generatedAt: "2026-02-01T00:00:00.000Z",
      freshThrough: "2026-02-01T00:00:00.000Z",
      importBatchId: fixture.importBatch.importBatchId,
      checkpointId: fixture.checkpoint.checkpointId
    });

    expect(partial).toMatchObject({
      status: "partial",
      staleReason: "imported_boundary_behind_source_boundary"
    });
    expect(stale).toMatchObject({
      status: "stale",
      staleReason: "affected_snapshot_pending_refresh"
    });
    expect(snapshotContract).toMatchObject({
      snapshotId: "snapshot:tenant_fixture:trial_balance:accrual:2026-01-01:2026-01-31:2026-01-31:USD",
      freshnessRow: {
        status: "fresh",
        freshThrough: "2026-02-01T00:00:00.000Z"
      }
    });
  });

  it("keeps large report drilldown refs compact with query tokens", () => {
    const basePosting = fixture.postings.find((posting) => posting.postingId === "post_cash_sale_revenue");

    if (basePosting === undefined) {
      throw new Error("fixture must include cash sale revenue posting");
    }

    const bulkRevenuePostings = Array.from({ length: 101 }, (_, index): LedgerPosting => ({
      ...basePosting,
      postingId: `post_bulk_revenue_${index.toString().padStart(3, "0")}`,
      sourcePostingId: `bulk_revenue_${index.toString().padStart(3, "0")}`,
      transactionId: `txn_bulk_revenue_${index.toString().padStart(3, "0")}`,
      transactionLineId: `line_bulk_revenue_${index.toString().padStart(3, "0")}`
    }));
    const report = buildProfitAndLossReport({
      ...fixture.reportRequest,
      accounts: fixture.accounts,
      postings: [...fixture.postings, ...bulkRevenuePostings]
    });
    const salesLine = report.lines.find((line) => line.accountId === "acct_sales");

    expect(salesLine?.drilldownRef.postingCount).toBe(103);
    expect(salesLine?.drilldownRef.postingIds).toBeUndefined();
    expect(salesLine?.drilldownRef.token).toBe("profit_and_loss:acct_sales");
    expect(salesLine?.drilldownRef.query).toMatchObject({
      kind: "ledger_postings",
      accountIds: ["acct_sales"]
    });
  });
});

class RecordingClient implements PostgresQueryClient {
  readonly calls: QueryCall[] = [];

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ sql, params });

    return Promise.resolve({
      rows: [],
      rowCount: sql.startsWith("delete") || sql.startsWith("update") ? 1 : null
    });
  }
}
