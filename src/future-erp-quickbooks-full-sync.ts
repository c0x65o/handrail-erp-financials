import { assertNoCredentialKeys } from "./canonical-model.js";
import type { AccountingBasis, ImportBatchStatus, IsoCurrencyCode, IsoDateTime } from "./canonical-model.js";
import { persistFutureErpCanonicalFacts } from "./future-erp-persistence.js";
import type {
  FutureErpCanonicalFactPersistenceResult,
  FutureErpCanonicalFactPersistenceStorage,
  FutureErpCanonicalFactPersistenceWorker
} from "./future-erp-persistence.js";
import { adaptNormalizedQuickBooksResourceSetToAdapterInput } from "./quickbooks-contract-smoke.js";
import type { HandrailQuickBooksFullSyncServiceHandler } from "./quickbooks-sync-service.js";
import { mapHandrailQuickBooksSdkResourcesToCanonicalFacts } from "./source-adapters.js";
import type { CanonicalAccountingFactSet, HandrailQuickBooksSdkResourcesAdapterInput } from "./source-adapters.js";
import type {
  NormalizedQuickBooksFullSyncRequestEnvelope,
  NormalizedQuickBooksFullSyncResponseEnvelope,
  NormalizedQuickBooksResourceSet
} from "./normalized-accounting-contracts.js";

export type FutureErpQuickBooksFullSyncClient = Pick<HandrailQuickBooksFullSyncServiceHandler, "fullSync">;

export type FutureErpQuickBooksFullSyncPersistence =
  | FutureErpCanonicalFactPersistenceWorker
  | FutureErpCanonicalFactPersistenceStorage;

export type FutureErpQuickBooksFullSyncContextOptions = {
  readonly companyId: string;
  readonly accountingBasis?: AccountingBasis;
  readonly currencyCode?: IsoCurrencyCode;
  readonly importedAt?: IsoDateTime;
  readonly handrailQuickBooksServiceEnvironment?: "staging" | "production";
};

export type FutureErpQuickBooksFullSyncWorkerOptions = FutureErpQuickBooksFullSyncContextOptions & {
  readonly quickBooksClient: FutureErpQuickBooksFullSyncClient;
  readonly persistence: FutureErpQuickBooksFullSyncPersistence;
};

export type FutureErpQuickBooksFullSyncMapOptions = FutureErpQuickBooksFullSyncContextOptions;

export type FutureErpQuickBooksFullSyncMapResult = {
  readonly adapterInput: HandrailQuickBooksSdkResourcesAdapterInput;
  readonly facts: CanonicalAccountingFactSet;
};

export type FutureErpQuickBooksFullSyncRunResult = FutureErpQuickBooksFullSyncMapResult & {
  readonly response: NormalizedQuickBooksFullSyncResponseEnvelope;
  readonly persistence: FutureErpCanonicalFactPersistenceResult;
};

export type FutureErpQuickBooksFullSyncWorker = {
  fullSync(request: NormalizedQuickBooksFullSyncRequestEnvelope): Promise<FutureErpQuickBooksFullSyncRunResult>;
};

export function createFutureErpQuickBooksFullSyncWorker(
  options: FutureErpQuickBooksFullSyncWorkerOptions
): FutureErpQuickBooksFullSyncWorker {
  return {
    async fullSync(request) {
      assertNoCredentialKeys(request);
      const response = await options.quickBooksClient.fullSync(request);
      const mapped = mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts(response, options);
      const persistence = await persistQuickBooksFullSyncFacts(options.persistence, mapped.facts);

      return {
        response,
        ...mapped,
        persistence
      };
    }
  };
}

export function mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts(
  response: NormalizedQuickBooksFullSyncResponseEnvelope,
  options: FutureErpQuickBooksFullSyncMapOptions
): FutureErpQuickBooksFullSyncMapResult {
  assertNoCredentialKeys(response);
  const resources = fullSyncResourcesWithEnvelopeMetadata(response);
  const baseAdapterInput = adaptNormalizedQuickBooksResourceSetToAdapterInput(resources, {
    ...(options.accountingBasis === undefined ? {} : { accountingBasis: options.accountingBasis }),
    ...(options.currencyCode === undefined ? {} : { currencyCode: options.currencyCode })
  });
  const importedAt =
    options.importedAt ??
    response.completedAt ??
    response.importBatch?.completedAt ??
    response.importBatch?.startedAt ??
    baseAdapterInput.context.importedAt;
  const adapterInput: HandrailQuickBooksSdkResourcesAdapterInput = {
    ...baseAdapterInput,
    context: {
      ...baseAdapterInput.context,
      companyId: options.companyId,
      importBatchId: response.importBatchId,
      checkpointId: response.checkpointId,
      importedAt,
      ...(response.freshThrough === undefined ? {} : { freshThrough: response.freshThrough }),
      ...(response.latestSourceUpdatedAt === undefined ? {} : { latestSourceUpdatedAt: response.latestSourceUpdatedAt }),
      runtimeConfig: {
        serviceEnvironment: options.handrailQuickBooksServiceEnvironment ?? "staging",
        providerMode: response.sourceIdentity.providerEnvironment,
        tenantId: response.sourceIdentity.tenantId
      }
    }
  };
  const mappedFacts = mapHandrailQuickBooksSdkResourcesToCanonicalFacts(adapterInput);
  const facts = applyFullSyncEnvelopeMetadataToFacts(response, mappedFacts, importedAt);

  return {
    adapterInput,
    facts
  };
}

function fullSyncResourcesWithEnvelopeMetadata(
  response: NormalizedQuickBooksFullSyncResponseEnvelope
): NormalizedQuickBooksResourceSet {
  return {
    ...response.resources,
    identity: response.sourceIdentity,
    ...(response.importBatch === undefined && response.resources.importBatch === undefined
      ? {}
      : { importBatch: response.importBatch ?? response.resources.importBatch }),
    ...(response.checkpoint === undefined && response.resources.checkpoint === undefined
      ? {}
      : { checkpoint: response.checkpoint ?? response.resources.checkpoint })
  };
}

function applyFullSyncEnvelopeMetadataToFacts(
  response: NormalizedQuickBooksFullSyncResponseEnvelope,
  facts: CanonicalAccountingFactSet,
  importedAt: IsoDateTime
): CanonicalAccountingFactSet {
  const importBatchStatus: ImportBatchStatus =
    response.importBatch?.status ?? (response.status === "accepted" ? "running" : response.status);

  return {
    ...facts,
    source: {
      ...facts.source,
      importBatchId: response.importBatchId,
      checkpointId: response.checkpointId,
      latestSyncedAt: importedAt
    },
    importBatch: {
      tenantId: facts.company.tenantId,
      sourceId: facts.source.sourceId,
      importBatchId: response.importBatchId,
      mode: response.importBatch?.mode ?? "initial",
      status: importBatchStatus,
      startedAt: response.importBatch?.startedAt ?? importedAt,
      ...(response.importBatch?.completedAt === undefined ? {} : { completedAt: response.importBatch.completedAt }),
      sourceObjectCounts: response.importBatch?.sourceObjectCounts ?? response.resourceCounts,
      ...(response.importBatch?.warningSummary === undefined && response.warningSummary === undefined
        ? {}
        : { warningSummary: response.importBatch?.warningSummary ?? response.warningSummary }),
      ...(response.importBatch?.errorSummary === undefined && response.errorSummary === undefined
        ? {}
        : { errorSummary: response.importBatch?.errorSummary ?? response.errorSummary })
    },
    checkpoint: {
      tenantId: facts.company.tenantId,
      sourceId: facts.source.sourceId,
      checkpointId: response.checkpointId,
      sourceObject: response.checkpoint?.sourceObject ?? "quickbooks_full_sync",
      cursorKind: response.cursorKind,
      cursorValue: response.cursorValue,
      ...(response.freshThrough === undefined ? {} : { freshThrough: response.freshThrough }),
      ...(response.latestSourceUpdatedAt === undefined ? {} : { latestSourceUpdatedAt: response.latestSourceUpdatedAt }),
      status: response.checkpoint?.status ?? "current"
    }
  };
}

function persistQuickBooksFullSyncFacts(
  persistence: FutureErpQuickBooksFullSyncPersistence,
  facts: CanonicalAccountingFactSet
): Promise<FutureErpCanonicalFactPersistenceResult> {
  if ("persist" in persistence) {
    return persistence.persist(facts);
  }
  return persistFutureErpCanonicalFacts(persistence, facts);
}
