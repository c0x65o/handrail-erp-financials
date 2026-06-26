import { assertNoCredentialKeys } from "./canonical-model.js";
import type { AccountingBasis, ImportBatchStatus, IsoCurrencyCode, IsoDateTime, SyncCheckpointId } from "./canonical-model.js";
import { persistCanonicalFacts } from "./canonical-fact-persistence.js";
import type {
  CanonicalFactPersistenceResult,
  CanonicalFactPersistenceStorage,
  CanonicalFactPersistenceWorker
} from "./canonical-fact-persistence.js";
import { buildCoreErpPersistenceEvidence } from "./core-erp-persistence-evidence.js";
import type { CoreErpPersistenceEvidence } from "./core-erp-persistence-evidence.js";
import { adaptNormalizedQuickBooksResourceSetToAdapterInput } from "./quickbooks-contract-smoke.js";
import type { HandrailQuickBooksFullSyncServiceHandler, HandrailQuickBooksIncrementalSyncRequest } from "./quickbooks-sync-service.js";
import { mapHandrailQuickBooksSdkResourcesToCanonicalFacts } from "./source-adapters.js";
import type { CanonicalAccountingFactSet, HandrailQuickBooksSdkResourcesAdapterInput } from "./source-adapters.js";
import type {
  NormalizedAccountingSyncResourceAction,
  NormalizedQuickBooksAccountResource,
  NormalizedQuickBooksCompanyInfoResource,
  NormalizedQuickBooksIncrementalSyncResponseEnvelope,
  NormalizedQuickBooksResourceEnvelope,
  NormalizedQuickBooksResourceSet,
  NormalizedQuickBooksSyncResourceSet
} from "./normalized-accounting-contracts.js";

export type QuickBooksIncrementalSyncClient = Pick<HandrailQuickBooksFullSyncServiceHandler, "incrementalSync">;

export type QuickBooksIncrementalSyncPersistence = CanonicalFactPersistenceWorker | CanonicalFactPersistenceStorage;

export type QuickBooksIncrementalSyncContextOptions = {
  readonly companyId: string;
  readonly accountingBasis?: AccountingBasis;
  readonly currencyCode?: IsoCurrencyCode;
  readonly importedAt?: IsoDateTime;
  readonly handrailQuickBooksServiceEnvironment?: "staging" | "production";
};

export type QuickBooksIncrementalSyncWorkerOptions = QuickBooksIncrementalSyncContextOptions & {
  readonly quickBooksClient: QuickBooksIncrementalSyncClient;
  readonly persistence: QuickBooksIncrementalSyncPersistence;
};

export type QuickBooksIncrementalSyncMapOptions = QuickBooksIncrementalSyncContextOptions;

export type QuickBooksChangedResourceAction = {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly action: NormalizedAccountingSyncResourceAction;
  readonly importBatchId?: string;
  readonly checkpointId?: string;
  readonly sourceUpdatedAt?: IsoDateTime;
};

export type QuickBooksIncrementalSyncMapResult = {
  readonly adapterInput: HandrailQuickBooksSdkResourcesAdapterInput;
  readonly facts: CanonicalAccountingFactSet;
  readonly resumeFromCheckpointId?: SyncCheckpointId;
  readonly changedResourceActions: readonly QuickBooksChangedResourceAction[];
};

export type QuickBooksIncrementalSyncRunResult = QuickBooksIncrementalSyncMapResult & {
  readonly response: NormalizedQuickBooksIncrementalSyncResponseEnvelope;
  readonly persistence: CanonicalFactPersistenceResult;
  readonly evidence: CoreErpPersistenceEvidence;
};

export type QuickBooksIncrementalSyncWorker = {
  incrementalSync(request: HandrailQuickBooksIncrementalSyncRequest): Promise<QuickBooksIncrementalSyncRunResult>;
};

export function createQuickBooksIncrementalSyncWorker(
  options: QuickBooksIncrementalSyncWorkerOptions
): QuickBooksIncrementalSyncWorker {
  return {
    async incrementalSync(request) {
      assertNoCredentialKeys(request);
      const response = await options.quickBooksClient.incrementalSync(request);
      const resumeFromCheckpointId = "resumeFromCheckpointId" in request ? request.resumeFromCheckpointId : undefined;
      const mapped = mapNormalizedQuickBooksIncrementalSyncResponseToCanonicalFacts(response, {
        ...options,
        ...(resumeFromCheckpointId === undefined ? {} : { resumeFromCheckpointId })
      });
      const persistence = await persistQuickBooksIncrementalSyncFacts(options.persistence, mapped.facts);

      return {
        response,
        ...mapped,
        persistence,
        evidence: buildCoreErpPersistenceEvidence({
          facts: mapped.facts,
          persistence,
          generatedAt: mapped.adapterInput.context.importedAt,
          ...(mapped.resumeFromCheckpointId === undefined ? {} : { resumeFromCheckpointId: mapped.resumeFromCheckpointId }),
          changedResourceActions: mapped.changedResourceActions
        })
      };
    }
  };
}

export function mapNormalizedQuickBooksIncrementalSyncResponseToCanonicalFacts(
  response: NormalizedQuickBooksIncrementalSyncResponseEnvelope,
  options: QuickBooksIncrementalSyncMapOptions & { readonly resumeFromCheckpointId?: SyncCheckpointId }
): QuickBooksIncrementalSyncMapResult {
  assertNoCredentialKeys(response);
  const resources = incrementalSyncResourcesWithEnvelopeMetadata(response);
  const originalAccountSourceIds = new Set((response.resources.accounts ?? []).map((resource) => resource.resource.sourceAccountId));
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
  const facts = applyIncrementalSyncEnvelopeMetadataToFacts(
    response,
    {
      ...mappedFacts,
      accounts: mappedFacts.accounts.filter((account) => originalAccountSourceIds.has(account.sourceAccountId))
    },
    importedAt
  );

  return {
    adapterInput,
    facts,
    ...(options.resumeFromCheckpointId === undefined ? {} : { resumeFromCheckpointId: options.resumeFromCheckpointId }),
    changedResourceActions: collectChangedResourceActions(response.resources)
  };
}

function incrementalSyncResourcesWithEnvelopeMetadata(
  response: NormalizedQuickBooksIncrementalSyncResponseEnvelope
): NormalizedQuickBooksResourceSet {
  const companyInfo = response.resources.companyInfo ?? syntheticCompanyInfoResource(response);
  const accounts = ensureReferencedAccounts(response.resources.accounts ?? [], response.resources);

  return {
    ...response.resources,
    identity: response.sourceIdentity,
    ...(response.importBatch === undefined && response.resources.importBatch === undefined
      ? {}
      : { importBatch: response.importBatch ?? response.resources.importBatch }),
    ...(response.checkpoint === undefined && response.resources.checkpoint === undefined
      ? {}
      : { checkpoint: response.checkpoint ?? response.resources.checkpoint }),
    companyInfo,
    accounts
  };
}

function applyIncrementalSyncEnvelopeMetadataToFacts(
  response: NormalizedQuickBooksIncrementalSyncResponseEnvelope,
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
      mode: response.importBatch?.mode ?? "delta",
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
      sourceObject: response.checkpoint?.sourceObject ?? "quickbooks_cdc",
      cursorKind: response.cursorKind,
      cursorValue: response.cursorValue,
      ...(response.freshThrough === undefined ? {} : { freshThrough: response.freshThrough }),
      ...(response.latestSourceUpdatedAt === undefined ? {} : { latestSourceUpdatedAt: response.latestSourceUpdatedAt }),
      status: response.checkpoint?.status ?? "current"
    }
  };
}

function syntheticCompanyInfoResource(
  response: NormalizedQuickBooksIncrementalSyncResponseEnvelope
): NormalizedQuickBooksCompanyInfoResource {
  return {
    sourceSystem: "quickbooks",
    tenantId: response.sourceIdentity.tenantId,
    sourceId: response.sourceIdentity.sourceId,
    providerEnvironment: response.sourceIdentity.providerEnvironment,
    realmId: response.sourceIdentity.realmId,
    resourceType: "CompanyInfo",
    resourceId: response.sourceIdentity.realmId,
    importBatchId: response.importBatchId,
    checkpointId: response.checkpointId,
    resource: {
      companyName: response.sourceIdentity.realmId,
      legalName: response.sourceIdentity.realmId
    }
  };
}

function ensureReferencedAccounts(
  accounts: readonly NormalizedQuickBooksAccountResource[],
  resources: NormalizedQuickBooksSyncResourceSet
): readonly NormalizedQuickBooksAccountResource[] {
  const accountBySourceId = new Map(accounts.map((account) => [account.resource.sourceAccountId, account]));
  for (const ref of collectReferencedAccountRefs(resources)) {
    if (!accountBySourceId.has(ref.sourceObjectId)) {
      accountBySourceId.set(ref.sourceObjectId, syntheticAccountResource(ref, resources));
    }
  }

  return [...accountBySourceId.values()];
}

function syntheticAccountResource(
  ref: { readonly sourceObjectId: string; readonly displayName?: string },
  resources: NormalizedQuickBooksSyncResourceSet
): NormalizedQuickBooksAccountResource {
  return {
    sourceSystem: "quickbooks",
    tenantId: resources.identity.tenantId,
    sourceId: resources.identity.sourceId,
    providerEnvironment: resources.identity.providerEnvironment,
    realmId: resources.identity.realmId,
    resourceType: "Account",
    resourceId: ref.sourceObjectId,
    ...(resources.importBatch?.importBatchId === undefined ? {} : { importBatchId: resources.importBatch.importBatchId }),
    ...(resources.checkpoint?.checkpointId === undefined ? {} : { checkpointId: resources.checkpoint.checkpointId }),
    resource: {
      sourceAccountId: ref.sourceObjectId,
      name: ref.displayName ?? ref.sourceObjectId,
      accountType: "Other Expense",
      classification: "expense",
      active: true
    }
  };
}

function collectReferencedAccountRefs(
  resources: NormalizedQuickBooksSyncResourceSet
): readonly { readonly sourceObjectId: string; readonly displayName?: string }[] {
  const refs = new Map<string, { readonly sourceObjectId: string; readonly displayName?: string }>();
  const addRef = (ref: { readonly sourceObjectId: string; readonly displayName?: string } | undefined) => {
    if (ref !== undefined && !refs.has(ref.sourceObjectId)) {
      refs.set(ref.sourceObjectId, ref);
    }
  };

  for (const resource of resources.journalEntries ?? []) {
    for (const line of resource.resource.lines) {
      for (const posting of line.postings) {
        addRef(posting.accountRef);
      }
      addRef(line.accountRef);
    }
  }
  for (const resource of resources.ledgerTransactions ?? []) {
    for (const line of resource.resource.lines) {
      for (const posting of line.postings) {
        addRef(posting.accountRef);
      }
      addRef(line.accountRef);
    }
  }
  for (const resource of resources.ledgerPostings ?? []) {
    addRef(resource.resource.accountRef);
  }

  return [...refs.values()];
}

function collectChangedResourceActions(
  resources: NormalizedQuickBooksSyncResourceSet
): readonly QuickBooksChangedResourceAction[] {
  return allIncrementalResourceEnvelopes(resources).flatMap((resource) => {
    if (resource.syncAction === undefined) {
      return [];
    }

    return [
      {
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        action: resource.syncAction,
        ...(resource.importBatchId === undefined ? {} : { importBatchId: resource.importBatchId }),
        ...(resource.checkpointId === undefined ? {} : { checkpointId: resource.checkpointId }),
        ...(resource.sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt: resource.sourceUpdatedAt })
      }
    ];
  });
}

function allIncrementalResourceEnvelopes(
  resources: NormalizedQuickBooksSyncResourceSet
): readonly NormalizedQuickBooksResourceEnvelope<string, unknown>[] {
  return [
    ...(resources.companyInfo === undefined ? [] : [resources.companyInfo]),
    ...(resources.accounts ?? []),
    ...(resources.journalEntries ?? []),
    ...(resources.ledgerTransactions ?? []),
    ...(resources.ledgerPostings ?? []),
    ...(resources.parties ?? []),
    ...(resources.customers ?? []),
    ...(resources.vendors ?? []),
    ...(resources.items ?? []),
    ...(resources.classes ?? []),
    ...(resources.departments ?? []),
    ...(resources.dimensions ?? [])
  ];
}

function persistQuickBooksIncrementalSyncFacts(
  persistence: QuickBooksIncrementalSyncPersistence,
  facts: CanonicalAccountingFactSet
): Promise<CanonicalFactPersistenceResult> {
  if ("persist" in persistence) {
    return persistence.persist(facts);
  }
  return persistCanonicalFacts(persistence, facts);
}
