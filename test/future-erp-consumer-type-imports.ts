import {
  buildBalanceSheetReport,
  buildCashFlowReport,
  buildFutureErpReportFromCanonicalReadModel,
  buildNormalizedQuickBooksFullSyncResponse,
  buildNormalizedQuickBooksIncrementalSyncResponse,
  buildProfitAndLossReport,
  buildTrialBalanceReport,
  createFutureErpCanonicalFactPersistenceWorker,
  createFutureErpQuickBooksFullSyncWorker,
  createFutureErpQuickBooksIncrementalSyncWorker,
  createFutureErpRollupAndLateArrivalWorker,
  createFutureErpSnapshotRefreshAndFreshnessWorker,
  createHandrailQuickBooksFullSyncServiceHandler,
  createHandrailQuickBooksSyncClient,
  createPostgresStorageAdapter,
  createSnapshotRefreshContract,
  fetchFutureErpQuickBooksProviderReportParitySnapshot,
  mapHandrailQuickBooksSdkResourcesToCanonicalFacts,
  mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts,
  mapNormalizedQuickBooksIncrementalSyncResponseToCanonicalFacts,
  persistFutureErpCanonicalFacts,
  reconcileReportFreshness,
  validateFutureErpCanonicalSchemaPreflight
} from "@handrail/erp-financials";
import type {
  CanonicalAccountingFactSet,
  FutureErpCanonicalFactPersistenceWorker,
  FutureErpCanonicalReportGenerationRequest,
  FutureErpCanonicalReportGenerationResult,
  FutureErpCanonicalReportReadModelStorage,
  FutureErpCanonicalReportSnapshotStorage,
  FutureErpRollupAndLateArrivalWorker,
  FutureErpRollupWorkerPostingReader,
  FutureErpScheduledRollupWorkerRequest,
  FutureErpScheduledRollupWorkerResult,
  FutureErpSnapshotRefreshAndFreshnessWorker,
  FutureErpSnapshotRefreshWorkerStorage,
  FutureErpStaleSnapshotRefreshWorkerRequest,
  FutureErpFreshnessReconciliationWorkerRequest,
  FutureErpFreshnessReconciliationWorkerResult,
  FutureErpWorkerScope,
  FutureErpQuickBooksFullSyncWorker,
  FutureErpQuickBooksFullSyncRunResult,
  FutureErpQuickBooksIncrementalSyncWorker,
  FutureErpQuickBooksIncrementalSyncRunResult,
  FutureErpQuickBooksProviderReportParityClient,
  FutureErpQuickBooksProviderReportParityRequest,
  FutureErpQuickBooksProviderReportParityResult,
  FutureErpQuickBooksProviderReportParitySnapshot,
  FutureErpQuickBooksProviderReportParityStatus,
  FreshnessReconcileInput,
  HandrailQuickBooksFullSyncServiceHandler,
  HandrailQuickBooksSdkResourcesAdapterInput,
  HandrailQuickBooksSyncClientTransport,
  NormalizedQuickBooksFullSyncRequestEnvelope,
  NormalizedQuickBooksFullSyncResponseEnvelope,
  NormalizedQuickBooksIncrementalSyncRequestEnvelope,
  NormalizedQuickBooksIncrementalSyncResponseEnvelope,
  NormalizedQuickBooksProviderReportName,
  NormalizedQuickBooksProviderReportResult,
  NormalizedQuickBooksResourceSet,
  QuickBooksContractSmokeHarnessResult,
  ReportFreshnessRow,
  ReportSnapshot,
  RollupBucket,
  PostgresQueryClient,
  ReportBuilderInput,
  SnapshotRefreshContractInput
} from "@handrail/erp-financials";

export const futureErpResolvedFinancialImports = {
  createPostgresStorageAdapter,
  validateFutureErpCanonicalSchemaPreflight,
  createFutureErpCanonicalFactPersistenceWorker,
  persistFutureErpCanonicalFacts,
  mapHandrailQuickBooksSdkResourcesToCanonicalFacts,
  mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts,
  mapNormalizedQuickBooksIncrementalSyncResponseToCanonicalFacts,
  buildProfitAndLossReport,
  buildBalanceSheetReport,
  buildTrialBalanceReport,
  buildCashFlowReport,
  createFutureErpQuickBooksFullSyncWorker,
  createFutureErpQuickBooksIncrementalSyncWorker,
  buildFutureErpReportFromCanonicalReadModel,
  createFutureErpRollupAndLateArrivalWorker,
  createFutureErpSnapshotRefreshAndFreshnessWorker,
  createSnapshotRefreshContract,
  reconcileReportFreshness
};

export const futureErpResolvedQuickBooksClientImports = {
  createHandrailQuickBooksFullSyncServiceHandler,
  createHandrailQuickBooksSyncClient,
  buildNormalizedQuickBooksFullSyncResponse,
  buildNormalizedQuickBooksIncrementalSyncResponse,
  fetchFutureErpQuickBooksProviderReportParitySnapshot
};

export type FutureErpResolvedQuickBooksSyncEnvelopeTypes = {
  readonly fullRequest: NormalizedQuickBooksFullSyncRequestEnvelope;
  readonly fullResponse: NormalizedQuickBooksFullSyncResponseEnvelope;
  readonly incrementalRequest: NormalizedQuickBooksIncrementalSyncRequestEnvelope;
  readonly incrementalResponse: NormalizedQuickBooksIncrementalSyncResponseEnvelope;
};

export type FutureErpResolvedQuickBooksServiceClientTypes = {
  readonly handler: HandrailQuickBooksFullSyncServiceHandler;
  readonly transport: HandrailQuickBooksSyncClientTransport;
  readonly clientFactory: typeof createHandrailQuickBooksSyncClient;
};

export type FutureErpResolvedQuickBooksSyncAndParityTypes = {
  readonly normalizedResources: NormalizedQuickBooksResourceSet;
  readonly providerReportName: NormalizedQuickBooksProviderReportName;
  readonly providerReportResult: NormalizedQuickBooksProviderReportResult;
  readonly sdkServiceFactory: typeof createHandrailQuickBooksFullSyncServiceHandler;
  readonly smokeHarnessResult: QuickBooksContractSmokeHarnessResult;
  readonly fullSyncWorker: FutureErpQuickBooksFullSyncWorker;
  readonly fullSyncResult: FutureErpQuickBooksFullSyncRunResult;
  readonly incrementalSyncWorker: FutureErpQuickBooksIncrementalSyncWorker;
  readonly incrementalSyncResult: FutureErpQuickBooksIncrementalSyncRunResult;
  readonly providerParityClient: FutureErpQuickBooksProviderReportParityClient;
  readonly providerParityRequest: FutureErpQuickBooksProviderReportParityRequest;
  readonly providerParityResult: FutureErpQuickBooksProviderReportParityResult;
  readonly providerParitySnapshot: FutureErpQuickBooksProviderReportParitySnapshot;
  readonly providerParityStatus: FutureErpQuickBooksProviderReportParityStatus;
};

export type FutureErpResolvedFinancialWorkflowTypes = {
  readonly postgresClient: PostgresQueryClient;
  readonly sdkAdapterInput: HandrailQuickBooksSdkResourcesAdapterInput;
  readonly canonicalFacts: CanonicalAccountingFactSet;
  readonly persistenceWorker: FutureErpCanonicalFactPersistenceWorker;
  readonly reportBuilderInput: ReportBuilderInput;
  readonly snapshotRefreshInput: SnapshotRefreshContractInput;
  readonly freshnessInput: FreshnessReconcileInput;
  readonly reportReadModelStorage: FutureErpCanonicalReportReadModelStorage;
  readonly reportSnapshotStorage: FutureErpCanonicalReportSnapshotStorage;
  readonly reportGenerationRequest: FutureErpCanonicalReportGenerationRequest;
  readonly reportGenerationResult: FutureErpCanonicalReportGenerationResult;
  readonly rollupWorkerScope: FutureErpWorkerScope;
  readonly rollupPostingReader: FutureErpRollupWorkerPostingReader;
  readonly rollupWorker: FutureErpRollupAndLateArrivalWorker;
  readonly rollupWorkerRequest: FutureErpScheduledRollupWorkerRequest;
  readonly rollupWorkerResult: FutureErpScheduledRollupWorkerResult;
  readonly snapshotWorkerStorage: FutureErpSnapshotRefreshWorkerStorage;
  readonly snapshotWorker: FutureErpSnapshotRefreshAndFreshnessWorker;
  readonly snapshotWorkerRequest: FutureErpStaleSnapshotRefreshWorkerRequest;
  readonly freshnessWorkerRequest: FutureErpFreshnessReconciliationWorkerRequest;
  readonly freshnessWorkerResult: FutureErpFreshnessReconciliationWorkerResult;
  readonly reportSnapshot: ReportSnapshot;
  readonly reportFreshnessRow: ReportFreshnessRow;
  readonly rollupBucket: RollupBucket;
};
