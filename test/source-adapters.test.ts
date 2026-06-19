import { describe, expect, it } from "vitest";

import {
  buildProfitAndLossReport,
  buildTrialBalanceReport,
  mapNativeLedgerToCanonicalFacts,
  mapQuickBooksJournalEntriesToCanonicalFacts
} from "../src/index.js";

import type {
  CanonicalAccountingFactSet,
  NativeLedgerAdapterInput,
  QuickBooksJournalEntryAdapterInput,
  ReportBuilderInput,
  SourceAdapterContext
} from "../src/index.js";

describe("source adapter contracts", () => {
  it("maps QuickBooks-shaped SDK data into canonical postings for the shared report builders", () => {
    const facts = mapQuickBooksJournalEntriesToCanonicalFacts(quickBooksFixtureInput());
    const profitAndLoss = buildProfitAndLossReport(reportInput(facts));
    const trialBalance = buildTrialBalanceReport(reportInput(facts));

    expect(totalAmount(profitAndLoss, "total_income")).toBe("500.00");
    expect(totalAmount(profitAndLoss, "net_income")).toBe("500.00");
    expect(totalAmount(trialBalance, "total_debits")).toBe("500.00");
    expect(totalAmount(trialBalance, "total_credits")).toBe("500.00");

    expect(facts.source.sourceSystem).toBe("quickbooks");
    expect(facts.source.providerEnvironment).toBe("sandbox");
    expect(facts.source.connectionRef).toBe("handrail-quickbooks-sdk:staging:sandbox:realm:123145999999999");
    expect(facts.company.sourceCompanyRef).toBe("123145999999999");
    expect(facts.importBatch.importBatchId).toBe("batch_qbo_1");
    expect(facts.checkpoint.checkpointId).toBe("checkpoint_qbo_1");

    const cashPosting = postingByAccountName(facts, "Checking");
    expect(cashPosting.importBatchId).toBe("batch_qbo_1");
    expect(cashPosting.checkpointId).toBe("checkpoint_qbo_1");
    expect(cashPosting.sourcePostingId).toBe("100:1");
    expect(cashPosting.sourcePayloadRef?.sourceObjectType).toBe("JournalEntryLine");
    expect(cashPosting.sourcePayloadRef?.sourceObjectId).toBe("100:1");
    expect(cashPosting.sourcePayloadRef?.sourceUpdatedAt).toBe("2026-02-01T10:00:00.000Z");
    expect(cashPosting.sourcePayloadRef?.storageRef).toBe("quickbooks://sandbox/realm/123145999999999/JournalEntryLine/100:1");
    expect(JSON.stringify(facts)).not.toMatch(/access[_-]?token|refresh[_-]?token|client_secret/i);
  });

  it("maps native ERP ledger data into the same canonical posting path", () => {
    const facts = mapNativeLedgerToCanonicalFacts(nativeFixtureInput());
    const profitAndLoss = buildProfitAndLossReport(reportInput(facts));
    const trialBalance = buildTrialBalanceReport(reportInput(facts));

    expect(facts.source.sourceSystem).toBe("native_erp");
    expect(facts.source.providerEnvironment).toBe("native");
    expect(totalAmount(profitAndLoss, "total_income")).toBe("500.00");
    expect(totalAmount(profitAndLoss, "net_income")).toBe("500.00");
    expect(totalAmount(trialBalance, "total_debits")).toBe("500.00");
    expect(totalAmount(trialBalance, "total_credits")).toBe("500.00");
    expect(facts.postings.map((posting) => posting.importBatchId)).toEqual(["batch_native_1", "batch_native_1"]);
    expect(facts.postings.map((posting) => posting.checkpointId)).toEqual(["checkpoint_native_1", "checkpoint_native_1"]);
  });
});

function quickBooksFixtureInput(): QuickBooksJournalEntryAdapterInput {
  return {
    context: {
      tenantId: "tenant_adapter",
      companyId: "company_qbo",
      sourceId: "source_qbo",
      realmId: "123145999999999",
      providerEnvironment: "sandbox",
      importBatchId: "batch_qbo_1",
      checkpointId: "checkpoint_qbo_1",
      accountingBasis: "accrual",
      defaultCurrencyCode: "USD",
      importedAt: "2026-02-01T10:05:00.000Z",
      freshThrough: "2026-02-01T10:00:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T10:00:00.000Z",
      runtimeConfig: {
        serviceEnvironment: "staging",
        providerMode: "sandbox",
        tenantId: "tenant_adapter"
      }
    },
    companyInfo: {
      CompanyName: "Adapter QBO Co",
      LegalName: "Adapter QuickBooks Company LLC",
      FiscalYearStartMonth: 1
    },
    accounts: [
      {
        Id: "35",
        Name: "Checking",
        AcctNum: "1000",
        AccountType: "Bank",
        AccountSubType: "Checking",
        Active: true,
        CurrencyRef: {
          value: "USD"
        }
      },
      {
        Id: "79",
        Name: "Services",
        AcctNum: "4000",
        AccountType: "Income",
        AccountSubType: "ServiceFeeIncome",
        Active: true,
        CurrencyRef: {
          value: "USD"
        }
      }
    ],
    journalEntries: [
      {
        Id: "100",
        SyncToken: "2",
        TxnDate: "2026-01-15",
        DocNumber: "JE-100",
        PrivateNote: "Recognize services revenue",
        CurrencyRef: {
          value: "USD"
        },
        MetaData: {
          LastUpdatedTime: "2026-02-01T10:00:00.000Z"
        },
        Line: [
          {
            Id: "1",
            LineNum: 1,
            Description: "Cash received",
            Amount: "500.00",
            JournalEntryLineDetail: {
              PostingType: "Debit",
              AccountRef: {
                value: "35",
                name: "Checking"
              },
              DepartmentRef: {
                value: "ops",
                name: "Operations"
              }
            }
          },
          {
            Id: "2",
            LineNum: 2,
            Description: "Services revenue",
            Amount: "500.00",
            JournalEntryLineDetail: {
              PostingType: "Credit",
              AccountRef: {
                value: "79",
                name: "Services"
              },
              ClassRef: {
                value: "services",
                name: "Services"
              }
            }
          }
        ]
      }
    ]
  };
}

function nativeFixtureInput(): NativeLedgerAdapterInput {
  const context: SourceAdapterContext = {
    tenantId: "tenant_adapter",
    companyId: "company_native",
    sourceId: "source_native",
    sourceSystem: "native_erp",
    providerEnvironment: "native",
    sourceCompanyRef: "native-company-1",
    connectionRef: "native-ledger:native-company-1",
    importBatchId: "batch_native_1",
    checkpointId: "checkpoint_native_1",
    accountingBasis: "accrual",
    defaultCurrencyCode: "USD",
    importedAt: "2026-02-01T10:05:00.000Z",
    freshThrough: "2026-02-01T10:00:00.000Z",
    latestSourceUpdatedAt: "2026-02-01T10:00:00.000Z"
  };

  return {
    context,
    company: {
      legalName: "Adapter Native Company LLC",
      displayName: "Adapter Native Co",
      fiscalYearStartMonth: 1
    },
    accounts: [
      {
        sourceAccountId: "cash",
        accountNumber: "1000",
        name: "Checking",
        classification: "asset",
        type: "asset",
        subtype: "Bank",
        currencyCode: "USD"
      },
      {
        sourceAccountId: "services",
        accountNumber: "4000",
        name: "Services",
        classification: "income",
        type: "income",
        subtype: "ServiceRevenue",
        currencyCode: "USD"
      }
    ],
    transactions: [
      {
        sourceTransactionId: "native-je-100",
        sourceTransactionType: "JournalEntry",
        transactionDate: "2026-01-15",
        transactionNumber: "NJE-100",
        updatedAt: "2026-02-01T10:00:00.000Z",
        currencyCode: "USD",
        memo: "Recognize services revenue",
        lines: [
          {
            sourceLineId: "1",
            lineNumber: 1,
            accountSourceId: "cash",
            amount: "500.00",
            description: "Cash received"
          },
          {
            sourceLineId: "2",
            lineNumber: 2,
            accountSourceId: "services",
            amount: "-500.00",
            description: "Services revenue"
          }
        ]
      }
    ]
  };
}

function reportInput(facts: CanonicalAccountingFactSet): ReportBuilderInput {
  return {
    tenantId: facts.company.tenantId,
    accounts: facts.accounts,
    postings: facts.postings,
    accountingBasis: "accrual",
    currencyCode: "USD",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    asOfDate: "2026-01-31",
    generatedAt: "2026-02-01T11:00:00.000Z",
    freshness: {
      status: "fresh",
      sourceId: facts.source.sourceId,
      importBatchId: facts.importBatch.importBatchId,
      checkpointId: facts.checkpoint.checkpointId,
      freshThrough: facts.checkpoint.freshThrough
    }
  };
}

function totalAmount(report: ReturnType<typeof buildProfitAndLossReport>, totalKey: string): string {
  const total = report.totals.find((entry) => entry.totalKey === totalKey);
  expect(total).toBeDefined();
  return total?.amount ?? "";
}

function postingByAccountName(facts: CanonicalAccountingFactSet, accountName: string) {
  const account = facts.accounts.find((entry) => entry.name === accountName);
  expect(account).toBeDefined();
  const posting = facts.postings.find((entry) => entry.accountId === account?.accountId);
  expect(posting).toBeDefined();
  if (posting === undefined) {
    throw new Error(`Missing posting for account ${accountName}`);
  }
  return posting;
}
