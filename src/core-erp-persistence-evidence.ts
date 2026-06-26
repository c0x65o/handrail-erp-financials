import {
  assertNoCredentialKeys,
  assertSafeSourcePayloadRef,
  createCompactDrilldownRef
} from "./canonical-model.js";
import type {
  DrilldownRef,
  ImportBatchStatus,
  IsoDateTime,
  JsonValue,
  ReportFreshnessStatus,
  SafeSourcePayloadRef,
  SyncCheckpointStatus
} from "./canonical-model.js";
import type { CanonicalFactPersistenceResult } from "./canonical-fact-persistence.js";
import type { ReportFreshnessRow } from "./postgres-storage.js";
import type { CanonicalAccountingFactSet } from "./source-adapters.js";

export const CORE_ERP_PERSISTENCE_EVIDENCE_DEFAULT_SOURCE_REF_LIMIT = 25;
export const CORE_ERP_PERSISTENCE_EVIDENCE_DEFAULT_FRESHNESS_ROW_LIMIT = 25;
export const CORE_ERP_PERSISTENCE_EVIDENCE_DEFAULT_CHANGED_RESOURCE_LIMIT = 50;
export const CORE_ERP_PERSISTENCE_EVIDENCE_DEFAULT_DRILLDOWN_POSTING_LIMIT = 100;

export type CoreErpPersistenceEvidenceImportBatchSummary = {
  readonly importBatchId: string;
  readonly mode: string;
  readonly status: ImportBatchStatus;
  readonly startedAt: IsoDateTime;
  readonly completedAt?: IsoDateTime;
  readonly sourceObjectCounts: JsonValue;
  readonly warningSummary?: JsonValue;
  readonly errorSummary?: JsonValue;
  readonly rowsWritten: number;
};

export type CoreErpPersistenceEvidenceCheckpointSummary = {
  readonly checkpointId: string;
  readonly sourceObject: string;
  readonly cursorKind: string;
  readonly cursorValue: string;
  readonly status: SyncCheckpointStatus;
  readonly freshThrough?: IsoDateTime;
  readonly latestSourceUpdatedAt?: IsoDateTime;
  readonly resumeFromCheckpointId?: string;
  readonly rowsWritten: number;
};

export type CoreErpPersistenceEvidenceCanonicalRowCounts = {
  readonly companies: number;
  readonly sources: number;
  readonly importBatches: number;
  readonly checkpoints: number;
  readonly accounts: number;
  readonly parties: number;
  readonly items: number;
  readonly dimensions: number;
  readonly transactions: number;
  readonly transactionLines: number;
  readonly postings: number;
};

export type CoreErpPersistenceEvidenceFreshnessRow = {
  readonly freshnessId: string;
  readonly reportName: string;
  readonly accountingBasis: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currencyCode: string;
  readonly status: ReportFreshnessStatus;
  readonly freshThrough?: IsoDateTime;
  readonly staleReason?: string;
  readonly importBatchId?: string;
  readonly checkpointId?: string;
  readonly updatedAt: IsoDateTime;
};

export type CoreErpPersistenceEvidenceFreshnessSummary = {
  readonly status: ReportFreshnessStatus;
  readonly freshThrough?: IsoDateTime;
  readonly latestSourceUpdatedAt?: IsoDateTime;
  readonly generatedAt: IsoDateTime;
  readonly rowCount: number;
  readonly returnedRows: number;
  readonly truncated: boolean;
  readonly rows: readonly CoreErpPersistenceEvidenceFreshnessRow[];
};

export type CoreErpPersistenceEvidenceSourceReferences = {
  readonly totalAvailable: number;
  readonly returned: number;
  readonly truncated: boolean;
  readonly refs: readonly SafeSourcePayloadRef[];
  readonly drilldownRef: DrilldownRef;
};

export type CoreErpPersistenceEvidenceChangedResourceAction = {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly action: string;
  readonly importBatchId?: string;
  readonly checkpointId?: string;
  readonly sourceUpdatedAt?: IsoDateTime;
};

export type CoreErpPersistenceEvidenceChangedResourcesSummary = {
  readonly total: number;
  readonly returned: number;
  readonly truncated: boolean;
  readonly actions: readonly CoreErpPersistenceEvidenceChangedResourceAction[];
};

export type CoreErpPersistenceEvidence = {
  readonly tenantId: string;
  readonly companyId: string;
  readonly sourceId: string;
  readonly sourceSystem: string;
  readonly providerEnvironment: string;
  readonly generatedAt: IsoDateTime;
  readonly importBatch: CoreErpPersistenceEvidenceImportBatchSummary;
  readonly checkpoint: CoreErpPersistenceEvidenceCheckpointSummary;
  readonly canonicalRowCounts: CoreErpPersistenceEvidenceCanonicalRowCounts;
  readonly writeCounts: CoreErpPersistenceEvidenceCanonicalRowCounts;
  readonly freshness: CoreErpPersistenceEvidenceFreshnessSummary;
  readonly sourceReferences: CoreErpPersistenceEvidenceSourceReferences;
  readonly changedResources: CoreErpPersistenceEvidenceChangedResourcesSummary;
};

export type BuildCoreErpPersistenceEvidenceInput = {
  readonly facts: CanonicalAccountingFactSet;
  readonly persistence: CanonicalFactPersistenceResult;
  readonly generatedAt?: IsoDateTime;
  readonly freshnessRows?: readonly ReportFreshnessRow[];
  readonly sourceRefs?: readonly SafeSourcePayloadRef[];
  readonly resumeFromCheckpointId?: string;
  readonly changedResourceActions?: readonly CoreErpPersistenceEvidenceChangedResourceAction[];
  readonly maxSourceRefs?: number;
  readonly maxFreshnessRows?: number;
  readonly maxChangedResourceActions?: number;
  readonly maxDrilldownPostingIds?: number;
};

export function buildCoreErpPersistenceEvidence(input: BuildCoreErpPersistenceEvidenceInput): CoreErpPersistenceEvidence {
  assertNoCredentialKeys(input.facts);
  assertNoCredentialKeys(input.persistence);

  const generatedAt =
    input.generatedAt ??
    input.facts.source.latestSyncedAt ??
    input.facts.importBatch.completedAt ??
    input.facts.importBatch.startedAt;
  const maxSourceRefs = input.maxSourceRefs ?? CORE_ERP_PERSISTENCE_EVIDENCE_DEFAULT_SOURCE_REF_LIMIT;
  const maxFreshnessRows = input.maxFreshnessRows ?? CORE_ERP_PERSISTENCE_EVIDENCE_DEFAULT_FRESHNESS_ROW_LIMIT;
  const maxChangedResourceActions =
    input.maxChangedResourceActions ?? CORE_ERP_PERSISTENCE_EVIDENCE_DEFAULT_CHANGED_RESOURCE_LIMIT;
  const maxDrilldownPostingIds =
    input.maxDrilldownPostingIds ?? CORE_ERP_PERSISTENCE_EVIDENCE_DEFAULT_DRILLDOWN_POSTING_LIMIT;
  const sourceRefs = collectSafeSourceRefs(input);
  const boundedSourceRefs = sourceRefs.slice(0, maxSourceRefs);
  const freshnessRows = (input.freshnessRows ?? []).map(toEvidenceFreshnessRow);
  assertFreshnessRowsInFactScope(freshnessRows, input.facts);
  const boundedFreshnessRows = freshnessRows.slice(0, maxFreshnessRows);
  const changedActions = [...(input.changedResourceActions ?? [])];
  assertNoCredentialKeys(changedActions);
  const boundedChangedActions = changedActions.slice(0, maxChangedResourceActions);
  const freshThrough = maxIsoDateTime([...freshnessRows.map((row) => row.freshThrough), input.facts.checkpoint.freshThrough]);
  const accountingBasis = input.facts.postings[0]?.accountingBasis;

  const evidence: CoreErpPersistenceEvidence = {
    tenantId: input.facts.company.tenantId,
    companyId: input.facts.company.companyId,
    sourceId: input.facts.source.sourceId,
    sourceSystem: input.facts.source.sourceSystem,
    providerEnvironment: input.facts.source.providerEnvironment,
    generatedAt,
    importBatch: {
      importBatchId: input.facts.importBatch.importBatchId,
      mode: input.facts.importBatch.mode,
      status: input.facts.importBatch.status,
      startedAt: input.facts.importBatch.startedAt,
      ...(input.facts.importBatch.completedAt === undefined ? {} : { completedAt: input.facts.importBatch.completedAt }),
      sourceObjectCounts: input.facts.importBatch.sourceObjectCounts,
      ...(input.facts.importBatch.warningSummary === undefined ? {} : { warningSummary: input.facts.importBatch.warningSummary }),
      ...(input.facts.importBatch.errorSummary === undefined ? {} : { errorSummary: input.facts.importBatch.errorSummary }),
      rowsWritten: input.persistence.importBatches
    },
    checkpoint: {
      checkpointId: input.facts.checkpoint.checkpointId,
      sourceObject: input.facts.checkpoint.sourceObject,
      cursorKind: input.facts.checkpoint.cursorKind,
      cursorValue: input.facts.checkpoint.cursorValue,
      status: input.facts.checkpoint.status,
      ...(input.facts.checkpoint.freshThrough === undefined ? {} : { freshThrough: input.facts.checkpoint.freshThrough }),
      ...(input.facts.checkpoint.latestSourceUpdatedAt === undefined
        ? {}
        : { latestSourceUpdatedAt: input.facts.checkpoint.latestSourceUpdatedAt }),
      ...(input.resumeFromCheckpointId === undefined ? {} : { resumeFromCheckpointId: input.resumeFromCheckpointId }),
      rowsWritten: input.persistence.checkpoints
    },
    canonicalRowCounts: {
      companies: 1,
      sources: 1,
      importBatches: 1,
      checkpoints: 1,
      accounts: input.facts.accounts.length,
      parties: input.facts.parties.length,
      items: input.facts.items.length,
      dimensions: input.facts.dimensions.length,
      transactions: input.facts.transactions.length,
      transactionLines: input.facts.transactionLines.length,
      postings: input.facts.postings.length
    },
    writeCounts: persistenceRowCounts(input.persistence),
    freshness: {
      status: deriveFreshnessStatus(freshnessRows, input.facts.checkpoint.status, input.facts.checkpoint.freshThrough),
      ...(freshThrough === undefined ? {} : { freshThrough }),
      ...(input.facts.checkpoint.latestSourceUpdatedAt === undefined
        ? {}
        : { latestSourceUpdatedAt: input.facts.checkpoint.latestSourceUpdatedAt }),
      generatedAt,
      rowCount: freshnessRows.length,
      returnedRows: boundedFreshnessRows.length,
      truncated: freshnessRows.length > boundedFreshnessRows.length,
      rows: boundedFreshnessRows
    },
    sourceReferences: {
      totalAvailable: sourceRefs.length,
      returned: boundedSourceRefs.length,
      truncated: sourceRefs.length > boundedSourceRefs.length,
      refs: boundedSourceRefs,
      drilldownRef: createCompactDrilldownRef({
        token: [
          "core_erp_persistence",
          input.facts.company.tenantId,
          input.facts.source.sourceId,
          input.facts.importBatch.importBatchId
        ].join(":"),
        postingIds: input.facts.postings.map((posting) => posting.postingId),
        accountIds: input.facts.postings.map((posting) => posting.accountId),
        query: {
          kind: "ledger_postings",
          tenantId: input.facts.company.tenantId,
          sourceId: input.facts.source.sourceId,
          ...(accountingBasis === undefined ? {} : { accountingBasis })
        },
        sourceRefs,
        inlinePostingLimit: maxDrilldownPostingIds,
        inlineSourceRefLimit: maxSourceRefs
      })
    },
    changedResources: {
      total: changedActions.length,
      returned: boundedChangedActions.length,
      truncated: changedActions.length > boundedChangedActions.length,
      actions: boundedChangedActions
    }
  };

  return evidence;
}

function persistenceRowCounts(persistence: CanonicalFactPersistenceResult): CoreErpPersistenceEvidenceCanonicalRowCounts {
  return {
    companies: persistence.companies,
    sources: persistence.sources,
    importBatches: persistence.importBatches,
    checkpoints: persistence.checkpoints,
    accounts: persistence.accounts,
    parties: persistence.parties,
    items: persistence.items,
    dimensions: persistence.dimensions,
    transactions: persistence.transactions,
    transactionLines: persistence.transactionLines,
    postings: persistence.postings
  };
}

function toEvidenceFreshnessRow(row: ReportFreshnessRow): CoreErpPersistenceEvidenceFreshnessRow {
  assertNoCredentialKeys(row);
  return {
    freshnessId: row.freshnessId,
    reportName: row.reportName,
    accountingBasis: row.accountingBasis,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    currencyCode: row.currencyCode,
    status: row.status,
    ...(row.freshThrough === undefined ? {} : { freshThrough: row.freshThrough }),
    ...(row.staleReason === undefined ? {} : { staleReason: row.staleReason }),
    ...(row.importBatchId === undefined ? {} : { importBatchId: row.importBatchId }),
    ...(row.checkpointId === undefined ? {} : { checkpointId: row.checkpointId }),
    updatedAt: row.updatedAt
  };
}

function assertFreshnessRowsInFactScope(
  rows: readonly CoreErpPersistenceEvidenceFreshnessRow[],
  facts: CanonicalAccountingFactSet
): void {
  for (const row of rows) {
    if (
      row.importBatchId !== undefined &&
      row.importBatchId !== facts.importBatch.importBatchId
    ) {
      throw new Error("Core ERP persistence evidence freshness row import batch is outside the persisted fact scope");
    }
    if (
      row.checkpointId !== undefined &&
      row.checkpointId !== facts.checkpoint.checkpointId
    ) {
      throw new Error("Core ERP persistence evidence freshness row checkpoint is outside the persisted fact scope");
    }
  }
}

function deriveFreshnessStatus(
  rows: readonly CoreErpPersistenceEvidenceFreshnessRow[],
  checkpointStatus: SyncCheckpointStatus,
  checkpointFreshThrough: IsoDateTime | undefined
): ReportFreshnessStatus {
  if (rows.some((row) => row.status === "stale")) {
    return "stale";
  }
  if (rows.some((row) => row.status === "partial")) {
    return "partial";
  }
  if (rows.length > 0 && rows.every((row) => row.status === "fresh")) {
    return "fresh";
  }
  if (checkpointStatus === "current" && checkpointFreshThrough !== undefined) {
    return "fresh";
  }
  if (checkpointStatus === "stale" || checkpointStatus === "replay_required" || checkpointStatus === "error") {
    return "stale";
  }
  return "unknown";
}

function collectSafeSourceRefs(input: BuildCoreErpPersistenceEvidenceInput): readonly SafeSourcePayloadRef[] {
  const refs = [
    ...input.facts.transactions.flatMap((transaction) =>
      transaction.sourcePayloadRef === undefined ? [] : [transaction.sourcePayloadRef]
    ),
    ...input.facts.postings.flatMap((posting) => (posting.sourcePayloadRef === undefined ? [] : [posting.sourcePayloadRef])),
    ...(input.sourceRefs ?? [])
  ];
  const deduplicated = new Map<string, SafeSourcePayloadRef>();

  for (const ref of refs) {
    assertSafeSourcePayloadRef(ref);
    deduplicated.set(sourceRefKey(ref), ref);
  }

  return [...deduplicated.values()].sort((left, right) => sourceRefKey(left).localeCompare(sourceRefKey(right)));
}

function sourceRefKey(ref: SafeSourcePayloadRef): string {
  return [ref.sourceObjectType, ref.sourceObjectId, ref.storageRef ?? "", ref.checksum ?? "", ref.sourceUpdatedAt ?? ""].join(":");
}

function maxIsoDateTime(values: readonly (IsoDateTime | undefined)[]): IsoDateTime | undefined {
  return values.filter((value): value is IsoDateTime => value !== undefined).sort().at(-1);
}
