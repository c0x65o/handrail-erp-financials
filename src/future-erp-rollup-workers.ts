import { assertNoCredentialKeys } from "./canonical-model.js";
import type {
  CompanyId,
  LedgerPosting,
  SourceId,
  TenantId
} from "./canonical-model.js";
import { createPostgresStorageAdapter } from "./postgres-storage.js";
import type { PostgresQueryClient, PostgresStorageAdapter, ReportFreshnessRow } from "./postgres-storage.js";
import {
  buildScheduledRollupJobResult,
  executeLateArrivalReprocess,
  reconcileReportFreshness
} from "./rollup-jobs.js";
import type {
  FreshnessReconcileInput,
  LateArrivalReprocessCanonicalPostingReader,
  LateArrivalReprocessExecutionResult,
  LateArrivalReprocessExecuteInput,
  ScheduledRollupCanonicalPostingReader,
  ScheduledRollupJobRequest,
  ScheduledRollupJobResult
} from "./rollup-jobs.js";

export type FutureErpWorkerScope = {
  readonly tenantId: TenantId;
  readonly companyId: CompanyId;
  readonly sourceId: SourceId;
};

export type FutureErpRollupWorkerPostingReader = ScheduledRollupCanonicalPostingReader &
  LateArrivalReprocessCanonicalPostingReader;

export type FutureErpRollupWorkerStorage = Pick<
  PostgresStorageAdapter,
  "writeRollupBuckets" | "replaceRollupBucketsForWindows" | "markReportSnapshotsStaleForPostingChanges" | "writeFreshnessRows"
>;

export type FutureErpRollupAndLateArrivalWorkerOptions = {
  readonly scope: FutureErpWorkerScope;
  readonly postingReader: FutureErpRollupWorkerPostingReader;
  readonly storage?: FutureErpRollupWorkerStorage;
  readonly postgresClient?: PostgresQueryClient;
};

export type FutureErpScheduledRollupWorkerRequest = Omit<
  ScheduledRollupJobRequest,
  "tenantId" | "companyId" | "sourceId" | "postings" | "postingReader"
> & {
  readonly freshnessReconciliations?: readonly Omit<FreshnessReconcileInput, "tenantId" | "companyId" | "sourceId">[];
};

export type FutureErpScheduledRollupWorkerResult = ScheduledRollupJobResult & {
  readonly rollupBucketsWritten: number;
  readonly freshnessRows: readonly ReportFreshnessRow[];
  readonly freshnessRowsWritten: number;
};

export type FutureErpLateArrivalWorkerRequest = Omit<
  LateArrivalReprocessExecuteInput,
  "tenantId" | "companyId" | "postings" | "postingReader" | "storage"
>;

export type FutureErpRollupAndLateArrivalWorker = {
  runScheduledRollup(request: FutureErpScheduledRollupWorkerRequest): Promise<FutureErpScheduledRollupWorkerResult>;
  runLateArrivalReprocess(request: FutureErpLateArrivalWorkerRequest): Promise<LateArrivalReprocessExecutionResult>;
};

export function createFutureErpRollupAndLateArrivalWorker(
  options: FutureErpRollupAndLateArrivalWorkerOptions
): FutureErpRollupAndLateArrivalWorker {
  const storage = resolveFutureErpRollupWorkerStorage(options);

  return {
    async runScheduledRollup(request) {
      assertNoCredentialKeys(request);
      const { freshnessReconciliations = [], ...rollupRequest } = request;
      const scopedRequest: ScheduledRollupJobRequest = {
        ...rollupRequest,
        tenantId: options.scope.tenantId,
        companyId: options.scope.companyId,
        sourceId: options.scope.sourceId,
        postingReader: options.postingReader
      };
      const rollup = await buildScheduledRollupJobResult(scopedRequest);
      const rollupBucketsWritten = await storage.writeRollupBuckets(rollup.buckets);
      const freshnessRows = buildScopedFreshnessRows(options.scope, freshnessReconciliations);
      const freshnessRowsWritten = freshnessRows.length === 0 ? 0 : await storage.writeFreshnessRows(freshnessRows);
      const result: FutureErpScheduledRollupWorkerResult = {
        ...rollup,
        rollupBucketsWritten,
        freshnessRows,
        freshnessRowsWritten
      };

      assertNoCredentialKeys(result);

      return result;
    },

    async runLateArrivalReprocess(request) {
      assertNoCredentialKeys(request);
      assertChangedPostingsMatchScope(options.scope, request.changedPostings);
      const result = await executeLateArrivalReprocess({
        ...request,
        tenantId: options.scope.tenantId,
        companyId: options.scope.companyId,
        postingReader: options.postingReader,
        storage
      });

      assertNoCredentialKeys(result);

      return result;
    }
  };
}

function resolveFutureErpRollupWorkerStorage(
  options: FutureErpRollupAndLateArrivalWorkerOptions
): FutureErpRollupWorkerStorage {
  if (options.storage !== undefined) {
    return options.storage;
  }
  if (options.postgresClient !== undefined) {
    return createPostgresStorageAdapter(options.postgresClient);
  }

  throw new Error("Future ERP rollup worker requires storage or postgresClient");
}

function buildScopedFreshnessRows(
  scope: FutureErpWorkerScope,
  inputs: readonly Omit<FreshnessReconcileInput, "tenantId" | "companyId" | "sourceId">[]
): readonly ReportFreshnessRow[] {
  return inputs.map((input) =>
    reconcileReportFreshness({
      ...input,
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      sourceId: scope.sourceId
    })
  );
}

function assertChangedPostingsMatchScope(scope: FutureErpWorkerScope, postings: readonly LedgerPosting[]): void {
  const outOfScopePosting = postings.find(
    (posting) =>
      posting.tenantId !== scope.tenantId || posting.sourceId !== scope.sourceId
  );

  if (outOfScopePosting !== undefined) {
    throw new Error("Future ERP late-arrival worker received a changed posting outside its tenant/source scope");
  }
}
