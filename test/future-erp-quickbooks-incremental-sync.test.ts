import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES,
  assertSafeSourcePayloadRef,
  createFutureErpQuickBooksIncrementalSyncWorker,
  mapNormalizedQuickBooksIncrementalSyncResponseToCanonicalFacts
} from "../src/index.js";

import type {
  Account,
  AccountingDimension,
  AccountingTransaction,
  FutureErpCanonicalFactPersistenceStorage,
  HandrailQuickBooksIncrementalSyncRequest,
  Item,
  LedgerPosting,
  NormalizedQuickBooksIncrementalSyncResponseEnvelope,
  Party,
  TransactionLine
} from "../src/index.js";

describe("Future ERP QuickBooks incremental sync orchestration", () => {
  it("maps incremental service responses into canonical fact changes with checkpoint metadata and resource actions", async () => {
    const fixture = ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.incrementalSync;
    const storage = new IdempotentIncrementalStorage();
    let receivedRequest: HandrailQuickBooksIncrementalSyncRequest | undefined;
    const worker = createFutureErpQuickBooksIncrementalSyncWorker({
      quickBooksClient: {
        incrementalSync(request) {
          receivedRequest = request;
          return Promise.resolve(fixture.response);
        }
      },
      persistence: storage,
      companyId: "company_future_erp_qbo_fixture",
      accountingBasis: "accrual",
      currencyCode: "USD",
      handrailQuickBooksServiceEnvironment: "staging"
    });

    const result = await worker.incrementalSync(fixture.request);

    expect(receivedRequest).toBe(fixture.request);
    expect(result.adapterInput.context).toMatchObject({
      tenantId: "tenant_qbo_sync_fixture",
      companyId: "company_future_erp_qbo_fixture",
      sourceId: "source_qbo_sync_fixture",
      realmId: "realm_qbo_sync_fixture",
      importBatchId: "batch_qbo_incremental_fixture_2026_02_01",
      checkpointId: "checkpoint_qbo_incremental_fixture_2026_02_01",
      accountingBasis: "accrual",
      defaultCurrencyCode: "USD",
      freshThrough: "2026-02-01T10:10:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T10:08:00.000Z"
    });
    expect(result.adapterInput.context.runtimeConfig).toEqual({
      serviceEnvironment: "staging",
      providerMode: "sandbox",
      tenantId: "tenant_qbo_sync_fixture"
    });
    expect(result.facts.importBatch).toMatchObject({
      importBatchId: "batch_qbo_incremental_fixture_2026_02_01",
      mode: "delta",
      status: "completed_with_warnings"
    });
    expect(result.facts.checkpoint).toEqual({
      tenantId: "tenant_qbo_sync_fixture",
      sourceId: "source_qbo_sync_fixture",
      checkpointId: "checkpoint_qbo_incremental_fixture_2026_02_01",
      sourceObject: "quickbooks_cdc",
      cursorKind: "updated_since",
      cursorValue: "cdc:realm_qbo_sync_fixture:2026-02-01T10:08:00.000Z",
      freshThrough: "2026-02-01T10:10:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T10:08:00.000Z",
      status: "current"
    });
    expect(result.changedResourceActions).toEqual([
      {
        resourceType: "Account",
        resourceId: "35",
        action: "changed",
        importBatchId: "batch_qbo_incremental_fixture_2026_02_01",
        checkpointId: "checkpoint_qbo_incremental_fixture_2026_02_01",
        sourceUpdatedAt: "2026-02-01T10:06:00.000Z"
      },
      {
        resourceType: "Account",
        resourceId: "88",
        action: "deleted",
        importBatchId: "batch_qbo_incremental_fixture_2026_02_01",
        checkpointId: "checkpoint_qbo_incremental_fixture_2026_02_01",
        sourceUpdatedAt: "2026-02-01T10:07:00.000Z"
      },
      {
        resourceType: "JournalEntry",
        resourceId: "101",
        action: "voided",
        importBatchId: "batch_qbo_incremental_fixture_2026_02_01",
        checkpointId: "checkpoint_qbo_incremental_fixture_2026_02_01",
        sourceUpdatedAt: "2026-02-01T10:08:00.000Z"
      },
      {
        resourceType: "Vendor",
        resourceId: "vendor_skipped",
        action: "skipped",
        importBatchId: "batch_qbo_incremental_fixture_2026_02_01",
        checkpointId: "checkpoint_qbo_incremental_fixture_2026_02_01",
        sourceUpdatedAt: "2026-02-01T10:08:00.000Z"
      }
    ]);
    expect(result.facts.transactions).toHaveLength(1);
    expect(result.facts.transactions[0]).toMatchObject({
      sourceTransactionId: "101",
      sourceTransactionType: "JournalEntry",
      transactionDate: "2026-01-20",
      updatedAt: "2026-02-01T10:08:00.000Z"
    });
    expect(result.facts.postings.map((posting) => posting.postingDate)).toEqual(["2026-01-20", "2026-01-20"]);
    expect(result.facts.postings.every((posting) => posting.checkpointId === fixture.response.checkpointId)).toBe(true);
    expect(result.facts.accounts.map((account) => account.sourceAccountId)).toEqual(["35", "88"]);
    for (const posting of result.facts.postings) {
      const sourcePayloadRef = posting.sourcePayloadRef;
      expect(sourcePayloadRef).toBeDefined();
      if (sourcePayloadRef === undefined) {
        throw new Error(`Expected sourcePayloadRef for posting ${posting.sourcePostingId}`);
      }
      assertSafeSourcePayloadRef(sourcePayloadRef);
    }
    expect(result.persistence).toMatchObject({
      tenantId: "tenant_qbo_sync_fixture",
      companyId: "company_future_erp_qbo_fixture",
      sourceId: "source_qbo_sync_fixture",
      importBatchId: "batch_qbo_incremental_fixture_2026_02_01",
      checkpointId: "checkpoint_qbo_incremental_fixture_2026_02_01",
      postings: 2
    });
    expect(JSON.stringify(result)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i);
  });

  it("preserves resume checkpoints and does not duplicate ledger postings when the same import batch is replayed", async () => {
    const fixture = ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.checkpointReplay;
    const storage = new IdempotentIncrementalStorage();
    const worker = createFutureErpQuickBooksIncrementalSyncWorker({
      quickBooksClient: {
        incrementalSync(request) {
          expect("resumeFromCheckpointId" in request ? request.resumeFromCheckpointId : undefined).toBe(
            "checkpoint_qbo_full_fixture_2026_01"
          );
          return Promise.resolve(fixture.response);
        }
      },
      persistence: storage,
      companyId: "company_future_erp_qbo_fixture",
      accountingBasis: "accrual",
      currencyCode: "USD"
    });

    const firstReplay = await worker.incrementalSync(fixture.request);
    const secondReplay = await worker.incrementalSync(fixture.request);

    expect(firstReplay.resumeFromCheckpointId).toBe("checkpoint_qbo_full_fixture_2026_01");
    expect(secondReplay.resumeFromCheckpointId).toBe("checkpoint_qbo_full_fixture_2026_01");
    expect(firstReplay.facts.importBatch.importBatchId).toBe("batch_qbo_checkpoint_replay_fixture_2026_02_01");
    expect(firstReplay.facts.checkpoint.checkpointId).toBe("checkpoint_qbo_checkpoint_replay_fixture_2026_02_01");
    expect(firstReplay.persistence.postings).toBe(2);
    expect(secondReplay.persistence.postings).toBe(0);
    expect(storage.uniqueLedgerPostingCount).toBe(2);
    expect(secondReplay.facts.postings.map((posting) => posting.postingId)).toEqual(
      firstReplay.facts.postings.map((posting) => posting.postingId)
    );
  });

  it("maps an incremental response envelope directly for host workers that already called the SDK service", () => {
    const response: NormalizedQuickBooksIncrementalSyncResponseEnvelope =
      ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.incrementalSync.response;

    const result = mapNormalizedQuickBooksIncrementalSyncResponseToCanonicalFacts(response, {
      companyId: "company_future_erp_qbo_fixture",
      accountingBasis: "accrual",
      currencyCode: "USD",
      resumeFromCheckpointId: "checkpoint_qbo_full_fixture_2026_01"
    });

    expect(result.resumeFromCheckpointId).toBe("checkpoint_qbo_full_fixture_2026_01");
    expect(result.facts.company.companyId).toBe("company_future_erp_qbo_fixture");
    expect(result.facts.importBatch.importBatchId).toBe(response.importBatchId);
    expect(result.facts.checkpoint.cursorKind).toBe("updated_since");
    expect(result.changedResourceActions.map((action) => `${action.resourceType}:${action.resourceId}:${action.action}`)).toEqual([
      "Account:35:changed",
      "Account:88:deleted",
      "JournalEntry:101:voided",
      "Vendor:vendor_skipped:skipped"
    ]);
  });
});

class IdempotentIncrementalStorage implements FutureErpCanonicalFactPersistenceStorage {
  readonly ledgerPostingKeys = new Set<string>();

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
