import type {
  AccountingBasis,
  AccountingSourceSystem,
  CompanyId,
  DecimalString,
  DrilldownRef,
  ImportBatchId,
  IsoCurrencyCode,
  IsoDate,
  IsoDateTime,
  LedgerPosting,
  Party,
  PartyType,
  ProviderEnvironment,
  ReportFreshness,
  SourceId,
  SyncCheckpointId,
  SyncCheckpointStatus,
  TenantId
} from "./canonical-model.js";
import {
  buildBalanceSheetReport,
  buildCashFlowReport,
  buildProfitAndLossReport,
  buildTrialBalanceReport
} from "./report-builders.js";
import { assertNoCredentialKeys, createCompactDrilldownRef } from "./canonical-model.js";
import type {
  MarkReportSnapshotsStaleForPostingChangesInput,
  PostgresStorageAdapter,
  ReportFreshnessRow,
  ReplaceRollupBucketsForWindowsInput,
  ReplaceRollupBucketsForWindowsResult,
  RollupBucket,
  RollupBucketGrain,
  RollupReprocessWindow,
  StoredReportSnapshot
} from "./postgres-storage.js";
import type { BuiltReport, CashFlowBuilderInput, CashFlowMetadata, ReportBuilderInput, ReportName } from "./report-builders.js";

export type RollupBuildInput = {
  readonly companyId: string;
  readonly postings: readonly LedgerPosting[];
  readonly bucketGrains: readonly RollupBucketGrain[];
  readonly fiscalYearStartMonth: number;
  readonly generatedAt: IsoDateTime;
  readonly importBatchId?: string;
  readonly parties?: readonly Party[];
};

export type BuiltRollupBucket = RollupBucket & {
  readonly drilldownRef: DrilldownRef;
};

export type ScheduledRollupJobName = "erp-financials-rollup";

export type ScheduledRollupScope = {
  readonly tenantId: TenantId;
  readonly companyId: CompanyId;
  readonly sourceId: SourceId;
};

export type ScheduledRollupSourceEvidence = {
  readonly sourceSystem?: AccountingSourceSystem;
  readonly providerEnvironment?: ProviderEnvironment;
  readonly latestSourceUpdatedAt?: IsoDateTime;
  readonly sourceFreshThrough?: IsoDateTime;
};

export type ScheduledRollupImportEvidence = {
  readonly importBatchId?: ImportBatchId;
  readonly importedThrough?: IsoDateTime;
  readonly completedAt?: IsoDateTime;
  readonly sourcePostingCount?: number;
};

export type ScheduledRollupCheckpointEvidence = {
  readonly checkpointId?: SyncCheckpointId;
  readonly sourceObject?: string;
  readonly freshThrough?: IsoDateTime;
  readonly latestSourceUpdatedAt?: IsoDateTime;
  readonly status?: SyncCheckpointStatus;
};

export type ScheduledRollupPostingReadRequest = ScheduledRollupScope & {
  readonly accountingBasis: AccountingBasis;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly currencyCode?: IsoCurrencyCode;
};

export type ScheduledRollupCanonicalPostingReader = {
  readCanonicalPostingsForRollup(input: ScheduledRollupPostingReadRequest): Promise<readonly LedgerPosting[]>;
};

export type ScheduledRollupJobRequest = ScheduledRollupScope & {
  readonly jobName?: ScheduledRollupJobName;
  readonly accountingBasis: AccountingBasis;
  readonly bucketGrains: readonly RollupBucketGrain[];
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly fiscalYearStartMonth: number;
  readonly generatedAt: IsoDateTime;
  readonly currencyCode?: IsoCurrencyCode;
  readonly sourceEvidence?: ScheduledRollupSourceEvidence;
  readonly importEvidence?: ScheduledRollupImportEvidence;
  readonly checkpointEvidence?: ScheduledRollupCheckpointEvidence;
  readonly parties?: readonly Party[];
  readonly postings?: readonly LedgerPosting[];
  readonly postingReader?: ScheduledRollupCanonicalPostingReader;
};

export type ScheduledRollupBucketGrainSummary = {
  readonly bucketGrain: RollupBucketGrain;
  readonly bucketCount: number;
  readonly windowCount: number;
  readonly bucketStartMin?: IsoDate;
  readonly bucketEndMax?: IsoDate;
};

export type ScheduledRollupJobSummary = ScheduledRollupScope & {
  readonly jobName: ScheduledRollupJobName;
  readonly accountingBasis: AccountingBasis;
  readonly bucketGrains: readonly RollupBucketGrain[];
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly generatedAt: IsoDateTime;
  readonly currencyCode?: IsoCurrencyCode;
  readonly postingCount: number;
  readonly bucketCount: number;
  readonly accountCount: number;
  readonly dimensionHashCount: number;
  readonly currencyCodes: readonly IsoCurrencyCode[];
  readonly sourcePostingMaxUpdatedAt?: IsoDateTime;
  readonly bucketSummaries: readonly ScheduledRollupBucketGrainSummary[];
  readonly sourceEvidence?: ScheduledRollupSourceEvidence;
  readonly importEvidence?: ScheduledRollupImportEvidence;
  readonly checkpointEvidence?: ScheduledRollupCheckpointEvidence;
};

export type ScheduledRollupJobResult = {
  readonly jobName: ScheduledRollupJobName;
  readonly generatedAt: IsoDateTime;
  readonly buckets: readonly RollupBucket[];
  readonly summary: ScheduledRollupJobSummary;
};

export type LateArrivalReprocessInput = {
  readonly tenantId: TenantId;
  readonly companyId: string;
  readonly changedPostings: readonly LedgerPosting[];
  readonly bucketGrains: readonly RollupBucketGrain[];
  readonly fiscalYearStartMonth: number;
  readonly overlapDays: number;
  readonly reportNames: readonly ReportName[];
  readonly updatedAt: IsoDateTime;
  readonly staleReason: string;
  readonly freshThrough?: IsoDateTime;
  readonly importBatchId?: string;
  readonly checkpointId?: string;
  readonly parties?: readonly Party[];
};

export type LateArrivalReprocessPlan = {
  readonly affectedStart: IsoDate;
  readonly affectedEnd: IsoDate;
  readonly windows: readonly RollupReprocessWindow[];
  readonly staleSnapshots: MarkReportSnapshotsStaleForPostingChangesInput;
  readonly freshnessRows: readonly ReportFreshnessRow[];
};

export type LateArrivalReprocessJobName = "erp-financials-late-arrival-reprocess";

export type LateArrivalReprocessPostingReadRequest = {
  readonly tenantId: TenantId;
  readonly companyId: string;
  readonly sourceId: SourceId;
  readonly accountingBasis: AccountingBasis;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
};

export type LateArrivalReprocessCanonicalPostingReader = {
  readCanonicalPostingsForLateArrivalReprocess(input: LateArrivalReprocessPostingReadRequest): Promise<readonly LedgerPosting[]>;
};

export type LateArrivalReprocessStorage = Pick<
  PostgresStorageAdapter,
  "replaceRollupBucketsForWindows" | "markReportSnapshotsStaleForPostingChanges" | "writeFreshnessRows"
>;

export type LateArrivalReprocessExecutionInput = LateArrivalReprocessInput & {
  readonly jobName?: LateArrivalReprocessJobName;
  readonly generatedAt: IsoDateTime;
  readonly postings?: readonly LedgerPosting[];
  readonly postingReader?: LateArrivalReprocessCanonicalPostingReader;
};

export type LateArrivalReprocessExecuteInput = LateArrivalReprocessExecutionInput & {
  readonly storage: LateArrivalReprocessStorage;
};

export type LateArrivalReprocessReplaceRollupBucketsStep = {
  readonly order: 1;
  readonly operation: "replaceRollupBucketsForWindows";
  readonly input: ReplaceRollupBucketsForWindowsInput;
};

export type LateArrivalReprocessMarkSnapshotsStaleStep = {
  readonly order: 2;
  readonly operation: "markReportSnapshotsStaleForPostingChanges";
  readonly input: MarkReportSnapshotsStaleForPostingChangesInput;
};

export type LateArrivalReprocessWriteFreshnessRowsStep = {
  readonly order: 3;
  readonly operation: "writeFreshnessRows";
  readonly input: readonly ReportFreshnessRow[];
};

export type LateArrivalReprocessStorageWriteStep =
  | LateArrivalReprocessReplaceRollupBucketsStep
  | LateArrivalReprocessMarkSnapshotsStaleStep
  | LateArrivalReprocessWriteFreshnessRowsStep;

export type LateArrivalReprocessExecutionContract = LateArrivalReprocessPlan & {
  readonly jobName: LateArrivalReprocessJobName;
  readonly generatedAt: IsoDateTime;
  readonly buckets: readonly RollupBucket[];
  readonly storageWritePlan: readonly LateArrivalReprocessStorageWriteStep[];
};

export type LateArrivalReprocessStorageWriteResult =
  | {
      readonly order: 1;
      readonly operation: "replaceRollupBucketsForWindows";
      readonly result: ReplaceRollupBucketsForWindowsResult;
    }
  | {
      readonly order: 2;
      readonly operation: "markReportSnapshotsStaleForPostingChanges";
      readonly result: number;
    }
  | {
      readonly order: 3;
      readonly operation: "writeFreshnessRows";
      readonly result: number;
    };

export type LateArrivalReprocessExecutionResult = LateArrivalReprocessExecutionContract & {
  readonly writeResults: readonly LateArrivalReprocessStorageWriteResult[];
};

export type SnapshotRefreshContractInput = {
  readonly tenantId: TenantId;
  readonly companyId: string;
  readonly sourceId: SourceId;
  readonly reportName: ReportName;
  readonly accountingBasis: AccountingBasis;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly asOfDate: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly generatedAt: IsoDateTime;
  readonly freshThrough?: IsoDateTime;
  readonly importBatchId?: string;
  readonly checkpointId?: string;
};

export type SnapshotRefreshContract = {
  readonly snapshotId: string;
  readonly freshnessRow: ReportFreshnessRow;
};

export type SnapshotRefreshJobName = "erp-financials-snapshot-refresh";

export type SnapshotRefreshCashFlowOptions = Pick<CashFlowBuilderInput, "cashAccountIds" | "activityByAccountId">;

export type SnapshotRefreshStorage = Pick<
  PostgresStorageAdapter,
  "loadLatestReportSnapshot" | "loadReportBuilderInput" | "writeReportSnapshot" | "writeFreshnessRows"
>;

export type SnapshotRefreshRequest = SnapshotRefreshContractInput & {
  readonly jobName?: SnapshotRefreshJobName;
  readonly storage: SnapshotRefreshStorage;
  readonly forceRefresh?: boolean;
  readonly cashFlow?: SnapshotRefreshCashFlowOptions;
};

export type SnapshotRefreshAction = "reused" | "rebuilt";

export type SnapshotRefreshWriteResult =
  | {
      readonly operation: "writeReportSnapshot";
      readonly result: number;
    }
  | {
      readonly operation: "writeFreshnessRows";
      readonly result: number;
    };

export type SnapshotRefreshResult = {
  readonly jobName: SnapshotRefreshJobName;
  readonly action: SnapshotRefreshAction;
  readonly generatedAt: IsoDateTime;
  readonly reportName: ReportName;
  readonly snapshotId: string;
  readonly snapshot: StoredReportSnapshot;
  readonly freshnessRow: ReportFreshnessRow;
  readonly writeResults: readonly SnapshotRefreshWriteResult[];
  readonly report?: BuiltReport;
  readonly cashFlow?: CashFlowMetadata;
};

export type FreshnessReconcileInput = {
  readonly tenantId: TenantId;
  readonly companyId: string;
  readonly sourceId: SourceId;
  readonly reportName: ReportName;
  readonly accountingBasis: AccountingBasis;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly updatedAt: IsoDateTime;
  readonly sourceFreshThrough?: IsoDateTime;
  readonly importedThrough?: IsoDateTime;
  readonly importBatchId?: string;
  readonly checkpointId?: string;
  readonly staleReasons?: readonly string[];
};

type RollupAccumulator = {
  readonly tenantId: TenantId;
  readonly companyId: string;
  readonly sourceId: SourceId;
  readonly accountId: string;
  readonly accountingBasis: AccountingBasis;
  readonly bucketGrain: RollupBucketGrain;
  readonly bucketStart: IsoDate;
  readonly bucketEnd: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly dimensionHash: string;
  readonly partyId?: string;
  readonly partyType?: PartyType;
  readonly itemId?: string;
  debitMinor: bigint;
  creditMinor: bigint;
  netMinor: bigint;
  postingCount: number;
  sourcePostingMaxUpdatedAt?: IsoDateTime;
  importBatchId?: string;
  readonly postingIds: string[];
};

export function buildRollupBuckets(input: RollupBuildInput): readonly BuiltRollupBucket[] {
  assertFiscalYearStartMonth(input.fiscalYearStartMonth);
  const accumulators = new Map<string, RollupAccumulator>();
  const partyTypesById = buildPartyTypesById(input.parties);

  for (const posting of input.postings) {
    const partyType = posting.partyId === undefined ? undefined : partyTypesById.get(posting.partyId);
    for (const grain of input.bucketGrains) {
      const window = bucketWindowForDate(posting.postingDate, grain, input.fiscalYearStartMonth);
      const key = rollupBucketIdentity({
        tenantId: posting.tenantId,
        companyId: input.companyId,
        sourceId: posting.sourceId,
        accountingBasis: posting.accountingBasis,
        bucketGrain: grain,
        bucketStart: window.bucketStart,
        bucketEnd: window.bucketEnd,
        accountId: posting.accountId,
        currencyCode: posting.currencyCode,
        dimensionHash: posting.dimensionHash,
        ...(posting.partyId === undefined ? {} : { partyId: posting.partyId }),
        ...(partyType === undefined ? {} : { partyType }),
        ...(posting.itemId === undefined ? {} : { itemId: posting.itemId })
      });
      const existing = accumulators.get(key);

      if (existing === undefined) {
        accumulators.set(key, {
          tenantId: posting.tenantId,
          companyId: input.companyId,
          sourceId: posting.sourceId,
          accountId: posting.accountId,
          accountingBasis: posting.accountingBasis,
          bucketGrain: grain,
          bucketStart: window.bucketStart,
          bucketEnd: window.bucketEnd,
          currencyCode: posting.currencyCode,
          dimensionHash: posting.dimensionHash,
          ...(posting.partyId === undefined ? {} : { partyId: posting.partyId }),
          ...(partyType === undefined ? {} : { partyType }),
          ...(posting.itemId === undefined ? {} : { itemId: posting.itemId }),
          debitMinor: parseMoney(posting.debitAmount),
          creditMinor: parseMoney(posting.creditAmount),
          netMinor: parseMoney(posting.netAmount),
          postingCount: 1,
          ...(posting.sourcePayloadRef?.sourceUpdatedAt === undefined
            ? {}
            : { sourcePostingMaxUpdatedAt: posting.sourcePayloadRef.sourceUpdatedAt }),
          importBatchId: input.importBatchId ?? posting.importBatchId,
          postingIds: [posting.postingId]
        });
      } else {
        existing.debitMinor += parseMoney(posting.debitAmount);
        existing.creditMinor += parseMoney(posting.creditAmount);
        existing.netMinor += parseMoney(posting.netAmount);
        existing.postingCount += 1;
        const sourcePostingMaxUpdatedAt = maxIsoDateTime(existing.sourcePostingMaxUpdatedAt, posting.sourcePayloadRef?.sourceUpdatedAt);
        if (sourcePostingMaxUpdatedAt !== undefined) {
          existing.sourcePostingMaxUpdatedAt = sourcePostingMaxUpdatedAt;
        }
        existing.importBatchId = input.importBatchId ?? existing.importBatchId ?? posting.importBatchId;
        existing.postingIds.push(posting.postingId);
      }
    }
  }

  return [...accumulators.values()].sort(compareRollupAccumulators).map((accumulator) => rollupBucketFromAccumulator(accumulator, input));
}

export async function buildScheduledRollupJobResult(input: ScheduledRollupJobRequest): Promise<ScheduledRollupJobResult> {
  assertScheduledRollupRequest(input);
  assertNoCredentialKeys(input.sourceEvidence);
  assertNoCredentialKeys(input.importEvidence);
  assertNoCredentialKeys(input.checkpointEvidence);
  assertNoCredentialKeys(input.parties);

  const postings = await readScheduledRollupPostings(input);
  assertNoCredentialKeys(postings);

  const selectedPostings = selectScheduledRollupPostings(input, postings);
  const builtBuckets = buildRollupBuckets({
    companyId: input.companyId,
    postings: selectedPostings,
    bucketGrains: input.bucketGrains,
    fiscalYearStartMonth: input.fiscalYearStartMonth,
    generatedAt: input.generatedAt,
    ...(input.parties === undefined ? {} : { parties: input.parties }),
    ...(input.importEvidence?.importBatchId === undefined ? {} : { importBatchId: input.importEvidence.importBatchId })
  });
  const buckets = builtBuckets.map(writeReadyRollupBucket);
  const summary = buildScheduledRollupJobSummary(input, selectedPostings, buckets);
  const result: ScheduledRollupJobResult = {
    jobName: "erp-financials-rollup",
    generatedAt: input.generatedAt,
    buckets,
    summary
  };

  assertNoCredentialKeys(result);

  return result;
}

export function planLateArrivalReprocess(input: LateArrivalReprocessInput): LateArrivalReprocessPlan {
  assertFiscalYearStartMonth(input.fiscalYearStartMonth);

  if (input.changedPostings.length === 0) {
    throw new Error("changedPostings must include at least one posting");
  }
  if (input.overlapDays < 0) {
    throw new Error("overlapDays must be nonnegative");
  }

  const affectedPostingStart = minIsoDate(input.changedPostings.map((posting) => posting.postingDate));
  const affectedStart = addDays(affectedPostingStart, -input.overlapDays);
  const affectedEnd = maxIsoDate(input.changedPostings.map((posting) => posting.postingDate));
  const windows = buildRollupReprocessWindows(input, affectedStart, affectedEnd);
  const staleSnapshots: MarkReportSnapshotsStaleForPostingChangesInput = {
    tenantId: input.tenantId,
    affectedStart,
    affectedEnd,
    staleReason: input.staleReason,
    reportNames: input.reportNames
  };
  const freshnessRows = buildLateArrivalFreshnessRows(input, affectedStart, affectedEnd);

  return {
    affectedStart,
    affectedEnd,
    windows,
    staleSnapshots,
    freshnessRows
  };
}

export async function buildLateArrivalReprocessExecutionContract(
  input: LateArrivalReprocessExecutionInput
): Promise<LateArrivalReprocessExecutionContract> {
  assertLateArrivalReprocessExecutionInput(input);
  assertNoCredentialKeys(input.changedPostings);
  assertNoCredentialKeys(input.postings);
  assertNoCredentialKeys(input.parties);

  const plan = planLateArrivalReprocess(input);
  const postings = await readLateArrivalReprocessPostings(input, plan);
  assertNoCredentialKeys(postings);

  const buckets = buildRollupBuckets({
    companyId: input.companyId,
    postings: selectLateArrivalReprocessPostings(postings, plan.windows),
    bucketGrains: input.bucketGrains,
    fiscalYearStartMonth: input.fiscalYearStartMonth,
    generatedAt: input.generatedAt,
    ...(input.parties === undefined ? {} : { parties: input.parties }),
    ...(input.importBatchId === undefined ? {} : { importBatchId: input.importBatchId })
  })
    .map(writeReadyRollupBucket)
    .filter((bucket) => rollupBucketMatchesAnyWindow(bucket, plan.windows));

  const storageWritePlan: readonly LateArrivalReprocessStorageWriteStep[] = [
    {
      order: 1,
      operation: "replaceRollupBucketsForWindows",
      input: {
        windows: plan.windows,
        buckets
      }
    },
    {
      order: 2,
      operation: "markReportSnapshotsStaleForPostingChanges",
      input: plan.staleSnapshots
    },
    {
      order: 3,
      operation: "writeFreshnessRows",
      input: plan.freshnessRows
    }
  ];

  const contract: LateArrivalReprocessExecutionContract = {
    jobName: "erp-financials-late-arrival-reprocess",
    generatedAt: input.generatedAt,
    affectedStart: plan.affectedStart,
    affectedEnd: plan.affectedEnd,
    windows: plan.windows,
    staleSnapshots: plan.staleSnapshots,
    freshnessRows: plan.freshnessRows,
    buckets,
    storageWritePlan
  };

  assertNoCredentialKeys(contract);

  return contract;
}

export async function executeLateArrivalReprocess(input: LateArrivalReprocessExecuteInput): Promise<LateArrivalReprocessExecutionResult> {
  const contract = await buildLateArrivalReprocessExecutionContract(input);
  const writeResults: LateArrivalReprocessStorageWriteResult[] = [];

  for (const step of contract.storageWritePlan) {
    switch (step.operation) {
      case "replaceRollupBucketsForWindows":
        writeResults.push({
          order: step.order,
          operation: step.operation,
          result: await input.storage.replaceRollupBucketsForWindows(step.input)
        });
        break;
      case "markReportSnapshotsStaleForPostingChanges":
        writeResults.push({
          order: step.order,
          operation: step.operation,
          result: await input.storage.markReportSnapshotsStaleForPostingChanges(step.input)
        });
        break;
      case "writeFreshnessRows":
        writeResults.push({
          order: step.order,
          operation: step.operation,
          result: await input.storage.writeFreshnessRows(step.input)
        });
        break;
    }
  }

  return {
    ...contract,
    writeResults
  };
}

export function createSnapshotRefreshContract(input: SnapshotRefreshContractInput): SnapshotRefreshContract {
  return {
    snapshotId: [
      "snapshot",
      input.tenantId,
      input.reportName,
      input.accountingBasis,
      input.periodStart,
      input.periodEnd,
      input.asOfDate,
      input.currencyCode
    ].join(":"),
    freshnessRow: {
      freshnessId: freshnessId(input),
      tenantId: input.tenantId,
      companyId: input.companyId,
      sourceId: input.sourceId,
      reportName: input.reportName,
      accountingBasis: input.accountingBasis,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      currencyCode: input.currencyCode,
      status: input.freshThrough === undefined ? "unknown" : "fresh",
      ...(input.freshThrough === undefined ? {} : { freshThrough: input.freshThrough }),
      ...(input.importBatchId === undefined ? {} : { importBatchId: input.importBatchId }),
      ...(input.checkpointId === undefined ? {} : { checkpointId: input.checkpointId }),
      updatedAt: input.generatedAt
    }
  };
}

export async function executeSnapshotRefresh(input: SnapshotRefreshRequest): Promise<SnapshotRefreshResult> {
  assertSnapshotRefreshRequest(input);
  assertNoCredentialKeys(input.cashFlow);

  const contract = createSnapshotRefreshContract(input);
  assertNoCredentialKeys(contract);
  const storedSnapshot = await input.storage.loadLatestReportSnapshot({
    tenantId: input.tenantId,
    reportName: input.reportName,
    accountingBasis: input.accountingBasis,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    asOfDate: input.asOfDate,
    currencyCode: input.currencyCode
  });

  if (storedSnapshot !== undefined && storedSnapshot.snapshot.freshness.status === "fresh" && input.forceRefresh !== true) {
    const result: SnapshotRefreshResult = {
      jobName: "erp-financials-snapshot-refresh",
      action: "reused",
      generatedAt: input.generatedAt,
      reportName: input.reportName,
      snapshotId: storedSnapshot.snapshot.reportSnapshotId,
      snapshot: storedSnapshot,
      freshnessRow: contract.freshnessRow,
      writeResults: []
    };
    return result;
  }

  const builderInput = await input.storage.loadReportBuilderInput({
    tenantId: input.tenantId,
    companyId: input.companyId,
    sourceId: input.sourceId,
    reportName: input.reportName,
    accountingBasis: input.accountingBasis,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    asOfDate: input.asOfDate,
    currencyCode: input.currencyCode,
    generatedAt: input.generatedAt
  });
  const report = buildSnapshotRefreshReport(input.reportName, {
    ...builderInput,
    sourceId: input.sourceId,
    generatedAt: input.generatedAt,
    freshness: freshnessRowToReportFreshness(contract.freshnessRow)
  }, input.cashFlow);
  if (report.snapshot.reportSnapshotId !== contract.snapshotId) {
    throw new Error("rebuilt report snapshot id does not match snapshot refresh contract");
  }

  const snapshotWriteCount = await input.storage.writeReportSnapshot(report);
  const freshnessWriteCount = await input.storage.writeFreshnessRows([contract.freshnessRow]);
  const result: SnapshotRefreshResult = {
    jobName: "erp-financials-snapshot-refresh",
    action: "rebuilt",
    generatedAt: input.generatedAt,
    reportName: input.reportName,
    snapshotId: report.snapshot.reportSnapshotId,
    snapshot: {
      snapshot: report.snapshot,
      lines: report.lines,
      totals: report.totals
    },
    freshnessRow: contract.freshnessRow,
    writeResults: [
      {
        operation: "writeReportSnapshot",
        result: snapshotWriteCount
      },
      {
        operation: "writeFreshnessRows",
        result: freshnessWriteCount
      }
    ],
    report,
    ...(report.metadata.cashFlow === undefined ? {} : { cashFlow: report.metadata.cashFlow })
  };

  return result;
}

export function reconcileReportFreshness(input: FreshnessReconcileInput): ReportFreshnessRow {
  const staleReasons = input.staleReasons ?? [];
  const sourceFreshThrough = input.sourceFreshThrough;
  const importedThrough = input.importedThrough;
  const importedBehindSource =
    sourceFreshThrough !== undefined && importedThrough !== undefined && importedThrough < sourceFreshThrough;
  const status =
    staleReasons.length > 0
      ? "stale"
      : importedThrough === undefined || sourceFreshThrough === undefined || importedBehindSource
        ? "partial"
        : "fresh";
  const staleReason =
    staleReasons.length > 0
      ? staleReasons.join(";")
      : importedBehindSource
        ? "imported_boundary_behind_source_boundary"
        : undefined;

  return {
    freshnessId: freshnessId(input),
    tenantId: input.tenantId,
    companyId: input.companyId,
    sourceId: input.sourceId,
    reportName: input.reportName,
    accountingBasis: input.accountingBasis,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    currencyCode: input.currencyCode,
    status,
    ...(importedThrough === undefined ? {} : { freshThrough: importedThrough }),
    ...(staleReason === undefined ? {} : { staleReason }),
    ...(input.importBatchId === undefined ? {} : { importBatchId: input.importBatchId }),
    ...(input.checkpointId === undefined ? {} : { checkpointId: input.checkpointId }),
    updatedAt: input.updatedAt
  };
}

function assertScheduledRollupRequest(input: ScheduledRollupJobRequest): void {
  assertFiscalYearStartMonth(input.fiscalYearStartMonth);

  if (input.periodStart > input.periodEnd) {
    throw new Error("periodStart must be on or before periodEnd");
  }
  if (input.bucketGrains.length === 0) {
    throw new Error("bucketGrains must include at least one grain");
  }
  if (new Set(input.bucketGrains).size !== input.bucketGrains.length) {
    throw new Error("bucketGrains must not include duplicate grains");
  }
  const jobName = input.jobName as string | undefined;
  if (jobName !== undefined && jobName !== "erp-financials-rollup") {
    throw new Error("jobName must be erp-financials-rollup");
  }

  const hasPostings = input.postings !== undefined;
  const hasPostingReader = input.postingReader !== undefined;
  if (hasPostings === hasPostingReader) {
    throw new Error("scheduled rollup request must include exactly one of postings or postingReader");
  }
}

function assertLateArrivalReprocessExecutionInput(input: LateArrivalReprocessExecutionInput): void {
  const jobName = input.jobName as string | undefined;
  if (jobName !== undefined && jobName !== "erp-financials-late-arrival-reprocess") {
    throw new Error("jobName must be erp-financials-late-arrival-reprocess");
  }

  const hasPostings = input.postings !== undefined;
  const hasPostingReader = input.postingReader !== undefined;
  if (hasPostings === hasPostingReader) {
    throw new Error("late-arrival reprocess execution request must include exactly one of postings or postingReader");
  }
}

function assertSnapshotRefreshRequest(input: SnapshotRefreshRequest): void {
  const jobName = input.jobName as string | undefined;
  if (jobName !== undefined && jobName !== "erp-financials-snapshot-refresh") {
    throw new Error("jobName must be erp-financials-snapshot-refresh");
  }
  if (input.periodStart > input.periodEnd) {
    throw new Error("periodStart must be on or before periodEnd");
  }
  if (input.asOfDate < input.periodEnd) {
    throw new Error("asOfDate must be on or after periodEnd");
  }
}

function buildSnapshotRefreshReport(
  reportName: ReportName,
  input: ReportBuilderInput,
  cashFlow: SnapshotRefreshCashFlowOptions | undefined
): BuiltReport {
  switch (reportName) {
    case "profit_and_loss":
      return buildProfitAndLossReport(input);
    case "balance_sheet":
      return buildBalanceSheetReport(input);
    case "trial_balance":
      return buildTrialBalanceReport(input);
    case "cash_flow":
      return buildCashFlowReport({
        ...input,
        cashAccountIds: cashFlow?.cashAccountIds ?? [],
        activityByAccountId: cashFlow?.activityByAccountId ?? {}
      });
  }
}

function freshnessRowToReportFreshness(row: ReportFreshnessRow): ReportFreshness {
  return {
    status: row.status,
    sourceId: row.sourceId,
    ...(row.importBatchId === undefined ? {} : { importBatchId: row.importBatchId }),
    ...(row.checkpointId === undefined ? {} : { checkpointId: row.checkpointId }),
    ...(row.freshThrough === undefined ? {} : { freshThrough: row.freshThrough }),
    ...(row.staleReason === undefined ? {} : { staleReason: row.staleReason })
  };
}

async function readScheduledRollupPostings(input: ScheduledRollupJobRequest): Promise<readonly LedgerPosting[]> {
  if (input.postings !== undefined) {
    return input.postings;
  }

  const postingReader = input.postingReader;
  if (postingReader === undefined) {
    throw new Error("scheduled rollup request must include a postingReader when postings are not provided");
  }

  return postingReader.readCanonicalPostingsForRollup({
    tenantId: input.tenantId,
    companyId: input.companyId,
    sourceId: input.sourceId,
    accountingBasis: input.accountingBasis,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    ...(input.currencyCode === undefined ? {} : { currencyCode: input.currencyCode })
  });
}

async function readLateArrivalReprocessPostings(
  input: LateArrivalReprocessExecutionInput,
  plan: LateArrivalReprocessPlan
): Promise<readonly LedgerPosting[]> {
  if (input.postings !== undefined) {
    return input.postings;
  }

  const postingReader = input.postingReader;
  if (postingReader === undefined) {
    throw new Error("late-arrival reprocess execution request must include a postingReader when postings are not provided");
  }

  const readRequests = buildLateArrivalReprocessPostingReadRequests(input, plan.windows);
  const postingGroups = await Promise.all(
    readRequests.map((request) => postingReader.readCanonicalPostingsForLateArrivalReprocess(request))
  );

  return postingGroups.flat();
}

function selectScheduledRollupPostings(
  input: ScheduledRollupJobRequest,
  postings: readonly LedgerPosting[]
): readonly LedgerPosting[] {
  return postings.filter(
    (posting) =>
      posting.tenantId === input.tenantId &&
      posting.sourceId === input.sourceId &&
      posting.accountingBasis === input.accountingBasis &&
      posting.postingDate >= input.periodStart &&
      posting.postingDate <= input.periodEnd &&
      (input.currencyCode === undefined || posting.currencyCode === input.currencyCode)
  );
}

function buildLateArrivalReprocessPostingReadRequests(
  input: LateArrivalReprocessInput,
  windows: readonly RollupReprocessWindow[]
): readonly LateArrivalReprocessPostingReadRequest[] {
  const requestsByIdentity = new Map<string, LateArrivalReprocessPostingReadRequest>();

  for (const window of windows) {
    const key = rollupWindowScopeIdentity(window);
    const existing = requestsByIdentity.get(key);

    if (existing === undefined) {
      requestsByIdentity.set(key, {
        tenantId: input.tenantId,
        companyId: input.companyId,
        sourceId: window.sourceId,
        accountingBasis: window.accountingBasis,
        periodStart: window.bucketStart,
        periodEnd: window.bucketEnd,
        currencyCode: window.currencyCode
      });
    } else {
      requestsByIdentity.set(key, {
        ...existing,
        periodStart: minIsoDate([existing.periodStart, window.bucketStart]),
        periodEnd: maxIsoDate([existing.periodEnd, window.bucketEnd])
      });
    }
  }

  return [...requestsByIdentity.values()].sort(
    (left, right) =>
      left.sourceId.localeCompare(right.sourceId) ||
      left.accountingBasis.localeCompare(right.accountingBasis) ||
      left.currencyCode.localeCompare(right.currencyCode)
  );
}

function selectLateArrivalReprocessPostings(
  postings: readonly LedgerPosting[],
  windows: readonly RollupReprocessWindow[]
): readonly LedgerPosting[] {
  return postings.filter((posting) =>
    windows.some(
      (window) =>
        posting.tenantId === window.tenantId &&
        posting.sourceId === window.sourceId &&
        posting.accountingBasis === window.accountingBasis &&
        posting.currencyCode === window.currencyCode &&
        posting.postingDate >= window.bucketStart &&
        posting.postingDate <= window.bucketEnd
    )
  );
}

function rollupBucketMatchesAnyWindow(bucket: RollupBucket, windows: readonly RollupReprocessWindow[]): boolean {
  return windows.some(
    (window) =>
      bucket.tenantId === window.tenantId &&
      bucket.companyId === window.companyId &&
      bucket.sourceId === window.sourceId &&
      bucket.accountingBasis === window.accountingBasis &&
      bucket.bucketGrain === window.bucketGrain &&
      bucket.bucketStart === window.bucketStart &&
      bucket.bucketEnd === window.bucketEnd &&
      bucket.currencyCode === window.currencyCode
  );
}

function writeReadyRollupBucket(bucket: BuiltRollupBucket): RollupBucket {
  return {
    rollupBucketId: bucket.rollupBucketId,
    tenantId: bucket.tenantId,
    companyId: bucket.companyId,
    sourceId: bucket.sourceId,
    accountId: bucket.accountId,
    accountingBasis: bucket.accountingBasis,
    bucketGrain: bucket.bucketGrain,
    bucketStart: bucket.bucketStart,
    bucketEnd: bucket.bucketEnd,
    currencyCode: bucket.currencyCode,
    dimensionHash: bucket.dimensionHash,
    ...(bucket.partyId === undefined ? {} : { partyId: bucket.partyId }),
    ...(bucket.partyType === undefined ? {} : { partyType: bucket.partyType }),
    ...(bucket.itemId === undefined ? {} : { itemId: bucket.itemId }),
    debitAmount: bucket.debitAmount,
    creditAmount: bucket.creditAmount,
    netAmount: bucket.netAmount,
    postingCount: bucket.postingCount,
    ...(bucket.sourcePostingMaxUpdatedAt === undefined ? {} : { sourcePostingMaxUpdatedAt: bucket.sourcePostingMaxUpdatedAt }),
    ...(bucket.importBatchId === undefined ? {} : { importBatchId: bucket.importBatchId }),
    generatedAt: bucket.generatedAt
  };
}

function buildScheduledRollupJobSummary(
  input: ScheduledRollupJobRequest,
  postings: readonly LedgerPosting[],
  buckets: readonly RollupBucket[]
): ScheduledRollupJobSummary {
  const sourcePostingMaxUpdatedAt = maxIsoDateTimeFromValues(buckets.map((bucket) => bucket.sourcePostingMaxUpdatedAt));
  const sourceEvidence = sanitizeScheduledRollupSourceEvidence(input.sourceEvidence);
  const importEvidence = sanitizeScheduledRollupImportEvidence(input.importEvidence);
  const checkpointEvidence = sanitizeScheduledRollupCheckpointEvidence(input.checkpointEvidence);

  return {
    jobName: "erp-financials-rollup",
    tenantId: input.tenantId,
    companyId: input.companyId,
    sourceId: input.sourceId,
    accountingBasis: input.accountingBasis,
    bucketGrains: input.bucketGrains,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    generatedAt: input.generatedAt,
    ...(input.currencyCode === undefined ? {} : { currencyCode: input.currencyCode }),
    postingCount: postings.length,
    bucketCount: buckets.length,
    accountCount: uniqueSortedStrings(postings.map((posting) => posting.accountId)).length,
    dimensionHashCount: uniqueSortedStrings(postings.map((posting) => posting.dimensionHash)).length,
    currencyCodes: uniqueSortedStrings(postings.map((posting) => posting.currencyCode)),
    ...(sourcePostingMaxUpdatedAt === undefined ? {} : { sourcePostingMaxUpdatedAt }),
    bucketSummaries: input.bucketGrains.map((grain) => buildScheduledRollupBucketGrainSummary(grain, buckets)),
    ...(sourceEvidence === undefined ? {} : { sourceEvidence }),
    ...(importEvidence === undefined ? {} : { importEvidence }),
    ...(checkpointEvidence === undefined ? {} : { checkpointEvidence })
  };
}

function buildScheduledRollupBucketGrainSummary(
  bucketGrain: RollupBucketGrain,
  buckets: readonly RollupBucket[]
): ScheduledRollupBucketGrainSummary {
  const bucketsForGrain = buckets.filter((bucket) => bucket.bucketGrain === bucketGrain);
  const bucketStartMin = minIsoDateOrUndefined(bucketsForGrain.map((bucket) => bucket.bucketStart));
  const bucketEndMax = maxIsoDateOrUndefined(bucketsForGrain.map((bucket) => bucket.bucketEnd));
  const base = {
    bucketGrain,
    bucketCount: bucketsForGrain.length,
    windowCount: uniqueSortedStrings(bucketsForGrain.map((bucket) => `${bucket.bucketStart}:${bucket.bucketEnd}`)).length
  };

  if (bucketStartMin === undefined || bucketEndMax === undefined) {
    return base;
  }

  return {
    ...base,
    bucketStartMin,
    bucketEndMax
  };
}

function sanitizeScheduledRollupSourceEvidence(
  evidence: ScheduledRollupSourceEvidence | undefined
): ScheduledRollupSourceEvidence | undefined {
  if (evidence === undefined) {
    return undefined;
  }

  return emptyObjectToUndefined({
    ...(evidence.sourceSystem === undefined ? {} : { sourceSystem: evidence.sourceSystem }),
    ...(evidence.providerEnvironment === undefined ? {} : { providerEnvironment: evidence.providerEnvironment }),
    ...(evidence.latestSourceUpdatedAt === undefined ? {} : { latestSourceUpdatedAt: evidence.latestSourceUpdatedAt }),
    ...(evidence.sourceFreshThrough === undefined ? {} : { sourceFreshThrough: evidence.sourceFreshThrough })
  });
}

function sanitizeScheduledRollupImportEvidence(
  evidence: ScheduledRollupImportEvidence | undefined
): ScheduledRollupImportEvidence | undefined {
  if (evidence === undefined) {
    return undefined;
  }

  return emptyObjectToUndefined({
    ...(evidence.importBatchId === undefined ? {} : { importBatchId: evidence.importBatchId }),
    ...(evidence.importedThrough === undefined ? {} : { importedThrough: evidence.importedThrough }),
    ...(evidence.completedAt === undefined ? {} : { completedAt: evidence.completedAt }),
    ...(evidence.sourcePostingCount === undefined ? {} : { sourcePostingCount: evidence.sourcePostingCount })
  });
}

function sanitizeScheduledRollupCheckpointEvidence(
  evidence: ScheduledRollupCheckpointEvidence | undefined
): ScheduledRollupCheckpointEvidence | undefined {
  if (evidence === undefined) {
    return undefined;
  }

  return emptyObjectToUndefined({
    ...(evidence.checkpointId === undefined ? {} : { checkpointId: evidence.checkpointId }),
    ...(evidence.sourceObject === undefined ? {} : { sourceObject: evidence.sourceObject }),
    ...(evidence.freshThrough === undefined ? {} : { freshThrough: evidence.freshThrough }),
    ...(evidence.latestSourceUpdatedAt === undefined ? {} : { latestSourceUpdatedAt: evidence.latestSourceUpdatedAt }),
    ...(evidence.status === undefined ? {} : { status: evidence.status })
  });
}

function emptyObjectToUndefined<Evidence extends object>(evidence: Evidence): Evidence | undefined {
  return Object.keys(evidence).length === 0 ? undefined : evidence;
}

function buildPartyTypesById(parties: readonly Party[] | undefined): ReadonlyMap<string, PartyType> {
  const partyTypesById = new Map<string, PartyType>();

  for (const party of parties ?? []) {
    partyTypesById.set(party.partyId, party.partyType);
  }

  return partyTypesById;
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function maxIsoDateTimeFromValues(values: readonly (IsoDateTime | undefined)[]): IsoDateTime | undefined {
  return values.reduce<IsoDateTime | undefined>((maximum, value) => maxIsoDateTime(maximum, value), undefined);
}

function minIsoDateOrUndefined(values: readonly IsoDate[]): IsoDate | undefined {
  if (values.length === 0) {
    return undefined;
  }

  return minIsoDate(values);
}

function maxIsoDateOrUndefined(values: readonly IsoDate[]): IsoDate | undefined {
  if (values.length === 0) {
    return undefined;
  }

  return maxIsoDate(values);
}

function rollupBucketFromAccumulator(accumulator: RollupAccumulator, input: RollupBuildInput): BuiltRollupBucket {
  const rollupBucketId = rollupBucketIdentity(accumulator);
  return {
    rollupBucketId,
    tenantId: accumulator.tenantId,
    companyId: accumulator.companyId,
    sourceId: accumulator.sourceId,
    accountId: accumulator.accountId,
    accountingBasis: accumulator.accountingBasis,
    bucketGrain: accumulator.bucketGrain,
    bucketStart: accumulator.bucketStart,
    bucketEnd: accumulator.bucketEnd,
    currencyCode: accumulator.currencyCode,
    dimensionHash: accumulator.dimensionHash,
    ...(accumulator.partyId === undefined ? {} : { partyId: accumulator.partyId }),
    ...(accumulator.partyType === undefined ? {} : { partyType: accumulator.partyType }),
    ...(accumulator.itemId === undefined ? {} : { itemId: accumulator.itemId }),
    debitAmount: formatMoney(accumulator.debitMinor),
    creditAmount: formatMoney(accumulator.creditMinor),
    netAmount: formatMoney(accumulator.netMinor),
    postingCount: accumulator.postingCount,
    ...(accumulator.sourcePostingMaxUpdatedAt === undefined
      ? {}
      : { sourcePostingMaxUpdatedAt: accumulator.sourcePostingMaxUpdatedAt }),
    ...(accumulator.importBatchId === undefined ? {} : { importBatchId: accumulator.importBatchId }),
    generatedAt: input.generatedAt,
    drilldownRef: createCompactDrilldownRef({
      token: rollupBucketId,
      postingIds: accumulator.postingIds,
      accountIds: [accumulator.accountId],
      dimensionHash: accumulator.dimensionHash,
      query: {
        kind: "ledger_postings",
        tenantId: accumulator.tenantId,
        sourceId: accumulator.sourceId,
        accountingBasis: accumulator.accountingBasis,
        periodStart: accumulator.bucketStart,
        periodEnd: accumulator.bucketEnd,
        accountIds: [accumulator.accountId],
        dimensionHash: accumulator.dimensionHash,
        ...(accumulator.itemId === undefined ? {} : { itemIds: [accumulator.itemId] })
      }
    })
  };
}

function buildRollupReprocessWindows(
  input: LateArrivalReprocessInput,
  affectedStart: IsoDate,
  affectedEnd: IsoDate
): readonly RollupReprocessWindow[] {
  const identityKeys = uniquePostingIdentities(input.changedPostings);
  const windows: RollupReprocessWindow[] = [];

  for (const identity of identityKeys) {
    for (const grain of input.bucketGrains) {
      for (const window of bucketWindowsBetween(affectedStart, affectedEnd, grain, input.fiscalYearStartMonth)) {
        windows.push({
          tenantId: input.tenantId,
          companyId: input.companyId,
          sourceId: identity.sourceId,
          accountingBasis: identity.accountingBasis,
          bucketGrain: grain,
          bucketStart: window.bucketStart,
          bucketEnd: window.bucketEnd,
          currencyCode: identity.currencyCode
        });
      }
    }
  }

  return windows.sort(compareReprocessWindows);
}

function buildLateArrivalFreshnessRows(
  input: LateArrivalReprocessInput,
  affectedStart: IsoDate,
  affectedEnd: IsoDate
): readonly ReportFreshnessRow[] {
  return uniquePostingIdentities(input.changedPostings).flatMap((identity) =>
    input.reportNames.map((reportName) => ({
      freshnessId: freshnessId({
        tenantId: input.tenantId,
        companyId: input.companyId,
        sourceId: identity.sourceId,
        reportName,
        accountingBasis: identity.accountingBasis,
        periodStart: affectedStart,
        periodEnd: affectedEnd,
        currencyCode: identity.currencyCode
      }),
      tenantId: input.tenantId,
      companyId: input.companyId,
      sourceId: identity.sourceId,
      reportName,
      accountingBasis: identity.accountingBasis,
      periodStart: affectedStart,
      periodEnd: affectedEnd,
      currencyCode: identity.currencyCode,
      status: "stale" as const,
      ...(input.freshThrough === undefined ? {} : { freshThrough: input.freshThrough }),
      staleReason: input.staleReason,
      ...(input.importBatchId === undefined ? {} : { importBatchId: input.importBatchId }),
      ...(input.checkpointId === undefined ? {} : { checkpointId: input.checkpointId }),
      updatedAt: input.updatedAt
    }))
  );
}

function uniquePostingIdentities(
  postings: readonly LedgerPosting[]
): readonly { readonly sourceId: SourceId; readonly accountingBasis: AccountingBasis; readonly currencyCode: IsoCurrencyCode }[] {
  const identities = new Map<string, { readonly sourceId: SourceId; readonly accountingBasis: AccountingBasis; readonly currencyCode: IsoCurrencyCode }>();

  for (const posting of postings) {
    const key = [posting.sourceId, posting.accountingBasis, posting.currencyCode].join(":");
    identities.set(key, {
      sourceId: posting.sourceId,
      accountingBasis: posting.accountingBasis,
      currencyCode: posting.currencyCode
    });
  }

  return [...identities.values()].sort(
    (left, right) =>
      left.sourceId.localeCompare(right.sourceId) ||
      left.accountingBasis.localeCompare(right.accountingBasis) ||
      left.currencyCode.localeCompare(right.currencyCode)
  );
}

function bucketWindowsBetween(
  affectedStart: IsoDate,
  affectedEnd: IsoDate,
  grain: RollupBucketGrain,
  fiscalYearStartMonth: number
): readonly { readonly bucketStart: IsoDate; readonly bucketEnd: IsoDate }[] {
  const windows: { readonly bucketStart: IsoDate; readonly bucketEnd: IsoDate }[] = [];
  let cursor = bucketWindowForDate(affectedStart, grain, fiscalYearStartMonth).bucketStart;

  while (cursor <= affectedEnd) {
    const window = bucketWindowForDate(cursor, grain, fiscalYearStartMonth);
    windows.push(window);
    cursor = addDays(window.bucketEnd, 1);
  }

  return windows;
}

function bucketWindowForDate(
  postingDate: IsoDate,
  grain: RollupBucketGrain,
  fiscalYearStartMonth: number
): { readonly bucketStart: IsoDate; readonly bucketEnd: IsoDate } {
  switch (grain) {
    case "day":
      return {
        bucketStart: postingDate,
        bucketEnd: postingDate
      };
    case "month":
      return calendarMonthWindow(postingDate);
    case "fiscal_period":
      return fiscalPeriodWindow(postingDate, fiscalYearStartMonth);
    case "fiscal_quarter":
      return fiscalQuarterWindow(postingDate, fiscalYearStartMonth);
    case "fiscal_year":
      return fiscalYearWindow(postingDate, fiscalYearStartMonth);
  }
}

function fiscalPeriodWindow(postingDate: IsoDate, fiscalYearStartMonth: number): { readonly bucketStart: IsoDate; readonly bucketEnd: IsoDate } {
  assertFiscalYearStartMonth(fiscalYearStartMonth);
  return calendarMonthWindow(postingDate);
}

function fiscalQuarterWindow(postingDate: IsoDate, fiscalYearStartMonth: number): { readonly bucketStart: IsoDate; readonly bucketEnd: IsoDate } {
  const fiscalYearStart = fiscalYearStartDateForDate(postingDate, fiscalYearStartMonth);
  const postingMonth = parseIsoDate(postingDate).getUTCMonth() + 1;
  const fiscalMonthOffset = (postingMonth - fiscalYearStartMonth + 12) % 12;
  const quarterStartOffset = Math.floor(fiscalMonthOffset / 3) * 3;
  const start = new Date(Date.UTC(fiscalYearStart.getUTCFullYear(), fiscalYearStart.getUTCMonth() + quarterStartOffset, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0));

  return {
    bucketStart: formatIsoDate(start),
    bucketEnd: formatIsoDate(end)
  };
}

function fiscalYearWindow(postingDate: IsoDate, fiscalYearStartMonth: number): { readonly bucketStart: IsoDate; readonly bucketEnd: IsoDate } {
  const start = fiscalYearStartDateForDate(postingDate, fiscalYearStartMonth);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 12, 0));

  return {
    bucketStart: formatIsoDate(start),
    bucketEnd: formatIsoDate(end)
  };
}

function fiscalYearStartDateForDate(postingDate: IsoDate, fiscalYearStartMonth: number): Date {
  assertFiscalYearStartMonth(fiscalYearStartMonth);
  const date = parseIsoDate(postingDate);
  const postingMonth = date.getUTCMonth() + 1;
  const startYear = postingMonth >= fiscalYearStartMonth ? date.getUTCFullYear() : date.getUTCFullYear() - 1;

  return new Date(Date.UTC(startYear, fiscalYearStartMonth - 1, 1));
}

function calendarMonthWindow(postingDate: IsoDate): { readonly bucketStart: IsoDate; readonly bucketEnd: IsoDate } {
  const date = parseIsoDate(postingDate);
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));

  return {
    bucketStart: formatIsoDate(start),
    bucketEnd: formatIsoDate(end)
  };
}

function rollupBucketIdentity(input: {
  readonly tenantId: TenantId;
  readonly companyId: string;
  readonly sourceId: SourceId;
  readonly accountingBasis: AccountingBasis;
  readonly bucketGrain: RollupBucketGrain;
  readonly bucketStart: IsoDate;
  readonly bucketEnd: IsoDate;
  readonly accountId: string;
  readonly currencyCode: IsoCurrencyCode;
  readonly dimensionHash: string;
  readonly partyId?: string;
  readonly partyType?: PartyType;
  readonly itemId?: string;
}): string {
  const keyParts = [
    "rollup",
    input.tenantId,
    input.companyId,
    input.sourceId,
    input.accountingBasis,
    input.bucketGrain,
    input.bucketStart,
    input.bucketEnd,
    input.accountId,
    input.currencyCode,
    input.dimensionHash
  ];

  if (input.partyId !== undefined || input.partyType !== undefined) {
    keyParts.push(input.partyId ?? "", input.partyType ?? "");
  }
  if (input.itemId !== undefined) {
    keyParts.push(input.itemId);
  }

  return keyParts.join(":");
}

function rollupWindowScopeIdentity(input: {
  readonly sourceId: SourceId;
  readonly accountingBasis: AccountingBasis;
  readonly currencyCode: IsoCurrencyCode;
}): string {
  return [input.sourceId, input.accountingBasis, input.currencyCode].join(":");
}

function freshnessId(input: {
  readonly tenantId: TenantId;
  readonly companyId: string;
  readonly sourceId: SourceId;
  readonly reportName: string;
  readonly accountingBasis: AccountingBasis;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
}): string {
  return [
    "freshness",
    input.tenantId,
    input.companyId,
    input.sourceId,
    input.reportName,
    input.accountingBasis,
    input.periodStart,
    input.periodEnd,
    input.currencyCode
  ].join(":");
}

function compareRollupAccumulators(left: RollupAccumulator, right: RollupAccumulator): number {
  return (
    left.tenantId.localeCompare(right.tenantId) ||
    left.companyId.localeCompare(right.companyId) ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.accountingBasis.localeCompare(right.accountingBasis) ||
    left.bucketGrain.localeCompare(right.bucketGrain) ||
    left.bucketStart.localeCompare(right.bucketStart) ||
    left.bucketEnd.localeCompare(right.bucketEnd) ||
    left.accountId.localeCompare(right.accountId) ||
    left.currencyCode.localeCompare(right.currencyCode) ||
    left.dimensionHash.localeCompare(right.dimensionHash) ||
    (left.partyType ?? "").localeCompare(right.partyType ?? "") ||
    (left.partyId ?? "").localeCompare(right.partyId ?? "") ||
    (left.itemId ?? "").localeCompare(right.itemId ?? "")
  );
}

function compareReprocessWindows(left: RollupReprocessWindow, right: RollupReprocessWindow): number {
  return (
    left.tenantId.localeCompare(right.tenantId) ||
    left.companyId.localeCompare(right.companyId) ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.accountingBasis.localeCompare(right.accountingBasis) ||
    left.bucketGrain.localeCompare(right.bucketGrain) ||
    left.bucketStart.localeCompare(right.bucketStart) ||
    left.bucketEnd.localeCompare(right.bucketEnd) ||
    left.currencyCode.localeCompare(right.currencyCode)
  );
}

function parseMoney(value: DecimalString): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (match === null || match[2] === undefined) {
    throw new Error(`Decimal value must have at most two fractional digits: ${value}`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? "").padEnd(2, "0"));
  return sign * (whole * 100n + fraction);
}

function formatMoney(value: bigint): DecimalString {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  return `${sign}${whole.toString()}.${fraction.toString().padStart(2, "0")}`;
}

function maxIsoDateTime(left: IsoDateTime | undefined, right: IsoDateTime | undefined): IsoDateTime | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return left >= right ? left : right;
}

function minIsoDate(values: readonly IsoDate[]): IsoDate {
  const [first, ...rest] = values;
  if (first === undefined) {
    throw new Error("expected at least one date");
  }
  return rest.reduce((minimum, value) => (value < minimum ? value : minimum), first);
}

function maxIsoDate(values: readonly IsoDate[]): IsoDate {
  const [first, ...rest] = values;
  if (first === undefined) {
    throw new Error("expected at least one date");
  }
  return rest.reduce((maximum, value) => (value > maximum ? value : maximum), first);
}

function addDays(value: IsoDate, days: number): IsoDate {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

function parseIsoDate(value: IsoDate): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`expected ISO date: ${value}`);
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatIsoDate(value: Date): IsoDate {
  return value.toISOString().slice(0, 10);
}

function assertFiscalYearStartMonth(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 12) {
    throw new Error("fiscalYearStartMonth must be an integer between 1 and 12");
  }
}
