import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES,
  assertSafeSourcePayloadRef,
  createFutureErpQuickBooksFullSyncWorker,
  mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts
} from "../src/index.js";

import type {
  Account,
  AccountingDimension,
  AccountingTransaction,
  FutureErpCanonicalFactPersistenceStorage,
  Item,
  LedgerPosting,
  NormalizedQuickBooksFullSyncRequestEnvelope,
  Party,
  TransactionLine
} from "../src/index.js";

describe("Future ERP QuickBooks full sync orchestration", () => {
  it("maps normalized full-sync service responses into canonical facts and persists them", async () => {
    const fixture = ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.fullSync;
    const storage = new RecordingFullSyncStorage();
    let receivedRequest: NormalizedQuickBooksFullSyncRequestEnvelope | undefined;
    const worker = createFutureErpQuickBooksFullSyncWorker({
      quickBooksClient: {
        fullSync(request) {
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

    const result = await worker.fullSync(fixture.request);

    expect(receivedRequest).toBe(fixture.request);
    expect(result.adapterInput.context).toMatchObject({
      tenantId: "tenant_qbo_sync_fixture",
      companyId: "company_future_erp_qbo_fixture",
      sourceId: "source_qbo_sync_fixture",
      realmId: "realm_qbo_sync_fixture",
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
    expect(result.facts.company).toMatchObject({
      tenantId: "tenant_qbo_sync_fixture",
      companyId: "company_future_erp_qbo_fixture",
      sourceSystem: "quickbooks",
      providerEnvironment: "sandbox",
      sourceCompanyRef: "realm_qbo_sync_fixture"
    });
    expect(result.facts.source).toMatchObject({
      sourceId: "source_qbo_sync_fixture",
      sourceSystem: "quickbooks",
      providerEnvironment: "sandbox",
      connectionRef: "handrail-quickbooks-sdk:staging:sandbox:realm:realm_qbo_sync_fixture",
      importBatchId: "batch_qbo_full_fixture_2026_01",
      checkpointId: "checkpoint_qbo_full_fixture_2026_01"
    });
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
    expect(result.facts.transactions[0]).toMatchObject({
      sourceTransactionId: "100",
      sourceTransactionType: "JournalEntry",
      updatedAt: "2026-02-01T09:59:59.000Z"
    });
    expect(result.facts.postings.map((posting) => posting.sourcePayloadRef?.storageRef)).toEqual([
      "quickbooks-sdk://sandbox/realm/realm_qbo_sync_fixture/JournalEntryLine/100:1",
      "quickbooks-sdk://sandbox/realm/realm_qbo_sync_fixture/JournalEntryLine/100:2"
    ]);
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
    expect(postingTotals(result.facts.postings)).toEqual({
      debit: "500.00",
      credit: "500.00",
      net: "0.00"
    });
    expect(result.persistence).toMatchObject({
      tenantId: "tenant_qbo_sync_fixture",
      companyId: "company_future_erp_qbo_fixture",
      sourceId: "source_qbo_sync_fixture",
      importBatchId: "batch_qbo_full_fixture_2026_01",
      checkpointId: "checkpoint_qbo_full_fixture_2026_01",
      postings: 2
    });
    expect(storage.persistedPostings).toEqual(result.facts.postings);
    expect(JSON.stringify(result)).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|rawPayload/i);
  });

  it("maps a full-sync response envelope directly for host workers that already called the SDK service", () => {
    const response = ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.fullSync.response;

    const result = mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts(response, {
      companyId: "company_future_erp_qbo_fixture",
      accountingBasis: "accrual",
      currencyCode: "USD"
    });

    expect(result.facts.company.companyId).toBe("company_future_erp_qbo_fixture");
    expect(result.facts.importBatch.importBatchId).toBe(response.importBatchId);
    expect(result.facts.checkpoint.checkpointId).toBe(response.checkpointId);
    expect(result.facts.checkpoint.cursorKind).toBe("full_scan");
    expect(postingTotals(result.facts.postings).net).toBe("0.00");
  });
});

class RecordingFullSyncStorage implements FutureErpCanonicalFactPersistenceStorage {
  persistedPostings: readonly LedgerPosting[] | undefined;

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
    return Promise.resolve(postings.length);
  }
}

function postingTotals(postings: readonly LedgerPosting[]): { readonly debit: string; readonly credit: string; readonly net: string } {
  const debitMinor = postings.reduce((sum, posting) => sum + parseMoney(posting.debitAmount), 0n);
  const creditMinor = postings.reduce((sum, posting) => sum + parseMoney(posting.creditAmount), 0n);

  return {
    debit: formatMoney(debitMinor),
    credit: formatMoney(creditMinor),
    net: formatMoney(debitMinor - creditMinor)
  };
}

function parseMoney(value: string): bigint {
  const [whole = "0", fractional = ""] = value.split(".");
  const sign = whole.startsWith("-") ? -1n : 1n;
  const normalizedWhole = whole.replace("-", "");
  const cents = `${fractional}00`.slice(0, 2);
  return sign * (BigInt(normalizedWhole) * 100n + BigInt(cents));
}

function formatMoney(minor: bigint): string {
  const sign = minor < 0n ? "-" : "";
  const absolute = minor < 0n ? -minor : minor;
  const whole = absolute / 100n;
  const cents = absolute % 100n;
  return `${sign}${whole.toString()}.${cents.toString().padStart(2, "0")}`;
}
