import {
  buildBalanceSheetReport,
  buildCashFlowReport,
  buildFutureErpReportFromCanonicalReadModel,
  buildProfitAndLossReport,
  buildTrialBalanceReport,
  createFutureErpCanonicalFactPersistenceWorker,
  createFutureErpRollupAndLateArrivalWorker,
  createFutureErpSnapshotRefreshAndFreshnessWorker,
  createHandrailQuickBooksFullSyncServiceHandler,
  createHandrailQuickBooksSyncClient,
  buildFutureErpQuickBooksSandboxSyncOwnerEvidence,
  createPostgresStorageAdapter,
  createSnapshotRefreshContract,
  mapHandrailQuickBooksSdkResourcesToCanonicalFacts,
  persistFutureErpCanonicalFacts,
  reconcileReportFreshness,
  runFutureErpQuickBooksSandboxReplay,
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
  FutureErpQuickBooksSandboxReplayClient,
  FutureErpQuickBooksSandboxReplayResult,
  FutureErpQuickBooksSandboxSyncOwnerEvidence,
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
  buildProfitAndLossReport,
  buildBalanceSheetReport,
  buildTrialBalanceReport,
  buildCashFlowReport,
  buildFutureErpReportFromCanonicalReadModel,
  createFutureErpRollupAndLateArrivalWorker,
  createFutureErpSnapshotRefreshAndFreshnessWorker,
  createSnapshotRefreshContract,
  reconcileReportFreshness
};

export const futureErpResolvedQuickBooksClientImports = {
  createHandrailQuickBooksFullSyncServiceHandler,
  createHandrailQuickBooksSyncClient,
  buildFutureErpQuickBooksSandboxSyncOwnerEvidence,
  runFutureErpQuickBooksSandboxReplay
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

export type FutureErpResolvedQuickBooksSandboxReplaySmokeTypes = {
  readonly normalizedResources: NormalizedQuickBooksResourceSet;
  readonly providerReportName: NormalizedQuickBooksProviderReportName;
  readonly providerReportResult: NormalizedQuickBooksProviderReportResult;
  readonly sdkServiceFactory: typeof createHandrailQuickBooksFullSyncServiceHandler;
  readonly replayClient: FutureErpQuickBooksSandboxReplayClient;
  readonly replayRunner: typeof runFutureErpQuickBooksSandboxReplay;
  readonly replayResult: FutureErpQuickBooksSandboxReplayResult;
  readonly ownerEvidenceBuilder: typeof buildFutureErpQuickBooksSandboxSyncOwnerEvidence;
  readonly ownerEvidence: FutureErpQuickBooksSandboxSyncOwnerEvidence;
  readonly smokeHarnessResult: QuickBooksContractSmokeHarnessResult;
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
