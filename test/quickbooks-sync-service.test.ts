import { describe, expect, it, vi } from "vitest";

import {
  buildQuickBooksServiceHealthProbeResponse,
  buildQuickBooksBalanceSheetReconciliationEvidence,
  buildQuickBooksProfitAndLossReconciliationEvidence,
  buildQuickBooksProviderReportReconciliationEvidence,
  buildQuickBooksTrialBalanceReconciliationEvidence,
  createHandrailQuickBooksFullSyncServiceHandler,
  createHandrailQuickBooksSyncClient,
  buildUnavailableQuickBooksProviderReportResponse,
  ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES,
  assertSafeSourcePayloadRef
} from "../src/index.js";
import type {
  HandrailQuickBooksFullSyncProvider,
  HandrailQuickBooksIncrementalSyncProvider,
  HandrailQuickBooksIncrementalSyncRequest,
  HandrailQuickBooksProviderReportProvider,
  HandrailQuickBooksServiceHealthProvider,
  NormalizedQuickBooksBalanceSheetReportRequestEnvelope,
  NormalizedQuickBooksCashFlowParityReportRequestEnvelope,
  NormalizedQuickBooksCanonicalReportTotal,
  NormalizedQuickBooksFullSyncRequestEnvelope,
  NormalizedQuickBooksIncrementalSyncRequestEnvelope,
  NormalizedQuickBooksLedgerPostingResource,
  NormalizedQuickBooksLedgerTransactionResource,
  NormalizedQuickBooksPartyResource,
  NormalizedQuickBooksProfitAndLossReportRequestEnvelope,
  NormalizedQuickBooksProviderReportName,
  NormalizedQuickBooksProviderReportRequestEnvelope,
  NormalizedQuickBooksProviderReportResult,
  NormalizedQuickBooksResourceSet,
  NormalizedQuickBooksServiceHealthProbeRequest,
  NormalizedQuickBooksSyncResourceSet,
  NormalizedQuickBooksTrialBalanceReportRequestEnvelope,
  SafeSourcePayloadRef
} from "../src/index.js";

const QUICKBOOKS_CUSTODY_BOUNDARY_LEAK_PATTERN =
  /access[_-]?token|refresh[_-]?token|client[_-]?secret|clientSecret|oauth|sealed[_-]?secret|sealedSecret|token[_-]?refresh|tokenRefresh|provider[_-]?client|providerClient|raw[_-]?imports?|rawImports?|rawPayload|rawProviderPayload/i;

describe("Handrail QuickBooks service health probe contract", () => {
  it("exposes a safe SDK serviceHealth method with provider mode, capabilities, source identity, and checkpoint status", async () => {
    const request = serviceHealthProbeRequest();
    let providerRequest: NormalizedQuickBooksServiceHealthProbeRequest | undefined;
    const loadServiceHealth: HandrailQuickBooksServiceHealthProvider = (input) => {
      providerRequest = input;
      return {
        status: "ready",
        serviceAvailability: "available",
        providerMode: "sandbox",
        serviceEnvironment: "staging",
        checkedAt: "2026-02-01T10:02:31.000Z",
        capabilities: {
          fullSync: healthCapability("ready", "Full sync is available."),
          incrementalSync: healthCapability("ready", "Incremental sync is available."),
          providerReports: healthCapability("ready", "Provider reports are available."),
          sandbox: healthCapability("ready", "Sandbox mode is available."),
          replay: healthCapability("ready", "Replay fixtures are available.")
        },
        checkpoint: {
          checkpointId: "checkpoint_full_qbo_1",
          status: "current",
          sourceObject: "quickbooks_full_sync",
          cursorKind: "full_scan",
          cursorValue: "full:realm_sync:2026-02-01T10:00:00.000Z",
          sourceFreshThrough: "2026-02-01T10:00:00.000Z",
          importedThrough: "2026-02-01T10:00:00.000Z",
          freshThrough: "2026-02-01T10:00:00.000Z",
          latestSourceUpdatedAt: "2026-02-01T09:59:59.000Z"
        }
      };
    };
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => normalizedFullSyncResources(),
        loadIncrementalSyncResources: () => normalizedIncrementalSyncResources(),
        loadProviderReport: providerReportFixture(),
        loadServiceHealth
      })
    );

    const response = await client.serviceHealth(request);

    expect(providerRequest).toBe(request);
    expect(response).toEqual({
      sourceIdentity: request.sourceIdentity,
      providerEnvironment: "sandbox",
      providerMode: "sandbox",
      serviceEnvironment: "staging",
      status: "ready",
      serviceAvailability: "available",
      capabilities: {
        fullSync: healthCapability("ready", "Full sync is available."),
        incrementalSync: healthCapability("ready", "Incremental sync is available."),
        providerReports: healthCapability("ready", "Provider reports are available."),
        sandbox: healthCapability("ready", "Sandbox mode is available."),
        replay: healthCapability("ready", "Replay fixtures are available.")
      },
      checkpoint: {
        checkpointId: "checkpoint_full_qbo_1",
        status: "current",
        sourceObject: "quickbooks_full_sync",
        cursorKind: "full_scan",
        cursorValue: "full:realm_sync:2026-02-01T10:00:00.000Z",
        sourceFreshThrough: "2026-02-01T10:00:00.000Z",
        importedThrough: "2026-02-01T10:00:00.000Z",
        freshThrough: "2026-02-01T10:00:00.000Z",
        latestSourceUpdatedAt: "2026-02-01T09:59:59.000Z"
      },
      requestedAt: "2026-02-01T10:02:30.000Z",
      checkedAt: "2026-02-01T10:02:31.000Z"
    });
    expect(JSON.stringify(response)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i);
  });

  it("covers deterministic ready, degraded, and unavailable fixture states", () => {
    const fixtures = ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.serviceHealth;

    expect(fixtures.ready.response.status).toBe("ready");
    expect(fixtures.ready.response.serviceAvailability).toBe("available");
    expect(fixtures.ready.response.capabilities.sandbox.available).toBe(true);
    expect(fixtures.ready.response.capabilities.replay.available).toBe(true);
    expect(fixtures.ready.response.checkpoint.status).toBe("current");

    expect(fixtures.degraded.response.status).toBe("degraded");
    expect(fixtures.degraded.response.serviceAvailability).toBe("degraded");
    expect(fixtures.degraded.response.capabilities.incrementalSync.status).toBe("degraded");
    expect(fixtures.degraded.response.checkpoint.status).toBe("replay_required");
    expect(fixtures.degraded.response.issues?.[0]?.code).toBe("quickbooks_checkpoint_replay_required");

    expect(fixtures.unavailable.response.status).toBe("unavailable");
    expect(fixtures.unavailable.response.serviceAvailability).toBe("unavailable");
    expect(fixtures.unavailable.response.capabilities.fullSync.available).toBe(false);
    expect(fixtures.unavailable.response.capabilities.providerReports.available).toBe(false);
    expect(fixtures.unavailable.response.checkpoint.status).toBe("unknown");

    expect(JSON.stringify(fixtures)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i);
  });

  it("rejects provider mode mismatches and credential-like health evidence", () => {
    const request = serviceHealthProbeRequest();

    expect(() =>
      buildQuickBooksServiceHealthProbeResponse(request, {
        status: "ready",
        providerMode: "production",
        checkpoint: { status: "current" }
      })
    ).toThrow(/providerMode production does not match source providerEnvironment sandbox/);

    expect(() =>
      buildQuickBooksServiceHealthProbeResponse(request, {
        status: "ready",
        checkpoint: { status: "current" },
        client_secret: "do-not-leak"
      } as Parameters<typeof buildQuickBooksServiceHealthProbeResponse>[1])
    ).toThrow(/credential-like field is not allowed/);
  });

  it("rejects QuickBooks custody-boundary fields from health evidence", () => {
    const request = serviceHealthProbeRequest();

    for (const forbiddenField of ["oauth", "sealedSecret", "tokenRefresh", "providerClient", "rawImport"] as const) {
      expect(() =>
        buildQuickBooksServiceHealthProbeResponse(request, {
          status: "ready",
          checkpoint: { status: "current" },
          [forbiddenField]: "integration-service-only"
        })
      ).toThrow(/credential-like field is not allowed/);
    }
  });
});

describe("Handrail QuickBooks normalized full sync service path", () => {
  it("keeps normalized SDK/service outputs inside the safe custody boundary", async () => {
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => normalizedFullSyncResources(),
        loadIncrementalSyncResources: () => normalizedIncrementalSyncResources(),
        loadProviderReport: providerReportFixture(),
        loadServiceHealth: () => ({
          status: "ready",
          serviceAvailability: "available",
          providerMode: "sandbox",
          serviceEnvironment: "staging",
          capabilities: {
            fullSync: healthCapability("ready", "Full sync is available."),
            incrementalSync: healthCapability("ready", "Incremental sync is available."),
            providerReports: healthCapability("ready", "Provider reports are available."),
            sandbox: healthCapability("ready", "Sandbox mode is available."),
            replay: healthCapability("ready", "Replay fixtures are available.")
          },
          checkpoint: {
            checkpointId: "checkpoint_full_qbo_1",
            status: "current",
            sourceObject: "quickbooks_full_sync",
            cursorKind: "full_scan",
            cursorValue: "full:realm_sync:2026-02-01T10:00:00.000Z"
          }
        })
      })
    );

    const health = await client.serviceHealth(serviceHealthProbeRequest());
    const fullSync = await client.fullSync(fullSyncRequest());
    const incrementalSync = await client.incrementalSync(incrementalSyncRequest());
    const profitAndLoss = await client.profitAndLossReport(providerReportRequest("profit_and_loss"));
    const cashFlow = await client.cashFlowParityReport(providerReportRequest("cash_flow"));
    const evidence = buildQuickBooksProviderReportReconciliationEvidence({
      providerReport: profitAndLoss,
      canonicalTotals: profitAndLoss.totals.map((total) => canonicalTotal(total.totalKey, total.amount))
    });
    const outputs = { health, fullSync, incrementalSync, profitAndLoss, cashFlow, evidence };

    expect(JSON.stringify(outputs)).not.toMatch(QUICKBOOKS_CUSTODY_BOUNDARY_LEAK_PATTERN);
    expect(fullSync.resources.companyInfo.sourcePayloadRef).toBeDefined();
    expect(fullSync.importBatch).toBeDefined();
    expect(fullSync.checkpoint).toBeDefined();
    expect(incrementalSync.checkpoint).toBeDefined();
    expect(profitAndLoss.providerReportRef.sourcePayloadRef).toBeDefined();
    expect(evidence.providerReportRef.sourcePayloadRef).toBeDefined();

    for (const sourcePayloadRef of [
      health.checkpoint,
      fullSync.resources.companyInfo.sourcePayloadRef,
      incrementalSync.resources.accounts?.[0]?.sourcePayloadRef,
      profitAndLoss.providerReportRef.sourcePayloadRef,
      evidence.providerReportRef.sourcePayloadRef
    ]) {
      if (sourcePayloadRef !== undefined && "sourceObjectType" in sourcePayloadRef) {
        assertSafeSourcePayloadRef(sourcePayloadRef);
      }
    }
  });

  it("exposes an SDK fullSync method backed by a service handler with normalized resource counts and safe refs", async () => {
    const request = fullSyncRequest();
    const resources = normalizedFullSyncResources();
    let providerRequest: NormalizedQuickBooksFullSyncRequestEnvelope | undefined;
    const provider: HandrailQuickBooksFullSyncProvider = (input) => {
      providerRequest = input;
      return resources;
    };
    const client = createHandrailQuickBooksSyncClient(createHandrailQuickBooksFullSyncServiceHandler({ loadFullSyncResources: provider }));

    const response = await client.fullSync(request);

    expect(providerRequest).toBe(request);
    expect(response.syncMode).toBe("full");
    expect(response.status).toBe("completed");
    expect(response.sourceIdentity).toEqual(request.sourceIdentity);
    expect(response.providerEnvironment).toBe("sandbox");
    expect(response.sourceFreshThrough).toBe("2026-02-01T10:00:00.000Z");
    expect(response.importedThrough).toBe("2026-02-01T10:00:00.000Z");
    expect(response.importBatch?.mode).toBe("initial");
    expect(response.checkpoint).toMatchObject({
      checkpointId: "checkpoint_full_qbo_1",
      cursorKind: "full_scan",
      cursorValue: "full:realm_sync:2026-02-01T10:00:00.000Z",
      sourceFreshThrough: "2026-02-01T10:00:00.000Z",
      importedThrough: "2026-02-01T10:00:00.000Z",
      freshThrough: "2026-02-01T10:00:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T09:59:59.000Z"
    });
    expect(response.resourceCounts).toEqual({
      companyInfo: 1,
      accounts: 2,
      journalEntries: 1,
      ledgerEntries: 1,
      ledgerTransactions: 0,
      ledgerPostings: 2,
      parties: 0,
      customers: 1,
      vendors: 1,
      items: 1,
      classes: 0,
      departments: 1,
      dimensions: 1,
      providerReports: 0,
      reconciliationEvidence: 0
    });
    expect(response.importBatch?.sourceObjectCounts).toEqual(response.resourceCounts);
    expect(response.resources.companyInfo.resourceId).toBe("realm_sync");
    expect(response.resources.accounts.map((account) => account.resourceId)).toEqual(["35", "79"]);
    expect(response.resources.journalEntries?.[0]?.resource.sourceTransactionId).toBe("100");
    expect(response.resources.journalEntries?.[0]?.resource.lines.map((line) => line.postings[0]?.sourcePostingId)).toEqual([
      "100:1",
      "100:2"
    ]);
    expect(response.resources.journalEntries?.[0]?.resource.sourcePayloadRef?.storageRef).toBe(
      "quickbooks-sdk://sandbox/realm/realm_sync/JournalEntry/100"
    );
    const boundedPreview = response.resources.journalEntries?.[0]?.resource.sourcePayloadRef?.preview;
    expect(typeof boundedPreview).toBe("object");
    expect((boundedPreview as { readonly truncated?: unknown }).truncated).toBe(true);
    expect(typeof (boundedPreview as { readonly byteLength?: unknown }).byteLength).toBe("number");
    expect(JSON.stringify(response)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i);
  });

  it("returns the normalized full-sync sandbox replay response shape consumed by ERP Financials", async () => {
    const request = {
      ...fullSyncRequest(),
      requestedResourceTypes: [
        "CompanyInfo",
        "Account",
        "Party",
        "Customer",
        "Vendor",
        "Item",
        "Department",
        "Dimension",
        "JournalEntry",
        "LedgerTransaction",
        "LedgerPosting"
      ]
    };
    const resources: NormalizedQuickBooksResourceSet = {
      ...normalizedFullSyncResources(),
      parties: [normalizedPartyResource("customer", "cust_1", "Sample Customer"), normalizedPartyResource("vendor", "vendor_1", "Sample Vendor")],
      ledgerTransactions: [normalizedInvoiceLedgerTransactionResource()],
      ledgerPostings: [
        normalizedLedgerPostingResource("100:1", "35", "Checking", "debit", "500.00", "JournalEntryLine"),
        normalizedLedgerPostingResource("100:2", "79", "Services", "credit", "500.00", "JournalEntryLine"),
        normalizedLedgerPostingResource("200:ar", "35", "Checking", "debit", "700.00", "InvoiceLine"),
        normalizedLedgerPostingResource("200:income", "79", "Services", "credit", "700.00", "InvoiceLine")
      ]
    };
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => resources
      })
    );

    const response = await client.fullSync(request);

    expect(response).toMatchObject({
      sourceIdentity: request.sourceIdentity,
      syncMode: "full",
      status: "completed",
      importBatchId: "batch_full_qbo_1",
      checkpointId: "checkpoint_full_qbo_1",
      providerEnvironment: "sandbox",
      cursorKind: "full_scan",
      cursorValue: "full:realm_sync:2026-02-01T10:00:00.000Z",
      sourceFreshThrough: "2026-02-01T10:00:00.000Z",
      importedThrough: "2026-02-01T10:00:00.000Z",
      freshThrough: "2026-02-01T10:00:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T09:59:59.000Z",
      completedAt: "2026-02-01T10:00:05.000Z"
    });
    expect(response.importBatch).toEqual({
      importBatchId: "batch_full_qbo_1",
      syncMode: "full",
      mode: "initial",
      status: "completed",
      startedAt: "2026-02-01T09:55:00.000Z",
      completedAt: "2026-02-01T10:00:05.000Z",
      sourceObjectCounts: response.resourceCounts
    });
    expect(response.checkpoint).toEqual({
      checkpointId: "checkpoint_full_qbo_1",
      sourceObject: "quickbooks_full_sync",
      cursorKind: "full_scan",
      cursorValue: "full:realm_sync:2026-02-01T10:00:00.000Z",
      sourceFreshThrough: "2026-02-01T10:00:00.000Z",
      importedThrough: "2026-02-01T10:00:00.000Z",
      freshThrough: "2026-02-01T10:00:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T09:59:59.000Z",
      status: "current"
    });
    expect(response.resourceCounts).toEqual({
      companyInfo: 1,
      accounts: 2,
      journalEntries: 1,
      ledgerEntries: 2,
      ledgerTransactions: 1,
      ledgerPostings: 4,
      parties: 2,
      customers: 1,
      vendors: 1,
      items: 1,
      classes: 0,
      departments: 1,
      dimensions: 1,
      providerReports: 0,
      reconciliationEvidence: 0
    });
    expect(response.resources.identity).toEqual(request.sourceIdentity);
    expect(response.resources.importBatch).toEqual(response.importBatch);
    expect(response.resources.checkpoint).toEqual(response.checkpoint);
    expect(response.resources.accounts.map((account) => account.resource.sourceAccountId)).toEqual(["35", "79"]);
    expect(response.resources.parties?.map((party) => [party.resource.partyType, party.resource.sourceObjectId])).toEqual([
      ["customer", "cust_1"],
      ["vendor", "vendor_1"]
    ]);
    expect(response.resources.items?.map((item) => [item.resource.sourceObjectId, item.resource.incomeAccountRef?.sourceObjectId])).toEqual([
      ["service_1", "79"]
    ]);
    expect(response.resources.dimensions?.map((dimension) => [dimension.resource.dimensionKind, dimension.resource.sourceObjectId])).toEqual([
      ["department", "ops"]
    ]);
    expect(response.resources.ledgerTransactions?.map((transaction) => transaction.resource.sourceTransactionType)).toEqual(["Invoice"]);
    expect(response.resources.ledgerPostings?.map((posting) => posting.resource.sourcePostingId)).toEqual([
      "100:1",
      "100:2",
      "200:ar",
      "200:income"
    ]);

    const sourcePayloadRefs = collectSourcePayloadRefs(response);
    expect(sourcePayloadRefs.length).toBeGreaterThanOrEqual(20);
    expect(sourcePayloadRefs.every((ref) => ref.storageRef?.startsWith("quickbooks-sdk://sandbox/realm/realm_sync/"))).toBe(true);
    for (const sourcePayloadRef of sourcePayloadRefs) {
      assertSafeSourcePayloadRef(sourcePayloadRef);
    }
    expect(JSON.stringify(response)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i);
  });

  it("counts postings from normalized non-JournalEntry ledger transactions when separate posting resources are omitted", async () => {
    const request = fullSyncRequest();
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => ({
          ...normalizedFullSyncResources(),
          journalEntries: [],
          ledgerTransactions: [normalizedInvoiceLedgerTransactionResource()]
        })
      })
    );

    const response = await client.fullSync(request);

    expect(response.resourceCounts).toMatchObject({
      journalEntries: 0,
      ledgerEntries: 1,
      ledgerTransactions: 1,
      ledgerPostings: 2
    });
    expect(response.resources.ledgerTransactions?.[0]?.resource.sourceTransactionType).toBe("Invoice");
    expect(response.resources.ledgerTransactions?.[0]?.resource.sourcePayloadRef?.sourceObjectType).toBe("Invoice");
    expect(JSON.stringify(response)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i);
  });

  it("rejects provider resources from a different realm or provider environment", async () => {
    const request = fullSyncRequest();
    const providerEnvironmentMismatch = createHandrailQuickBooksFullSyncServiceHandler({
      loadFullSyncResources: () => ({
        ...normalizedFullSyncResources(),
        identity: {
          ...normalizedFullSyncResources().identity,
          providerEnvironment: "production"
        }
      })
    });
    const realmMismatch = createHandrailQuickBooksFullSyncServiceHandler({
      loadFullSyncResources: () => ({
        ...normalizedFullSyncResources(),
        companyInfo: {
          ...normalizedFullSyncResources().companyInfo,
          realmId: "other_realm"
        }
      })
    });

    await expect(providerEnvironmentMismatch.fullSync(request)).rejects.toThrow(/providerEnvironment production does not match request sandbox/);
    await expect(realmMismatch.fullSync(request)).rejects.toThrow(/CompanyInfo realmId other_realm does not match request realm_sync/);
  });

  it("rejects request identities that do not use the QuickBooks realm as the source company ref", async () => {
    const handler = createHandrailQuickBooksFullSyncServiceHandler({
      loadFullSyncResources: () => normalizedFullSyncResources()
    });

    await expect(
      handler.fullSync({
        ...fullSyncRequest(),
        sourceIdentity: {
          ...fullSyncRequest().sourceIdentity,
          sourceCompanyRef: "company_ref_mismatch"
        }
      })
    ).rejects.toThrow(/sourceCompanyRef company_ref_mismatch does not match realmId realm_sync/);
  });

  it("does not serialize provider credential fields returned by the provider boundary", async () => {
    const handler = createHandrailQuickBooksFullSyncServiceHandler({
      loadFullSyncResources: () =>
        ({
          ...normalizedFullSyncResources(),
          accessToken: "provider-token"
        }) as unknown as NormalizedQuickBooksResourceSet
    });

    await expect(handler.fullSync(fullSyncRequest())).rejects.toThrow(/credential-like field is not allowed/);
  });

  it("rejects QuickBooks custody-boundary fields returned by sync and report providers", async () => {
    const syncLeakFields = ["oauth", "sealedSecret", "tokenRefresh", "providerClient", "rawImports"] as const;

    for (const forbiddenField of syncLeakFields) {
      const handler = createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () =>
          ({
            ...normalizedFullSyncResources(),
            [forbiddenField]: "integration-service-only"
          }),
        loadIncrementalSyncResources: () =>
          ({
            ...normalizedIncrementalSyncResources(),
            [forbiddenField]: "integration-service-only"
          }),
        loadProviderReport: async (request) =>
          ({
            ...(await providerReportFixture()(request)),
            [forbiddenField]: "integration-service-only"
          })
      });

      await expect(handler.fullSync(fullSyncRequest()), forbiddenField).rejects.toThrow(/credential-like field is not allowed/);
      await expect(handler.incrementalSync(incrementalSyncRequest()), forbiddenField).rejects.toThrow(
        /credential-like field is not allowed/
      );
      await expect(handler.profitAndLossReport(providerReportRequest("profit_and_loss")), forbiddenField).rejects.toThrow(
        /credential-like field is not allowed/
      );
    }
  });
});

describe("Handrail QuickBooks normalized incremental sync service path", () => {
  it("exposes an SDK incrementalSync method backed by a service handler with checkpoint metadata and delta counts", async () => {
    const request = incrementalSyncRequest();
    let providerRequest: HandrailQuickBooksIncrementalSyncRequest | undefined;
    const provider: HandrailQuickBooksIncrementalSyncProvider = (input) => {
      providerRequest = input;
      return normalizedIncrementalSyncResources();
    };
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => normalizedFullSyncResources(),
        loadIncrementalSyncResources: provider
      })
    );

    const response = await client.incrementalSync(request);

    expect(providerRequest).toBe(request);
    expect(response.syncMode).toBe("incremental");
    expect(response.status).toBe("completed_with_warnings");
    expect(response.sourceIdentity).toEqual(request.sourceIdentity);
    expect(response.providerEnvironment).toBe("sandbox");
    expect(response.sourceFreshThrough).toBe("2026-02-01T10:10:00.000Z");
    expect(response.importedThrough).toBe("2026-02-01T10:10:00.000Z");
    expect(response.importBatch).toMatchObject({
      importBatchId: "batch_incremental_qbo_1",
      syncMode: "incremental",
      mode: "delta",
      status: "completed_with_warnings"
    });
    expect(response.checkpoint).toEqual({
      checkpointId: "checkpoint_incremental_qbo_1",
      sourceObject: "quickbooks_cdc",
      cursorKind: "updated_since",
      cursorValue: "cdc:realm_sync:2026-02-01T10:08:00.000Z",
      sourceFreshThrough: "2026-02-01T10:10:00.000Z",
      importedThrough: "2026-02-01T10:10:00.000Z",
      freshThrough: "2026-02-01T10:10:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T10:08:00.000Z",
      status: "current"
    });
    expect(response.idempotencyKeys).toMatchObject({
      importBatchId: response.importBatchId,
      checkpointId: response.checkpointId,
      resourceSetKey: "tenant_sync:source_qbo_sync:batch_incremental_qbo_1:checkpoint_incremental_qbo_1"
    });
    expect(response.resourceCounts).toEqual({
      companyInfo: 0,
      accounts: 2,
      journalEntries: 1,
      ledgerEntries: 1,
      ledgerTransactions: 0,
      ledgerPostings: 2,
      parties: 0,
      customers: 0,
      vendors: 1,
      items: 0,
      classes: 0,
      departments: 0,
      dimensions: 0,
      providerReports: 0,
      reconciliationEvidence: 0,
      changedResources: 1,
      deletedResources: 1,
      voidedResources: 1,
      skippedResources: 1
    });
    expect(response.importBatch?.sourceObjectCounts).toEqual(response.resourceCounts);
    expect(response.resources.companyInfo).toBeUndefined();
    expect(response.resources.accounts?.map((account) => [account.resourceId, account.syncAction])).toEqual([
      ["35", "changed"],
      ["88", "deleted"]
    ]);
    expect(response.resources.journalEntries?.[0]?.syncAction).toBe("voided");
    expect(response.resources.vendors?.[0]?.syncAction).toBe("skipped");
    expect(response.warningSummary?.items?.[0]).toMatchObject({
      code: "quickbooks_sparse_vendor_skipped",
      resourceType: "Vendor",
      resourceId: "vendor_skipped"
    });
    expect(JSON.stringify(response)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i);
  });

  it("derives latestSourceUpdatedAt and freshThrough from changed resources when the provider omits checkpoint metadata", async () => {
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => normalizedFullSyncResources(),
        loadIncrementalSyncResources: () => {
          const resources = normalizedIncrementalSyncResources();
          const account = resources.accounts?.[0];
          if (account === undefined) {
            throw new Error("Expected incremental fixture account");
          }
          return {
            identity: resources.identity,
            accounts: [account]
          };
        }
      })
    );

    const response = await client.incrementalSync({
      ...incrementalSyncRequest(),
      requestedAt: "2026-02-01T10:20:00.000Z",
      checkpointId: "checkpoint_incremental_qbo_derived",
      importBatchId: "batch_incremental_qbo_derived",
      idempotencyKey: "tenant_sync:source_qbo_sync:incremental:derived",
      idempotencyKeys: {
        syncRequestKey: "tenant_sync:source_qbo_sync:incremental:derived",
        importBatchId: "batch_incremental_qbo_derived",
        checkpointId: "checkpoint_incremental_qbo_derived"
      }
    });

    expect(response.latestSourceUpdatedAt).toBe("2026-02-01T10:06:00.000Z");
    expect(response.sourceFreshThrough).toBe("2026-02-01T10:06:00.000Z");
    expect(response.importedThrough).toBe("2026-02-01T10:06:00.000Z");
    expect(response.freshThrough).toBe("2026-02-01T10:06:00.000Z");
    expect(response.checkpoint).toMatchObject({
      checkpointId: "checkpoint_incremental_qbo_derived",
      cursorKind: "updated_since",
      cursorValue: "2026-02-01T10:06:00.000Z",
      sourceFreshThrough: "2026-02-01T10:06:00.000Z",
      importedThrough: "2026-02-01T10:06:00.000Z",
      freshThrough: "2026-02-01T10:06:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T10:06:00.000Z"
    });
  });

  it("replays from a supplied checkpoint without duplicate resource identity", async () => {
    const request: HandrailQuickBooksIncrementalSyncRequest = {
      ...incrementalSyncRequest(),
      resumeFromCheckpointId: "checkpoint_full_qbo_1"
    };
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => normalizedFullSyncResources(),
        loadIncrementalSyncResources: (input) => {
          expect("resumeFromCheckpointId" in input ? input.resumeFromCheckpointId : undefined).toBe("checkpoint_full_qbo_1");
          return normalizedIncrementalSyncResources();
        }
      })
    );

    const firstReplay = await client.incrementalSync(request);
    const secondReplay = await client.incrementalSync(request);
    const firstIdentities = quickBooksResourceIdentities(firstReplay.resources);
    const secondIdentities = quickBooksResourceIdentities(secondReplay.resources);

    expect(firstIdentities).toEqual(["Account:35", "Account:88", "JournalEntry:101", "Vendor:vendor_skipped"]);
    expect(new Set(firstIdentities).size).toBe(firstIdentities.length);
    expect(secondIdentities).toEqual(firstIdentities);
  });

  it("rejects duplicate resource identities returned from an incremental provider replay", async () => {
    const resources = normalizedIncrementalSyncResources();
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => normalizedFullSyncResources(),
        loadIncrementalSyncResources: () => ({
          ...resources,
          accounts: [resources.accounts?.[0], resources.accounts?.[0]].filter((account) => account !== undefined)
        })
      })
    );

    await expect(client.incrementalSync(incrementalSyncRequest())).rejects.toThrow(/duplicate resource identity Account:35/);
  });
});

describe("Handrail QuickBooks normalized provider report service path", () => {
  it("serves sandbox replay fixture provider report parity responses through the SDK report APIs", async () => {
    const fixtures = ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.providerReports;
    const loadProviderReport = vi.fn<HandrailQuickBooksProviderReportProvider>((request) => {
      switch (request.reportName) {
        case "profit_and_loss":
          return fixtures.profitAndLoss.providerResult;
        case "balance_sheet":
          return fixtures.balanceSheet.providerResult;
        case "trial_balance":
          return fixtures.trialBalance.providerResult;
        case "cash_flow":
          throw new Error("cash-flow parity is unsupported by the QuickBooks service fixture");
        default:
          request.reportName satisfies never;
          throw new Error("Unsupported provider report fixture");
      }
    });
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => normalizedFullSyncResources(),
        loadProviderReport
      })
    );

    const profitAndLoss = await client.profitAndLossReport(fixtures.profitAndLoss.request);
    const balanceSheet = await client.balanceSheetReport(fixtures.balanceSheet.request);
    const trialBalance = await client.trialBalanceReport(fixtures.trialBalance.request);
    const cashFlow = await client.cashFlowParityReport(fixtures.cashFlow.request);

    expect(profitAndLoss).toEqual(fixtures.profitAndLoss.response);
    expect(balanceSheet).toEqual(fixtures.balanceSheet.response);
    expect(trialBalance).toEqual(fixtures.trialBalance.response);
    expect(cashFlow).toEqual(fixtures.cashFlow.response);
    expect(loadProviderReport).toHaveBeenCalledTimes(3);

    for (const [request, response] of [
      [fixtures.profitAndLoss.request, profitAndLoss],
      [fixtures.balanceSheet.request, balanceSheet],
      [fixtures.trialBalance.request, trialBalance]
    ] as const) {
      expect(response.supportStatus).toBe("supported");
      expect(response.requestedAt).toBe(request.requestedAt);
      expect(response.providerEnvironment).toBe(request.sourceIdentity.providerEnvironment);
      expect(response.importBatchId).toBe("batch_qbo_full_fixture_2026_01");
      expect(response.checkpointId).toBe("checkpoint_qbo_full_fixture_2026_01");
      expect(response.sourceFreshThrough).toBe("2026-02-01T10:01:00.000Z");
      expect(response.importedThrough).toBe("2026-02-01T10:00:00.000Z");
      expect(response.latestSourceUpdatedAt).toBe("2026-02-01T10:01:00.000Z");
      expect(response.generatedAt).toBe("2026-02-01T10:02:00.000Z");
      expect(response.providerReportRef.reportName).toBe(response.reportName);
      assertSafeSourcePayloadRef(response.providerReportRef.sourcePayloadRef);
      expect(response.totals.length).toBeGreaterThan(0);
      expect(response.totals.every((total) => total.label !== undefined && /^-?\d+\.\d{2}$/.test(total.amount))).toBe(true);
      for (const total of response.totals) {
        expect(total.drilldownRef).toBeDefined();
        assertSafeSourcePayloadRef(total.drilldownRef as SafeSourcePayloadRef);
      }

      const evidence = buildQuickBooksProviderReportReconciliationEvidence({
        providerReport: response,
        canonicalTotals: response.totals.map((total) => ({
          totalKey: total.totalKey,
          amount: total.amount,
          ...(total.currencyCode === undefined ? {} : { currencyCode: total.currencyCode })
        })),
        toleranceAmount: "0.01",
        generatedAt: "2026-02-01T10:03:00.000Z"
      });
      expect(evidence.toleranceAmount).toBe("0.01");
      expect(evidence.totals.every((total) => total.status === "matched")).toBe(true);
      expect(evidence.totals.every((total) => total.drilldownRef !== undefined)).toBe(true);
    }

    expect(cashFlow).toMatchObject({
      reportName: "cash_flow",
      supportStatus: "unsupported",
      unsupportedReason: "quickbooks_cash_flow_parity_report_not_supported",
      requestedAt: fixtures.cashFlow.request.requestedAt,
      totals: []
    });
    expect(cashFlow.providerReportRef).toBeUndefined();
    expect(JSON.stringify([profitAndLoss, balanceSheet, trialBalance, cashFlow])).not.toMatch(
      /access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i
    );
  });

  it("represents unavailable provider report parity as an explicit safe state with a reason", () => {
    const request = ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.providerReports.balanceSheet.request;

    const response = buildUnavailableQuickBooksProviderReportResponse(request);

    expect(response).toMatchObject({
      sourceIdentity: request.sourceIdentity,
      reportName: "balance_sheet",
      supportStatus: "unsupported",
      unsupportedReason: "quickbooks_provider_report_unavailable",
      accountingBasis: request.accountingBasis,
      currencyCode: request.currencyCode,
      providerEnvironment: "sandbox",
      importBatchId: "batch_qbo_full_fixture_2026_01",
      checkpointId: "checkpoint_qbo_full_fixture_2026_01",
      sourceFreshThrough: "2026-02-01T10:00:00.000Z",
      importedThrough: "2026-02-01T10:00:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T09:59:59.000Z",
      asOfDate: request.asOfDate,
      requestedAt: request.requestedAt,
      totals: []
    });
    expect(response.providerReportRef).toBeUndefined();
    expect(response.generatedAt).toBeUndefined();
    expect(JSON.stringify(response)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i);
  });

  it("returns bounded P&L provider totals with a safe providerReportRef and drilldown refs", async () => {
    const request = providerReportRequest("profit_and_loss");
    const provider = providerReportFixture();
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => normalizedFullSyncResources(),
        loadProviderReport: provider
      })
    );

    const response = await client.profitAndLossReport(request);

    expect(response.supportStatus).toBe("supported");
    expect(response.providerEnvironment).toBe("sandbox");
    expect(response.providerReportRef.sourcePayloadRef.storageRef).toBe(
      "quickbooks-sdk://sandbox/realm/realm_sync/Report/profit_and_loss/2026-01-01:2026-01-31"
    );
    expect(response.sourceUpdatedAt).toBe("2026-02-01T10:01:00.000Z");
    expect(response.latestSourceUpdatedAt).toBe("2026-02-01T10:01:00.000Z");
    expect(response.sourceFreshThrough).toBe("2026-02-01T10:01:00.000Z");
    expect(response.importedThrough).toBe("2026-02-01T10:01:00.000Z");
    expect(response.totals).toEqual([
      {
        totalKey: "income",
        label: "Income",
        amount: "20000.00",
        currencyCode: "USD",
        sourceUpdatedAt: "2026-02-01T10:01:00.000Z",
        drilldownRef: {
          sourceObjectType: "ReportTotal",
          sourceObjectId: "profit_and_loss:income",
          sourceUpdatedAt: "2026-02-01T10:01:00.000Z",
          storageRef: "quickbooks-sdk://sandbox/realm/realm_sync/Report/profit_and_loss/total/income",
          preview: {
            reportName: "profit_and_loss",
            totalKey: "income"
          }
        }
      },
      {
        totalKey: "expenses",
        label: "Expenses",
        amount: "6200.00",
        currencyCode: "USD",
        sourceUpdatedAt: "2026-02-01T10:01:00.000Z",
        drilldownRef: {
          sourceObjectType: "ReportTotal",
          sourceObjectId: "profit_and_loss:expenses",
          sourceUpdatedAt: "2026-02-01T10:01:00.000Z",
          storageRef: "quickbooks-sdk://sandbox/realm/realm_sync/Report/profit_and_loss/total/expenses",
          preview: {
            reportName: "profit_and_loss",
            totalKey: "expenses"
          }
        }
      },
      {
        totalKey: "net_income",
        label: "Net Income",
        amount: "13800.00",
        currencyCode: "USD",
        sourceUpdatedAt: "2026-02-01T10:01:00.000Z",
        drilldownRef: {
          sourceObjectType: "ReportTotal",
          sourceObjectId: "profit_and_loss:net_income",
          sourceUpdatedAt: "2026-02-01T10:01:00.000Z",
          storageRef: "quickbooks-sdk://sandbox/realm/realm_sync/Report/profit_and_loss/total/net_income",
          preview: {
            reportName: "profit_and_loss",
            totalKey: "net_income"
          }
        }
      }
    ]);
    expect(JSON.stringify(response)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|rawPayload/i);
  });

  it("returns balance sheet and trial balance provider report fixtures through helper APIs", async () => {
    const provider = providerReportFixture();
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => normalizedFullSyncResources(),
        loadProviderReport: provider
      })
    );

    const balanceSheet = await client.balanceSheetReport(providerReportRequest("balance_sheet"));
    const trialBalance = await client.trialBalanceReport(providerReportRequest("trial_balance"));

    expect(balanceSheet.supportStatus).toBe("supported");
    expect(balanceSheet.providerReportRef.reportName).toBe("balance_sheet");
    expect(balanceSheet.totals.map((total) => [total.totalKey, total.amount])).toEqual([
      ["assets", "83900.00"],
      ["liabilities", "-11200.00"],
      ["equity", "-72700.00"]
    ]);
    expect(trialBalance.supportStatus).toBe("supported");
    expect(trialBalance.providerReportRef.reportName).toBe("trial_balance");
    expect(trialBalance.totals.map((total) => [total.totalKey, total.amount])).toEqual([
      ["debits", "119900.00"],
      ["credits", "-119900.00"],
      ["net", "0.00"]
    ]);
  });

  it("represents unsupported QuickBooks cash-flow parity without provider totals or provider loader calls", async () => {
    const loadProviderReport = vi.fn<HandrailQuickBooksProviderReportProvider>();
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => normalizedFullSyncResources(),
        loadProviderReport
      })
    );

    const response = await client.cashFlowParityReport(providerReportRequest("cash_flow"));

    expect(loadProviderReport).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      reportName: "cash_flow",
      supportStatus: "unsupported",
      unsupportedReason: "quickbooks_cash_flow_parity_report_not_supported",
      providerEnvironment: "sandbox",
      totals: []
    });
    expect(response.providerReportRef).toBeUndefined();
  });

  it("does not treat unsupported QuickBooks cash-flow parity as a zero-delta reconciliation match", async () => {
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => normalizedFullSyncResources(),
        loadProviderReport: vi.fn<HandrailQuickBooksProviderReportProvider>()
      })
    );
    const response = await client.cashFlowParityReport(providerReportRequest("cash_flow"));

    expect(() =>
      buildQuickBooksProviderReportReconciliationEvidence({
        providerReport: response,
        canonicalTotals: [canonicalTotal("net_cash_flow", "0.00")]
      })
    ).toThrow(/requires a supported provider report/);
  });

  it("rejects unbounded report totals from the provider boundary", async () => {
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => normalizedFullSyncResources(),
        loadProviderReport: async (request) => ({
          ...(await providerReportFixture()(request)),
          totals: Array.from({ length: 51 }, (_, index) => ({
            totalKey: `total_${String(index)}`,
            amount: `${String(index)}.00`
          }))
        })
      })
    );

    await expect(client.profitAndLossReport(providerReportRequest("profit_and_loss"))).rejects.toThrow(
      /provider report totals must be bounded/
    );
  });

  it("builds matched reconciliation evidence from caller-supplied ERP canonical totals", async () => {
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => normalizedFullSyncResources(),
        loadProviderReport: providerReportFixture()
      })
    );
    const providerReport = await client.profitAndLossReport(providerReportRequest("profit_and_loss"));

    const evidence = buildQuickBooksProfitAndLossReconciliationEvidence({
      providerReport,
      canonicalTotals: [
        canonicalTotal("income", "20000.00"),
        canonicalTotal("expenses", "6200.00"),
        canonicalTotal("net_income", "13800.00")
      ],
      generatedAt: "2026-02-01T10:03:00.000Z"
    });

    expect(evidence.provider).toBe("quickbooks");
    expect(evidence.providerReportRef.sourcePayloadRef.storageRef).toBe(
      "quickbooks-sdk://sandbox/realm/realm_sync/Report/profit_and_loss/2026-01-01:2026-01-31"
    );
    expect(evidence.sourceUpdatedAt).toBe("2026-02-01T10:01:00.000Z");
    expect(evidence.generatedAt).toBe("2026-02-01T10:03:00.000Z");
    expect(evidence.toleranceAmount).toBe("0.00");
    expect(evidence.reconciliationStatus).toBe("balanced");
    expect(evidence.reconciliationDifference).toBe("0.00");
    expect(evidence.totals.map((total) => total.status)).toEqual(["matched", "matched", "matched"]);
    expect(evidence.totals[0]?.drilldownRef).toEqual({
      sourceObjectType: "ReportTotal",
      sourceObjectId: "profit_and_loss:income",
      sourceUpdatedAt: "2026-02-01T10:01:00.000Z",
      storageRef: "quickbooks-sdk://sandbox/realm/realm_sync/Report/profit_and_loss/total/income",
      preview: {
        reportName: "profit_and_loss",
        totalKey: "income"
      }
    });
    expect(JSON.stringify(evidence)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|rawPayload/i);
  });

  it("builds balance sheet and trial balance reconciliation evidence through named helpers", async () => {
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => normalizedFullSyncResources(),
        loadProviderReport: providerReportFixture()
      })
    );
    const balanceSheet = await client.balanceSheetReport(providerReportRequest("balance_sheet"));
    const trialBalance = await client.trialBalanceReport(providerReportRequest("trial_balance"));

    const balanceSheetEvidence = buildQuickBooksBalanceSheetReconciliationEvidence({
      providerReport: balanceSheet,
      canonicalTotals: [canonicalTotal("assets", "83900.00"), canonicalTotal("liabilities", "-11200.00")]
    });
    const trialBalanceEvidence = buildQuickBooksTrialBalanceReconciliationEvidence({
      providerReport: trialBalance,
      canonicalTotals: [canonicalTotal("debits", "119900.00"), canonicalTotal("credits", "-119900.00")]
    });

    expect(balanceSheetEvidence.providerReportRef.reportName).toBe("balance_sheet");
    expect(balanceSheetEvidence.reconciliationStatus).toBe("balanced");
    expect(trialBalanceEvidence.providerReportRef.reportName).toBe("trial_balance");
    expect(trialBalanceEvidence.reconciliationStatus).toBe("balanced");
  });

  it("reports mismatches while honoring tolerance and bounding difference output", async () => {
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => normalizedFullSyncResources(),
        loadProviderReport: providerReportFixture()
      })
    );
    const providerReport = await client.profitAndLossReport(providerReportRequest("profit_and_loss"));

    const evidence = buildQuickBooksProviderReportReconciliationEvidence({
      providerReport,
      canonicalTotals: [canonicalTotal("income", "19999.99"), canonicalTotal("expenses", "6200.03")],
      toleranceAmount: "0.01"
    });

    expect(evidence.reconciliationStatus).toBe("out_of_balance");
    expect(evidence.reconciliationDifference).toBe("0.03");
    expect(evidence.totals).toEqual([
      {
        totalKey: "income",
        canonicalAmount: "19999.99",
        providerAmount: "20000.00",
        difference: "0.01",
        status: "matched",
        drilldownRef: {
          sourceObjectType: "ReportTotal",
          sourceObjectId: "profit_and_loss:income",
          sourceUpdatedAt: "2026-02-01T10:01:00.000Z",
          storageRef: "quickbooks-sdk://sandbox/realm/realm_sync/Report/profit_and_loss/total/income",
          preview: {
            reportName: "profit_and_loss",
            totalKey: "income"
          }
        }
      },
      {
        totalKey: "expenses",
        canonicalAmount: "6200.03",
        providerAmount: "6200.00",
        difference: "-0.03",
        status: "mismatched",
        drilldownRef: {
          sourceObjectType: "ReportTotal",
          sourceObjectId: "profit_and_loss:expenses",
          sourceUpdatedAt: "2026-02-01T10:01:00.000Z",
          storageRef: "quickbooks-sdk://sandbox/realm/realm_sync/Report/profit_and_loss/total/expenses",
          preview: {
            reportName: "profit_and_loss",
            totalKey: "expenses"
          }
        }
      }
    ]);
    expect(JSON.stringify(evidence)).not.toContain("rawPayload");
  });

  it("marks caller-requested ERP totals as missing when the provider report lacks the total key", async () => {
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => normalizedFullSyncResources(),
        loadProviderReport: providerReportFixture()
      })
    );
    const providerReport = await client.profitAndLossReport(providerReportRequest("profit_and_loss"));

    const evidence = buildQuickBooksProfitAndLossReconciliationEvidence({
      providerReport,
      canonicalTotals: [canonicalTotal("gross_margin", "18000.00")]
    });

    expect(evidence.reconciliationStatus).toBe("out_of_balance");
    expect(evidence.reconciliationDifference).toBe("18000.00");
    expect(evidence.totals).toEqual([
      {
        totalKey: "gross_margin",
        canonicalAmount: "18000.00",
        providerAmount: "0.00",
        difference: "-18000.00",
        status: "missing"
      }
    ]);
  });

  it("rejects unbounded reconciliation evidence comparisons and credential-like inputs", async () => {
    const client = createHandrailQuickBooksSyncClient(
      createHandrailQuickBooksFullSyncServiceHandler({
        loadFullSyncResources: () => normalizedFullSyncResources(),
        loadProviderReport: providerReportFixture()
      })
    );
    const providerReport = await client.profitAndLossReport(providerReportRequest("profit_and_loss"));

    expect(() =>
      buildQuickBooksProfitAndLossReconciliationEvidence({
        providerReport,
        canonicalTotals: Array.from({ length: 51 }, (_, index) => canonicalTotal(`total_${String(index)}`, `${String(index)}.00`))
      })
    ).toThrow(/reconciliation evidence totals must be bounded/);
    expect(() =>
      buildQuickBooksProfitAndLossReconciliationEvidence({
        providerReport: {
          ...providerReport,
          client_secret: "do-not-leak"
        } as typeof providerReport,
        canonicalTotals: [canonicalTotal("income", "20000.00")]
      })
    ).toThrow(/credential-like field is not allowed/);
    expect(() =>
      buildQuickBooksProfitAndLossReconciliationEvidence({
        providerReport: {
          ...providerReport,
          rawPayload: { reportRows: ["do-not-leak"] }
        } as typeof providerReport,
        canonicalTotals: [canonicalTotal("income", "20000.00")]
      })
    ).toThrow(/credential-like field is not allowed/);
  });
});

function fullSyncRequest(): NormalizedQuickBooksFullSyncRequestEnvelope {
  return {
    sourceIdentity: {
      tenantId: "tenant_sync",
      sourceId: "source_qbo_sync",
      sourceSystem: "quickbooks",
      providerEnvironment: "sandbox",
      realmId: "realm_sync",
      sourceCompanyRef: "realm_sync"
    },
    syncMode: "full",
    importBatchId: "batch_full_qbo_1",
    checkpointId: "checkpoint_full_qbo_1",
    cursorKind: "full_scan",
    cursorValue: "start",
    resourceCounts: {},
    idempotencyKey: "tenant_sync:source_qbo_sync:full:start",
    idempotencyKeys: {
      syncRequestKey: "tenant_sync:source_qbo_sync:full:start",
      importBatchId: "batch_full_qbo_1",
      checkpointId: "checkpoint_full_qbo_1",
      resourceSetKey: "tenant_sync:source_qbo_sync:batch_full_qbo_1:checkpoint_full_qbo_1"
    },
    requestedResourceTypes: ["CompanyInfo", "Account", "JournalEntry", "Customer", "Vendor", "Item", "Department", "Dimension"]
  };
}

function serviceHealthProbeRequest(): NormalizedQuickBooksServiceHealthProbeRequest {
  return {
    sourceIdentity: fullSyncRequest().sourceIdentity,
    providerMode: "sandbox",
    serviceEnvironment: "staging",
    checkpointId: "checkpoint_full_qbo_1",
    requestedAt: "2026-02-01T10:02:30.000Z"
  };
}

function healthCapability(
  status: "ready" | "degraded" | "unavailable",
  message: string
): { readonly status: "ready" | "degraded" | "unavailable"; readonly available: boolean; readonly message: string } {
  return {
    status,
    available: status !== "unavailable",
    message
  };
}

function incrementalSyncRequest(): NormalizedQuickBooksIncrementalSyncRequestEnvelope {
  return {
    sourceIdentity: fullSyncRequest().sourceIdentity,
    syncMode: "incremental",
    importBatchId: "batch_incremental_qbo_1",
    checkpointId: "checkpoint_incremental_qbo_1",
    cursorKind: "updated_since",
    cursorValue: "2026-02-01T10:00:00.000Z",
    resourceCounts: {},
    warningSummary: {
      count: 1,
      items: [
        {
          code: "quickbooks_sparse_vendor_skipped",
          message: "QuickBooks CDC returned a sparse Vendor update that was skipped by the normalizer.",
          severity: "info",
          resourceType: "Vendor",
          resourceId: "vendor_skipped",
          sourcePayloadRef: {
            sourceObjectType: "Vendor",
            sourceObjectId: "vendor_skipped",
            sourceUpdatedAt: "2026-02-01T10:08:00.000Z",
            storageRef: "quickbooks-sdk://sandbox/realm/realm_sync/Vendor/vendor_skipped",
            preview: {
              skipped: true,
              reason: "sparse_cdc_payload"
            }
          }
        }
      ]
    },
    idempotencyKey: "tenant_sync:source_qbo_sync:incremental:2026-02-01T10:00:00.000Z",
    idempotencyKeys: {
      syncRequestKey: "tenant_sync:source_qbo_sync:incremental:2026-02-01T10:00:00.000Z",
      importBatchId: "batch_incremental_qbo_1",
      checkpointId: "checkpoint_incremental_qbo_1",
      resourceSetKey: "tenant_sync:source_qbo_sync:batch_incremental_qbo_1:checkpoint_incremental_qbo_1"
    },
    requestedResourceTypes: ["Account", "JournalEntry", "Vendor"]
  };
}

function normalizedFullSyncResources(): NormalizedQuickBooksResourceSet {
  const identity = fullSyncRequest().sourceIdentity;
  const sourcePayloadRef = (
    sourceObjectType: string,
    sourceObjectId: string,
    preview: NonNullable<SafeSourcePayloadRef["preview"]> = {}
  ): SafeSourcePayloadRef => ({
    sourceObjectType,
    sourceObjectId,
    sourceUpdatedAt: "2026-02-01T09:59:59.000Z",
    storageRef: `quickbooks-sdk://sandbox/realm/${identity.realmId}/${sourceObjectType}/${sourceObjectId}`,
    preview
  });

  return {
    identity,
    importBatch: {
      importBatchId: "batch_full_qbo_1",
      syncMode: "full",
      mode: "initial",
      status: "completed",
      startedAt: "2026-02-01T09:55:00.000Z",
      completedAt: "2026-02-01T10:00:05.000Z",
      sourceObjectCounts: {}
    },
    checkpoint: {
      checkpointId: "checkpoint_full_qbo_1",
      sourceObject: "quickbooks_full_sync",
      cursorKind: "full_scan",
      cursorValue: "full:realm_sync:2026-02-01T10:00:00.000Z",
      freshThrough: "2026-02-01T10:00:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T09:59:59.000Z",
      status: "current"
    },
    companyInfo: {
      sourceSystem: "quickbooks",
      tenantId: identity.tenantId,
      sourceId: identity.sourceId,
      providerEnvironment: identity.providerEnvironment,
      realmId: identity.realmId,
      resourceType: "CompanyInfo",
      resourceId: identity.realmId,
      importBatchId: "batch_full_qbo_1",
      checkpointId: "checkpoint_full_qbo_1",
      sourcePayloadRef: sourcePayloadRef("CompanyInfo", identity.realmId, { realmId: identity.realmId }),
      resource: {
        companyName: "Full Sync QBO Co",
        legalName: "Full Sync QuickBooks Company LLC",
        baseCurrencyCode: "USD",
        fiscalYearStartMonth: 1
      }
    },
    accounts: [
      {
        sourceSystem: "quickbooks",
        tenantId: identity.tenantId,
        sourceId: identity.sourceId,
        providerEnvironment: identity.providerEnvironment,
        realmId: identity.realmId,
        resourceType: "Account",
        resourceId: "35",
        importBatchId: "batch_full_qbo_1",
        checkpointId: "checkpoint_full_qbo_1",
        sourcePayloadRef: sourcePayloadRef("Account", "35", { name: "Checking" }),
        resource: {
          sourceAccountId: "35",
          name: "Checking",
          accountNumber: "1000",
          accountType: "Bank",
          accountSubType: "Checking",
          classification: "asset",
          active: true,
          currencyCode: "USD",
          sourcePayloadRef: sourcePayloadRef("Account", "35", { name: "Checking" })
        }
      },
      {
        sourceSystem: "quickbooks",
        tenantId: identity.tenantId,
        sourceId: identity.sourceId,
        providerEnvironment: identity.providerEnvironment,
        realmId: identity.realmId,
        resourceType: "Account",
        resourceId: "79",
        importBatchId: "batch_full_qbo_1",
        checkpointId: "checkpoint_full_qbo_1",
        sourcePayloadRef: sourcePayloadRef("Account", "79", { name: "Services" }),
        resource: {
          sourceAccountId: "79",
          name: "Services",
          accountNumber: "4000",
          accountType: "Income",
          accountSubType: "ServiceFeeIncome",
          classification: "income",
          active: true,
          currencyCode: "USD"
        }
      }
    ],
    journalEntries: [
      {
        sourceSystem: "quickbooks",
        tenantId: identity.tenantId,
        sourceId: identity.sourceId,
        providerEnvironment: identity.providerEnvironment,
        realmId: identity.realmId,
        resourceType: "JournalEntry",
        resourceId: "100",
        importBatchId: "batch_full_qbo_1",
        checkpointId: "checkpoint_full_qbo_1",
        sourceUpdatedAt: "2026-02-01T09:59:59.000Z",
        sourcePayloadRef: sourcePayloadRef("JournalEntry", "100", { note: "x".repeat(1500) }),
        resource: {
          sourceTransactionId: "100",
          sourceTransactionType: "JournalEntry",
          transactionDate: "2026-01-15",
          transactionNumber: "JE-100",
          sourceUpdatedAt: "2026-02-01T09:59:59.000Z",
          currencyCode: "USD",
          memo: "Recognize services revenue",
          sourcePayloadRef: sourcePayloadRef("JournalEntry", "100", { note: "x".repeat(1500) }),
          lines: [
            {
              sourceLineId: "1",
              lineNumber: 1,
              amount: "500.00",
              accountRef: {
                sourceObjectId: "35",
                displayName: "Checking"
              },
              postings: [
                {
                  sourcePostingId: "100:1",
                  accountRef: {
                    sourceObjectId: "35",
                    displayName: "Checking"
                  },
                  postingDate: "2026-01-15",
                  accountingBasis: "accrual",
                  debitAmount: "500.00",
                  currencyCode: "USD",
                  sourcePayloadRef: sourcePayloadRef("JournalEntryLine", "100:1", { lineNumber: 1 })
                }
              ],
              sourcePayloadRef: sourcePayloadRef("JournalEntryLine", "100:1", { lineNumber: 1 })
            },
            {
              sourceLineId: "2",
              lineNumber: 2,
              amount: "-500.00",
              accountRef: {
                sourceObjectId: "79",
                displayName: "Services"
              },
              dimensionRefs: [
                {
                  dimensionKind: "department",
                  sourceObjectId: "ops",
                  displayName: "Operations"
                }
              ],
              postings: [
                {
                  sourcePostingId: "100:2",
                  accountRef: {
                    sourceObjectId: "79",
                    displayName: "Services"
                  },
                  postingDate: "2026-01-15",
                  accountingBasis: "accrual",
                  creditAmount: "500.00",
                  currencyCode: "USD",
                  sourcePayloadRef: sourcePayloadRef("JournalEntryLine", "100:2", { lineNumber: 2 })
                }
              ],
              sourcePayloadRef: sourcePayloadRef("JournalEntryLine", "100:2", { lineNumber: 2 })
            }
          ]
        }
      }
    ],
    customers: [
      {
        sourceSystem: "quickbooks",
        tenantId: identity.tenantId,
        sourceId: identity.sourceId,
        providerEnvironment: identity.providerEnvironment,
        realmId: identity.realmId,
        resourceType: "Customer",
        resourceId: "cust_1",
        resource: {
          sourceObjectId: "cust_1",
          displayName: "Sample Customer",
          partyType: "customer",
          active: true
        }
      }
    ],
    vendors: [
      {
        sourceSystem: "quickbooks",
        tenantId: identity.tenantId,
        sourceId: identity.sourceId,
        providerEnvironment: identity.providerEnvironment,
        realmId: identity.realmId,
        resourceType: "Vendor",
        resourceId: "vendor_1",
        resource: {
          sourceObjectId: "vendor_1",
          displayName: "Sample Vendor",
          partyType: "vendor",
          active: true
        }
      }
    ],
    items: [
      {
        sourceSystem: "quickbooks",
        tenantId: identity.tenantId,
        sourceId: identity.sourceId,
        providerEnvironment: identity.providerEnvironment,
        realmId: identity.realmId,
        resourceType: "Item",
        resourceId: "service_1",
        resource: {
          sourceObjectId: "service_1",
          displayName: "Implementation",
          itemType: "service",
          name: "Implementation",
          incomeAccountRef: {
            sourceObjectId: "79",
            displayName: "Services"
          },
          active: true
        }
      }
    ],
    departments: [
      {
        sourceSystem: "quickbooks",
        tenantId: identity.tenantId,
        sourceId: identity.sourceId,
        providerEnvironment: identity.providerEnvironment,
        realmId: identity.realmId,
        resourceType: "Department",
        resourceId: "ops",
        resource: {
          dimensionKind: "department",
          sourceObjectId: "ops",
          displayName: "Operations",
          name: "Operations",
          active: true
        }
      }
    ],
    dimensions: [
      {
        sourceSystem: "quickbooks",
        tenantId: identity.tenantId,
        sourceId: identity.sourceId,
        providerEnvironment: identity.providerEnvironment,
        realmId: identity.realmId,
        resourceType: "Dimension",
        resourceId: "department:ops",
        resource: {
          dimensionKind: "department",
          sourceObjectId: "ops",
          displayName: "Operations",
          name: "Operations",
          active: true
        }
      }
    ]
  };
}

function normalizedPartyResource(
  partyType: "customer" | "vendor",
  resourceId: string,
  displayName: string
): NormalizedQuickBooksPartyResource {
  const identity = fullSyncRequest().sourceIdentity;
  return {
    sourceSystem: "quickbooks",
    tenantId: identity.tenantId,
    sourceId: identity.sourceId,
    providerEnvironment: identity.providerEnvironment,
    realmId: identity.realmId,
    resourceType: "Party",
    resourceId,
    importBatchId: "batch_full_qbo_1",
    checkpointId: "checkpoint_full_qbo_1",
    sourceUpdatedAt: "2026-02-01T09:59:59.000Z",
    sourcePayloadRef: sandboxSourcePayloadRef("Party", resourceId),
    resource: {
      sourceObjectId: resourceId,
      displayName,
      partyType,
      active: true,
      sourceUpdatedAt: "2026-02-01T09:59:59.000Z",
      sourcePayloadRef: sandboxSourcePayloadRef(partyType === "customer" ? "Customer" : "Vendor", resourceId)
    }
  };
}

function normalizedLedgerPostingResource(
  sourcePostingId: string,
  sourceAccountId: string,
  accountName: string,
  postingKind: "debit" | "credit",
  amount: string,
  sourceObjectType: string
): NormalizedQuickBooksLedgerPostingResource {
  const identity = fullSyncRequest().sourceIdentity;
  return {
    sourceSystem: "quickbooks",
    tenantId: identity.tenantId,
    sourceId: identity.sourceId,
    providerEnvironment: identity.providerEnvironment,
    realmId: identity.realmId,
    resourceType: "LedgerPosting",
    resourceId: sourcePostingId,
    importBatchId: "batch_full_qbo_1",
    checkpointId: "checkpoint_full_qbo_1",
    sourceUpdatedAt: "2026-02-01T09:59:59.000Z",
    sourcePayloadRef: sandboxSourcePayloadRef(sourceObjectType, sourcePostingId),
    resource: {
      sourcePostingId,
      accountRef: {
        sourceObjectId: sourceAccountId,
        displayName: accountName
      },
      postingDate: sourcePostingId.startsWith("100:") ? "2026-01-15" : "2026-01-16",
      accountingBasis: "accrual",
      ...(postingKind === "debit" ? { debitAmount: amount } : { creditAmount: amount }),
      currencyCode: "USD",
      sourcePayloadRef: sandboxSourcePayloadRef(sourceObjectType, sourcePostingId)
    }
  };
}

function sandboxSourcePayloadRef(sourceObjectType: string, sourceObjectId: string): SafeSourcePayloadRef {
  const identity = fullSyncRequest().sourceIdentity;
  return {
    sourceObjectType,
    sourceObjectId,
    sourceUpdatedAt: "2026-02-01T09:59:59.000Z",
    storageRef: `quickbooks-sdk://sandbox/realm/${identity.realmId}/${sourceObjectType}/${sourceObjectId}`,
    preview: {
      sourceObjectType,
      sourceObjectId
    }
  };
}

function normalizedInvoiceLedgerTransactionResource(): NormalizedQuickBooksLedgerTransactionResource {
  const identity = fullSyncRequest().sourceIdentity;
  const sourcePayloadRef = (sourceObjectType: string, sourceObjectId: string): SafeSourcePayloadRef => ({
    sourceObjectType,
    sourceObjectId,
    sourceUpdatedAt: "2026-02-01T09:59:59.000Z",
    storageRef: `quickbooks-sdk://sandbox/realm/${identity.realmId}/${sourceObjectType}/${sourceObjectId}`,
    preview: {
      sourceObjectType,
      sourceObjectId
    }
  });

  return {
    sourceSystem: "quickbooks",
    tenantId: identity.tenantId,
    sourceId: identity.sourceId,
    providerEnvironment: identity.providerEnvironment,
    realmId: identity.realmId,
    resourceType: "LedgerTransaction",
    resourceId: "200",
    importBatchId: "batch_full_qbo_1",
    checkpointId: "checkpoint_full_qbo_1",
    sourceUpdatedAt: "2026-02-01T09:59:59.000Z",
    sourcePayloadRef: sourcePayloadRef("Invoice", "200"),
    resource: {
      sourceTransactionId: "200",
      sourceTransactionType: "Invoice",
      transactionDate: "2026-01-16",
      transactionNumber: "INV-200",
      sourceUpdatedAt: "2026-02-01T09:59:59.000Z",
      currencyCode: "USD",
      memo: "Services invoice",
      sourcePayloadRef: sourcePayloadRef("Invoice", "200"),
      lines: [
        {
          sourceLineId: "ar",
          lineNumber: 1,
          amount: "700.00",
          accountRef: {
            sourceObjectId: "35",
            displayName: "Checking"
          },
          postings: [
            {
              sourcePostingId: "200:ar",
              accountRef: {
                sourceObjectId: "35",
                displayName: "Checking"
              },
              postingDate: "2026-01-16",
              accountingBasis: "accrual",
              debitAmount: "700.00",
              currencyCode: "USD",
              sourcePayloadRef: sourcePayloadRef("InvoiceLine", "200:ar")
            }
          ],
          sourcePayloadRef: sourcePayloadRef("InvoiceLine", "200:ar")
        },
        {
          sourceLineId: "income",
          lineNumber: 2,
          amount: "-700.00",
          accountRef: {
            sourceObjectId: "79",
            displayName: "Services"
          },
          postings: [
            {
              sourcePostingId: "200:income",
              accountRef: {
                sourceObjectId: "79",
                displayName: "Services"
              },
              postingDate: "2026-01-16",
              accountingBasis: "accrual",
              creditAmount: "700.00",
              currencyCode: "USD",
              sourcePayloadRef: sourcePayloadRef("InvoiceLine", "200:income")
            }
          ],
          sourcePayloadRef: sourcePayloadRef("InvoiceLine", "200:income")
        }
      ]
    }
  };
}

function collectSourcePayloadRefs(value: unknown): readonly SafeSourcePayloadRef[] {
  const refs: SafeSourcePayloadRef[] = [];
  visitObjectEntries(value, (key, entry) => {
    if ((key === "sourcePayloadRef" || key === "drilldownRef") && isSourcePayloadRef(entry)) {
      refs.push(entry);
    }
  });
  return refs;
}

function visitObjectEntries(value: unknown, visitor: (key: string, entry: unknown) => void): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      visitObjectEntries(entry, visitor);
    });
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      visitor(key, entry);
      visitObjectEntries(entry, visitor);
    }
  }
}

function isSourcePayloadRef(value: unknown): value is SafeSourcePayloadRef {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as SafeSourcePayloadRef).sourceObjectType === "string" &&
    typeof (value as SafeSourcePayloadRef).sourceObjectId === "string"
  );
}

function normalizedIncrementalSyncResources(): NormalizedQuickBooksSyncResourceSet {
  const identity = fullSyncRequest().sourceIdentity;
  const sourcePayloadRef = (
    sourceObjectType: string,
    sourceObjectId: string,
    sourceUpdatedAt: string,
    preview: NonNullable<SafeSourcePayloadRef["preview"]> = {}
  ): SafeSourcePayloadRef => ({
    sourceObjectType,
    sourceObjectId,
    sourceUpdatedAt,
    storageRef: `quickbooks-sdk://sandbox/realm/${identity.realmId}/${sourceObjectType}/${sourceObjectId}`,
    preview
  });

  return {
    identity,
    importBatch: {
      importBatchId: "batch_incremental_qbo_1",
      syncMode: "incremental",
      mode: "delta",
      status: "completed_with_warnings",
      startedAt: "2026-02-01T10:10:00.000Z",
      completedAt: "2026-02-01T10:10:05.000Z",
      sourceObjectCounts: {}
    },
    checkpoint: {
      checkpointId: "checkpoint_incremental_qbo_1",
      sourceObject: "quickbooks_cdc",
      cursorKind: "updated_since",
      cursorValue: "cdc:realm_sync:2026-02-01T10:08:00.000Z",
      freshThrough: "2026-02-01T10:10:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T10:08:00.000Z",
      status: "current"
    },
    accounts: [
      {
        sourceSystem: "quickbooks",
        tenantId: identity.tenantId,
        sourceId: identity.sourceId,
        providerEnvironment: identity.providerEnvironment,
        realmId: identity.realmId,
        resourceType: "Account",
        resourceId: "35",
        importBatchId: "batch_incremental_qbo_1",
        checkpointId: "checkpoint_incremental_qbo_1",
        sourceUpdatedAt: "2026-02-01T10:06:00.000Z",
        syncAction: "changed",
        sourcePayloadRef: sourcePayloadRef("Account", "35", "2026-02-01T10:06:00.000Z", { name: "Checking - Operating" }),
        resource: {
          sourceAccountId: "35",
          name: "Checking - Operating",
          accountNumber: "1000",
          accountType: "Bank",
          accountSubType: "Checking",
          classification: "asset",
          active: true,
          currencyCode: "USD",
          sourceUpdatedAt: "2026-02-01T10:06:00.000Z"
        }
      },
      {
        sourceSystem: "quickbooks",
        tenantId: identity.tenantId,
        sourceId: identity.sourceId,
        providerEnvironment: identity.providerEnvironment,
        realmId: identity.realmId,
        resourceType: "Account",
        resourceId: "88",
        importBatchId: "batch_incremental_qbo_1",
        checkpointId: "checkpoint_incremental_qbo_1",
        sourceUpdatedAt: "2026-02-01T10:07:00.000Z",
        syncAction: "deleted",
        sourcePayloadRef: sourcePayloadRef("Account", "88", "2026-02-01T10:07:00.000Z", { deleted: true }),
        resource: {
          sourceAccountId: "88",
          name: "Legacy Clearing",
          accountType: "Other Current Asset",
          classification: "asset",
          active: false,
          currencyCode: "USD",
          sourceUpdatedAt: "2026-02-01T10:07:00.000Z"
        }
      }
    ],
    journalEntries: [
      {
        sourceSystem: "quickbooks",
        tenantId: identity.tenantId,
        sourceId: identity.sourceId,
        providerEnvironment: identity.providerEnvironment,
        realmId: identity.realmId,
        resourceType: "JournalEntry",
        resourceId: "101",
        importBatchId: "batch_incremental_qbo_1",
        checkpointId: "checkpoint_incremental_qbo_1",
        sourceUpdatedAt: "2026-02-01T10:08:00.000Z",
        syncAction: "voided",
        sourcePayloadRef: sourcePayloadRef("JournalEntry", "101", "2026-02-01T10:08:00.000Z", { status: "Voided" }),
        resource: {
          sourceTransactionId: "101",
          sourceTransactionType: "JournalEntry",
          transactionDate: "2026-01-20",
          transactionNumber: "JE-101",
          sourceUpdatedAt: "2026-02-01T10:08:00.000Z",
          currencyCode: "USD",
          memo: "Voided by QuickBooks CDC",
          sourcePayloadRef: sourcePayloadRef("JournalEntry", "101", "2026-02-01T10:08:00.000Z", { status: "Voided" }),
          lines: [
            {
              sourceLineId: "1",
              lineNumber: 1,
              amount: "0.00",
              accountRef: {
                sourceObjectId: "35",
                displayName: "Checking - Operating"
              },
              postings: [
                {
                  sourcePostingId: "101:1",
                  accountRef: {
                    sourceObjectId: "35",
                    displayName: "Checking - Operating"
                  },
                  postingDate: "2026-01-20",
                  accountingBasis: "accrual",
                  netAmount: "0.00",
                  currencyCode: "USD",
                  sourcePayloadRef: sourcePayloadRef("JournalEntryLine", "101:1", "2026-02-01T10:08:00.000Z", { voided: true })
                }
              ],
              sourcePayloadRef: sourcePayloadRef("JournalEntryLine", "101:1", "2026-02-01T10:08:00.000Z", { voided: true })
            },
            {
              sourceLineId: "2",
              lineNumber: 2,
              amount: "0.00",
              accountRef: {
                sourceObjectId: "79",
                displayName: "Services"
              },
              postings: [
                {
                  sourcePostingId: "101:2",
                  accountRef: {
                    sourceObjectId: "79",
                    displayName: "Services"
                  },
                  postingDate: "2026-01-20",
                  accountingBasis: "accrual",
                  netAmount: "0.00",
                  currencyCode: "USD",
                  sourcePayloadRef: sourcePayloadRef("JournalEntryLine", "101:2", "2026-02-01T10:08:00.000Z", { voided: true })
                }
              ],
              sourcePayloadRef: sourcePayloadRef("JournalEntryLine", "101:2", "2026-02-01T10:08:00.000Z", { voided: true })
            }
          ]
        }
      }
    ],
    vendors: [
      {
        sourceSystem: "quickbooks",
        tenantId: identity.tenantId,
        sourceId: identity.sourceId,
        providerEnvironment: identity.providerEnvironment,
        realmId: identity.realmId,
        resourceType: "Vendor",
        resourceId: "vendor_skipped",
        importBatchId: "batch_incremental_qbo_1",
        checkpointId: "checkpoint_incremental_qbo_1",
        sourceUpdatedAt: "2026-02-01T10:08:00.000Z",
        syncAction: "skipped",
        sourcePayloadRef: sourcePayloadRef("Vendor", "vendor_skipped", "2026-02-01T10:08:00.000Z", { skipped: true }),
        resource: {
          sourceObjectId: "vendor_skipped",
          displayName: "Sparse CDC Vendor",
          partyType: "vendor",
          active: true,
          sourceUpdatedAt: "2026-02-01T10:08:00.000Z"
        }
      }
    ]
  };
}

function quickBooksResourceIdentities(resources: NormalizedQuickBooksSyncResourceSet): readonly string[] {
  return [
    ...(resources.companyInfo === undefined ? [] : [`${resources.companyInfo.resourceType}:${resources.companyInfo.resourceId}`]),
    ...(resources.accounts ?? []).map((resource) => `${resource.resourceType}:${resource.resourceId}`),
    ...(resources.journalEntries ?? []).map((resource) => `${resource.resourceType}:${resource.resourceId}`),
    ...(resources.ledgerTransactions ?? []).map((resource) => `${resource.resourceType}:${resource.resourceId}`),
    ...(resources.ledgerPostings ?? []).map((resource) => `${resource.resourceType}:${resource.resourceId}`),
    ...(resources.parties ?? []).map((resource) => `${resource.resourceType}:${resource.resourceId}`),
    ...(resources.customers ?? []).map((resource) => `${resource.resourceType}:${resource.resourceId}`),
    ...(resources.vendors ?? []).map((resource) => `${resource.resourceType}:${resource.resourceId}`),
    ...(resources.items ?? []).map((resource) => `${resource.resourceType}:${resource.resourceId}`),
    ...(resources.classes ?? []).map((resource) => `${resource.resourceType}:${resource.resourceId}`),
    ...(resources.departments ?? []).map((resource) => `${resource.resourceType}:${resource.resourceId}`),
    ...(resources.dimensions ?? []).map((resource) => `${resource.resourceType}:${resource.resourceId}`)
  ];
}

function providerReportRequest(reportName: "profit_and_loss"): NormalizedQuickBooksProfitAndLossReportRequestEnvelope;
function providerReportRequest(reportName: "balance_sheet"): NormalizedQuickBooksBalanceSheetReportRequestEnvelope;
function providerReportRequest(reportName: "trial_balance"): NormalizedQuickBooksTrialBalanceReportRequestEnvelope;
function providerReportRequest(reportName: "cash_flow"): NormalizedQuickBooksCashFlowParityReportRequestEnvelope;
function providerReportRequest(reportName: NormalizedQuickBooksProviderReportName): NormalizedQuickBooksProviderReportRequestEnvelope {
  const base = {
    sourceIdentity: fullSyncRequest().sourceIdentity,
    reportName,
    accountingBasis: "accrual" as const,
    currencyCode: "USD" as const,
    requestedAt: "2026-02-01T10:02:00.000Z",
    idempotencyKey: `tenant_sync:source_qbo_sync:report:${reportName}:2026-01`
  };

  if (reportName === "balance_sheet") {
    return {
      ...base,
      reportName,
      asOfDate: "2026-01-31"
    };
  }

  return {
    ...base,
    reportName,
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31"
  };
}

function providerReportFixture(): HandrailQuickBooksProviderReportProvider {
  return (request) => {
    const totalsByReport = {
      profit_and_loss: [
        total("profit_and_loss", "income", "Income", "20000.00"),
        total("profit_and_loss", "expenses", "Expenses", "6200.00"),
        total("profit_and_loss", "net_income", "Net Income", "13800.00")
      ],
      balance_sheet: [
        total("balance_sheet", "assets", "Assets", "83900.00"),
        total("balance_sheet", "liabilities", "Liabilities", "-11200.00"),
        total("balance_sheet", "equity", "Equity", "-72700.00")
      ],
      trial_balance: [
        total("trial_balance", "debits", "Debits", "119900.00"),
        total("trial_balance", "credits", "Credits", "-119900.00"),
        total("trial_balance", "net", "Net", "0.00")
      ],
      cash_flow: []
    } satisfies Record<NormalizedQuickBooksProviderReportName, NormalizedQuickBooksProviderReportResult["totals"]>;

    return {
      providerReportRef: providerReportRef(request),
      sourceUpdatedAt: "2026-02-01T10:01:00.000Z",
      generatedAt: "2026-02-01T10:02:00.000Z",
      totals: totalsByReport[request.reportName]
    };
  };
}

function providerReportRef(request: NormalizedQuickBooksProviderReportRequestEnvelope): NormalizedQuickBooksProviderReportResult["providerReportRef"] {
  const periodRef =
    request.reportName === "balance_sheet" ? request.asOfDate ?? "missing-as-of" : `${request.periodStart ?? "missing"}:${request.periodEnd ?? "missing"}`;

  return {
    provider: "quickbooks",
    providerEnvironment: request.sourceIdentity.providerEnvironment,
    realmId: request.sourceIdentity.realmId,
    reportName: request.reportName,
    accountingBasis: request.accountingBasis,
    ...(request.periodStart === undefined ? {} : { periodStart: request.periodStart }),
    ...(request.periodEnd === undefined ? {} : { periodEnd: request.periodEnd }),
    sourceUpdatedAt: "2026-02-01T10:01:00.000Z",
    sourcePayloadRef: {
      sourceObjectType: "Report",
      sourceObjectId: `${request.reportName}:${periodRef}`,
      sourceUpdatedAt: "2026-02-01T10:01:00.000Z",
      storageRef: `quickbooks-sdk://sandbox/realm/${request.sourceIdentity.realmId}/Report/${request.reportName}/${periodRef}`,
      preview: {
        reportName: request.reportName,
        accountingBasis: request.accountingBasis
      }
    }
  };
}

function total(
  reportName: Exclude<NormalizedQuickBooksProviderReportName, "cash_flow">,
  totalKey: string,
  label: string,
  amount: string
): NormalizedQuickBooksProviderReportResult["totals"][number] {
  return {
    totalKey,
    label,
    amount,
    currencyCode: "USD",
    sourceUpdatedAt: "2026-02-01T10:01:00.000Z",
    drilldownRef: {
      sourceObjectType: "ReportTotal",
      sourceObjectId: `${reportName}:${totalKey}`,
      sourceUpdatedAt: "2026-02-01T10:01:00.000Z",
      storageRef: `quickbooks-sdk://sandbox/realm/realm_sync/Report/${reportName}/total/${totalKey}`,
      preview: {
        reportName,
        totalKey
      }
    }
  };
}

function canonicalTotal(totalKey: string, amount: string): NormalizedQuickBooksCanonicalReportTotal {
  return {
    totalKey,
    amount,
    currencyCode: "USD"
  };
}
