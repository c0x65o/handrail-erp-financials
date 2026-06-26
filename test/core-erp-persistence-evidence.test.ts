import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES,
  buildCoreErpPersistenceEvidence,
  createQuickBooksIncrementalSyncWorker,
  mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts
} from "../src/index.js";

import type {
  Account,
  AccountingDimension,
  AccountingTransaction,
  CanonicalFactPersistenceResult,
  CanonicalFactPersistenceStorage,
  Item,
  LedgerPosting,
  Party,
  ReportFreshnessRow,
  TransactionLine
} from "../src/index.js";

const SENSITIVE_EVIDENCE_PATTERN =
  /access[_-]?token|refresh[_-]?token|client[_-]?secret|clientSecret|credential|rawPayload|rawProviderPayload/i;

describe("Core ERP persistence evidence", () => {
  it("builds bounded Core ERP evidence with import batch, checkpoint, counts, freshness, and source refs", () => {
    const mapped = mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts(
      ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.fullSync.response,
      {
        companyId: "company_core_erp_qbo_fixture",
        accountingBasis: "accrual",
        currencyCode: "USD"
      }
    );
    const persistence = persistenceResultFor(mapped.facts.postings.length, mapped.facts);
    const freshnessRows: readonly ReportFreshnessRow[] = [
      {
        freshnessId: "freshness_core_erp_profit_and_loss",
        tenantId: mapped.facts.company.tenantId,
        companyId: mapped.facts.company.companyId,
        sourceId: mapped.facts.source.sourceId,
        reportName: "profit_and_loss",
        accountingBasis: "accrual",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        currencyCode: "USD",
        status: "fresh",
        freshThrough: "2026-02-01T10:00:00.000Z",
        importBatchId: mapped.facts.importBatch.importBatchId,
        checkpointId: mapped.facts.checkpoint.checkpointId,
        updatedAt: "2026-02-01T10:00:01.000Z"
      }
    ];

    const evidence = buildCoreErpPersistenceEvidence({
      facts: mapped.facts,
      persistence,
      freshnessRows,
      maxSourceRefs: 1,
      maxDrilldownPostingIds: 1
    });

    expect(evidence).toMatchObject({
      tenantId: "tenant_qbo_sync_fixture",
      companyId: "company_core_erp_qbo_fixture",
      sourceId: "source_qbo_sync_fixture",
      sourceSystem: "quickbooks",
      providerEnvironment: "sandbox",
      importBatch: {
        importBatchId: "batch_qbo_full_fixture_2026_01",
        mode: "initial",
        status: "completed",
        rowsWritten: 1
      },
      checkpoint: {
        checkpointId: "checkpoint_qbo_full_fixture_2026_01",
        sourceObject: "quickbooks_full_sync",
        cursorKind: "full_scan",
        status: "current",
        rowsWritten: 1
      },
      freshness: {
        status: "fresh",
        freshThrough: "2026-02-01T10:00:00.000Z",
        rowCount: 1,
        returnedRows: 1,
        truncated: false
      }
    });
    expect(evidence.canonicalRowCounts).toEqual({
      companies: 1,
      sources: 1,
      importBatches: 1,
      checkpoints: 1,
      accounts: mapped.facts.accounts.length,
      parties: mapped.facts.parties.length,
      items: mapped.facts.items.length,
      dimensions: mapped.facts.dimensions.length,
      transactions: mapped.facts.transactions.length,
      transactionLines: mapped.facts.transactionLines.length,
      postings: mapped.facts.postings.length
    });
    expect(evidence.writeCounts.postings).toBe(mapped.facts.postings.length);
    expect(evidence.freshness.rows[0]).toMatchObject({
      importBatchId: mapped.facts.importBatch.importBatchId,
      checkpointId: mapped.facts.checkpoint.checkpointId
    });
    expect(evidence.sourceReferences.totalAvailable).toBeGreaterThan(1);
    expect(evidence.sourceReferences.returned).toBe(1);
    expect(evidence.sourceReferences.truncated).toBe(true);
    expect(evidence.sourceReferences.drilldownRef.postingCount).toBe(mapped.facts.postings.length);
    expect(evidence.sourceReferences.drilldownRef.postingIds).toBeUndefined();
    expect(JSON.stringify(evidence)).not.toMatch(SENSITIVE_EVIDENCE_PATTERN);
  });

  it("returns Core ERP evidence from incremental sync with resume checkpoint and changed resources", async () => {
    const fixture = ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.checkpointReplay;
    const worker = createQuickBooksIncrementalSyncWorker({
      quickBooksClient: {
        incrementalSync() {
          return Promise.resolve(fixture.response);
        }
      },
      persistence: new IdempotentCoreErpStorage(),
      companyId: "company_core_erp_qbo_fixture",
      accountingBasis: "accrual",
      currencyCode: "USD"
    });

    const result = await worker.incrementalSync(fixture.request);

    expect(result.evidence.importBatch.importBatchId).toBe("batch_qbo_checkpoint_replay_fixture_2026_02_01");
    expect(result.evidence.checkpoint).toMatchObject({
      checkpointId: "checkpoint_qbo_checkpoint_replay_fixture_2026_02_01",
      resumeFromCheckpointId: "checkpoint_qbo_full_fixture_2026_01",
      cursorKind: "updated_since"
    });
    expect(result.evidence.canonicalRowCounts.postings).toBe(2);
    expect(result.evidence.writeCounts.postings).toBe(2);
    expect(result.evidence.freshness.status).toBe("fresh");
    expect(result.evidence.changedResources.actions).toEqual([
      {
        resourceType: "JournalEntry",
        resourceId: "101",
        action: "voided",
        importBatchId: "batch_qbo_checkpoint_replay_fixture_2026_02_01",
        checkpointId: "checkpoint_qbo_checkpoint_replay_fixture_2026_02_01",
        sourceUpdatedAt: "2026-02-01T10:08:00.000Z"
      }
    ]);
    expect(JSON.stringify(result.evidence)).not.toMatch(SENSITIVE_EVIDENCE_PATTERN);
  });
});

class IdempotentCoreErpStorage implements CanonicalFactPersistenceStorage {
  readonly postingIds = new Set<string>();

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
    const before = this.postingIds.size;
    postings.forEach((posting) => this.postingIds.add(posting.postingId));
    return Promise.resolve(this.postingIds.size - before);
  }
}

function persistenceResultFor(postings: number, facts: { readonly accounts: readonly Account[] }): CanonicalFactPersistenceResult {
  return {
    tenantId: "tenant_qbo_sync_fixture",
    companyId: "company_core_erp_qbo_fixture",
    sourceId: "source_qbo_sync_fixture",
    importBatchId: "batch_qbo_full_fixture_2026_01",
    checkpointId: "checkpoint_qbo_full_fixture_2026_01",
    companies: 1,
    sources: 1,
    importBatches: 1,
    checkpoints: 1,
    accounts: facts.accounts.length,
    parties: 0,
    items: 0,
    dimensions: 0,
    transactions: 1,
    transactionLines: postings,
    postings
  };
}
