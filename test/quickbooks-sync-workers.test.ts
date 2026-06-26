import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES,
  assertSafeSourcePayloadRef,
  createQuickBooksFullSyncWorker,
  createQuickBooksIncrementalSyncWorker,
  mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts,
  mapNormalizedQuickBooksIncrementalSyncResponseToCanonicalFacts
} from "../src/index.js";

import type {
  Account,
  AccountingDimension,
  AccountingTransaction,
  CanonicalFactPersistenceStorage,
  HandrailQuickBooksIncrementalSyncRequest,
  Item,
  LedgerPosting,
  NormalizedQuickBooksFullSyncRequestEnvelope,
  NormalizedQuickBooksIncrementalSyncResponseEnvelope,
  Party,
  TransactionLine
} from "../src/index.js";

describe("host-neutral QuickBooks sync workers", () => {
  it("maps and persists full-sync responses through neutral exports", async () => {
    const fixture = ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.fullSync;
    const storage = new RecordingCanonicalStorage();
    let receivedRequest: NormalizedQuickBooksFullSyncRequestEnvelope | undefined;
    const worker = createQuickBooksFullSyncWorker({
      quickBooksClient: {
        fullSync(request) {
          receivedRequest = request;
          return Promise.resolve(fixture.response);
        }
      },
      persistence: storage,
      companyId: "company_core_erp_qbo_fixture",
      accountingBasis: "accrual",
      currencyCode: "USD",
      handrailQuickBooksServiceEnvironment: "staging"
    });

    const result = await worker.fullSync(fixture.request);

    expect(receivedRequest).toBe(fixture.request);
    expect(result.adapterInput.context).toMatchObject({
      tenantId: "tenant_qbo_sync_fixture",
      companyId: "company_core_erp_qbo_fixture",
      sourceId: "source_qbo_sync_fixture",
      importBatchId: "batch_qbo_full_fixture_2026_01",
      checkpointId: "checkpoint_qbo_full_fixture_2026_01",
      accountingBasis: "accrual",
      defaultCurrencyCode: "USD",
      latestSourceUpdatedAt: "2026-02-01T09:59:59.000Z"
    });
    expect(result.adapterInput.context.runtimeConfig).toEqual({
      serviceEnvironment: "staging",
      providerMode: "sandbox",
      tenantId: "tenant_qbo_sync_fixture"
    });
    expect(result.facts.company.companyId).toBe("company_core_erp_qbo_fixture");
    expect(result.facts.importBatch).toMatchObject({
      importBatchId: "batch_qbo_full_fixture_2026_01",
      mode: "initial",
      status: "completed"
    });
    expect(result.facts.checkpoint).toEqual({
      tenantId: "tenant_qbo_sync_fixture",
      sourceId: "source_qbo_sync_fixture",
      checkpointId: "checkpoint_qbo_full_fixture_2026_01",
      sourceObject: "quickbooks_full_sync",
      cursorKind: "full_scan",
      cursorValue: "full:realm_qbo_sync_fixture:2026-02-01T10:00:00.000Z",
      freshThrough: "2026-02-01T10:00:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T09:59:59.000Z",
      status: "current"
    });
    expect(result.persistence).toMatchObject({
      tenantId: "tenant_qbo_sync_fixture",
      companyId: "company_core_erp_qbo_fixture",
      sourceId: "source_qbo_sync_fixture",
      importBatchId: "batch_qbo_full_fixture_2026_01",
      checkpointId: "checkpoint_qbo_full_fixture_2026_01",
      postings: 2
    });
    expect(storage.persistedPostings).toEqual(result.facts.postings);
    for (const posting of result.facts.postings) {
      expect(posting.importBatchId).toBe("batch_qbo_full_fixture_2026_01");
      expect(posting.checkpointId).toBe("checkpoint_qbo_full_fixture_2026_01");
      const sourcePayloadRef = posting.sourcePayloadRef;
      expect(sourcePayloadRef).toBeDefined();
      if (sourcePayloadRef === undefined) {
        throw new Error(`Expected sourcePayloadRef for posting ${posting.sourcePostingId}`);
      }
      assertSafeSourcePayloadRef(sourcePayloadRef);
    }
    expect(JSON.stringify(result)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i);
  });

  it("maps incremental responses with checkpoint resume metadata, resource actions, and idempotent persistence", async () => {
    const fixture = ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.checkpointReplay;
    const storage = new RecordingCanonicalStorage();
    let receivedRequest: HandrailQuickBooksIncrementalSyncRequest | undefined;
    const worker = createQuickBooksIncrementalSyncWorker({
      quickBooksClient: {
        incrementalSync(request) {
          receivedRequest = request;
          return Promise.resolve(fixture.response);
        }
      },
      persistence: storage,
      companyId: "company_core_erp_qbo_fixture",
      accountingBasis: "accrual",
      currencyCode: "USD"
    });

    const firstReplay = await worker.incrementalSync(fixture.request);
    const secondReplay = await worker.incrementalSync(fixture.request);

    expect(receivedRequest).toBe(fixture.request);
    expect(firstReplay.resumeFromCheckpointId).toBe("checkpoint_qbo_full_fixture_2026_01");
    expect(secondReplay.resumeFromCheckpointId).toBe("checkpoint_qbo_full_fixture_2026_01");
    expect(firstReplay.facts.importBatch).toMatchObject({
      importBatchId: "batch_qbo_checkpoint_replay_fixture_2026_02_01",
      mode: "delta"
    });
    expect(firstReplay.facts.checkpoint).toMatchObject({
      checkpointId: "checkpoint_qbo_checkpoint_replay_fixture_2026_02_01",
      sourceObject: "quickbooks_checkpoint_replay",
      cursorKind: "updated_since"
    });
    expect(firstReplay.changedResourceActions.map((action) => `${action.resourceType}:${action.resourceId}:${action.action}`)).toEqual([
      "JournalEntry:101:voided"
    ]);
    expect(firstReplay.persistence.postings).toBe(2);
    expect(secondReplay.persistence.postings).toBe(0);
    expect(storage.uniqueLedgerPostingCount).toBe(2);
    expect(secondReplay.facts.postings.map((posting) => posting.postingId)).toEqual(
      firstReplay.facts.postings.map((posting) => posting.postingId)
    );
    expect(JSON.stringify(firstReplay)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i);
  });

  it("maps normalized envelopes directly through neutral mapping exports", () => {
    const fullSync = mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts(
      ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.fullSync.response,
      {
        companyId: "company_core_erp_qbo_fixture",
        accountingBasis: "accrual",
        currencyCode: "USD"
      }
    );
    const incrementalResponse: NormalizedQuickBooksIncrementalSyncResponseEnvelope =
      ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.incrementalSync.response;
    const incrementalSync = mapNormalizedQuickBooksIncrementalSyncResponseToCanonicalFacts(incrementalResponse, {
      companyId: "company_core_erp_qbo_fixture",
      accountingBasis: "accrual",
      currencyCode: "USD",
      resumeFromCheckpointId: "checkpoint_qbo_full_fixture_2026_01"
    });

    expect(fullSync.facts.company.companyId).toBe("company_core_erp_qbo_fixture");
    expect(fullSync.facts.importBatch.importBatchId).toBe("batch_qbo_full_fixture_2026_01");
    expect(incrementalSync.resumeFromCheckpointId).toBe("checkpoint_qbo_full_fixture_2026_01");
    expect(incrementalSync.facts.checkpoint.cursorKind).toBe("updated_since");
    expect(incrementalSync.changedResourceActions.map((action) => `${action.resourceType}:${action.resourceId}:${action.action}`)).toEqual([
      "Account:35:changed",
      "Account:88:deleted",
      "JournalEntry:101:voided",
      "Vendor:vendor_skipped:skipped"
    ]);
  });
});

class RecordingCanonicalStorage implements CanonicalFactPersistenceStorage {
  readonly ledgerPostingKeys = new Set<string>();
  persistedPostings: readonly LedgerPosting[] | undefined;

  get uniqueLedgerPostingCount(): number {
    return this.ledgerPostingKeys.size;
  }

  upsertAccountingCompany(): Promise<number> {
    return Promise.resolve(1);
  }

  upsertAccountingSource(): Promise<number> {
    return Promise.resolve(1);
  }

  upsertImportBatch(): Promise<number> {
    return Promise.resolve(1);
  }

  upsertSyncCheckpoint(): Promise<number> {
    return Promise.resolve(1);
  }

  upsertAccounts(accounts: readonly Account[]): Promise<number> {
    return Promise.resolve(accounts.length);
  }

  upsertParties(parties: readonly Party[]): Promise<number> {
    return Promise.resolve(parties.length);
  }

  upsertItems(items: readonly Item[]): Promise<number> {
    return Promise.resolve(items.length);
  }

  upsertDimensions(dimensions: readonly AccountingDimension[]): Promise<number> {
    return Promise.resolve(dimensions.length);
  }

  upsertTransactions(transactions: readonly AccountingTransaction[]): Promise<number> {
    return Promise.resolve(transactions.length);
  }

  upsertTransactionLines(lines: readonly TransactionLine[]): Promise<number> {
    return Promise.resolve(lines.length);
  }

  upsertLedgerPostings(postings: readonly LedgerPosting[]): Promise<number> {
    this.persistedPostings = postings;
    let inserted = 0;
    for (const posting of postings) {
      const key = `${posting.tenantId}:${posting.sourceId}:${posting.accountingBasis}:${posting.sourcePostingId}`;
      if (!this.ledgerPostingKeys.has(key)) {
        this.ledgerPostingKeys.add(key);
        inserted += 1;
      }
    }
    return Promise.resolve(inserted);
  }
}
