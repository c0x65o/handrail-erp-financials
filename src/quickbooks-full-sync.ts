import { assertNoCredentialKeys } from "./canonical-model.js";
import type { AccountingBasis, ImportBatchStatus, IsoCurrencyCode, IsoDateTime } from "./canonical-model.js";
import { persistCanonicalFacts } from "./canonical-fact-persistence.js";
import type {
  CanonicalFactPersistenceResult,
  CanonicalFactPersistenceStorage,
  CanonicalFactPersistenceWorker
} from "./canonical-fact-persistence.js";
import type {
  DeleteLedgerFactsOutsideImportBatchResult,
  PostgresStorageAdapter
} from "./postgres-storage.js";
import { buildCoreErpPersistenceEvidence } from "./core-erp-persistence-evidence.js";
import type { CoreErpPersistenceEvidence } from "./core-erp-persistence-evidence.js";
import { adaptNormalizedQuickBooksResourceSetToAdapterInput } from "./quickbooks-contract-smoke.js";
import type { HandrailQuickBooksFullSyncServiceHandler } from "./quickbooks-sync-service.js";
import { mapHandrailQuickBooksSdkResourcesToCanonicalFacts } from "./source-adapters.js";
import type { CanonicalAccountingFactSet, HandrailQuickBooksSdkResourcesAdapterInput } from "./source-adapters.js";
import type {
  NormalizedQuickBooksFullSyncRequestEnvelope,
  NormalizedQuickBooksFullSyncResponseEnvelope,
  NormalizedQuickBooksResourceSet
} from "./normalized-accounting-contracts.js";

export type QuickBooksFullSyncClient = Pick<HandrailQuickBooksFullSyncServiceHandler, "fullSync">;

export type QuickBooksFullSyncPersistence = CanonicalFactPersistenceWorker | CanonicalFactPersistenceStorage;

export type QuickBooksFullSyncContextOptions = {
  readonly companyId: string;
  readonly accountingBasis?: AccountingBasis;
  readonly currencyCode?: IsoCurrencyCode;
  readonly importedAt?: IsoDateTime;
  readonly handrailQuickBooksServiceEnvironment?: "staging" | "production";
};

export type QuickBooksFullSyncWorkerOptions = QuickBooksFullSyncContextOptions & {
  readonly quickBooksClient: QuickBooksFullSyncClient;
  readonly persistence: QuickBooksFullSyncPersistence;
  /**
   * When true, a successful full sync deletes ledger facts (postings and
   * orphaned transactions/lines) for the tenant/source that were not written
   * by this import batch, making the full sync authoritative for the ledger.
   * This removes postings from provider transactions deleted since the last
   * sync and leftovers from a previous posting source (for example, locally
   * derived postings after switching to provider general ledger ingestion).
   * Requires persistence storage with deleteLedgerFactsOutsideImportBatch.
   */
  readonly replaceLedgerFactsOnFullSync?: boolean;
};

export type QuickBooksFullSyncMapOptions = QuickBooksFullSyncContextOptions;

export type QuickBooksFullSyncMapResult = {
  readonly adapterInput: HandrailQuickBooksSdkResourcesAdapterInput;
  readonly facts: CanonicalAccountingFactSet;
};

export type QuickBooksFullSyncRunResult = QuickBooksFullSyncMapResult & {
  readonly response: NormalizedQuickBooksFullSyncResponseEnvelope;
  readonly persistence: CanonicalFactPersistenceResult;
  readonly evidence: CoreErpPersistenceEvidence;
  readonly removedLedgerFacts?: DeleteLedgerFactsOutsideImportBatchResult;
};

export type QuickBooksFullSyncWorker = {
  fullSync(request: NormalizedQuickBooksFullSyncRequestEnvelope): Promise<QuickBooksFullSyncRunResult>;
};

export function createQuickBooksFullSyncWorker(options: QuickBooksFullSyncWorkerOptions): QuickBooksFullSyncWorker {
  return {
    async fullSync(request) {
      assertNoCredentialKeys(request);
      const response = await options.quickBooksClient.fullSync(request);
      const mapped = mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts(response, options);
      const persistence = await persistQuickBooksFullSyncFacts(options.persistence, mapped.facts);
      const removedLedgerFacts =
        options.replaceLedgerFactsOnFullSync === true
          ? await replaceLedgerFactsOutsideImportBatch(options.persistence, persistence)
          : undefined;

      return {
        response,
        ...mapped,
        persistence,
        evidence: buildCoreErpPersistenceEvidence({
          facts: mapped.facts,
          persistence,
          generatedAt: mapped.adapterInput.context.importedAt
        }),
        ...(removedLedgerFacts === undefined ? {} : { removedLedgerFacts })
      };
    }
  };
}

function replaceLedgerFactsOutsideImportBatch(
  persistence: QuickBooksFullSyncPersistence,
  persisted: CanonicalFactPersistenceResult
): Promise<DeleteLedgerFactsOutsideImportBatchResult> {
  const candidate = persistence as Partial<
    Pick<PostgresStorageAdapter, "deleteLedgerFactsOutsideImportBatch">
  >;

  if (typeof candidate.deleteLedgerFactsOutsideImportBatch !== "function") {
    throw new Error(
      "replaceLedgerFactsOnFullSync requires persistence storage that implements deleteLedgerFactsOutsideImportBatch"
    );
  }

  return candidate.deleteLedgerFactsOutsideImportBatch({
    tenantId: persisted.tenantId,
    sourceId: persisted.sourceId,
    importBatchId: persisted.importBatchId
  });
}

export function mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts(
  response: NormalizedQuickBooksFullSyncResponseEnvelope,
  options: QuickBooksFullSyncMapOptions
): QuickBooksFullSyncMapResult {
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
  persistence: QuickBooksFullSyncPersistence,
  facts: CanonicalAccountingFactSet
): Promise<CanonicalFactPersistenceResult> {
  if ("persist" in persistence) {
    return persistence.persist(facts);
  }
  return persistCanonicalFacts(persistence, facts);
}
