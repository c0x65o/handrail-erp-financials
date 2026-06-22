import { createHash } from "node:crypto";

export type TenantId = string;
export type CompanyId = string;
export type SourceId = string;
export type ImportBatchId = string;
export type SyncCheckpointId = string;
export type AccountId = string;
export type PartyId = string;
export type ItemId = string;
export type DimensionId = string;
export type TransactionId = string;
export type TransactionLineId = string;
export type LedgerPostingId = string;
export type ReportSnapshotId = string;
export type ReportLineId = string;
export type ReportTotalId = string;
export type IsoCurrencyCode = string;
export type IsoDate = string;
export type IsoDateTime = string;
export type DecimalString = string;
export type DimensionHash = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

export type ProviderEnvironment = "sandbox" | "production" | "staging" | "test" | "native";
export type AccountingSourceSystem = "quickbooks" | "native_erp" | "csv_import" | (string & {});
export type AccountingBasis = "accrual" | "cash" | "modified_cash";
export type AccountClassification =
  | "asset"
  | "liability"
  | "equity"
  | "income"
  | "cost_of_goods_sold"
  | "expense"
  | "other_income"
  | "other_expense";
export type AccountStatus = "active" | "inactive";
export type AccountingSourceStatus = "active" | "paused" | "error" | "archived";
export type TransactionStatus = "draft" | "posted" | "void" | "deleted";
export type PartyType = "customer" | "vendor" | "employee" | "other";
export type ItemType = "product" | "service" | "inventory" | "billable" | "other";
export type ImportBatchMode = "initial" | "delta" | "backfill" | "reprocess" | "fixture";
export type ImportBatchStatus = "running" | "completed" | "completed_with_warnings" | "failed";
export type CursorKind = "updated_since" | "page_token" | "high_watermark" | "full_scan";
export type SyncCheckpointStatus = "current" | "stale" | "replay_required" | "error";
export type ReportSnapshotSource = "builder" | "rollup" | "fixture" | "imported";
export type ReportFreshnessStatus = "fresh" | "stale" | "partial" | "unknown";
export type ReconciliationStatus = "balanced" | "out_of_balance" | "not_reconciled";

export type TenantScopedRecord = {
  readonly tenantId: TenantId;
};

export type SourceScopedRecord = TenantScopedRecord & {
  readonly sourceId: SourceId;
};

export type SourceIdentity = SourceScopedRecord & {
  readonly sourceSystem: AccountingSourceSystem;
  readonly providerEnvironment: ProviderEnvironment;
  readonly sourceObjectType: string;
  readonly sourceObjectId: string;
};

export type SafeSourcePayloadRef = {
  readonly sourceObjectType: string;
  readonly sourceObjectId: string;
  readonly sourceUpdatedAt?: IsoDateTime;
  readonly storageRef?: string;
  readonly checksum?: string;
  readonly byteLength?: number;
  readonly preview?: JsonValue;
};

export type DimensionRef = {
  readonly dimensionId?: DimensionId;
  readonly dimensionKind: string;
  readonly sourceDimensionId?: string;
  readonly name?: string;
};

export type AccountingCompany = TenantScopedRecord & {
  readonly companyId: CompanyId;
  readonly legalName: string;
  readonly displayName: string;
  readonly baseCurrencyCode: IsoCurrencyCode;
  readonly fiscalYearStartMonth: number;
  readonly providerEnvironment: ProviderEnvironment;
  readonly sourceSystem: AccountingSourceSystem;
  readonly sourceCompanyRef: string;
};

export type AccountingSource = TenantScopedRecord & {
  readonly sourceId: SourceId;
  readonly sourceSystem: AccountingSourceSystem;
  readonly providerEnvironment: ProviderEnvironment;
  readonly connectionRef: string;
  readonly importBatchId?: ImportBatchId;
  readonly checkpointId?: SyncCheckpointId;
  readonly latestSyncedAt?: IsoDateTime;
  readonly status: AccountingSourceStatus;
};

export type Account = SourceScopedRecord & {
  readonly accountId: AccountId;
  readonly sourceAccountId: string;
  readonly accountNumber?: string;
  readonly name: string;
  readonly type: string;
  readonly subtype?: string;
  readonly classification: AccountClassification;
  readonly parentAccountId?: AccountId;
  readonly currencyCode?: IsoCurrencyCode;
  readonly active: boolean;
};

export type Party = SourceScopedRecord & {
  readonly partyId: PartyId;
  readonly sourcePartyId: string;
  readonly partyType: PartyType;
  readonly displayName: string;
  readonly active: boolean;
};

export type Item = SourceScopedRecord & {
  readonly itemId: ItemId;
  readonly sourceItemId: string;
  readonly itemType: ItemType;
  readonly name: string;
  readonly incomeAccountId?: AccountId;
  readonly expenseAccountId?: AccountId;
  readonly assetAccountId?: AccountId;
  readonly active: boolean;
};

export type AccountingDimension = SourceScopedRecord & {
  readonly dimensionId: DimensionId;
  readonly dimensionKind: string;
  readonly sourceDimensionId: string;
  readonly name: string;
  readonly parentDimensionId?: DimensionId;
  readonly active: boolean;
};

export type AccountingTransaction = SourceScopedRecord & {
  readonly transactionId: TransactionId;
  readonly sourceTransactionId: string;
  readonly sourceTransactionType: string;
  readonly transactionNumber?: string;
  readonly transactionDate: IsoDate;
  readonly postedAt?: IsoDateTime;
  readonly updatedAt?: IsoDateTime;
  readonly partyId?: PartyId;
  readonly currencyCode: IsoCurrencyCode;
  readonly exchangeRate?: DecimalString;
  readonly status: TransactionStatus;
  readonly memo?: string;
  readonly sourcePayloadRef?: SafeSourcePayloadRef;
};

export type TransactionLine = TenantScopedRecord & {
  readonly transactionLineId: TransactionLineId;
  readonly transactionId: TransactionId;
  readonly lineNumber: number;
  readonly accountId?: AccountId;
  readonly partyId?: PartyId;
  readonly itemId?: ItemId;
  readonly amount: DecimalString;
  readonly quantity?: DecimalString;
  readonly unitAmount?: DecimalString;
  readonly description?: string;
  readonly dimensionRefs: readonly DimensionRef[];
};

export type LedgerPosting = SourceScopedRecord & {
  readonly postingId: LedgerPostingId;
  readonly sourcePostingId: string;
  readonly transactionId: TransactionId;
  readonly transactionLineId?: TransactionLineId;
  readonly accountId: AccountId;
  readonly partyId?: PartyId;
  readonly itemId?: ItemId;
  readonly postingDate: IsoDate;
  readonly accountingBasis: AccountingBasis;
  readonly debitAmount: DecimalString;
  readonly creditAmount: DecimalString;
  readonly netAmount: DecimalString;
  readonly currencyCode: IsoCurrencyCode;
  readonly dimensionHash: DimensionHash;
  readonly dimensionRefs: readonly DimensionRef[];
  readonly sourcePayloadRef?: SafeSourcePayloadRef;
  readonly importBatchId: ImportBatchId;
  readonly checkpointId?: SyncCheckpointId;
};

export type ImportBatch = SourceScopedRecord & {
  readonly importBatchId: ImportBatchId;
  readonly mode: ImportBatchMode;
  readonly status: ImportBatchStatus;
  readonly startedAt: IsoDateTime;
  readonly completedAt?: IsoDateTime;
  readonly sourceObjectCounts: JsonValue;
  readonly warningSummary?: JsonValue;
  readonly errorSummary?: JsonValue;
};

export type SyncCheckpoint = SourceScopedRecord & {
  readonly checkpointId: SyncCheckpointId;
  readonly sourceObject: string;
  readonly cursorKind: CursorKind;
  readonly cursorValue: string;
  readonly freshThrough?: IsoDateTime;
  readonly latestSourceUpdatedAt?: IsoDateTime;
  readonly status: SyncCheckpointStatus;
};

export type ReportFreshness = {
  readonly status: ReportFreshnessStatus;
  readonly sourceId?: SourceId;
  readonly importBatchId?: ImportBatchId;
  readonly checkpointId?: SyncCheckpointId;
  readonly freshThrough?: IsoDateTime;
  readonly staleReason?: string;
};

export type DrilldownRef = {
  readonly token: string;
  readonly postingCount?: number;
  readonly postingIds?: readonly LedgerPostingId[];
  readonly accountIds?: readonly AccountId[];
  readonly dimensionHash?: DimensionHash;
  readonly query?: DrilldownQueryRef;
  readonly sourceRefCount?: number;
  readonly sourceRefs?: readonly SafeSourcePayloadRef[];
};

export type DrilldownQueryRef = {
  readonly kind: "ledger_postings";
  readonly tenantId?: TenantId;
  readonly sourceId?: SourceId;
  readonly accountingBasis?: AccountingBasis;
  readonly periodStart?: IsoDate;
  readonly periodEnd?: IsoDate;
  readonly accountIds?: readonly AccountId[];
  readonly dimensionHash?: DimensionHash;
};

export type ReportSnapshot = TenantScopedRecord & {
  readonly reportSnapshotId: ReportSnapshotId;
  readonly reportName: string;
  readonly snapshotSource: ReportSnapshotSource;
  readonly accountingBasis: AccountingBasis;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly asOfDate: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly generatedAt: IsoDateTime;
  readonly freshness: ReportFreshness;
  readonly reconciliationStatus: ReconciliationStatus;
  readonly reconciliationDifference: DecimalString;
};

export type ReportSnapshotLine = TenantScopedRecord & {
  readonly reportLineId: ReportLineId;
  readonly reportSnapshotId: ReportSnapshotId;
  readonly parentReportLineId?: ReportLineId;
  readonly section: string;
  readonly label: string;
  readonly accountId?: AccountId;
  readonly amount: DecimalString;
  readonly sortOrder: number;
  readonly drilldownRef: DrilldownRef;
};

export type ReportSnapshotTotal = TenantScopedRecord & {
  readonly reportTotalId: ReportTotalId;
  readonly reportSnapshotId: ReportSnapshotId;
  readonly totalKey: string;
  readonly label: string;
  readonly amount: DecimalString;
  readonly drilldownRef: DrilldownRef;
};

export const DEFAULT_JSON_REF_MAX_BYTES = 4096;
export const DEFAULT_DRILLDOWN_INLINE_POSTING_LIMIT = 100;
export const DEFAULT_DRILLDOWN_INLINE_SOURCE_REF_LIMIT = 25;

const CREDENTIAL_FIELD_PATTERN =
  /(?:^|[_-])(?:access|refresh)?[-_]?token$|oauth|secret|password|credential|client_secret|private[-_]?key|sealed[-_]?secret|token[-_]?refresh|provider[-_]?client|raw[-_]?(?:provider[-_]?)?imports?|raw[-_]?provider[-_]?payload|raw[-_]?payload|provider[-_]?payload[-_]?archive|payload[-_]?archive|raw[-_]?archive/i;

export function canonicalSourceIdentityKey(identity: SourceIdentity): string {
  return [
    identity.tenantId,
    identity.sourceId,
    identity.sourceSystem,
    identity.providerEnvironment,
    identity.sourceObjectType,
    identity.sourceObjectId
  ].join(":");
}

export function createDimensionHash(dimensionRefs: readonly DimensionRef[]): DimensionHash {
  const normalized = [...dimensionRefs]
    .map((ref) => ({
      dimensionId: ref.dimensionId ?? null,
      dimensionKind: ref.dimensionKind,
      name: ref.name ?? null,
      sourceDimensionId: ref.sourceDimensionId ?? null
    }))
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));

  return createHash("sha256").update(stableJson(normalized)).digest("hex");
}

export function assertLedgerPostingAmounts(posting: Pick<LedgerPosting, "debitAmount" | "creditAmount">): void {
  assertNonNegativeDecimal(posting.debitAmount, "debitAmount");
  assertNonNegativeDecimal(posting.creditAmount, "creditAmount");
}

export function assertSafeSourcePayloadRef(
  sourcePayloadRef: SafeSourcePayloadRef,
  maxBytes = DEFAULT_JSON_REF_MAX_BYTES
): void {
  if (sourcePayloadRef.byteLength !== undefined && sourcePayloadRef.byteLength > maxBytes) {
    throw new Error(`sourcePayloadRef.byteLength exceeds ${String(maxBytes)} bytes`);
  }

  const serialized = stableJson(sourcePayloadRef);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new Error(`sourcePayloadRef exceeds ${String(maxBytes)} serialized bytes`);
  }

  assertNoCredentialKeys(sourcePayloadRef);
}

export function assertSafeDrilldownRef(drilldownRef: DrilldownRef): void {
  for (const sourceRef of drilldownRef.sourceRefs ?? []) {
    assertSafeSourcePayloadRef(sourceRef);
  }
  assertNoCredentialKeys(drilldownRef.query);
}

export function assertNoCredentialKeys(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertNoCredentialKeys(entry, `${path}[${String(index)}]`);
    });
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (CREDENTIAL_FIELD_PATTERN.test(key)) {
        throw new Error(`credential-like field is not allowed at ${path}.${key}`);
      }
      assertNoCredentialKeys(entry, `${path}.${key}`);
    }
  }
}

export type CompactDrilldownRefInput = {
  readonly token: string;
  readonly postingIds: readonly LedgerPostingId[];
  readonly accountIds?: readonly AccountId[];
  readonly dimensionHash?: DimensionHash;
  readonly query?: DrilldownQueryRef;
  readonly sourceRefs?: readonly SafeSourcePayloadRef[];
  readonly inlinePostingLimit?: number;
  readonly inlineSourceRefLimit?: number;
};

export function createCompactDrilldownRef(input: CompactDrilldownRefInput): DrilldownRef {
  const postingIds = uniqueStrings(input.postingIds);
  const accountIds = input.accountIds === undefined ? undefined : uniqueStrings(input.accountIds);
  const sourceRefs = input.sourceRefs === undefined ? undefined : uniqueSourceRefs(input.sourceRefs);
  const inlinePostingLimit = input.inlinePostingLimit ?? DEFAULT_DRILLDOWN_INLINE_POSTING_LIMIT;
  const inlineSourceRefLimit = input.inlineSourceRefLimit ?? DEFAULT_DRILLDOWN_INLINE_SOURCE_REF_LIMIT;
  const base = {
    token: input.token,
    postingCount: postingIds.length,
    ...(accountIds === undefined ? {} : { accountIds }),
    ...(input.dimensionHash === undefined ? {} : { dimensionHash: input.dimensionHash }),
    ...(input.query === undefined ? {} : { query: compactDrilldownQuery(input.query, accountIds, input.dimensionHash) }),
    ...(sourceRefs === undefined ? {} : { sourceRefCount: sourceRefs.length }),
    ...(sourceRefs === undefined || sourceRefs.length > inlineSourceRefLimit ? {} : { sourceRefs })
  };

  if (postingIds.length > inlinePostingLimit) {
    return base;
  }

  return {
    ...base,
    postingIds
  };
}

function assertNonNegativeDecimal(value: DecimalString, fieldName: string): void {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new Error(`${fieldName} must be a nonnegative decimal string`);
  }
}

function compactDrilldownQuery(
  query: DrilldownQueryRef,
  accountIds: readonly AccountId[] | undefined,
  dimensionHash: DimensionHash | undefined
): DrilldownQueryRef {
  return {
    ...query,
    ...(query.accountIds === undefined && accountIds !== undefined ? { accountIds } : {}),
    ...(query.dimensionHash === undefined && dimensionHash !== undefined ? { dimensionHash } : {})
  };
}

function uniqueStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function uniqueSourceRefs(values: readonly SafeSourcePayloadRef[]): SafeSourcePayloadRef[] {
  const refs = new Map<string, SafeSourcePayloadRef>();
  for (const value of values) {
    assertSafeSourcePayloadRef(value);
    refs.set(
      [
        value.sourceObjectType,
        value.sourceObjectId,
        value.storageRef ?? "",
        value.checksum ?? "",
        value.sourceUpdatedAt ?? ""
      ].join(":"),
      value
    );
  }

  return [...refs.values()].sort((left, right) =>
    [left.sourceObjectType, left.sourceObjectId, left.storageRef ?? "", left.checksum ?? ""]
      .join(":")
      .localeCompare([right.sourceObjectType, right.sourceObjectId, right.storageRef ?? "", right.checksum ?? ""].join(":"))
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
