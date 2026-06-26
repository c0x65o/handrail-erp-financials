import { assertNoCredentialKeys } from "./canonical-model.js";
import type { PostgresStorageAdapter } from "./postgres-storage.js";
import type { CanonicalAccountingFactSet } from "./source-adapters.js";

export type CanonicalFactPersistenceStorage = Pick<
  PostgresStorageAdapter,
  | "upsertAccountingCompany"
  | "upsertAccountingSource"
  | "upsertImportBatch"
  | "upsertSyncCheckpoint"
  | "upsertAccounts"
  | "upsertParties"
  | "upsertItems"
  | "upsertDimensions"
  | "upsertTransactions"
  | "upsertTransactionLines"
  | "upsertLedgerPostings"
>;

export type CanonicalFactPersistenceResult = {
  readonly tenantId: string;
  readonly companyId: string;
  readonly sourceId: string;
  readonly importBatchId: string;
  readonly checkpointId: string;
  readonly companies: number;
  readonly sources: number;
  readonly importBatches: number;
  readonly checkpoints: number;
  readonly accounts: number;
  readonly parties: number;
  readonly items: number;
  readonly dimensions: number;
  readonly transactions: number;
  readonly transactionLines: number;
  readonly postings: number;
};

export type CanonicalFactPersistenceWorker = {
  persist(facts: CanonicalAccountingFactSet): Promise<CanonicalFactPersistenceResult>;
};

export function createCanonicalFactPersistenceWorker(
  storage: CanonicalFactPersistenceStorage
): CanonicalFactPersistenceWorker {
  return {
    persist(facts) {
      return persistCanonicalFacts(storage, facts);
    }
  };
}

export async function persistCanonicalFacts(
  storage: CanonicalFactPersistenceStorage,
  facts: CanonicalAccountingFactSet
): Promise<CanonicalFactPersistenceResult> {
  assertNoCredentialKeys(facts);

  return {
    tenantId: facts.company.tenantId,
    companyId: facts.company.companyId,
    sourceId: facts.source.sourceId,
    importBatchId: facts.importBatch.importBatchId,
    checkpointId: facts.checkpoint.checkpointId,
    companies: await storage.upsertAccountingCompany(facts.company),
    sources: await storage.upsertAccountingSource(facts.source),
    importBatches: await storage.upsertImportBatch(facts.importBatch),
    checkpoints: await storage.upsertSyncCheckpoint(facts.checkpoint),
    accounts: await storage.upsertAccounts(facts.accounts),
    parties: await storage.upsertParties(facts.parties),
    items: await storage.upsertItems(facts.items),
    dimensions: await storage.upsertDimensions(facts.dimensions),
    transactions: await storage.upsertTransactions(facts.transactions),
    transactionLines: await storage.upsertTransactionLines(facts.transactionLines),
    postings: await storage.upsertLedgerPostings(facts.postings)
  };
}
