import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  assertNoCredentialKeys,
  buildLateArrivalReprocessExecutionContract,
  buildProfitAndLossReport,
  buildRollupBuckets,
  buildScheduledRollupJobResult,
  createPostgresStorageAdapter,
  createSnapshotRefreshContract,
  executeSnapshotRefresh,
  executeLateArrivalReprocess,
  planLateArrivalReprocess,
  reconcileReportFreshness
} from "../src/index.js";

import type {
  BuiltReport,
  LedgerPosting,
  LoadReportBuilderInput,
  PostgresQueryClient,
  PostgresQueryResult,
  ReportBuilderInput,
  ReportFreshnessRow,
  Party,
  ScheduledRollupCanonicalPostingReader,
  SnapshotRefreshStorage,
  StoredReportSnapshot
} from "../src/index.js";

type QueryCall = {
  readonly sql: string;
  readonly params: readonly unknown[];
};

const fixture = ERP_FINANCIALS_STATEMENT_FIXTURE;

describe("rollup, snapshot, freshness, and late-arrival job contracts", () => {
  it("aggregates postings into deterministic day, month, and fiscal rollup buckets", () => {
    const input = {
      companyId: fixture.company.companyId,
      postings: fixture.postings,
      bucketGrains: ["day", "month", "fiscal_period", "fiscal_quarter", "fiscal_year"] as const,
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
    const fiscalQuarterSales = firstRun.find(
      (bucket) => bucket.bucketGrain === "fiscal_quarter" && bucket.bucketStart === "2026-01-01" && bucket.accountId === "acct_sales"
    );
    const fiscalYearSales = firstRun.find(
      (bucket) => bucket.bucketGrain === "fiscal_year" && bucket.bucketStart === "2026-01-01" && bucket.accountId === "acct_sales"
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
    expect(fiscalQuarterSales).toMatchObject({
      rollupBucketId: `rollup:${fixture.company.tenantId}:${fixture.company.companyId}:${fixture.source.sourceId}:accrual:fiscal_quarter:2026-01-01:2026-03-31:acct_sales:USD:${salesDimensionHash}`,
      creditAmount: "20000.00",
      postingCount: 2
    });
    expect(fiscalYearSales).toMatchObject({
      rollupBucketId: `rollup:${fixture.company.tenantId}:${fixture.company.companyId}:${fixture.source.sourceId}:accrual:fiscal_year:2026-01-01:2026-12-31:acct_sales:USD:${salesDimensionHash}`,
      creditAmount: "20000.00",
      postingCount: 2
    });
  });

  it("uses fiscal-year-start month for fiscal quarter and fiscal year windows", () => {
    const basePosting = fixture.postings.find((posting) => posting.postingId === "post_cash_sale_revenue");

    if (basePosting === undefined) {
      throw new Error("fixture must include cash sale revenue posting");
    }

    const postings: readonly LedgerPosting[] = [
      {
        ...basePosting,
        postingId: "post_fiscal_march_revenue",
        sourcePostingId: "source_fiscal_march_revenue",
        transactionId: "txn_fiscal_march_revenue",
        transactionLineId: "line_fiscal_march_revenue",
        postingDate: "2026-03-31"
      },
      {
        ...basePosting,
        postingId: "post_fiscal_april_revenue",
        sourcePostingId: "source_fiscal_april_revenue",
        transactionId: "txn_fiscal_april_revenue",
        transactionLineId: "line_fiscal_april_revenue",
        postingDate: "2026-04-01"
      }
    ];
    const buckets = buildRollupBuckets({
      companyId: fixture.company.companyId,
      postings,
      bucketGrains: ["fiscal_quarter", "fiscal_year"],
      fiscalYearStartMonth: 4,
      generatedAt: "2026-04-02T00:00:00.000Z"
    });

    expect(buckets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bucketGrain: "fiscal_quarter",
          bucketStart: "2026-01-01",
          bucketEnd: "2026-03-31",
          postingCount: 1
        }),
        expect.objectContaining({
          bucketGrain: "fiscal_quarter",
          bucketStart: "2026-04-01",
          bucketEnd: "2026-06-30",
          postingCount: 1
        }),
        expect.objectContaining({
          bucketGrain: "fiscal_year",
          bucketStart: "2025-04-01",
          bucketEnd: "2026-03-31",
          postingCount: 1
        }),
        expect.objectContaining({
          bucketGrain: "fiscal_year",
          bucketStart: "2026-04-01",
          bucketEnd: "2027-03-31",
          postingCount: 1
        })
      ])
    );

    const plan = planLateArrivalReprocess({
      tenantId: fixture.company.tenantId,
      companyId: fixture.company.companyId,
      changedPostings: postings,
      bucketGrains: ["fiscal_quarter", "fiscal_year"],
      fiscalYearStartMonth: 4,
      overlapDays: 0,
      reportNames: ["profit_and_loss"],
      updatedAt: "2026-04-02T00:00:00.000Z",
      staleReason: "late_arrival_overlap_reprocess"
    });

    expect(plan.windows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bucketGrain: "fiscal_quarter",
          bucketStart: "2026-01-01",
          bucketEnd: "2026-03-31"
        }),
        expect.objectContaining({
          bucketGrain: "fiscal_quarter",
          bucketStart: "2026-04-01",
          bucketEnd: "2026-06-30"
        }),
        expect.objectContaining({
          bucketGrain: "fiscal_year",
          bucketStart: "2025-04-01",
          bucketEnd: "2026-03-31"
        }),
        expect.objectContaining({
          bucketGrain: "fiscal_year",
          bucketStart: "2026-04-01",
          bucketEnd: "2027-03-31"
        })
      ])
    );
  });

  it("keeps customer, vendor, and employee rollup groups separate in persisted bucket identity", () => {
    const basePosting = fixture.postings.find((posting) => posting.postingId === "post_cash_sale_revenue");
    if (basePosting === undefined) {
      throw new Error("fixture must include cash sale revenue posting");
    }

    const parties: readonly Party[] = [
      {
        tenantId: fixture.company.tenantId,
        sourceId: fixture.source.sourceId,
        partyId: "party_rollup_customer",
        sourcePartyId: "rollup_customer",
        partyType: "customer",
        displayName: "Rollup Customer",
        active: true
      },
      {
        tenantId: fixture.company.tenantId,
        sourceId: fixture.source.sourceId,
        partyId: "party_rollup_vendor",
        sourcePartyId: "rollup_vendor",
        partyType: "vendor",
        displayName: "Rollup Vendor",
        active: true
      },
      {
        tenantId: fixture.company.tenantId,
        sourceId: fixture.source.sourceId,
        partyId: "party_rollup_employee",
        sourcePartyId: "rollup_employee",
        partyType: "employee",
        displayName: "Rollup Employee",
        active: true
      }
    ];
    const postings: readonly LedgerPosting[] = parties.map((party) => ({
      ...basePosting,
      postingId: `post_${party.partyType}_grouped_revenue`,
      sourcePostingId: `${party.partyType}_grouped_revenue`,
      transactionId: `txn_${party.partyType}_grouped_revenue`,
      transactionLineId: `line_${party.partyType}_grouped_revenue`,
      partyId: party.partyId
    }));

    const buckets = buildRollupBuckets({
      companyId: fixture.company.companyId,
      postings,
      parties,
      bucketGrains: ["month"],
      fiscalYearStartMonth: fixture.company.fiscalYearStartMonth,
      generatedAt: "2026-02-01T00:00:00.000Z"
    });

    expect(buckets).toHaveLength(3);
    expect(buckets.map((bucket) => [bucket.partyType, bucket.partyId, bucket.postingCount])).toEqual([
      ["customer", "party_rollup_customer", 1],
      ["employee", "party_rollup_employee", 1],
      ["vendor", "party_rollup_vendor", 1]
    ]);
    expect(new Set(buckets.map((bucket) => bucket.rollupBucketId)).size).toBe(3);
    expect(buckets.map((bucket) => bucket.rollupBucketId)).toEqual(
      expect.arrayContaining([
        `${basePosting.dimensionHash}:party_rollup_customer:customer`,
        `${basePosting.dimensionHash}:party_rollup_vendor:vendor`,
        `${basePosting.dimensionHash}:party_rollup_employee:employee`
      ].map(
        (suffix) =>
          `rollup:${fixture.company.tenantId}:${fixture.company.companyId}:${fixture.source.sourceId}:accrual:month:2026-01-01:2026-01-31:acct_sales:USD:${suffix}`
      ))
    );
  });

  it("keeps product and service rollup groups separate in persisted bucket identity", () => {
    const basePosting = fixture.postings.find((posting) => posting.postingId === "post_cash_sale_revenue");
    if (basePosting === undefined) {
      throw new Error("fixture must include cash sale revenue posting");
    }

    const postings: readonly LedgerPosting[] = ["item_rollup_product", "item_rollup_service"].map((itemId) => ({
      ...basePosting,
      postingId: `post_${itemId}_grouped_revenue`,
      sourcePostingId: `${itemId}_grouped_revenue`,
      transactionId: `txn_${itemId}_grouped_revenue`,
      transactionLineId: `line_${itemId}_grouped_revenue`,
      itemId
    }));

    const buckets = buildRollupBuckets({
      companyId: fixture.company.companyId,
      postings,
      bucketGrains: ["month"],
      fiscalYearStartMonth: fixture.company.fiscalYearStartMonth,
      generatedAt: "2026-02-01T00:00:00.000Z"
    });

    expect(buckets).toHaveLength(2);
    expect(buckets.map((bucket) => [bucket.itemId, bucket.postingCount])).toEqual([
      ["item_rollup_product", 1],
      ["item_rollup_service", 1]
    ]);
    expect(new Set(buckets.map((bucket) => bucket.rollupBucketId)).size).toBe(2);
    expect(buckets.map((bucket) => bucket.rollupBucketId)).toEqual(
      expect.arrayContaining([
        `${basePosting.dimensionHash}:item_rollup_product`,
        `${basePosting.dimensionHash}:item_rollup_service`
      ].map(
        (suffix) =>
          `rollup:${fixture.company.tenantId}:${fixture.company.companyId}:${fixture.source.sourceId}:accrual:month:2026-01-01:2026-01-31:acct_sales:USD:${suffix}`
      ))
    );
    expect(buckets.map((bucket) => bucket.drilldownRef.query)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemIds: ["item_rollup_product"] }),
        expect.objectContaining({ itemIds: ["item_rollup_service"] })
      ])
    );
  });

  it("rejects invalid fiscal-year-start months before building rollups", () => {
    expect(() =>
      buildRollupBuckets({
        companyId: fixture.company.companyId,
        postings: fixture.postings,
        bucketGrains: ["fiscal_year"],
        fiscalYearStartMonth: 13,
        generatedAt: "2026-02-01T00:00:00.000Z"
      })
    ).toThrow("fiscalYearStartMonth must be an integer between 1 and 12");
  });

  it("builds scheduled rollup job results with deterministic fixture summaries and write-ready buckets", async () => {
    const request = {
      tenantId: fixture.company.tenantId,
      companyId: fixture.company.companyId,
      sourceId: fixture.source.sourceId,
      accountingBasis: "accrual",
      bucketGrains: ["day", "month"] as const,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      fiscalYearStartMonth: fixture.company.fiscalYearStartMonth,
      generatedAt: "2026-02-01T00:00:00.000Z",
      currencyCode: "USD",
      sourceEvidence: {
        sourceSystem: fixture.source.sourceSystem,
        providerEnvironment: fixture.source.providerEnvironment,
        ...(fixture.checkpoint.latestSourceUpdatedAt === undefined
          ? {}
          : { latestSourceUpdatedAt: fixture.checkpoint.latestSourceUpdatedAt }),
        ...(fixture.checkpoint.freshThrough === undefined ? {} : { sourceFreshThrough: fixture.checkpoint.freshThrough })
      },
      importEvidence: {
        importBatchId: fixture.importBatch.importBatchId,
        ...(fixture.importBatch.completedAt === undefined ? {} : { completedAt: fixture.importBatch.completedAt }),
        sourcePostingCount: fixture.postings.length
      },
      checkpointEvidence: {
        checkpointId: fixture.checkpoint.checkpointId,
        sourceObject: fixture.checkpoint.sourceObject,
        ...(fixture.checkpoint.freshThrough === undefined ? {} : { freshThrough: fixture.checkpoint.freshThrough }),
        ...(fixture.checkpoint.latestSourceUpdatedAt === undefined
          ? {}
          : { latestSourceUpdatedAt: fixture.checkpoint.latestSourceUpdatedAt }),
        status: fixture.checkpoint.status
      },
      postings: fixture.postings
    } as const;

    const firstRun = await buildScheduledRollupJobResult(request);
    const secondRun = await buildScheduledRollupJobResult(request);

    expect(secondRun.summary).toEqual(firstRun.summary);
    expect(firstRun.jobName).toBe("erp-financials-rollup");
    expect(firstRun.buckets.every((bucket) => !("drilldownRef" in bucket))).toBe(true);
    expect(firstRun.summary).toMatchObject({
      tenantId: fixture.company.tenantId,
      companyId: fixture.company.companyId,
      sourceId: fixture.source.sourceId,
      accountingBasis: "accrual",
      bucketGrains: ["day", "month"],
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      generatedAt: "2026-02-01T00:00:00.000Z",
      currencyCode: "USD",
      postingCount: 20,
      accountCount: 10,
      dimensionHashCount: 3,
      currencyCodes: ["USD"],
      sourceEvidence: {
        sourceSystem: fixture.source.sourceSystem,
        providerEnvironment: fixture.source.providerEnvironment
      },
      importEvidence: {
        importBatchId: fixture.importBatch.importBatchId,
        sourcePostingCount: fixture.postings.length
      },
      checkpointEvidence: {
        checkpointId: fixture.checkpoint.checkpointId,
        status: "current"
      }
    });
    expect(firstRun.summary.bucketSummaries).toEqual([
      {
        bucketGrain: "day",
        bucketCount: 20,
        windowCount: 10,
        bucketStartMin: "2026-01-05",
        bucketEndMax: "2026-01-30"
      },
      {
        bucketGrain: "month",
        bucketCount: 12,
        windowCount: 1,
        bucketStartMin: "2026-01-01",
        bucketEndMax: "2026-01-31"
      }
    ]);
    assertNoCredentialKeys(firstRun);
    expect(JSON.stringify(firstRun)).not.toContain("\"token\"");
    expect(JSON.stringify(firstRun)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i);
  });

  it("accepts a host canonical posting read interface for scheduled rollup jobs", async () => {
    const readRequests: unknown[] = [];
    const postingReader: ScheduledRollupCanonicalPostingReader = {
      readCanonicalPostingsForRollup(input) {
        readRequests.push(input);
        return Promise.resolve(fixture.postings);
      }
    };

    const result = await buildScheduledRollupJobResult({
      tenantId: fixture.company.tenantId,
      companyId: fixture.company.companyId,
      sourceId: fixture.source.sourceId,
      accountingBasis: "accrual",
      bucketGrains: ["month"],
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      fiscalYearStartMonth: fixture.company.fiscalYearStartMonth,
      generatedAt: "2026-02-01T00:00:00.000Z",
      currencyCode: "USD",
      postingReader
    });

    expect(readRequests).toEqual([
      {
        tenantId: fixture.company.tenantId,
        companyId: fixture.company.companyId,
        sourceId: fixture.source.sourceId,
        accountingBasis: "accrual",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        currencyCode: "USD"
      }
    ]);
    expect(result.summary).toMatchObject({
      postingCount: 20,
      bucketCount: 12,
      bucketSummaries: [
        {
          bucketGrain: "month",
          bucketCount: 12,
          windowCount: 1,
          bucketStartMin: "2026-01-01",
          bucketEndMax: "2026-01-31"
        }
      ]
    });
  });

  it("rejects credential-like scheduled rollup evidence", async () => {
    await expect(
      buildScheduledRollupJobResult({
        tenantId: fixture.company.tenantId,
        companyId: fixture.company.companyId,
        sourceId: fixture.source.sourceId,
        accountingBasis: "accrual",
        bucketGrains: ["month"],
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        fiscalYearStartMonth: fixture.company.fiscalYearStartMonth,
        generatedAt: "2026-02-01T00:00:00.000Z",
        sourceEvidence: {
          accessToken: "not allowed"
        } as never,
        postings: fixture.postings
      })
    ).rejects.toThrow("credential-like field is not allowed");
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

  it("rejects empty changed posting sets for late-arrival execution contracts", async () => {
    await expect(
      buildLateArrivalReprocessExecutionContract({
        tenantId: fixture.company.tenantId,
        companyId: fixture.company.companyId,
        changedPostings: [],
        bucketGrains: ["month"],
        fiscalYearStartMonth: fixture.company.fiscalYearStartMonth,
        overlapDays: 0,
        reportNames: ["profit_and_loss"],
        updatedAt: "2026-02-02T00:00:00.000Z",
        generatedAt: "2026-02-02T00:00:00.000Z",
        staleReason: "late_arrival_overlap_reprocess",
        postings: fixture.postings
      })
    ).rejects.toThrow("changedPostings must include at least one posting");
  });

  it("builds and executes an ordered late-arrival write plan with replace-before-stale-before-freshness semantics", async () => {
    const changedPostings = fixture.postings.filter((posting) =>
      ["post_rent_expense", "post_rent_cash"].includes(posting.postingId)
    );
    const request = {
      tenantId: fixture.company.tenantId,
      companyId: fixture.company.companyId,
      changedPostings,
      bucketGrains: ["day", "month"] as const,
      fiscalYearStartMonth: fixture.company.fiscalYearStartMonth,
      overlapDays: 7,
      reportNames: ["profit_and_loss", "balance_sheet"] as const,
      updatedAt: "2026-02-02T00:00:00.000Z",
      generatedAt: "2026-02-02T00:00:00.000Z",
      staleReason: "late_arrival_overlap_reprocess",
      freshThrough: "2026-02-01T00:00:00.000Z",
      importBatchId: "batch_delta_late",
      checkpointId: fixture.checkpoint.checkpointId,
      postings: fixture.postings
    };
    const firstContract = await buildLateArrivalReprocessExecutionContract(request);
    const secondContract = await buildLateArrivalReprocessExecutionContract(request);
    const client = new RecordingClient();
    const adapter = createPostgresStorageAdapter(client);

    const firstExecution = await executeLateArrivalReprocess({ ...request, storage: adapter });
    await executeLateArrivalReprocess({ ...request, storage: adapter });

    expect(secondContract).toEqual(firstContract);
    expect(firstContract.jobName).toBe("erp-financials-late-arrival-reprocess");
    expect(firstContract.storageWritePlan.map((step) => step.operation)).toEqual([
      "replaceRollupBucketsForWindows",
      "markReportSnapshotsStaleForPostingChanges",
      "writeFreshnessRows"
    ]);
    expect(firstContract.storageWritePlan[0]).toMatchObject({
      order: 1,
      input: {
        windows: firstContract.windows,
        buckets: firstContract.buckets
      }
    });
    expect(firstContract.storageWritePlan[1]).toMatchObject({
      order: 2,
      input: {
        tenantId: fixture.company.tenantId,
        affectedStart: "2026-01-05",
        affectedEnd: "2026-01-12",
        staleReason: "late_arrival_overlap_reprocess",
        reportNames: ["profit_and_loss", "balance_sheet"]
      }
    });
    expect(firstContract.storageWritePlan[2]).toMatchObject({
      order: 3,
      input: firstContract.freshnessRows
    });
    expect(firstContract.buckets.some((bucket) => bucket.bucketGrain === "day" && bucket.bucketStart === "2026-01-30")).toBe(false);
    expect(firstContract.buckets.some((bucket) => bucket.bucketGrain === "month" && bucket.bucketStart === "2026-01-01")).toBe(true);
    expect(firstExecution.writeResults.map((result) => result.operation)).toEqual([
      "replaceRollupBucketsForWindows",
      "markReportSnapshotsStaleForPostingChanges",
      "writeFreshnessRows"
    ]);
    expect(client.calls[0]?.sql).toContain('delete from "erp_financials"."rollup_buckets"');
    expect(client.calls[1]?.sql).toContain('insert into "erp_financials"."rollup_buckets"');
    expect(client.calls[2]?.sql).toContain('update "erp_financials"."report_snapshots"');
    expect(client.calls[2]?.sql).toContain('"period_start" <= $3::date and "period_end" >= $2::date');
    expect(client.calls[3]?.sql).toContain('insert into "erp_financials"."report_freshness"');
    expect(client.calls[4]?.sql).toContain('delete from "erp_financials"."rollup_buckets"');
    expect(client.calls[5]?.sql).toContain('insert into "erp_financials"."rollup_buckets"');
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
      'on conflict ("tenant_id", "company_id", "source_id", "accounting_basis", "bucket_grain", "bucket_start", "bucket_end", "account_id", "currency_code", "dimension_hash", "party_id", "party_type", "item_id") do update'
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

  it("reuses fresh stored snapshots without rebuilding or writing", async () => {
    const freshReport = buildProfitAndLossReport({
      ...fixture.reportRequest,
      sourceId: fixture.source.sourceId,
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
    const storage = new SnapshotRefreshMemoryStorage(storedReportBuilderInput(), storedSnapshotFromReport(freshReport));

    const result = await executeSnapshotRefresh({
      tenantId: fixture.company.tenantId,
      companyId: fixture.company.companyId,
      sourceId: fixture.source.sourceId,
      reportName: "profit_and_loss",
      accountingBasis: "accrual",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      asOfDate: "2026-01-31",
      currencyCode: "USD",
      generatedAt: "2026-02-02T00:00:00.000Z",
      freshThrough: "2026-02-01T00:00:00.000Z",
      importBatchId: fixture.importBatch.importBatchId,
      checkpointId: fixture.checkpoint.checkpointId,
      storage
    });

    expect(result.action).toBe("reused");
    expect(result.snapshotId).toBe(freshReport.snapshot.reportSnapshotId);
    expect(result.writeResults).toEqual([]);
    expect(storage.builderRequests).toEqual([]);
    expect(storage.writtenReports).toEqual([]);
    expect(storage.writtenFreshnessRows).toEqual([]);
  });

  it("rebuilds stale and missing snapshots through package report builders and writes freshness rows", async () => {
    const staleReport = buildProfitAndLossReport({
      ...fixture.reportRequest,
      sourceId: fixture.source.sourceId,
      accounts: fixture.accounts,
      postings: fixture.postings,
      freshness: {
        status: "stale",
        staleReason: "late_arrival_overlap_reprocess"
      }
    });
    const staleStorage = new SnapshotRefreshMemoryStorage(storedReportBuilderInput(), storedSnapshotFromReport(staleReport));

    const staleResult = await executeSnapshotRefresh({
      tenantId: fixture.company.tenantId,
      companyId: fixture.company.companyId,
      sourceId: fixture.source.sourceId,
      reportName: "profit_and_loss",
      accountingBasis: "accrual",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      asOfDate: "2026-01-31",
      currencyCode: "USD",
      generatedAt: "2026-02-02T00:00:00.000Z",
      freshThrough: "2026-02-01T00:00:00.000Z",
      importBatchId: fixture.importBatch.importBatchId,
      checkpointId: fixture.checkpoint.checkpointId,
      storage: staleStorage
    });
    const missingStorage = new SnapshotRefreshMemoryStorage(storedReportBuilderInput());
    const missingResult = await executeSnapshotRefresh({
      tenantId: fixture.company.tenantId,
      companyId: fixture.company.companyId,
      sourceId: fixture.source.sourceId,
      reportName: "trial_balance",
      accountingBasis: "accrual",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      asOfDate: "2026-01-31",
      currencyCode: "USD",
      generatedAt: "2026-02-02T00:00:00.000Z",
      freshThrough: "2026-02-01T00:00:00.000Z",
      importBatchId: fixture.importBatch.importBatchId,
      checkpointId: fixture.checkpoint.checkpointId,
      storage: missingStorage
    });

    expect(staleResult.action).toBe("rebuilt");
    expect(staleResult.report?.metadata.reportName).toBe("profit_and_loss");
    expect(staleResult.report?.snapshot.freshness).toMatchObject({
      status: "fresh",
      sourceId: fixture.source.sourceId,
      importBatchId: fixture.importBatch.importBatchId,
      checkpointId: fixture.checkpoint.checkpointId
    });
    expect(staleResult.writeResults.map((result) => result.operation)).toEqual(["writeReportSnapshot", "writeFreshnessRows"]);
    expect(staleStorage.builderRequests).toHaveLength(1);
    expect(staleStorage.writtenReports).toHaveLength(1);
    expect(staleStorage.writtenFreshnessRows).toHaveLength(1);
    expect(missingResult.action).toBe("rebuilt");
    expect(missingResult.report?.metadata.reportName).toBe("trial_balance");
    expect(missingStorage.writtenReports).toHaveLength(1);
    expect(missingStorage.writtenFreshnessRows[0]).toMatchObject({
      reportName: "trial_balance",
      status: "fresh",
      freshThrough: "2026-02-01T00:00:00.000Z"
    });
  });

  it("preserves cash-flow support metadata when refreshing a missing snapshot", async () => {
    const storage = new SnapshotRefreshMemoryStorage(storedReportBuilderInput());

    const result = await executeSnapshotRefresh({
      tenantId: fixture.company.tenantId,
      companyId: fixture.company.companyId,
      sourceId: fixture.source.sourceId,
      reportName: "cash_flow",
      accountingBasis: "accrual",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      asOfDate: "2026-01-31",
      currencyCode: "USD",
      generatedAt: "2026-02-02T00:00:00.000Z",
      freshThrough: "2026-02-01T00:00:00.000Z",
      importBatchId: fixture.importBatch.importBatchId,
      checkpointId: fixture.checkpoint.checkpointId,
      cashFlow: fixture.cashFlow,
      storage
    });

    expect(result.action).toBe("rebuilt");
    expect(result.cashFlow).toMatchObject({
      supportStatus: "partial",
      derivationMethod: "cash_account_ledger_movement",
      cashAccountIds: fixture.cashFlow.cashAccountIds,
      unsupportedReasons: ["cash_flow_has_unclassified_cash_movement"]
    });
    expect(result.report?.totals.find((total) => total.totalKey === "net_cash_flow")?.amount).toBe(
      fixture.expectedTotals.cashFlow.net_cash_flow
    );
    expect(storage.writtenReports[0]?.metadata.cashFlow?.supportStatus).toBe("partial");
    expect(storage.writtenFreshnessRows[0]).toMatchObject({
      reportName: "cash_flow",
      status: "fresh"
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

class SnapshotRefreshMemoryStorage implements SnapshotRefreshStorage {
  readonly loadSnapshotRequests: unknown[] = [];
  readonly builderRequests: LoadReportBuilderInput[] = [];
  readonly writtenReports: BuiltReport[] = [];
  readonly writtenFreshnessRows: ReportFreshnessRow[] = [];

  constructor(
    private readonly builderInput: ReportBuilderInput,
    private readonly latestSnapshot?: StoredReportSnapshot
  ) {}

  loadLatestReportSnapshot(input: Parameters<SnapshotRefreshStorage["loadLatestReportSnapshot"]>[0]): Promise<StoredReportSnapshot | undefined> {
    this.loadSnapshotRequests.push(input);
    return Promise.resolve(this.latestSnapshot);
  }

  loadReportBuilderInput(input: LoadReportBuilderInput): Promise<ReportBuilderInput> {
    this.builderRequests.push(input);
    return Promise.resolve(this.builderInput);
  }

  writeReportSnapshot(report: BuiltReport): Promise<number> {
    this.writtenReports.push(report);
    return Promise.resolve(1 + report.lines.length + report.totals.length);
  }

  writeFreshnessRows(rows: readonly ReportFreshnessRow[]): Promise<number> {
    this.writtenFreshnessRows.push(...rows);
    return Promise.resolve(rows.length);
  }
}

function storedReportBuilderInput(): ReportBuilderInput {
  return {
    ...fixture.reportRequest,
    sourceId: fixture.source.sourceId,
    accounts: fixture.accounts,
    postings: fixture.postings
  };
}

function storedSnapshotFromReport(report: BuiltReport): StoredReportSnapshot {
  return {
    snapshot: report.snapshot,
    lines: report.lines,
    totals: report.totals
  };
}
