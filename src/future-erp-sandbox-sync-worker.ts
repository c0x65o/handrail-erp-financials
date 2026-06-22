import { assertNoCredentialKeys } from "./canonical-model.js";
import type { IsoDateTime } from "./canonical-model.js";
import { ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES } from "./fixtures.js";
import {
  createFutureErpQuickBooksFullSyncWorker,
  type FutureErpQuickBooksFullSyncPersistence,
  type FutureErpQuickBooksFullSyncRunResult
} from "./future-erp-quickbooks-full-sync.js";
import {
  generateFutureErpCanonicalReportSnapshotsFromImport,
  runFutureErpQuickBooksSandboxReplay,
  type FutureErpCanonicalReportSnapshotGenerationResult,
  type FutureErpQuickBooksSandboxReplayCanonicalRowCounts,
  type FutureErpQuickBooksSandboxReplayCheckpointSummary,
  type FutureErpQuickBooksSandboxReplayClient,
  type FutureErpQuickBooksSandboxReplayImportBatchSummary,
  type FutureErpQuickBooksSandboxReplayOptions,
  type FutureErpQuickBooksSandboxReplayResult,
  type FutureErpQuickBooksSandboxReplaySafeSourceIdentityMetadata
} from "./future-erp-sandbox-replay.js";
import { validateFutureErpCanonicalSchemaPreflight } from "./future-erp-preflight.js";
import type {
  NormalizedAccountingResourceCounts,
  NormalizedQuickBooksFullSyncRequestEnvelope,
  NormalizedQuickBooksServiceHealthProbeRequest,
  NormalizedQuickBooksServiceHealthProbeResponseEnvelope
} from "./normalized-accounting-contracts.js";
import { createPostgresStorageAdapter } from "./postgres-storage.js";
import type { PostgresQueryClient, PostgresQueryResult, PostgresStorageAdapter } from "./postgres-storage.js";

export type FutureErpQuickBooksSandboxSyncWorkerMode = "full_sync" | "sandbox_replay";

export type FutureErpQuickBooksSandboxSyncWorkerEnvironment = "dev" | "test" | "staging" | "production";

export type FutureErpQuickBooksSandboxSyncWorkerPreflightStatus = "ready" | "blocked";

export type FutureErpQuickBooksSandboxSyncWorkerPreflightCheckStatus = "ready" | "blocked" | "skipped";

export type FutureErpQuickBooksSandboxSyncWorkerPreflightCheck = {
  readonly name: string;
  readonly status: FutureErpQuickBooksSandboxSyncWorkerPreflightCheckStatus;
  readonly message?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
};

export type FutureErpQuickBooksSandboxSyncWorkerPreflightProbeRequest = {
  readonly mode: FutureErpQuickBooksSandboxSyncWorkerMode;
  readonly sourceIdentity: FutureErpQuickBooksSandboxReplaySafeSourceIdentityMetadata;
  readonly requestedAt?: IsoDateTime;
};

export type FutureErpQuickBooksSandboxSyncWorkerPreflightProbeResult = {
  readonly connected: boolean;
  readonly replayAvailable?: boolean;
  readonly message?: string;
  readonly sourceIdentity?: Partial<FutureErpQuickBooksSandboxReplaySafeSourceIdentityMetadata>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
};

export type FutureErpQuickBooksSandboxSyncWorkerClient = FutureErpQuickBooksSandboxReplayClient & {
  readonly serviceHealth?: (
    request: NormalizedQuickBooksServiceHealthProbeRequest
  ) => Promise<NormalizedQuickBooksServiceHealthProbeResponseEnvelope>;
  readonly preflight?: (
    request: FutureErpQuickBooksSandboxSyncWorkerPreflightProbeRequest
  ) => Promise<FutureErpQuickBooksSandboxSyncWorkerPreflightProbeResult>;
};

export type FutureErpQuickBooksSandboxSyncWorkerPreflightResult = {
  readonly status: FutureErpQuickBooksSandboxSyncWorkerPreflightStatus;
  readonly mode: FutureErpQuickBooksSandboxSyncWorkerMode;
  readonly executionEnvironment: FutureErpQuickBooksSandboxSyncWorkerEnvironment;
  readonly sourceIdentity: FutureErpQuickBooksSandboxReplaySafeSourceIdentityMetadata;
  readonly checks: readonly FutureErpQuickBooksSandboxSyncWorkerPreflightCheck[];
};

export type FutureErpQuickBooksSandboxSyncWorkerCanonicalCounts = FutureErpQuickBooksSandboxReplayCanonicalRowCounts;

export type FutureErpQuickBooksSandboxSyncWorkerImportBatchSummary = FutureErpQuickBooksSandboxReplayImportBatchSummary;

export type FutureErpQuickBooksSandboxSyncWorkerCheckpointSummary = FutureErpQuickBooksSandboxReplayCheckpointSummary;

export type FutureErpQuickBooksSandboxSyncWorkerRunResult = {
  readonly mode: FutureErpQuickBooksSandboxSyncWorkerMode;
  readonly preflight: FutureErpQuickBooksSandboxSyncWorkerPreflightResult;
  readonly sourceIdentity: FutureErpQuickBooksSandboxReplaySafeSourceIdentityMetadata;
  readonly importBatch: FutureErpQuickBooksSandboxSyncWorkerImportBatchSummary;
  readonly checkpoint: FutureErpQuickBooksSandboxSyncWorkerCheckpointSummary;
  readonly counts: {
    readonly normalizedResourceCounts: NormalizedAccountingResourceCounts;
    readonly canonicalRowCounts: FutureErpQuickBooksSandboxSyncWorkerCanonicalCounts;
  };
  readonly reports?: Pick<
    FutureErpCanonicalReportSnapshotGenerationResult,
    "reportStatuses" | "reports" | "snapshotIds" | "freshnessIds" | "safeDrilldownRefs"
  >;
  readonly replay?: Pick<
    FutureErpQuickBooksSandboxReplayResult,
    "reportStatuses" | "snapshotIds" | "freshnessIds" | "parityStatuses" | "providerParity" | "safeDrilldownRefs"
  >;
};

export type FutureErpQuickBooksSandboxSyncOwnerEvidenceStatus = "passed" | "degraded" | "blocked";

export type FutureErpQuickBooksSandboxSyncOwnerEvidence = {
  readonly evidenceKind: "future_erp_quickbooks_sandbox_replay";
  readonly evidenceVersion: 1;
  readonly mode: FutureErpQuickBooksSandboxSyncWorkerMode;
  readonly status: FutureErpQuickBooksSandboxSyncOwnerEvidenceStatus;
  readonly preflightStatus: FutureErpQuickBooksSandboxSyncWorkerPreflightStatus;
  readonly preflightChecks: readonly Pick<FutureErpQuickBooksSandboxSyncWorkerPreflightCheck, "name" | "status">[];
  readonly sourceIdentity: FutureErpQuickBooksSandboxReplaySafeSourceIdentityMetadata;
  readonly importBatchId: string;
  readonly checkpointId: string;
  readonly sourceFreshThrough?: string;
  readonly latestSourceUpdatedAt?: string;
  readonly counts: FutureErpQuickBooksSandboxSyncWorkerRunResult["counts"];
  readonly reportStatuses: NonNullable<FutureErpQuickBooksSandboxSyncWorkerRunResult["reports"]>["reportStatuses"];
  readonly snapshotIds: NonNullable<FutureErpQuickBooksSandboxSyncWorkerRunResult["reports"]>["snapshotIds"];
  readonly freshnessIds: NonNullable<FutureErpQuickBooksSandboxSyncWorkerRunResult["reports"]>["freshnessIds"];
  readonly reports: readonly {
    readonly reportName: string;
    readonly status: string;
    readonly freshnessStatus: string;
    readonly reconciliationStatus: string;
    readonly reconciliationDifference: string;
    readonly snapshotId: string;
    readonly freshnessId: string;
    readonly lineCount: number;
    readonly totalCount: number;
    readonly snapshotRowsWritten: number;
    readonly freshnessRowsWritten: number;
    readonly safeDrilldownRefCounts: {
      readonly lineRefs: number;
      readonly totalRefs: number;
      readonly hasReportSnapshotRef: boolean;
      readonly hasReconciliationDifferenceRef: boolean;
    };
  }[];
  readonly providerParity?: {
    readonly status: string;
    readonly reports: readonly {
      readonly reportName: string;
      readonly status: string;
      readonly reconciliationStatus?: string;
      readonly reconciliationDifference?: string;
      readonly evidenceTotalCount: number;
      readonly unsupportedReason?: string;
      readonly unavailableReason?: string;
      readonly hasReconciliationDifferenceDrilldownRef: boolean;
    }[];
  };
};

export type FutureErpQuickBooksSandboxSyncWorkerRequest = {
  readonly mode?: FutureErpQuickBooksSandboxSyncWorkerMode;
  readonly executionEnvironment?: FutureErpQuickBooksSandboxSyncWorkerEnvironment;
  readonly fullSyncRequest?: NormalizedQuickBooksFullSyncRequestEnvelope;
  readonly requestedAt?: IsoDateTime;
};

export type FutureErpQuickBooksSandboxSyncWorkerOptions = Omit<
  FutureErpQuickBooksSandboxReplayOptions,
  "quickBooksClient" | "fullSyncRequest"
> & {
  readonly quickBooksClient: FutureErpQuickBooksSandboxSyncWorkerClient;
  readonly persistence?: FutureErpQuickBooksFullSyncPersistence;
  readonly postgresClient?: PostgresQueryClient;
  readonly postgresStorage?: PostgresStorageAdapter;
  readonly schemaPreflightClient?: PostgresQueryClient;
  readonly installSchemaIfMissing?: boolean;
  readonly executionEnvironment?: FutureErpQuickBooksSandboxSyncWorkerEnvironment;
  readonly handrailQuickBooksServiceEnvironment?: "staging" | "production";
};

export type FutureErpQuickBooksSandboxSyncWorker = {
  preflight(
    request?: FutureErpQuickBooksSandboxSyncWorkerRequest
  ): Promise<FutureErpQuickBooksSandboxSyncWorkerPreflightResult>;
  run(request?: FutureErpQuickBooksSandboxSyncWorkerRequest): Promise<FutureErpQuickBooksSandboxSyncWorkerRunResult>;
};

export class FutureErpQuickBooksSandboxSyncWorkerPreflightError extends Error {
  readonly preflight: FutureErpQuickBooksSandboxSyncWorkerPreflightResult;

  constructor(preflight: FutureErpQuickBooksSandboxSyncWorkerPreflightResult) {
    const blockedChecks = preflight.checks
      .filter((check) => check.status === "blocked")
      .map((check) => check.name)
      .join(", ");

    super(`Future ERP QuickBooks sandbox sync preflight failed: ${blockedChecks}`);
    this.name = "FutureErpQuickBooksSandboxSyncWorkerPreflightError";
    this.preflight = preflight;
  }
}

export function createFutureErpQuickBooksSandboxSyncWorker(
  options: FutureErpQuickBooksSandboxSyncWorkerOptions
): FutureErpQuickBooksSandboxSyncWorker {
  return {
    preflight(request = {}) {
      return preflightFutureErpQuickBooksSandboxSync(options, request);
    },
    async run(request = {}) {
      const preflight = await preflightFutureErpQuickBooksSandboxSync(options, request);
      if (preflight.status !== "ready") {
        throw new FutureErpQuickBooksSandboxSyncWorkerPreflightError(preflight);
      }

      const mode = request.mode ?? "sandbox_replay";
      const fullSyncRequest = request.fullSyncRequest ?? ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.fullSync.request;

      if (mode === "sandbox_replay") {
        const replay = await runFutureErpQuickBooksSandboxReplay({
          ...options,
          quickBooksClient: options.quickBooksClient,
          fullSyncRequest
        });
        const result: FutureErpQuickBooksSandboxSyncWorkerRunResult = {
          mode,
          preflight,
          sourceIdentity: replay.sourceIdentity,
          importBatch: replay.importBatch,
          checkpoint: replay.checkpoint,
          counts: {
            normalizedResourceCounts: replay.normalizedResourceCounts,
            canonicalRowCounts: replay.canonicalRowCounts
          },
          reports: {
            reportStatuses: replay.reportStatuses,
            reports: replay.reports,
            snapshotIds: replay.snapshotIds,
            freshnessIds: replay.freshnessIds,
            safeDrilldownRefs: replay.safeDrilldownRefs
          },
          replay: {
            reportStatuses: replay.reportStatuses,
            snapshotIds: replay.snapshotIds,
            freshnessIds: replay.freshnessIds,
            parityStatuses: replay.parityStatuses,
            providerParity: replay.providerParity,
            safeDrilldownRefs: replay.safeDrilldownRefs
          }
        };
        assertNoCredentialKeys(result);
        assertSandboxWorkerResultContainsNoDisallowedKeys(result);

        return result;
      }

      const fullSyncPersistence = resolveFullSyncPersistence(options);
      const importResult = await runFullSync(options, fullSyncRequest, fullSyncPersistence.persistence);
      const reportGeneration = await generateFutureErpCanonicalReportSnapshotsFromImport({
        storage: fullSyncPersistence.reportStorage,
        importResult,
        accountingBasis: options.accountingBasis ?? "accrual",
        currencyCode: options.currencyCode ?? "USD",
        generatedAt: options.generatedAt ?? options.importedAt ?? importResult.facts.source.latestSyncedAt ?? "1970-01-01T00:00:00.000Z",
        periodStart: options.periodStart ?? "2026-01-01",
        periodEnd: options.periodEnd ?? "2026-01-31",
        asOfDate: options.asOfDate ?? options.periodEnd ?? "2026-01-31",
        ...(options.cashFlow === undefined ? {} : { cashFlow: options.cashFlow }),
        ...(options.maxDrilldownRefsPerReport === undefined ? {} : { maxDrilldownRefsPerReport: options.maxDrilldownRefsPerReport })
      });
      const result: FutureErpQuickBooksSandboxSyncWorkerRunResult = {
        mode,
        preflight,
        sourceIdentity: safeSourceIdentityMetadata(importResult, options),
        importBatch: importBatchSummary(importResult),
        checkpoint: checkpointSummary(importResult),
        counts: {
          normalizedResourceCounts: importResult.response.resourceCounts,
          canonicalRowCounts: canonicalRowCounts(importResult)
        },
        reports: {
          reportStatuses: reportGeneration.reportStatuses,
          reports: reportGeneration.reports,
          snapshotIds: reportGeneration.snapshotIds,
          freshnessIds: reportGeneration.freshnessIds,
          safeDrilldownRefs: reportGeneration.safeDrilldownRefs
        }
      };
      assertNoCredentialKeys(result);
      assertSandboxWorkerResultContainsNoDisallowedKeys(result);

      return result;
    }
  };
}

export function buildFutureErpQuickBooksSandboxSyncOwnerEvidence(
  result: FutureErpQuickBooksSandboxSyncWorkerRunResult
): FutureErpQuickBooksSandboxSyncOwnerEvidence {
  const reportGeneration = result.reports;
  if (reportGeneration === undefined) {
    throw new Error("Future ERP QuickBooks sandbox sync owner evidence requires generated reports");
  }

  const providerParity = result.replay?.providerParity;
  const evidence: FutureErpQuickBooksSandboxSyncOwnerEvidence = {
    evidenceKind: "future_erp_quickbooks_sandbox_replay",
    evidenceVersion: 1,
    mode: result.mode,
    status: ownerEvidenceStatus(result),
    preflightStatus: result.preflight.status,
    preflightChecks: result.preflight.checks.map((check) => ({
      name: check.name,
      status: check.status
    })),
    sourceIdentity: result.sourceIdentity,
    importBatchId: result.importBatch.importBatchId,
    checkpointId: result.checkpoint.checkpointId,
    ...(result.checkpoint.freshThrough === undefined ? {} : { sourceFreshThrough: result.checkpoint.freshThrough }),
    ...(result.checkpoint.latestSourceUpdatedAt === undefined
      ? {}
      : { latestSourceUpdatedAt: result.checkpoint.latestSourceUpdatedAt }),
    counts: result.counts,
    reportStatuses: reportGeneration.reportStatuses,
    snapshotIds: reportGeneration.snapshotIds,
    freshnessIds: reportGeneration.freshnessIds,
    reports: Object.values(reportGeneration.reports).map((report) => ({
      reportName: report.reportName,
      status: report.status,
      freshnessStatus: report.freshnessStatus,
      reconciliationStatus: report.reconciliationStatus,
      reconciliationDifference: report.reconciliationDifference,
      snapshotId: report.snapshotId,
      freshnessId: report.freshnessId,
      lineCount: report.lineCount,
      totalCount: report.totalCount,
      snapshotRowsWritten: report.snapshotRowsWritten,
      freshnessRowsWritten: report.freshnessRowsWritten,
      safeDrilldownRefCounts: {
        lineRefs: report.safeDrilldownRefs.lineRefs.length,
        totalRefs: report.safeDrilldownRefs.totalRefs.length,
        hasReportSnapshotRef: true,
        hasReconciliationDifferenceRef: true
      }
    })),
    ...(providerParity === undefined
      ? {}
      : {
          providerParity: {
            status: providerParity.status,
            reports: providerParity.reports.map((report) => ({
              reportName: report.reportName,
              status: report.status,
              ...(report.reconciliationStatus === undefined ? {} : { reconciliationStatus: report.reconciliationStatus }),
              ...(report.reconciliationDifference === undefined
                ? {}
                : { reconciliationDifference: report.reconciliationDifference }),
              evidenceTotalCount: report.evidenceTotalCount,
              ...(report.unsupportedReason === undefined ? {} : { unsupportedReason: report.unsupportedReason }),
              ...(report.unavailableReason === undefined ? {} : { unavailableReason: report.unavailableReason }),
              hasReconciliationDifferenceDrilldownRef: report.reconciliationDifferenceDrilldownRef !== undefined
            }))
          }
        })
  };

  assertNoCredentialKeys(evidence);
  assertSandboxWorkerResultContainsNoDisallowedKeys(evidence);

  return evidence;
}

export async function preflightFutureErpQuickBooksSandboxSync(
  options: FutureErpQuickBooksSandboxSyncWorkerOptions,
  request: FutureErpQuickBooksSandboxSyncWorkerRequest = {}
): Promise<FutureErpQuickBooksSandboxSyncWorkerPreflightResult> {
  const mode = request.mode ?? "sandbox_replay";
  const executionEnvironment = request.executionEnvironment ?? options.executionEnvironment ?? "dev";
  const fullSyncRequest = request.fullSyncRequest ?? ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.fullSync.request;
  const sourceIdentity = safeSourceIdentityMetadataFromRequest(fullSyncRequest, options);
  const checks: FutureErpQuickBooksSandboxSyncWorkerPreflightCheck[] = [
    devOnlyCheck(executionEnvironment),
    methodCheck("quickbooks_full_sync", options.quickBooksClient.fullSync)
  ];

  if (mode === "sandbox_replay") {
    checks.push(
      methodCheck("quickbooks_profit_and_loss_report", options.quickBooksClient.profitAndLossReport),
      methodCheck("quickbooks_balance_sheet_report", options.quickBooksClient.balanceSheetReport),
      methodCheck("quickbooks_trial_balance_report", options.quickBooksClient.trialBalanceReport),
      methodCheck("quickbooks_cash_flow_parity_report", options.quickBooksClient.cashFlowParityReport)
    );
  }

  checks.push(await schemaCheck(options));
  checks.push(
    await serviceAvailabilityCheck(options.quickBooksClient, {
      mode,
      sourceIdentity,
      ...(request.requestedAt === undefined ? {} : { requestedAt: request.requestedAt })
    })
  );

  const preflight: FutureErpQuickBooksSandboxSyncWorkerPreflightResult = {
    status: checks.some((check) => check.status === "blocked") ? "blocked" : "ready",
    mode,
    executionEnvironment,
    sourceIdentity,
    checks
  };
  assertNoCredentialKeys(preflight);
  assertSandboxWorkerResultContainsNoDisallowedKeys(preflight);

  return preflight;
}

async function runFullSync(
  options: FutureErpQuickBooksSandboxSyncWorkerOptions,
  fullSyncRequest: NormalizedQuickBooksFullSyncRequestEnvelope,
  persistence: FutureErpQuickBooksFullSyncPersistence
): Promise<FutureErpQuickBooksFullSyncRunResult> {
  const worker = createFutureErpQuickBooksFullSyncWorker({
    quickBooksClient: options.quickBooksClient,
    persistence,
    companyId: options.companyId ?? "company_future_erp_qbo_fixture",
    ...(options.accountingBasis === undefined ? {} : { accountingBasis: options.accountingBasis }),
    ...(options.currencyCode === undefined ? {} : { currencyCode: options.currencyCode }),
    ...(options.importedAt === undefined ? {} : { importedAt: options.importedAt }),
    handrailQuickBooksServiceEnvironment: options.handrailQuickBooksServiceEnvironment ?? "staging"
  });

  return worker.fullSync(fullSyncRequest);
}

type FullSyncPersistenceResolution = {
  readonly persistence: FutureErpQuickBooksFullSyncPersistence;
  readonly reportStorage: Pick<PostgresStorageAdapter, "writeReportSnapshot" | "writeFreshnessRows">;
};

function resolveFullSyncPersistence(options: FutureErpQuickBooksSandboxSyncWorkerOptions): FullSyncPersistenceResolution {
  const fallbackStorage =
    options.persistence === undefined && options.postgresStorage === undefined
      ? createPostgresStorageAdapter(options.postgresClient ?? new RecordingSandboxPostgresClient())
      : undefined;
  const persistence = options.persistence ?? options.postgresStorage ?? fallbackStorage;
  const reportStorage = options.postgresStorage ?? (isReportSnapshotStorage(persistence) ? persistence : fallbackStorage);

  if (persistence === undefined || reportStorage === undefined) {
    throw new Error("Future ERP full sync report generation requires postgresStorage or report snapshot storage methods");
  }

  return {
    persistence,
    reportStorage
  };
}

function isReportSnapshotStorage(
  value: unknown
): value is Pick<PostgresStorageAdapter, "writeReportSnapshot" | "writeFreshnessRows"> {
  return (
    value !== null &&
    typeof value === "object" &&
    "writeReportSnapshot" in value &&
    "writeFreshnessRows" in value
  );
}

function safeSourceIdentityMetadata(
  importResult: FutureErpQuickBooksFullSyncRunResult,
  options: Pick<FutureErpQuickBooksSandboxSyncWorkerOptions, "handrailQuickBooksServiceEnvironment">
): FutureErpQuickBooksSandboxReplaySafeSourceIdentityMetadata {
  const identity = importResult.response.sourceIdentity;

  return {
    tenantId: identity.tenantId,
    sourceId: identity.sourceId,
    sourceSystem: "quickbooks",
    providerEnvironment: identity.providerEnvironment,
    sourceCompanyRef: identity.sourceCompanyRef,
    realmId: identity.realmId,
    connectionRef: importResult.facts.source.connectionRef,
    handrailQuickBooksServiceEnvironment:
      importResult.adapterInput.context.runtimeConfig?.serviceEnvironment ?? options.handrailQuickBooksServiceEnvironment ?? "staging"
  };
}

function safeSourceIdentityMetadataFromRequest(
  request: NormalizedQuickBooksFullSyncRequestEnvelope,
  options: Pick<FutureErpQuickBooksSandboxSyncWorkerOptions, "handrailQuickBooksServiceEnvironment">
): FutureErpQuickBooksSandboxReplaySafeSourceIdentityMetadata {
  const identity = request.sourceIdentity;
  const serviceEnvironment = options.handrailQuickBooksServiceEnvironment ?? "staging";

  return {
    tenantId: identity.tenantId,
    sourceId: identity.sourceId,
    sourceSystem: "quickbooks",
    providerEnvironment: identity.providerEnvironment,
    sourceCompanyRef: identity.sourceCompanyRef,
    realmId: identity.realmId,
    connectionRef: `handrail-quickbooks-sdk:${serviceEnvironment}:${identity.providerEnvironment}:realm:${identity.realmId}`,
    handrailQuickBooksServiceEnvironment: serviceEnvironment
  };
}

function importBatchSummary(importResult: FutureErpQuickBooksFullSyncRunResult): FutureErpQuickBooksSandboxSyncWorkerImportBatchSummary {
  const importBatch = importResult.facts.importBatch;

  return {
    importBatchId: importBatch.importBatchId,
    mode: importBatch.mode,
    status: importBatch.status,
    startedAt: importBatch.startedAt,
    ...(importBatch.completedAt === undefined ? {} : { completedAt: importBatch.completedAt })
  };
}

function checkpointSummary(importResult: FutureErpQuickBooksFullSyncRunResult): FutureErpQuickBooksSandboxSyncWorkerCheckpointSummary {
  const checkpoint = importResult.facts.checkpoint;

  return {
    checkpointId: checkpoint.checkpointId,
    sourceObject: checkpoint.sourceObject,
    cursorKind: checkpoint.cursorKind,
    cursorValue: checkpoint.cursorValue,
    ...(checkpoint.freshThrough === undefined ? {} : { freshThrough: checkpoint.freshThrough }),
    ...(checkpoint.latestSourceUpdatedAt === undefined ? {} : { latestSourceUpdatedAt: checkpoint.latestSourceUpdatedAt }),
    status: checkpoint.status
  };
}

function canonicalRowCounts(importResult: FutureErpQuickBooksFullSyncRunResult): FutureErpQuickBooksSandboxSyncWorkerCanonicalCounts {
  return {
    companies: importResult.persistence.companies,
    sources: importResult.persistence.sources,
    importBatches: importResult.persistence.importBatches,
    checkpoints: importResult.persistence.checkpoints,
    accounts: importResult.persistence.accounts,
    parties: importResult.persistence.parties,
    items: importResult.persistence.items,
    dimensions: importResult.persistence.dimensions,
    transactions: importResult.persistence.transactions,
    transactionLines: importResult.persistence.transactionLines,
    postings: importResult.persistence.postings
  };
}

function devOnlyCheck(
  executionEnvironment: FutureErpQuickBooksSandboxSyncWorkerEnvironment
): FutureErpQuickBooksSandboxSyncWorkerPreflightCheck {
  if (executionEnvironment === "dev" || executionEnvironment === "test") {
    return {
      name: "dev_only_execution",
      status: "ready",
      metadata: { executionEnvironment }
    };
  }

  return {
    name: "dev_only_execution",
    status: "blocked",
    message: "Future ERP QuickBooks sandbox sync workers may only run in dev or test.",
    metadata: { executionEnvironment }
  };
}

function methodCheck(name: string, method: unknown): FutureErpQuickBooksSandboxSyncWorkerPreflightCheck {
  return typeof method === "function"
    ? { name, status: "ready" }
    : { name, status: "blocked", message: `${name} is not available on the Handrail QuickBooks SDK/service client.` };
}

async function schemaCheck(
  options: FutureErpQuickBooksSandboxSyncWorkerOptions
): Promise<FutureErpQuickBooksSandboxSyncWorkerPreflightCheck> {
  const client = options.schemaPreflightClient ?? options.postgresClient;
  if (client === undefined) {
    return {
      name: "erp_financials_canonical_schema",
      status: "skipped",
      message: "No schema preflight client was provided."
    };
  }

  try {
    const validation = await validateFutureErpCanonicalSchemaPreflight(client, {
      jobName: "future-erp-quickbooks-sandbox-sync",
      installSchemaIfMissing: options.installSchemaIfMissing === true
    });

    return {
      name: "erp_financials_canonical_schema",
      status: "ready",
      metadata: {
        issues: validation.issues.length,
        fixtureSupport: validation.fixtureSupport,
        schemaInstalled: validation.install?.executed === true
      }
    };
  } catch (error) {
    return {
      name: "erp_financials_canonical_schema",
      status: "blocked",
      message: error instanceof Error ? error.message : "Future ERP canonical schema preflight failed."
    };
  }
}

async function serviceAvailabilityCheck(
  client: FutureErpQuickBooksSandboxSyncWorkerClient,
  request: FutureErpQuickBooksSandboxSyncWorkerPreflightProbeRequest
): Promise<FutureErpQuickBooksSandboxSyncWorkerPreflightCheck> {
  if (client.serviceHealth !== undefined) {
    const serviceEnvironment = normalizedQuickBooksServiceEnvironment(
      request.sourceIdentity.handrailQuickBooksServiceEnvironment
    );
    const health = await client.serviceHealth({
      sourceIdentity: request.sourceIdentity,
      providerMode: request.sourceIdentity.providerEnvironment,
      ...(serviceEnvironment === undefined ? {} : { serviceEnvironment }),
      ...(request.requestedAt === undefined ? {} : { requestedAt: request.requestedAt })
    });
    assertNoCredentialKeys(health);
    const replayBlocked = request.mode === "sandbox_replay" && !health.capabilities.replay.available;
    if (health.status === "unavailable" || health.serviceAvailability === "unavailable" || replayBlocked) {
      return {
        name: "quickbooks_service_availability",
        status: "blocked",
        ...(health.message === undefined ? {} : { message: health.message }),
        metadata: quickBooksServiceHealthMetadata(health)
      };
    }

    return {
      name: "quickbooks_service_availability",
      status: health.status === "degraded" ? "blocked" : "ready",
      ...(health.message === undefined ? {} : { message: health.message }),
      metadata: quickBooksServiceHealthMetadata(health)
    };
  }

  if (client.preflight === undefined) {
    return {
      name: "quickbooks_service_availability",
      status: "skipped",
      message: "The Handrail QuickBooks SDK/service client does not expose an availability probe."
    };
  }

  const probe = await client.preflight(request);
  assertNoCredentialKeys(probe);
  const replayBlocked = request.mode === "sandbox_replay" && probe.replayAvailable === false;
  if (!probe.connected || replayBlocked) {
    return {
      name: "quickbooks_service_availability",
      status: "blocked",
      ...(probe.message === undefined ? {} : { message: probe.message }),
      ...(probe.metadata === undefined ? {} : { metadata: probe.metadata })
    };
  }

  return {
    name: "quickbooks_service_availability",
    status: "ready",
    ...(probe.message === undefined ? {} : { message: probe.message }),
    ...(probe.metadata === undefined ? {} : { metadata: probe.metadata })
  };
}

function quickBooksServiceHealthMetadata(
  health: NormalizedQuickBooksServiceHealthProbeResponseEnvelope
): Readonly<Record<string, string | number | boolean>> {
  return {
    serviceAvailability: health.serviceAvailability,
    providerMode: health.providerMode,
    sandboxAvailable: health.capabilities.sandbox.available,
    replayAvailable: health.capabilities.replay.available,
    fullSyncAvailable: health.capabilities.fullSync.available,
    incrementalSyncAvailable: health.capabilities.incrementalSync.available,
    providerReportsAvailable: health.capabilities.providerReports.available,
    checkpointStatus: health.checkpoint.status,
    ...(health.checkpoint.checkpointId === undefined ? {} : { checkpointId: health.checkpoint.checkpointId }),
    ...(health.checkpoint.sourceFreshThrough === undefined ? {} : { sourceFreshThrough: health.checkpoint.sourceFreshThrough }),
    ...(health.checkpoint.importedThrough === undefined ? {} : { importedThrough: health.checkpoint.importedThrough }),
    ...(health.checkpoint.latestSourceUpdatedAt === undefined ? {} : { latestSourceUpdatedAt: health.checkpoint.latestSourceUpdatedAt })
  };
}

function normalizedQuickBooksServiceEnvironment(
  value: string
): NormalizedQuickBooksServiceHealthProbeRequest["serviceEnvironment"] | undefined {
  return value === "local" || value === "dev" || value === "staging" || value === "production" ? value : undefined;
}

function ownerEvidenceStatus(
  result: FutureErpQuickBooksSandboxSyncWorkerRunResult
): FutureErpQuickBooksSandboxSyncOwnerEvidenceStatus {
  if (result.preflight.status === "blocked") {
    return "blocked";
  }

  const reportStatuses = result.reports === undefined ? [] : Object.values(result.reports.reportStatuses);
  if (reportStatuses.some((status) => status === "partial" || status === "unsupported")) {
    return "degraded";
  }

  const parityStatuses = result.replay === undefined ? [] : Object.values(result.replay.parityStatuses);
  if (parityStatuses.some((status) => status === "partial" || status === "unavailable")) {
    return "degraded";
  }

  return "passed";
}

class RecordingSandboxPostgresClient implements PostgresQueryClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(): Promise<PostgresQueryResult<Row>> {
    return Promise.resolve({
      rows: [],
      rowCount: null
    });
  }
}

function assertSandboxWorkerResultContainsNoDisallowedKeys(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertSandboxWorkerResultContainsNoDisallowedKeys(entry, `${path}[${String(index)}]`);
    });
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/access[_-]?token|refresh[_-]?token|client[_-]?secret|clientSecret|credential|rawPayload|rawProviderPayload/i.test(key)) {
        throw new Error(`sandbox sync worker result contains a disallowed field at ${path}.${key}`);
      }
      assertSandboxWorkerResultContainsNoDisallowedKeys(entry, `${path}.${key}`);
    }
  }
}
