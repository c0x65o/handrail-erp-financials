import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  createFutureErpRollupAndLateArrivalWorker
} from "../src/index.js";

import type {
  FutureErpRollupWorkerPostingReader,
  FutureErpRollupWorkerStorage,
  LedgerPosting,
  PostgresQueryClient,
  PostgresQueryResult,
  ReportFreshnessRow,
  ReplaceRollupBucketsForWindowsInput,
  ReplaceRollupBucketsForWindowsResult,
  RollupBucket,
  ScheduledRollupPostingReadRequest,
  LateArrivalReprocessPostingReadRequest,
  MarkReportSnapshotsStaleForPostingChangesInput
} from "../src/index.js";

type QueryCall = {
  readonly sql: string;
  readonly params: readonly unknown[];
};

type StorageCall =
  | {
      readonly method: "writeRollupBuckets";
      readonly buckets: readonly RollupBucket[];
    }
  | {
      readonly method: "replaceRollupBucketsForWindows";
      readonly input: ReplaceRollupBucketsForWindowsInput;
    }
  | {
      readonly method: "markReportSnapshotsStaleForPostingChanges";
      readonly input: MarkReportSnapshotsStaleForPostingChangesInput;
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

describe("Future ERP rollup and late-arrival worker bindings", () => {
  it("runs scheduled rollups from app-owned scope, reader, and Postgres storage adapter writes", async () => {
    const reader = new RecordingPostingReader(fixture.postings);
    const postgresClient = new RecordingPostgresClient();
    const worker = createFutureErpRollupAndLateArrivalWorker({
      scope,
      postingReader: reader,
      postgresClient
    });

    const result = await worker.runScheduledRollup({
      accountingBasis: "accrual",
      bucketGrains: ["month"],
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
          : { latestSourceUpdatedAt: fixture.checkpoint.latestSourceUpdatedAt })
      },
      importEvidence: {
        importBatchId: fixture.importBatch.importBatchId,
        importedThrough: "2026-02-01T00:00:00.000Z"
      },
      checkpointEvidence: {
        checkpointId: fixture.checkpoint.checkpointId,
        status: fixture.checkpoint.status
      },
      freshnessReconciliations: [
        {
          reportName: "profit_and_loss",
          accountingBasis: "accrual",
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
          currencyCode: "USD",
          sourceFreshThrough: "2026-02-01T00:00:00.000Z",
          importedThrough: "2026-02-01T00:00:00.000Z",
          importBatchId: fixture.importBatch.importBatchId,
          checkpointId: fixture.checkpoint.checkpointId,
          updatedAt: "2026-02-01T00:00:00.000Z"
        }
      ]
    });

    expect(reader.rollupRequests).toEqual([
      {
        tenantId: scope.tenantId,
        companyId: scope.companyId,
        sourceId: scope.sourceId,
        accountingBasis: "accrual",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        currencyCode: "USD"
      }
    ]);
    expect(result.summary).toMatchObject({
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      sourceId: scope.sourceId,
      postingCount: 20,
      bucketCount: 12
    });
    expect(result.rollupBucketsWritten).toBe(12);
    expect(result.freshnessRowsWritten).toBe(1);
    expect(result.freshnessRows).toEqual([
      expect.objectContaining({
        freshnessId:
          "freshness:tenant_fixture:company_fixture:source_native_fixture:profit_and_loss:accrual:2026-01-01:2026-01-31:USD",
        status: "fresh",
        freshThrough: "2026-02-01T00:00:00.000Z"
      })
    ]);
    expect(postgresClient.calls[0]?.sql).toContain('insert into "erp_financials"."rollup_buckets"');
    expect(postgresClient.calls[0]?.sql).toContain(
      'on conflict ("tenant_id", "company_id", "source_id", "accounting_basis", "bucket_grain", "bucket_start", "bucket_end", "account_id", "currency_code", "dimension_hash") do update'
    );
    expect(postgresClient.calls[1]?.sql).toContain('insert into "erp_financials"."report_freshness"');
    expect(JSON.stringify(result)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i);
  });

  it("executes late-arrival reprocess with replace, stale snapshot, and freshness storage writes", async () => {
    const reader = new RecordingPostingReader(fixture.postings);
    const storage = new RecordingRollupStorage();
    const worker = createFutureErpRollupAndLateArrivalWorker({
      scope,
      postingReader: reader,
      storage
    });
    const changedPostings = fixture.postings.filter((posting) =>
      ["post_rent_expense", "post_rent_cash"].includes(posting.postingId)
    );

    const result = await worker.runLateArrivalReprocess({
      changedPostings,
      bucketGrains: ["day", "month"],
      fiscalYearStartMonth: fixture.company.fiscalYearStartMonth,
      overlapDays: 7,
      reportNames: ["profit_and_loss", "balance_sheet"],
      updatedAt: "2026-02-02T00:00:00.000Z",
      generatedAt: "2026-02-02T00:00:00.000Z",
      staleReason: "late_arrival_overlap_reprocess",
      freshThrough: "2026-02-01T00:00:00.000Z",
      importBatchId: "batch_delta_late",
      checkpointId: fixture.checkpoint.checkpointId
    });

    expect(reader.lateArrivalRequests).toEqual([
      {
        tenantId: scope.tenantId,
        companyId: scope.companyId,
        sourceId: scope.sourceId,
        accountingBasis: "accrual",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        currencyCode: "USD"
      }
    ]);
    expect(storage.calls.map((call) => call.method)).toEqual([
      "replaceRollupBucketsForWindows",
      "markReportSnapshotsStaleForPostingChanges",
      "writeFreshnessRows"
    ]);
    expect(result.writeResults.map((write) => write.operation)).toEqual([
      "replaceRollupBucketsForWindows",
      "markReportSnapshotsStaleForPostingChanges",
      "writeFreshnessRows"
    ]);
    const replaceCall = storage.calls[0];
    if (replaceCall?.method !== "replaceRollupBucketsForWindows") {
      throw new Error("expected first storage call to replace rollup buckets");
    }
    expect(replaceCall.input.buckets).toContainEqual({
      rollupBucketId: expect.any(String) as string,
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      sourceId: scope.sourceId,
      accountId: expect.any(String) as string,
      accountingBasis: "accrual",
      bucketGrain: "month",
      bucketStart: "2026-01-01",
      bucketEnd: "2026-01-31",
      currencyCode: "USD",
      dimensionHash: expect.any(String) as string,
      debitAmount: expect.any(String) as string,
      creditAmount: expect.any(String) as string,
      netAmount: expect.any(String) as string,
      postingCount: expect.any(Number) as number,
      generatedAt: "2026-02-02T00:00:00.000Z",
      importBatchId: "batch_delta_late"
    });
    expect(storage.calls[1]).toMatchObject({
      method: "markReportSnapshotsStaleForPostingChanges",
      input: {
        tenantId: scope.tenantId,
        affectedStart: "2026-01-05",
        affectedEnd: "2026-01-12",
        staleReason: "late_arrival_overlap_reprocess",
        reportNames: ["profit_and_loss", "balance_sheet"]
      }
    });
    expect(storage.calls[2]).toMatchObject({
      method: "writeFreshnessRows",
      rows: [
        expect.objectContaining({
          reportName: "profit_and_loss",
          status: "stale",
          staleReason: "late_arrival_overlap_reprocess"
        }),
        expect.objectContaining({
          reportName: "balance_sheet",
          status: "stale",
          staleReason: "late_arrival_overlap_reprocess"
        })
      ]
    });
    expect(JSON.stringify(result)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i);
  });

  it("rejects late-arrival postings outside the configured tenant/source scope before storage writes", async () => {
    const reader = new RecordingPostingReader(fixture.postings);
    const storage = new RecordingRollupStorage();
    const worker = createFutureErpRollupAndLateArrivalWorker({
      scope,
      postingReader: reader,
      storage
    });
    const changedPosting = fixture.postings.find((posting) => posting.postingId === "post_rent_expense");
    if (changedPosting === undefined) {
      throw new Error("fixture must include changed posting");
    }

    await expect(
      worker.runLateArrivalReprocess({
        changedPostings: [{ ...changedPosting, sourceId: "source_other" }],
        bucketGrains: ["month"],
        fiscalYearStartMonth: fixture.company.fiscalYearStartMonth,
        overlapDays: 0,
        reportNames: ["profit_and_loss"],
        updatedAt: "2026-02-02T00:00:00.000Z",
        generatedAt: "2026-02-02T00:00:00.000Z",
        staleReason: "late_arrival_overlap_reprocess"
      })
    ).rejects.toThrow("outside its tenant/source scope");
    expect(storage.calls).toEqual([]);
    expect(reader.lateArrivalRequests).toEqual([]);
  });
});

class RecordingPostingReader implements FutureErpRollupWorkerPostingReader {
  readonly rollupRequests: ScheduledRollupPostingReadRequest[] = [];
  readonly lateArrivalRequests: LateArrivalReprocessPostingReadRequest[] = [];

  constructor(private readonly postings: readonly LedgerPosting[]) {}

  readCanonicalPostingsForRollup(input: ScheduledRollupPostingReadRequest): Promise<readonly LedgerPosting[]> {
    this.rollupRequests.push(input);

    return Promise.resolve(this.postings);
  }

  readCanonicalPostingsForLateArrivalReprocess(
    input: LateArrivalReprocessPostingReadRequest
  ): Promise<readonly LedgerPosting[]> {
    this.lateArrivalRequests.push(input);

    return Promise.resolve(this.postings);
  }
}

class RecordingRollupStorage implements FutureErpRollupWorkerStorage {
  readonly calls: StorageCall[] = [];

  writeRollupBuckets(buckets: readonly RollupBucket[]): Promise<number> {
    this.calls.push({ method: "writeRollupBuckets", buckets });

    return Promise.resolve(buckets.length);
  }

  replaceRollupBucketsForWindows(input: ReplaceRollupBucketsForWindowsInput): Promise<ReplaceRollupBucketsForWindowsResult> {
    this.calls.push({ method: "replaceRollupBucketsForWindows", input });

    return Promise.resolve({ deleted: input.windows.length, upserted: input.buckets.length });
  }

  markReportSnapshotsStaleForPostingChanges(input: MarkReportSnapshotsStaleForPostingChangesInput): Promise<number> {
    this.calls.push({ method: "markReportSnapshotsStaleForPostingChanges", input });

    return Promise.resolve(1);
  }

  writeFreshnessRows(rows: readonly ReportFreshnessRow[]): Promise<number> {
    this.calls.push({ method: "writeFreshnessRows", rows });

    return Promise.resolve(rows.length);
  }
}

class RecordingPostgresClient implements PostgresQueryClient {
  readonly calls: QueryCall[] = [];

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ sql, params });

    return Promise.resolve({
      rows: [],
      rowCount: null
    });
  }
}
