import {
  CORE_ERP_CANONICAL_REPORT_NAMES,
  buildCoreErpReportFromCanonicalReadModel,
  buildCoreErpPersistenceEvidence,
  createQuickBooksFullSyncWorker,
  createQuickBooksIncrementalSyncWorker
} from "@handrail/erp-financials";

import type {
  BuildCoreErpPersistenceEvidenceInput,
  CoreErpCanonicalReportGenerationRequest,
  CoreErpCanonicalReportGenerationResult,
  CoreErpCanonicalReportReadModelStorage,
  CoreErpCanonicalReportSnapshotStorage,
  CoreErpPersistenceEvidence,
  CoreErpPersistenceEvidenceCheckpointSummary,
  CoreErpPersistenceEvidenceFreshnessSummary,
  CoreErpPersistenceEvidenceSourceReferences,
  CoreErpReportDrilldownSurface,
  CoreErpReportDrilldownSurfaceEntry,
  CoreErpReportFreshness,
  CoreErpReportFreshnessRow,
  CoreErpReportName,
  CoreErpReportReconciliationDrilldownSurface,
  CoreErpReportRollupBucket,
  CoreErpTenantReadAccess,
  QuickBooksFullSyncRunResult,
  QuickBooksFullSyncWorker,
  QuickBooksIncrementalSyncRunResult,
  QuickBooksIncrementalSyncWorker
} from "@handrail/erp-financials";

export const coreErpPersistenceEvidenceImports = {
  CORE_ERP_CANONICAL_REPORT_NAMES,
  buildCoreErpReportFromCanonicalReadModel,
  buildCoreErpPersistenceEvidence,
  createQuickBooksFullSyncWorker,
  createQuickBooksIncrementalSyncWorker
};

export const coreErpSupportedReportNames: readonly CoreErpReportName[] = [
  "profit_and_loss",
  "balance_sheet",
  "trial_balance",
  "cash_flow"
];

export type CoreErpPersistenceEvidenceImports = {
  readonly buildInput: BuildCoreErpPersistenceEvidenceInput;
  readonly evidence: CoreErpPersistenceEvidence;
  readonly checkpoint: CoreErpPersistenceEvidenceCheckpointSummary;
  readonly freshness: CoreErpPersistenceEvidenceFreshnessSummary;
  readonly sourceReferences: CoreErpPersistenceEvidenceSourceReferences;
  readonly fullSyncWorker: QuickBooksFullSyncWorker;
  readonly fullSyncRunResult: QuickBooksFullSyncRunResult;
  readonly incrementalSyncWorker: QuickBooksIncrementalSyncWorker;
  readonly incrementalSyncRunResult: QuickBooksIncrementalSyncRunResult;
  readonly supportedReportName: CoreErpReportName;
  readonly supportedReportNames: typeof CORE_ERP_CANONICAL_REPORT_NAMES;
  readonly tenantReadAccess: CoreErpTenantReadAccess;
  readonly reportReadModelStorage: CoreErpCanonicalReportReadModelStorage;
  readonly reportSnapshotStorage: CoreErpCanonicalReportSnapshotStorage;
  readonly reportGenerationRequest: CoreErpCanonicalReportGenerationRequest;
  readonly reportGenerationResult: CoreErpCanonicalReportGenerationResult;
  readonly reportFreshness: CoreErpReportFreshness;
  readonly reportFreshnessRow: CoreErpReportFreshnessRow;
  readonly reportRollupBucket: CoreErpReportRollupBucket;
  readonly drilldownSurface: CoreErpReportDrilldownSurface;
  readonly drilldownEntry: CoreErpReportDrilldownSurfaceEntry;
  readonly reconciliationDrilldownSurface: CoreErpReportReconciliationDrilldownSurface;
};
