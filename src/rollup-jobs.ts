import type {
  AccountingBasis,
  DecimalString,
  DrilldownRef,
  IsoCurrencyCode,
  IsoDate,
  IsoDateTime,
  LedgerPosting,
  SourceId,
  TenantId
} from "./canonical-model.js";
import { createCompactDrilldownRef } from "./canonical-model.js";
import type {
  MarkReportSnapshotsStaleForPostingChangesInput,
  ReportFreshnessRow,
  RollupBucket,
  RollupBucketGrain,
  RollupReprocessWindow
} from "./postgres-storage.js";
import type { ReportName } from "./report-builders.js";

export type RollupBuildInput = {
  readonly companyId: string;
  readonly postings: readonly LedgerPosting[];
  readonly bucketGrains: readonly RollupBucketGrain[];
  readonly fiscalYearStartMonth: number;
  readonly generatedAt: IsoDateTime;
  readonly importBatchId?: string;
};

export type BuiltRollupBucket = RollupBucket & {
  readonly drilldownRef: DrilldownRef;
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
};

export type LateArrivalReprocessPlan = {
  readonly affectedStart: IsoDate;
  readonly affectedEnd: IsoDate;
  readonly windows: readonly RollupReprocessWindow[];
  readonly staleSnapshots: MarkReportSnapshotsStaleForPostingChangesInput;
  readonly freshnessRows: readonly ReportFreshnessRow[];
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

  for (const posting of input.postings) {
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
        dimensionHash: posting.dimensionHash
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
        dimensionHash: accumulator.dimensionHash
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
  }
}

function fiscalPeriodWindow(postingDate: IsoDate, fiscalYearStartMonth: number): { readonly bucketStart: IsoDate; readonly bucketEnd: IsoDate } {
  assertFiscalYearStartMonth(fiscalYearStartMonth);
  return calendarMonthWindow(postingDate);
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
}): string {
  return [
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
  ].join(":");
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
    left.dimensionHash.localeCompare(right.dimensionHash)
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
