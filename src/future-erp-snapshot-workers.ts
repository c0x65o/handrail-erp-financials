import { assertNoCredentialKeys } from "./canonical-model.js";
import type { CompanyId, SourceId, TenantId } from "./canonical-model.js";
import { createPostgresStorageAdapter } from "./postgres-storage.js";
import type { PostgresQueryClient, PostgresStorageAdapter, ReportFreshnessRow } from "./postgres-storage.js";
import { executeSnapshotRefresh, reconcileReportFreshness } from "./rollup-jobs.js";
import type {
  FreshnessReconcileInput,
  SnapshotRefreshCashFlowOptions,
  SnapshotRefreshRequest,
  SnapshotRefreshResult
} from "./rollup-jobs.js";

export type FutureErpSnapshotWorkerScope = {
  readonly tenantId: TenantId;
  readonly companyId: CompanyId;
  readonly sourceId: SourceId;
};

export type FutureErpSnapshotRefreshWorkerStorage = Pick<
  PostgresStorageAdapter,
  "loadLatestReportSnapshot" | "loadReportBuilderInput" | "writeReportSnapshot" | "writeFreshnessRows"
>;

export type FutureErpSnapshotRefreshAndFreshnessWorkerOptions = {
  readonly scope: FutureErpSnapshotWorkerScope;
  readonly storage?: FutureErpSnapshotRefreshWorkerStorage;
  readonly postgresClient?: PostgresQueryClient;
};

export type FutureErpStaleSnapshotRefreshWorkerRequest = Omit<
  SnapshotRefreshRequest,
  "tenantId" | "companyId" | "sourceId" | "storage"
> & {
  readonly cashFlow?: SnapshotRefreshCashFlowOptions;
};

export type FutureErpFreshnessReconciliationWorkerRequest = Omit<
  FreshnessReconcileInput,
  "tenantId" | "companyId" | "sourceId"
>;

export type FutureErpFreshnessReconciliationWorkerResult = {
  readonly freshnessRow: ReportFreshnessRow;
  readonly freshnessRowsWritten: number;
};

export type FutureErpSnapshotRefreshAndFreshnessWorker = {
  runStaleSnapshotRefresh(request: FutureErpStaleSnapshotRefreshWorkerRequest): Promise<SnapshotRefreshResult>;
  runFreshnessReconciliation(
    request: FutureErpFreshnessReconciliationWorkerRequest
  ): Promise<FutureErpFreshnessReconciliationWorkerResult>;
};

export function createFutureErpSnapshotRefreshAndFreshnessWorker(
  options: FutureErpSnapshotRefreshAndFreshnessWorkerOptions
): FutureErpSnapshotRefreshAndFreshnessWorker {
  const storage = resolveFutureErpSnapshotWorkerStorage(options);

  return {
    async runStaleSnapshotRefresh(request) {
      assertNoCredentialKeys(request);
      const result = await executeSnapshotRefresh({
        ...request,
        tenantId: options.scope.tenantId,
        companyId: options.scope.companyId,
        sourceId: options.scope.sourceId,
        storage
      });

      assertSnapshotRefreshResultMatchesScope(options.scope, result);
      assertNoCredentialKeys(result.freshnessRow);
      assertNoCredentialKeys(result.cashFlow);
      assertNoCredentialKeys(result.writeResults);

      return result;
    },

    async runFreshnessReconciliation(request) {
      assertNoCredentialKeys(request);
      const freshnessRow = reconcileReportFreshness({
        ...request,
        tenantId: options.scope.tenantId,
        companyId: options.scope.companyId,
        sourceId: options.scope.sourceId
      });
      const freshnessRowsWritten = await storage.writeFreshnessRows([freshnessRow]);
      const result = {
        freshnessRow,
        freshnessRowsWritten
      };

      assertNoCredentialKeys(result);

      return result;
    }
  };
}

function resolveFutureErpSnapshotWorkerStorage(
  options: FutureErpSnapshotRefreshAndFreshnessWorkerOptions
): FutureErpSnapshotRefreshWorkerStorage {
  if (options.storage !== undefined) {
    return options.storage;
  }
  if (options.postgresClient !== undefined) {
    return createPostgresStorageAdapter(options.postgresClient);
  }

  throw new Error("Future ERP snapshot worker requires storage or postgresClient");
}

function assertSnapshotRefreshResultMatchesScope(
  scope: FutureErpSnapshotWorkerScope,
  result: SnapshotRefreshResult
): void {
  if (result.snapshot.snapshot.tenantId !== scope.tenantId) {
    throw new Error("Future ERP snapshot refresh worker received a snapshot outside its tenant scope");
  }
  for (const line of result.snapshot.lines) {
    if (line.tenantId !== scope.tenantId) {
      throw new Error("Future ERP snapshot refresh worker received a snapshot line outside its tenant scope");
    }
  }
  for (const total of result.snapshot.totals) {
    if (total.tenantId !== scope.tenantId) {
      throw new Error("Future ERP snapshot refresh worker received a snapshot total outside its tenant scope");
    }
  }
  if (
    result.freshnessRow.tenantId !== scope.tenantId ||
    result.freshnessRow.companyId !== scope.companyId ||
    result.freshnessRow.sourceId !== scope.sourceId
  ) {
    throw new Error("Future ERP snapshot refresh worker produced freshness outside its tenant/source scope");
  }
}
