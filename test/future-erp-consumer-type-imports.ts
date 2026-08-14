import {
  adaptHandrailQuickBooksSdkFullSyncEnvelope,
  adaptHandrailQuickBooksSdkIncrementalSyncEnvelope,
  buildBalanceSheetReport,
  buildCashFlowReport,
  buildFutureErpReportFromCanonicalReadModel,
  buildNormalizedQuickBooksFullSyncResponse,
  buildNormalizedQuickBooksIncrementalSyncResponse,
  buildProfitAndLossReport,
  buildTrialBalanceReport,
  assertValidAccountHierarchy,
  createFutureErpCanonicalFactPersistenceWorker,
  createFutureErpQuickBooksFullSyncWorker,
  createFutureErpQuickBooksIncrementalSyncWorker,
  createFutureErpRollupAndLateArrivalWorker,
  createFutureErpSnapshotRefreshAndFreshnessWorker,
  createErpFinancials,
  createFiscalCloseEvidenceChecksum,
  createHandrailQuickBooksFullSyncServiceHandler,
  createHandrailQuickBooksSyncClient,
  createPostgresStorageAdapter,
  createPostgresTransactionRunner,
  createSnapshotRefreshContract,
  fetchFutureErpQuickBooksProviderReportParitySnapshot,
  mapHandrailQuickBooksSdkResourcesToCanonicalFacts,
  mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts,
  mapNormalizedQuickBooksIncrementalSyncResponseToCanonicalFacts,
  migratePostgresSchema,
  planPostgresMigrations,
  persistFutureErpCanonicalFacts,
  reconcileReportFreshness,
  validateAccountHierarchy,
  validateFutureErpCanonicalSchemaPreflight,
  validatePostgresMigrationHistory
} from "@handrail/erp-financials";
import type {
  Account,
  AccountHierarchyDiagnostic,
  AdjustmentDetail,
  AdjustmentListItem,
  CanonicalAccountingFactSet,
  CreateErpFinancialsInput,
  ErpFinancials,
  FinancialOperationContext,
  FiscalCloseEvidence,
  FiscalCloseEvidenceMaterial,
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
  HandrailQuickBooksSdkEnvelopeAdapterOptions,
  HandrailQuickBooksSdkFullSyncEnvelope,
  HandrailQuickBooksSdkIncrementalSyncEnvelope,
  HandrailQuickBooksSdkResourcesAdapterInput,
  HandrailQuickBooksSyncClientTransport,
  IssuedAdjustmentLifecycleResult,
  NormalizedQuickBooksFullSyncRequestEnvelope,
  NormalizedQuickBooksFullSyncResponseEnvelope,
  NormalizedQuickBooksIncrementalSyncRequestEnvelope,
  NormalizedQuickBooksIncrementalSyncResponseEnvelope,
  NormalizedQuickBooksProviderReportName,
  NormalizedQuickBooksProviderReportResult,
  NormalizedQuickBooksResourceSet,
  PostgresMigrationPlan,
  QuickBooksContractSmokeHarnessResult,
  ReplaceIssuedAdjustmentInput,
  ReportFreshnessRow,
  ReportSnapshot,
  RollupBucket,
  PostgresQueryClient,
  ReportBuilderInput,
  SnapshotRefreshContractInput,
  SubledgerApplicationResult,
  VoidIssuedAdjustmentInput
} from "@handrail/erp-financials";

export const futureErpResolvedFinancialImports = {
  adaptHandrailQuickBooksSdkFullSyncEnvelope,
  adaptHandrailQuickBooksSdkIncrementalSyncEnvelope,
  createPostgresStorageAdapter,
  createPostgresTransactionRunner,
  planPostgresMigrations,
  migratePostgresSchema,
  validatePostgresMigrationHistory,
  createErpFinancials,
  createFiscalCloseEvidenceChecksum,
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
  validateAccountHierarchy,
  assertValidAccountHierarchy,
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

export const futureErpConsumerAccountWithParent: Account = {
  accountId: "acct_consumer_child",
  tenantId: "tenant_consumer",
  sourceId: "source_consumer",
  sourceAccountId: "consumer_child",
  accountNumber: "4100",
  name: "Consumer Child Income",
  type: "Income",
  classification: "income",
  parentAccountId: "acct_consumer_parent",
  active: true
};

export type FutureErpResolvedQuickBooksSyncEnvelopeTypes = {
  readonly sdkAdapterOptions: HandrailQuickBooksSdkEnvelopeAdapterOptions;
  readonly sdkFullResponse: HandrailQuickBooksSdkFullSyncEnvelope;
  readonly sdkIncrementalResponse: HandrailQuickBooksSdkIncrementalSyncEnvelope;
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
  readonly accountWithParent: Account;
  readonly hierarchyDiagnostics: readonly AccountHierarchyDiagnostic[];
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
  readonly financialsInput: CreateErpFinancialsInput;
  readonly financials: ErpFinancials;
  readonly financialOperation: FinancialOperationContext;
  readonly fiscalCloseEvidence: FiscalCloseEvidence;
  readonly fiscalCloseEvidenceMaterial: FiscalCloseEvidenceMaterial;
  readonly migrationPlan: PostgresMigrationPlan;
  readonly subledgerApplication: SubledgerApplicationResult;
  readonly adjustmentRegisterItem: AdjustmentListItem;
  readonly adjustmentDetail: AdjustmentDetail;
  readonly voidIssuedAdjustmentInput: VoidIssuedAdjustmentInput;
  readonly replaceIssuedAdjustmentInput: ReplaceIssuedAdjustmentInput;
  readonly issuedAdjustmentLifecycle: IssuedAdjustmentLifecycleResult;
};
