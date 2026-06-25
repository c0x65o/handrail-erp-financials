import type {
  Account,
  AccountingCompany,
  AccountingBasis,
  AccountingDimension,
  AccountingSource,
  AccountingTransaction,
  DecimalString,
  DimensionRef,
  DrilldownRef,
  ImportBatch,
  IsoCurrencyCode,
  IsoDate,
  IsoDateTime,
  Item,
  LedgerPosting,
  Party,
  ReconciliationStatus,
  ReportFreshness,
  SafeSourcePayloadRef,
  SourceId,
  SyncCheckpoint,
  TransactionLine
} from "./canonical-model.js";
import { createDimensionHash } from "./canonical-model.js";
import type { CanonicalAccountingFactSet, QuickBooksJournalEntryAdapterInput } from "./source-adapters.js";
import { mapQuickBooksJournalEntriesToCanonicalFacts } from "./source-adapters.js";
import type { BuiltReport, CashFlowActivity, ReportBuilderInput, ReportName } from "./report-builders.js";
import { buildBalanceSheetReport, buildProfitAndLossReport, buildTrialBalanceReport } from "./report-builders.js";
import type {
  HandrailQuickBooksIncrementalSyncRequest,
  NormalizedQuickBooksProviderReportReconciliationEvidenceInput
} from "./quickbooks-sync-service.js";
import {
  buildQuickBooksServiceHealthProbeResponse,
  buildNormalizedQuickBooksFullSyncResponse,
  buildNormalizedQuickBooksIncrementalSyncResponse,
  buildNormalizedQuickBooksProviderReportResponse,
  buildQuickBooksProviderReportReconciliationEvidence,
  buildUnsupportedQuickBooksCashFlowParityReportResponse
} from "./quickbooks-sync-service.js";
import type {
  NormalizedAccountingReconciliationEvidence,
  NormalizedQuickBooksBalanceSheetReportRequestEnvelope,
  NormalizedQuickBooksBalanceSheetReportResponseEnvelope,
  NormalizedQuickBooksCashFlowParityReportRequestEnvelope,
  NormalizedQuickBooksCashFlowParityReportResponseEnvelope,
  NormalizedQuickBooksCanonicalReportTotal,
  NormalizedQuickBooksFullSyncRequestEnvelope,
  NormalizedQuickBooksFullSyncResponseEnvelope,
  NormalizedQuickBooksIncrementalSyncResponseEnvelope,
  NormalizedQuickBooksLedgerLine,
  NormalizedQuickBooksDimensionRef,
  NormalizedQuickBooksProfitAndLossReportRequestEnvelope,
  NormalizedQuickBooksProfitAndLossReportResponseEnvelope,
  NormalizedQuickBooksProviderReportName,
  NormalizedQuickBooksProviderReportRequestEnvelope,
  NormalizedQuickBooksProviderReportResult,
  NormalizedQuickBooksProviderReportTotal,
  NormalizedQuickBooksResourceEnvelope,
  NormalizedQuickBooksResourceSet,
  NormalizedQuickBooksServiceHealthProbeRequest,
  NormalizedQuickBooksServiceHealthProbeResponseEnvelope,
  NormalizedQuickBooksSourceIdentity,
  NormalizedQuickBooksSyncResourceSet,
  NormalizedQuickBooksTrialBalanceReportRequestEnvelope,
  NormalizedQuickBooksTrialBalanceReportResponseEnvelope
} from "./normalized-accounting-contracts.js";

export type StatementFixtureSet = {
  readonly company: AccountingCompany;
  readonly source: AccountingSource;
  readonly importBatch: ImportBatch;
  readonly checkpoint: SyncCheckpoint;
  readonly accounts: readonly Account[];
  readonly parties: readonly Party[];
  readonly items: readonly Item[];
  readonly dimensions: readonly AccountingDimension[];
  readonly transactions: readonly AccountingTransaction[];
  readonly transactionLines: readonly TransactionLine[];
  readonly postings: readonly LedgerPosting[];
  readonly reportRequest: {
    readonly tenantId: string;
    readonly accountingBasis: "accrual";
    readonly currencyCode: "USD";
    readonly periodStart: "2026-01-01";
    readonly periodEnd: "2026-01-31";
    readonly asOfDate: "2026-01-31";
    readonly generatedAt: "2026-02-01T00:00:00.000Z";
  };
  readonly cashFlow: {
    readonly cashAccountIds: readonly string[];
    readonly activityByAccountId: Readonly<Record<string, Exclude<CashFlowActivity, "unclassified">>>;
  };
  readonly expectedTotals: {
    readonly profitAndLoss: Readonly<Record<string, string>>;
    readonly balanceSheet: Readonly<Record<string, string>>;
    readonly trialBalance: Readonly<Record<string, string>>;
    readonly cashFlow: Readonly<Record<string, string>>;
  };
};

export type ProviderReportTotalComparison = {
  readonly totalKey: string;
  readonly providerAmount: DecimalString;
  readonly erpAmount: DecimalString;
  readonly difference: DecimalString;
  readonly status: "matched" | "mismatched";
  readonly drilldownRef?: DrilldownRef;
};

export type ProviderReportReconciliationEvidence = {
  readonly provider: "quickbooks";
  readonly reportName: ReportName;
  readonly sourceId: SourceId;
  readonly importBatchId: string;
  readonly checkpointId: string;
  readonly accountingBasis: AccountingBasis;
  readonly currencyCode: IsoCurrencyCode;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly asOfDate?: IsoDate;
  readonly comparedAt: IsoDateTime;
  readonly toleranceAmount: DecimalString;
  readonly reconciliationStatus: ReconciliationStatus;
  readonly reconciliationDifference: DecimalString;
  readonly providerReportRef: SafeSourcePayloadRef;
  readonly totals: readonly ProviderReportTotalComparison[];
};

export type QuickBooksAdapterFixtureSet = {
  readonly input: QuickBooksJournalEntryAdapterInput;
  readonly facts: CanonicalAccountingFactSet;
  readonly reportRequest: ReportBuilderInput;
  readonly reports: {
    readonly profitAndLoss: BuiltReport;
    readonly balanceSheet: BuiltReport;
    readonly trialBalance: BuiltReport;
  };
  readonly providerReportEvidence: readonly ProviderReportReconciliationEvidence[];
};

export type NormalizedQuickBooksProviderReportFixtureSet = {
  readonly profitAndLoss: {
    readonly request: NormalizedQuickBooksProfitAndLossReportRequestEnvelope;
    readonly providerResult: NormalizedQuickBooksProviderReportResult;
    readonly response: NormalizedQuickBooksProfitAndLossReportResponseEnvelope;
  };
  readonly balanceSheet: {
    readonly request: NormalizedQuickBooksBalanceSheetReportRequestEnvelope;
    readonly providerResult: NormalizedQuickBooksProviderReportResult;
    readonly response: NormalizedQuickBooksBalanceSheetReportResponseEnvelope;
  };
  readonly trialBalance: {
    readonly request: NormalizedQuickBooksTrialBalanceReportRequestEnvelope;
    readonly providerResult: NormalizedQuickBooksProviderReportResult;
    readonly response: NormalizedQuickBooksTrialBalanceReportResponseEnvelope;
  };
  readonly cashFlow: {
    readonly request: NormalizedQuickBooksCashFlowParityReportRequestEnvelope;
    readonly response: NormalizedQuickBooksCashFlowParityReportResponseEnvelope;
  };
};

export type NormalizedQuickBooksReconciliationDifferenceFixtureSet = {
  readonly matchedProfitAndLoss: NormalizedAccountingReconciliationEvidence;
  readonly outOfBalanceProfitAndLoss: NormalizedAccountingReconciliationEvidence;
  readonly missingProviderTotal: NormalizedAccountingReconciliationEvidence;
};

export type NormalizedQuickBooksServiceHealthFixture = {
  readonly request: NormalizedQuickBooksServiceHealthProbeRequest;
  readonly response: NormalizedQuickBooksServiceHealthProbeResponseEnvelope;
};

export type NormalizedQuickBooksServiceHealthFixtureSet = {
  readonly ready: NormalizedQuickBooksServiceHealthFixture;
  readonly degraded: NormalizedQuickBooksServiceHealthFixture;
  readonly unavailable: NormalizedQuickBooksServiceHealthFixture;
};

export type NormalizedQuickBooksSyncFixtureSet = {
  readonly fullSync: {
    readonly request: NormalizedQuickBooksFullSyncRequestEnvelope;
    readonly resources: NormalizedQuickBooksResourceSet;
    readonly response: NormalizedQuickBooksFullSyncResponseEnvelope;
  };
  readonly incrementalSync: {
    readonly request: HandrailQuickBooksIncrementalSyncRequest;
    readonly resources: NormalizedQuickBooksSyncResourceSet;
    readonly response: NormalizedQuickBooksIncrementalSyncResponseEnvelope;
  };
  readonly checkpointReplay: {
    readonly request: HandrailQuickBooksIncrementalSyncRequest;
    readonly resources: NormalizedQuickBooksSyncResourceSet;
    readonly response: NormalizedQuickBooksIncrementalSyncResponseEnvelope;
  };
  readonly providerReports: NormalizedQuickBooksProviderReportFixtureSet;
  readonly reconciliationDifferences: NormalizedQuickBooksReconciliationDifferenceFixtureSet;
  readonly serviceHealth: NormalizedQuickBooksServiceHealthFixtureSet;
};

const tenantId = "tenant_fixture";
const sourceId = "source_native_fixture";
const importBatchId = "batch_fixture_2026_01";
const checkpointId = "checkpoint_fixture_2026_01";
const currencyCode = "USD";
const accountingBasis = "accrual";

const chicagoOps: readonly DimensionRef[] = [
  {
    dimensionId: "dim_location_chicago",
    dimensionKind: "location",
    sourceDimensionId: "chicago",
    name: "Chicago"
  },
  {
    dimensionId: "dim_department_operations",
    dimensionKind: "department",
    sourceDimensionId: "operations",
    name: "Operations"
  }
];
const chicagoAdmin: readonly DimensionRef[] = [
  {
    dimensionId: "dim_location_chicago",
    dimensionKind: "location",
    sourceDimensionId: "chicago",
    name: "Chicago"
  },
  {
    dimensionId: "dim_department_admin",
    dimensionKind: "department",
    sourceDimensionId: "admin",
    name: "Admin"
  }
];
const noDimensions: readonly DimensionRef[] = [];

const opsHash = createDimensionHash(chicagoOps);
const adminHash = createDimensionHash(chicagoAdmin);
const emptyHash = createDimensionHash(noDimensions);

export const ERP_FINANCIALS_STATEMENT_FIXTURE: StatementFixtureSet = {
  company: {
    tenantId,
    companyId: "company_fixture",
    legalName: "Fixture Manufacturing LLC",
    displayName: "Fixture Manufacturing",
    baseCurrencyCode: currencyCode,
    fiscalYearStartMonth: 1,
    providerEnvironment: "native",
    sourceSystem: "native_erp",
    sourceCompanyRef: "fixture-company"
  },
  source: {
    tenantId,
    sourceId,
    sourceSystem: "native_erp",
    providerEnvironment: "native",
    connectionRef: "fixture-native-ledger",
    importBatchId,
    checkpointId,
    latestSyncedAt: "2026-02-01T00:00:00.000Z",
    status: "active"
  },
  importBatch: {
    tenantId,
    sourceId,
    importBatchId,
    mode: "fixture",
    status: "completed",
    startedAt: "2026-02-01T00:00:00.000Z",
    completedAt: "2026-02-01T00:00:01.000Z",
    sourceObjectCounts: {
      accounts: 13,
      transactions: 11,
      postings: 22
    }
  },
  checkpoint: {
    tenantId,
    sourceId,
    checkpointId,
    sourceObject: "fixture-ledger",
    cursorKind: "full_scan",
    cursorValue: "fixture-2026-01",
    freshThrough: "2026-02-01T00:00:00.000Z",
    latestSourceUpdatedAt: "2026-02-01T00:00:00.000Z",
    status: "current"
  },
  accounts: [
    account("acct_cash", "1000", "Operating Cash", "asset", "Bank"),
    account("acct_ar", "1100", "Accounts Receivable", "asset", "AccountsReceivable"),
    account("acct_equipment", "1500", "Equipment", "asset", "FixedAsset"),
    account("acct_suspense", "1999", "Suspense Clearing", "asset", "OtherCurrentAsset"),
    account("acct_ap", "2000", "Accounts Payable", "liability", "AccountsPayable"),
    account("acct_loan", "2400", "Term Loan", "liability", "LongTermLiability"),
    account("acct_capital", "3000", "Owner Capital", "equity", "OpeningBalanceEquity"),
    account("acct_draw", "3100", "Owner Draws", "equity", "OwnerDraw"),
    account("acct_sales", "4000", "Product Revenue", "income", "SalesOfProductIncome"),
    account("acct_cogs", "5000", "Cost of Goods Sold", "cost_of_goods_sold", "CostOfGoodsSold"),
    account("acct_expense", "6100", "Operating Expense", "expense", "Expense"),
    account("acct_expense_facilities", "6110", "Facilities Expense", "expense", "Expense", "acct_expense"),
    account("acct_expense_utilities", "6111", "Utilities Expense", "expense", "Expense", "acct_expense_facilities")
  ],
  parties: [
    party("party_customer_acme", "customer", "Acme Stores"),
    party("party_vendor_supply", "vendor", "Supply Vendor"),
    party("party_vendor_landlord", "vendor", "Landlord LLC"),
    party("party_lender", "other", "Community Lender"),
    party("party_owner", "employee", "Primary Owner")
  ],
  items: [
    item("item_widget", "product", "Widget", "acct_sales", "acct_cogs", undefined),
    item("item_install", "service", "Installation", "acct_sales", undefined, undefined),
    item("item_equipment", "inventory", "Production Equipment", undefined, undefined, "acct_equipment")
  ],
  dimensions: [
    dimension("dim_location_chicago", "location", "chicago", "Chicago"),
    dimension("dim_department_operations", "department", "operations", "Operations"),
    dimension("dim_department_admin", "department", "admin", "Admin")
  ],
  transactions: [
    transaction("txn_opening", "JournalEntry", "OPEN-2026", "2025-12-31", "Opening capitalization", "party_owner"),
    transaction("txn_cash_sale", "SalesReceipt", "SR-1001", "2026-01-05", "Cash sale", "party_customer_acme"),
    transaction("txn_invoice", "Invoice", "INV-1002", "2026-01-08", "Accrual invoice", "party_customer_acme"),
    transaction("txn_cogs", "BillPayment", "BP-1003", "2026-01-10", "Inventory purchase paid from cash", "party_vendor_supply"),
    transaction("txn_rent", "Check", "CHK-1004", "2026-01-12", "Monthly rent", "party_vendor_landlord"),
    transaction("txn_equipment", "Check", "CHK-1005", "2026-01-15", "Equipment purchase", "party_vendor_supply"),
    transaction("txn_loan", "Deposit", "DEP-1006", "2026-01-18", "Loan proceeds", "party_lender"),
    transaction("txn_draw", "Check", "CHK-1007", "2026-01-20", "Owner draw", "party_owner"),
    transaction("txn_unclassified", "JournalEntry", "JE-1008", "2026-01-25", "Cash movement with unclear source", undefined),
    transaction("txn_collection", "Payment", "PMT-1009", "2026-01-28", "Customer payment", "party_customer_acme"),
    transaction("txn_accrued_bill", "Bill", "BILL-1010", "2026-01-30", "Accrued utility bill", "party_vendor_supply")
  ],
  transactionLines: [
    line("line_opening_cash", "txn_opening", 1, "acct_cash", "50000.00", undefined, undefined, noDimensions),
    line("line_opening_capital", "txn_opening", 2, "acct_capital", "-50000.00", "party_owner", undefined, noDimensions),
    line("line_cash_sale_cash", "txn_cash_sale", 1, "acct_cash", "12000.00", "party_customer_acme", "item_widget", chicagoOps),
    line("line_cash_sale_revenue", "txn_cash_sale", 2, "acct_sales", "-12000.00", "party_customer_acme", "item_widget", chicagoOps),
    line("line_invoice_ar", "txn_invoice", 1, "acct_ar", "8000.00", "party_customer_acme", "item_install", chicagoOps),
    line("line_invoice_revenue", "txn_invoice", 2, "acct_sales", "-8000.00", "party_customer_acme", "item_install", chicagoOps),
    line("line_cogs_expense", "txn_cogs", 1, "acct_cogs", "3000.00", "party_vendor_supply", "item_widget", chicagoOps),
    line("line_cogs_cash", "txn_cogs", 2, "acct_cash", "-3000.00", "party_vendor_supply", "item_widget", chicagoOps),
    line("line_rent_expense", "txn_rent", 1, "acct_expense", "2000.00", "party_vendor_landlord", undefined, chicagoAdmin),
    line("line_rent_cash", "txn_rent", 2, "acct_cash", "-2000.00", "party_vendor_landlord", undefined, chicagoAdmin),
    line("line_equipment_asset", "txn_equipment", 1, "acct_equipment", "15000.00", "party_vendor_supply", "item_equipment", noDimensions),
    line("line_equipment_cash", "txn_equipment", 2, "acct_cash", "-15000.00", "party_vendor_supply", "item_equipment", noDimensions),
    line("line_loan_cash", "txn_loan", 1, "acct_cash", "10000.00", "party_lender", undefined, noDimensions),
    line("line_loan_liability", "txn_loan", 2, "acct_loan", "-10000.00", "party_lender", undefined, noDimensions),
    line("line_draw_equity", "txn_draw", 1, "acct_draw", "1000.00", "party_owner", undefined, noDimensions),
    line("line_draw_cash", "txn_draw", 2, "acct_cash", "-1000.00", "party_owner", undefined, noDimensions),
    line("line_unclassified_cash", "txn_unclassified", 1, "acct_cash", "700.00", undefined, undefined, noDimensions),
    line("line_unclassified_suspense", "txn_unclassified", 2, "acct_suspense", "-700.00", undefined, undefined, noDimensions),
    line("line_collection_cash", "txn_collection", 1, "acct_cash", "2000.00", "party_customer_acme", undefined, chicagoOps),
    line("line_collection_ar", "txn_collection", 2, "acct_ar", "-2000.00", "party_customer_acme", undefined, chicagoOps),
    line(
      "line_accrued_bill_expense",
      "txn_accrued_bill",
      1,
      "acct_expense_utilities",
      "1200.00",
      "party_vendor_supply",
      undefined,
      chicagoAdmin
    ),
    line("line_accrued_bill_ap", "txn_accrued_bill", 2, "acct_ap", "-1200.00", "party_vendor_supply", undefined, chicagoAdmin)
  ],
  postings: [
    posting("post_opening_cash", "txn_opening", "line_opening_cash", "acct_cash", "2025-12-31", "50000.00", "0.00", noDimensions),
    posting("post_opening_capital", "txn_opening", "line_opening_capital", "acct_capital", "2025-12-31", "0.00", "50000.00", noDimensions),
    posting("post_cash_sale_cash", "txn_cash_sale", "line_cash_sale_cash", "acct_cash", "2026-01-05", "12000.00", "0.00", chicagoOps),
    posting("post_cash_sale_revenue", "txn_cash_sale", "line_cash_sale_revenue", "acct_sales", "2026-01-05", "0.00", "12000.00", chicagoOps),
    posting("post_invoice_ar", "txn_invoice", "line_invoice_ar", "acct_ar", "2026-01-08", "8000.00", "0.00", chicagoOps),
    posting("post_invoice_revenue", "txn_invoice", "line_invoice_revenue", "acct_sales", "2026-01-08", "0.00", "8000.00", chicagoOps),
    posting("post_cogs_expense", "txn_cogs", "line_cogs_expense", "acct_cogs", "2026-01-10", "3000.00", "0.00", chicagoOps),
    posting("post_cogs_cash", "txn_cogs", "line_cogs_cash", "acct_cash", "2026-01-10", "0.00", "3000.00", chicagoOps),
    posting("post_rent_expense", "txn_rent", "line_rent_expense", "acct_expense", "2026-01-12", "2000.00", "0.00", chicagoAdmin),
    posting("post_rent_cash", "txn_rent", "line_rent_cash", "acct_cash", "2026-01-12", "0.00", "2000.00", chicagoAdmin),
    posting("post_equipment_asset", "txn_equipment", "line_equipment_asset", "acct_equipment", "2026-01-15", "15000.00", "0.00", noDimensions),
    posting("post_equipment_cash", "txn_equipment", "line_equipment_cash", "acct_cash", "2026-01-15", "0.00", "15000.00", noDimensions),
    posting("post_loan_cash", "txn_loan", "line_loan_cash", "acct_cash", "2026-01-18", "10000.00", "0.00", noDimensions),
    posting("post_loan_liability", "txn_loan", "line_loan_liability", "acct_loan", "2026-01-18", "0.00", "10000.00", noDimensions),
    posting("post_draw_equity", "txn_draw", "line_draw_equity", "acct_draw", "2026-01-20", "1000.00", "0.00", noDimensions),
    posting("post_draw_cash", "txn_draw", "line_draw_cash", "acct_cash", "2026-01-20", "0.00", "1000.00", noDimensions),
    posting("post_unclassified_cash", "txn_unclassified", "line_unclassified_cash", "acct_cash", "2026-01-25", "700.00", "0.00", noDimensions),
    posting("post_unclassified_suspense", "txn_unclassified", "line_unclassified_suspense", "acct_suspense", "2026-01-25", "0.00", "700.00", noDimensions),
    posting("post_collection_cash", "txn_collection", "line_collection_cash", "acct_cash", "2026-01-28", "2000.00", "0.00", chicagoOps),
    posting("post_collection_ar", "txn_collection", "line_collection_ar", "acct_ar", "2026-01-28", "0.00", "2000.00", chicagoOps),
    posting(
      "post_accrued_bill_expense",
      "txn_accrued_bill",
      "line_accrued_bill_expense",
      "acct_expense_utilities",
      "2026-01-30",
      "1200.00",
      "0.00",
      chicagoAdmin
    ),
    posting("post_accrued_bill_ap", "txn_accrued_bill", "line_accrued_bill_ap", "acct_ap", "2026-01-30", "0.00", "1200.00", chicagoAdmin)
  ],
  reportRequest: {
    tenantId,
    accountingBasis,
    currencyCode,
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    asOfDate: "2026-01-31",
    generatedAt: "2026-02-01T00:00:00.000Z"
  },
  cashFlow: {
    cashAccountIds: ["acct_cash"],
    activityByAccountId: {
      acct_ar: "operating",
      acct_sales: "operating",
      acct_cogs: "operating",
      acct_expense: "operating",
      acct_expense_facilities: "operating",
      acct_expense_utilities: "operating",
      acct_equipment: "investing",
      acct_loan: "financing",
      acct_draw: "financing"
    }
  },
  expectedTotals: {
    profitAndLoss: {
      total_income: "20000.00",
      total_cost_of_goods_sold: "3000.00",
      gross_profit: "17000.00",
      total_expenses: "3200.00",
      net_operating_income: "13800.00",
      net_income: "13800.00"
    },
    balanceSheet: {
      total_assets: "74000.00",
      total_liabilities: "11200.00",
      total_equity: "62800.00",
      total_liabilities_and_equity: "74000.00"
    },
    trialBalance: {
      total_debits: "81900.00",
      total_credits: "81900.00"
    },
    cashFlow: {
      cash_beginning: "50000.00",
      net_operating_cash: "9000.00",
      net_investing_cash: "-15000.00",
      net_financing_cash: "9000.00",
      unclassified_cash_movement: "700.00",
      net_cash_flow: "3700.00",
      cash_ending: "53700.00"
    }
  }
};

const quickBooksAdapterInput: QuickBooksJournalEntryAdapterInput = {
  context: {
    tenantId: "tenant_qbo_fixture",
    companyId: "company_qbo_fixture",
    sourceId: "source_qbo_fixture",
    realmId: "123145999999999",
    providerEnvironment: "sandbox",
    importBatchId: "batch_qbo_fixture_2026_01",
    checkpointId: "checkpoint_qbo_fixture_2026_01",
    accountingBasis: "accrual",
    defaultCurrencyCode: "USD",
    importedAt: "2026-02-01T10:05:00.000Z",
    freshThrough: "2026-02-01T10:00:00.000Z",
    latestSourceUpdatedAt: "2026-02-01T10:00:00.000Z",
    runtimeConfig: {
      serviceEnvironment: "staging",
      providerMode: "sandbox",
      tenantId: "tenant_qbo_fixture"
    }
  },
  companyInfo: {
    CompanyName: "Fixture QuickBooks Company",
    LegalName: "Fixture QuickBooks Company LLC",
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

const quickBooksFacts = mapQuickBooksJournalEntriesToCanonicalFacts(quickBooksAdapterInput);
const quickBooksReportRequest = reportRequestFromFacts(quickBooksFacts, "2026-01-01", "2026-01-31", "2026-01-31", "2026-02-01T11:00:00.000Z");
const quickBooksReports = {
  profitAndLoss: buildProfitAndLossReport(quickBooksReportRequest),
  balanceSheet: buildBalanceSheetReport(quickBooksReportRequest),
  trialBalance: buildTrialBalanceReport(quickBooksReportRequest)
};

export const ERP_FINANCIALS_QUICKBOOKS_ADAPTER_FIXTURE: QuickBooksAdapterFixtureSet = {
  input: quickBooksAdapterInput,
  facts: quickBooksFacts,
  reportRequest: quickBooksReportRequest,
  reports: quickBooksReports,
  providerReportEvidence: [
    providerReportEvidence(quickBooksFacts, quickBooksReportRequest, "profit_and_loss", quickBooksReports.profitAndLoss, {
      total_income: "500.00",
      net_income: "500.00"
    }),
    providerReportEvidence(quickBooksFacts, quickBooksReportRequest, "balance_sheet", quickBooksReports.balanceSheet, {
      total_assets: "500.00",
      total_equity: "500.00",
      total_liabilities_and_equity: "500.00"
    }),
    providerReportEvidence(quickBooksFacts, quickBooksReportRequest, "trial_balance", quickBooksReports.trialBalance, {
      total_debits: "500.00",
      total_credits: "500.00"
    })
  ]
};

const normalizedQuickBooksIdentity: NormalizedQuickBooksSourceIdentity = {
  tenantId: "tenant_qbo_sync_fixture",
  sourceId: "source_qbo_sync_fixture",
  sourceSystem: "quickbooks",
  providerEnvironment: "sandbox",
  realmId: "realm_qbo_sync_fixture",
  sourceCompanyRef: "realm_qbo_sync_fixture"
};

const normalizedQuickBooksFullSyncRequest: NormalizedQuickBooksFullSyncRequestEnvelope = {
  sourceIdentity: normalizedQuickBooksIdentity,
  syncMode: "full",
  importBatchId: "batch_qbo_full_fixture_2026_01",
  checkpointId: "checkpoint_qbo_full_fixture_2026_01",
  cursorKind: "full_scan",
  cursorValue: "start",
  resourceCounts: {},
  requestedAt: "2026-02-01T10:00:00.000Z",
  requestedResourceTypes: ["CompanyInfo", "Account", "JournalEntry", "Customer", "Vendor", "Item", "Department", "Dimension"],
  idempotencyKey: "tenant_qbo_sync_fixture:source_qbo_sync_fixture:full:start",
  idempotencyKeys: {
    syncRequestKey: "tenant_qbo_sync_fixture:source_qbo_sync_fixture:full:start",
    importBatchId: "batch_qbo_full_fixture_2026_01",
    checkpointId: "checkpoint_qbo_full_fixture_2026_01",
    resourceSetKey: "tenant_qbo_sync_fixture:source_qbo_sync_fixture:batch_qbo_full_fixture_2026_01"
  }
};

const normalizedQuickBooksFullSyncResources: NormalizedQuickBooksResourceSet = {
  identity: normalizedQuickBooksIdentity,
  importBatch: {
    importBatchId: "batch_qbo_full_fixture_2026_01",
    syncMode: "full",
    mode: "initial",
    status: "completed",
    startedAt: "2026-02-01T10:00:00.000Z",
    completedAt: "2026-02-01T10:00:05.000Z",
    sourceObjectCounts: {
      companyInfo: 1,
      accounts: 2,
      journalEntries: 1,
      customers: 1,
      vendors: 1,
      items: 1,
      departments: 1,
      dimensions: 1
    }
  },
  checkpoint: {
    checkpointId: "checkpoint_qbo_full_fixture_2026_01",
    sourceObject: "quickbooks_full_sync",
    cursorKind: "full_scan",
    cursorValue: "full:realm_qbo_sync_fixture:2026-02-01T10:00:00.000Z",
    freshThrough: "2026-02-01T10:00:00.000Z",
    latestSourceUpdatedAt: "2026-02-01T09:59:59.000Z",
    status: "current"
  },
  companyInfo: normalizedQboResource("CompanyInfo", normalizedQuickBooksIdentity.realmId, "batch_qbo_full_fixture_2026_01", "checkpoint_qbo_full_fixture_2026_01", {
    companyName: "Deterministic Sandbox QBO Co",
    legalName: "Deterministic Sandbox QuickBooks Company LLC",
    baseCurrencyCode: "USD",
    fiscalYearStartMonth: 1
  }),
  accounts: [
    normalizedQboResource("Account", "35", "batch_qbo_full_fixture_2026_01", "checkpoint_qbo_full_fixture_2026_01", {
      sourceAccountId: "35",
      name: "Checking",
      accountNumber: "1000",
      accountType: "Bank",
      accountSubType: "Checking",
      classification: "asset",
      active: true,
      currencyCode: "USD",
      sourceUpdatedAt: "2026-02-01T09:59:59.000Z",
      sourcePayloadRef: normalizedQboSourcePayloadRef("Account", "35", "2026-02-01T09:59:59.000Z", { name: "Checking" })
    }),
    normalizedQboResource("Account", "79", "batch_qbo_full_fixture_2026_01", "checkpoint_qbo_full_fixture_2026_01", {
      sourceAccountId: "79",
      name: "Services",
      accountNumber: "4000",
      accountType: "Income",
      accountSubType: "ServiceFeeIncome",
      classification: "income",
      active: true,
      currencyCode: "USD",
      sourceUpdatedAt: "2026-02-01T09:59:59.000Z"
    })
  ],
  journalEntries: [
    normalizedQboResource(
      "JournalEntry",
      "100",
      "batch_qbo_full_fixture_2026_01",
      "checkpoint_qbo_full_fixture_2026_01",
      {
        sourceTransactionId: "100",
        sourceTransactionType: "JournalEntry",
        transactionDate: "2026-01-15",
        transactionNumber: "JE-100",
        postedAt: "2026-01-15T16:00:00.000Z",
        sourceUpdatedAt: "2026-02-01T09:59:59.000Z",
        currencyCode: "USD",
        memo: "Recognize services revenue",
        sourcePayloadRef: normalizedQboSourcePayloadRef("JournalEntry", "100", "2026-02-01T09:59:59.000Z", {
          transactionNumber: "JE-100"
        }),
        lines: [
          normalizedQboLedgerLine("1", 1, "Cash received", "500.00", "35", "Checking", "debit", "2026-01-15", "100:1"),
          normalizedQboLedgerLine("2", 2, "Services revenue", "-500.00", "79", "Services", "credit", "2026-01-15", "100:2", [
            {
              dimensionKind: "department",
              sourceObjectId: "ops",
              displayName: "Operations"
            }
          ])
        ]
      }
    )
  ],
  customers: [
    normalizedQboResource("Customer", "cust_1", "batch_qbo_full_fixture_2026_01", "checkpoint_qbo_full_fixture_2026_01", {
      sourceObjectId: "cust_1",
      displayName: "Sample Customer",
      partyType: "customer",
      active: true,
      sourceUpdatedAt: "2026-02-01T09:59:59.000Z"
    })
  ],
  vendors: [
    normalizedQboResource("Vendor", "vendor_1", "batch_qbo_full_fixture_2026_01", "checkpoint_qbo_full_fixture_2026_01", {
      sourceObjectId: "vendor_1",
      displayName: "Sample Vendor",
      partyType: "vendor",
      active: true,
      sourceUpdatedAt: "2026-02-01T09:59:59.000Z"
    })
  ],
  items: [
    normalizedQboResource("Item", "service_1", "batch_qbo_full_fixture_2026_01", "checkpoint_qbo_full_fixture_2026_01", {
      sourceObjectId: "service_1",
      displayName: "Implementation",
      itemType: "service",
      name: "Implementation",
      incomeAccountRef: {
        sourceObjectId: "79",
        displayName: "Services"
      },
      active: true,
      sourceUpdatedAt: "2026-02-01T09:59:59.000Z"
    })
  ],
  departments: [
    normalizedQboResource("Department", "ops", "batch_qbo_full_fixture_2026_01", "checkpoint_qbo_full_fixture_2026_01", {
      dimensionKind: "department",
      sourceObjectId: "ops",
      displayName: "Operations",
      name: "Operations",
      active: true,
      sourceUpdatedAt: "2026-02-01T09:59:59.000Z"
    })
  ],
  dimensions: [
    normalizedQboResource("Dimension", "department:ops", "batch_qbo_full_fixture_2026_01", "checkpoint_qbo_full_fixture_2026_01", {
      dimensionKind: "department",
      sourceObjectId: "ops",
      displayName: "Operations",
      name: "Operations",
      active: true,
      sourceUpdatedAt: "2026-02-01T09:59:59.000Z"
    })
  ]
};

const normalizedQuickBooksIncrementalSyncRequest: HandrailQuickBooksIncrementalSyncRequest = {
  sourceIdentity: normalizedQuickBooksIdentity,
  syncMode: "incremental",
  importBatchId: "batch_qbo_incremental_fixture_2026_02_01",
  checkpointId: "checkpoint_qbo_incremental_fixture_2026_02_01",
  cursorKind: "updated_since",
  cursorValue: "2026-02-01T10:00:00.000Z",
  resourceCounts: {},
  requestedAt: "2026-02-01T10:10:00.000Z",
  requestedResourceTypes: ["Account", "JournalEntry", "Vendor"],
  warningSummary: {
    count: 1,
    items: [
      {
        code: "quickbooks_sparse_vendor_skipped",
        message: "QuickBooks CDC returned a sparse Vendor update that was skipped by the normalizer.",
        severity: "info",
        resourceType: "Vendor",
        resourceId: "vendor_skipped",
        sourcePayloadRef: normalizedQboSourcePayloadRef("Vendor", "vendor_skipped", "2026-02-01T10:08:00.000Z", {
          skipped: true,
          reason: "sparse_cdc_payload"
        })
      }
    ]
  },
  idempotencyKey: "tenant_qbo_sync_fixture:source_qbo_sync_fixture:incremental:2026-02-01T10:00:00.000Z",
  idempotencyKeys: {
    syncRequestKey: "tenant_qbo_sync_fixture:source_qbo_sync_fixture:incremental:2026-02-01T10:00:00.000Z",
    importBatchId: "batch_qbo_incremental_fixture_2026_02_01",
    checkpointId: "checkpoint_qbo_incremental_fixture_2026_02_01",
    resourceSetKey: "tenant_qbo_sync_fixture:source_qbo_sync_fixture:batch_qbo_incremental_fixture_2026_02_01"
  }
};

const normalizedQuickBooksIncrementalSyncResources: NormalizedQuickBooksSyncResourceSet = {
  identity: normalizedQuickBooksIdentity,
  importBatch: {
    importBatchId: "batch_qbo_incremental_fixture_2026_02_01",
    syncMode: "incremental",
    mode: "delta",
    status: "completed_with_warnings",
    startedAt: "2026-02-01T10:10:00.000Z",
    completedAt: "2026-02-01T10:10:05.000Z",
    sourceObjectCounts: {
      accounts: 2,
      journalEntries: 1,
      vendors: 1
    },
    warningSummary: {
      skippedSparseUpdates: 1
    }
  },
  checkpoint: {
    checkpointId: "checkpoint_qbo_incremental_fixture_2026_02_01",
    sourceObject: "quickbooks_cdc",
    cursorKind: "updated_since",
    cursorValue: "cdc:realm_qbo_sync_fixture:2026-02-01T10:08:00.000Z",
    freshThrough: "2026-02-01T10:10:00.000Z",
    latestSourceUpdatedAt: "2026-02-01T10:08:00.000Z",
    status: "current"
  },
  accounts: [
    {
      ...normalizedQboResource("Account", "35", "batch_qbo_incremental_fixture_2026_02_01", "checkpoint_qbo_incremental_fixture_2026_02_01", {
        sourceAccountId: "35",
        name: "Checking - Operating",
        accountNumber: "1000",
        accountType: "Bank",
        accountSubType: "Checking",
        classification: "asset",
        active: true,
        currencyCode: "USD",
        sourceUpdatedAt: "2026-02-01T10:06:00.000Z"
      }, "2026-02-01T10:06:00.000Z"),
      syncAction: "changed"
    },
    {
      ...normalizedQboResource("Account", "88", "batch_qbo_incremental_fixture_2026_02_01", "checkpoint_qbo_incremental_fixture_2026_02_01", {
        sourceAccountId: "88",
        name: "Legacy Clearing",
        accountType: "Other Current Asset",
        classification: "asset",
        active: false,
        currencyCode: "USD",
        sourceUpdatedAt: "2026-02-01T10:07:00.000Z"
      }, "2026-02-01T10:07:00.000Z"),
      syncAction: "deleted"
    }
  ],
  journalEntries: [
    {
      ...normalizedQboResource(
        "JournalEntry",
        "101",
        "batch_qbo_incremental_fixture_2026_02_01",
        "checkpoint_qbo_incremental_fixture_2026_02_01",
        {
          sourceTransactionId: "101",
          sourceTransactionType: "JournalEntry",
          transactionDate: "2026-01-20",
          transactionNumber: "JE-101",
          sourceUpdatedAt: "2026-02-01T10:08:00.000Z",
          currencyCode: "USD",
          memo: "Voided by QuickBooks CDC",
          sourcePayloadRef: normalizedQboSourcePayloadRef("JournalEntry", "101", "2026-02-01T10:08:00.000Z", { status: "Voided" }),
          lines: [
            normalizedQboLedgerLine("1", 1, "Voided debit", "0.00", "35", "Checking - Operating", "net", "2026-01-20", "101:1"),
            normalizedQboLedgerLine("2", 2, "Voided credit", "0.00", "79", "Services", "net", "2026-01-20", "101:2")
          ]
        },
        "2026-02-01T10:08:00.000Z"
      ),
      syncAction: "voided"
    }
  ],
  vendors: [
    {
      ...normalizedQboResource("Vendor", "vendor_skipped", "batch_qbo_incremental_fixture_2026_02_01", "checkpoint_qbo_incremental_fixture_2026_02_01", {
        sourceObjectId: "vendor_skipped",
        displayName: "Sparse CDC Vendor",
        partyType: "vendor",
        active: true,
        sourceUpdatedAt: "2026-02-01T10:08:00.000Z"
      }, "2026-02-01T10:08:00.000Z"),
      syncAction: "skipped"
    }
  ]
};

const normalizedQuickBooksCheckpointReplayRequest: HandrailQuickBooksIncrementalSyncRequest = {
  ...normalizedQuickBooksIncrementalSyncRequest,
  importBatchId: "batch_qbo_checkpoint_replay_fixture_2026_02_01",
  checkpointId: "checkpoint_qbo_checkpoint_replay_fixture_2026_02_01",
  cursorValue: "cdc:realm_qbo_sync_fixture:2026-02-01T10:00:00.000Z",
  resumeFromCheckpointId: "checkpoint_qbo_full_fixture_2026_01",
  idempotencyKey: "tenant_qbo_sync_fixture:source_qbo_sync_fixture:checkpoint-replay:checkpoint_qbo_full_fixture_2026_01",
  idempotencyKeys: {
    syncRequestKey: "tenant_qbo_sync_fixture:source_qbo_sync_fixture:checkpoint-replay:checkpoint_qbo_full_fixture_2026_01",
    importBatchId: "batch_qbo_checkpoint_replay_fixture_2026_02_01",
    checkpointId: "checkpoint_qbo_checkpoint_replay_fixture_2026_02_01",
    resourceSetKey: "tenant_qbo_sync_fixture:source_qbo_sync_fixture:batch_qbo_checkpoint_replay_fixture_2026_02_01"
  }
};

const {
  accounts: normalizedQuickBooksCheckpointReplayOmittedAccounts,
  vendors: normalizedQuickBooksCheckpointReplayOmittedVendors,
  ...normalizedQuickBooksCheckpointReplayResourceBase
} = normalizedQuickBooksIncrementalSyncResources;
void normalizedQuickBooksCheckpointReplayOmittedAccounts;
void normalizedQuickBooksCheckpointReplayOmittedVendors;

const normalizedQuickBooksCheckpointReplayResources: NormalizedQuickBooksSyncResourceSet = {
  ...normalizedQuickBooksCheckpointReplayResourceBase,
  importBatch: {
    importBatchId: "batch_qbo_checkpoint_replay_fixture_2026_02_01",
    syncMode: "incremental",
    mode: "delta",
    status: "completed",
    startedAt: "2026-02-01T10:20:00.000Z",
    completedAt: "2026-02-01T10:20:04.000Z",
    sourceObjectCounts: {
      journalEntries: 1
    }
  },
  checkpoint: {
    checkpointId: "checkpoint_qbo_checkpoint_replay_fixture_2026_02_01",
    sourceObject: "quickbooks_checkpoint_replay",
    cursorKind: "updated_since",
    cursorValue: "cdc:realm_qbo_sync_fixture:2026-02-01T10:08:00.000Z",
    freshThrough: "2026-02-01T10:20:00.000Z",
    latestSourceUpdatedAt: "2026-02-01T10:08:00.000Z",
    status: "current"
  },
  journalEntries: (normalizedQuickBooksIncrementalSyncResources.journalEntries ?? []).map((resource) => ({
    ...resource,
    importBatchId: "batch_qbo_checkpoint_replay_fixture_2026_02_01",
    checkpointId: "checkpoint_qbo_checkpoint_replay_fixture_2026_02_01"
  }))
};

const normalizedQuickBooksProviderReportRequests = {
  profitAndLoss: normalizedQboProviderReportRequest("profit_and_loss"),
  balanceSheet: normalizedQboProviderReportRequest("balance_sheet"),
  trialBalance: normalizedQboProviderReportRequest("trial_balance"),
  cashFlow: normalizedQboProviderReportRequest("cash_flow")
};

const normalizedQuickBooksProviderReportResults = {
  profitAndLoss: normalizedQboProviderReportResult(normalizedQuickBooksProviderReportRequests.profitAndLoss, [
    normalizedQboProviderReportTotal("profit_and_loss", "income", "Income", "20000.00"),
    normalizedQboProviderReportTotal("profit_and_loss", "expenses", "Expenses", "6200.00"),
    normalizedQboProviderReportTotal("profit_and_loss", "net_income", "Net Income", "13800.00")
  ]),
  balanceSheet: normalizedQboProviderReportResult(normalizedQuickBooksProviderReportRequests.balanceSheet, [
    normalizedQboProviderReportTotal("balance_sheet", "assets", "Assets", "74000.00"),
    normalizedQboProviderReportTotal("balance_sheet", "liabilities", "Liabilities", "11200.00"),
    normalizedQboProviderReportTotal("balance_sheet", "equity", "Equity", "62800.00")
  ]),
  trialBalance: normalizedQboProviderReportResult(normalizedQuickBooksProviderReportRequests.trialBalance, [
    normalizedQboProviderReportTotal("trial_balance", "debits", "Debits", "81900.00"),
    normalizedQboProviderReportTotal("trial_balance", "credits", "Credits", "81900.00"),
    normalizedQboProviderReportTotal("trial_balance", "net", "Net", "0.00")
  ])
};

const normalizedQuickBooksProviderReportResponses = {
  profitAndLoss: buildNormalizedQuickBooksProviderReportResponse(
    normalizedQuickBooksProviderReportRequests.profitAndLoss,
    normalizedQuickBooksProviderReportResults.profitAndLoss
  ) as NormalizedQuickBooksProfitAndLossReportResponseEnvelope,
  balanceSheet: buildNormalizedQuickBooksProviderReportResponse(
    normalizedQuickBooksProviderReportRequests.balanceSheet,
    normalizedQuickBooksProviderReportResults.balanceSheet
  ) as NormalizedQuickBooksBalanceSheetReportResponseEnvelope,
  trialBalance: buildNormalizedQuickBooksProviderReportResponse(
    normalizedQuickBooksProviderReportRequests.trialBalance,
    normalizedQuickBooksProviderReportResults.trialBalance
  ) as NormalizedQuickBooksTrialBalanceReportResponseEnvelope,
  cashFlow: buildUnsupportedQuickBooksCashFlowParityReportResponse(normalizedQuickBooksProviderReportRequests.cashFlow)
};

const normalizedQuickBooksServiceHealthRequests = {
  ready: normalizedQboServiceHealthRequest("2026-02-01T10:02:30.000Z"),
  degraded: normalizedQboServiceHealthRequest("2026-02-01T10:03:30.000Z"),
  unavailable: normalizedQboServiceHealthRequest("2026-02-01T10:04:30.000Z")
};

const normalizedQuickBooksServiceHealthResponses = {
  ready: buildQuickBooksServiceHealthProbeResponse(normalizedQuickBooksServiceHealthRequests.ready, {
    status: "ready",
    serviceAvailability: "available",
    providerMode: "sandbox",
    serviceEnvironment: "staging",
    checkedAt: "2026-02-01T10:02:31.000Z",
    message: "QuickBooks service is ready for sandbox sync and replay preflight.",
    capabilities: {
      fullSync: normalizedQboHealthCapability("ready", "Full sync is available."),
      incrementalSync: normalizedQboHealthCapability("ready", "Incremental sync is available."),
      providerReports: normalizedQboHealthCapability("ready", "Provider report parity endpoints are available."),
      sandbox: normalizedQboHealthCapability("ready", "Sandbox provider mode is available."),
      replay: normalizedQboHealthCapability("ready", "Deterministic replay fixtures are available.")
    },
    checkpoint: {
      checkpointId: "checkpoint_qbo_full_fixture_2026_01",
      status: "current",
      sourceObject: "quickbooks_full_sync",
      cursorKind: "full_scan",
      cursorValue: "full:realm_qbo_sync_fixture:2026-02-01T10:00:00.000Z",
      sourceFreshThrough: "2026-02-01T10:00:00.000Z",
      importedThrough: "2026-02-01T10:00:00.000Z",
      freshThrough: "2026-02-01T10:00:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T09:59:59.000Z"
    }
  }),
  degraded: buildQuickBooksServiceHealthProbeResponse(normalizedQuickBooksServiceHealthRequests.degraded, {
    status: "degraded",
    serviceAvailability: "degraded",
    providerMode: "sandbox",
    serviceEnvironment: "staging",
    checkedAt: "2026-02-01T10:03:31.000Z",
    message: "QuickBooks service is reachable but checkpoint replay should run before scheduled imports.",
    capabilities: {
      fullSync: normalizedQboHealthCapability("ready", "Full sync is available."),
      incrementalSync: normalizedQboHealthCapability("degraded", "Incremental sync is available with checkpoint replay required."),
      providerReports: normalizedQboHealthCapability("ready", "Provider report parity endpoints are available."),
      sandbox: normalizedQboHealthCapability("ready", "Sandbox provider mode is available."),
      replay: normalizedQboHealthCapability("ready", "Deterministic replay fixtures are available.")
    },
    checkpoint: {
      checkpointId: "checkpoint_qbo_full_fixture_2026_01",
      status: "replay_required",
      sourceObject: "quickbooks_cdc",
      cursorKind: "updated_since",
      cursorValue: "cdc:realm_qbo_sync_fixture:2026-02-01T10:00:00.000Z",
      sourceFreshThrough: "2026-02-01T10:00:00.000Z",
      importedThrough: "2026-02-01T10:00:00.000Z",
      freshThrough: "2026-02-01T10:00:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T10:08:00.000Z"
    },
    issues: [
      {
        code: "quickbooks_checkpoint_replay_required",
        severity: "warning",
        message: "Checkpoint replay should run before the next scheduled import."
      }
    ]
  }),
  unavailable: buildQuickBooksServiceHealthProbeResponse(normalizedQuickBooksServiceHealthRequests.unavailable, {
    status: "unavailable",
    serviceAvailability: "unavailable",
    providerMode: "sandbox",
    serviceEnvironment: "staging",
    checkedAt: "2026-02-01T10:04:31.000Z",
    message: "QuickBooks service is unavailable to SDK preflight.",
    capabilities: {
      fullSync: normalizedQboHealthCapability("unavailable", "Full sync is unavailable."),
      incrementalSync: normalizedQboHealthCapability("unavailable", "Incremental sync is unavailable."),
      providerReports: normalizedQboHealthCapability("unavailable", "Provider report parity endpoints are unavailable."),
      sandbox: normalizedQboHealthCapability("unavailable", "Sandbox provider mode is unavailable."),
      replay: normalizedQboHealthCapability("unavailable", "Replay fixtures are unavailable.")
    },
    checkpoint: {
      checkpointId: "checkpoint_qbo_full_fixture_2026_01",
      status: "unknown"
    },
    issues: [
      {
        code: "quickbooks_service_unavailable",
        severity: "error",
        message: "The SDK/service health endpoint is unavailable."
      }
    ]
  })
};

export const ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES: NormalizedQuickBooksSyncFixtureSet = {
  fullSync: {
    request: normalizedQuickBooksFullSyncRequest,
    resources: normalizedQuickBooksFullSyncResources,
    response: buildNormalizedQuickBooksFullSyncResponse(normalizedQuickBooksFullSyncRequest, normalizedQuickBooksFullSyncResources)
  },
  incrementalSync: {
    request: normalizedQuickBooksIncrementalSyncRequest,
    resources: normalizedQuickBooksIncrementalSyncResources,
    response: buildNormalizedQuickBooksIncrementalSyncResponse(
      normalizedQuickBooksIncrementalSyncRequest,
      normalizedQuickBooksIncrementalSyncResources
    )
  },
  checkpointReplay: {
    request: normalizedQuickBooksCheckpointReplayRequest,
    resources: normalizedQuickBooksCheckpointReplayResources,
    response: buildNormalizedQuickBooksIncrementalSyncResponse(
      normalizedQuickBooksCheckpointReplayRequest,
      normalizedQuickBooksCheckpointReplayResources
    )
  },
  providerReports: {
    profitAndLoss: {
      request: normalizedQuickBooksProviderReportRequests.profitAndLoss,
      providerResult: normalizedQuickBooksProviderReportResults.profitAndLoss,
      response: normalizedQuickBooksProviderReportResponses.profitAndLoss
    },
    balanceSheet: {
      request: normalizedQuickBooksProviderReportRequests.balanceSheet,
      providerResult: normalizedQuickBooksProviderReportResults.balanceSheet,
      response: normalizedQuickBooksProviderReportResponses.balanceSheet
    },
    trialBalance: {
      request: normalizedQuickBooksProviderReportRequests.trialBalance,
      providerResult: normalizedQuickBooksProviderReportResults.trialBalance,
      response: normalizedQuickBooksProviderReportResponses.trialBalance
    },
    cashFlow: {
      request: normalizedQuickBooksProviderReportRequests.cashFlow,
      response: normalizedQuickBooksProviderReportResponses.cashFlow
    }
  },
  reconciliationDifferences: {
    matchedProfitAndLoss: normalizedQboReconciliationEvidence(normalizedQuickBooksProviderReportResponses.profitAndLoss, [
      normalizedQboCanonicalTotal("income", "20000.00"),
      normalizedQboCanonicalTotal("expenses", "6200.00"),
      normalizedQboCanonicalTotal("net_income", "13800.00")
    ]),
    outOfBalanceProfitAndLoss: normalizedQboReconciliationEvidence(normalizedQuickBooksProviderReportResponses.profitAndLoss, [
      normalizedQboCanonicalTotal("income", "20000.00"),
      normalizedQboCanonicalTotal("expenses", "6200.00"),
      normalizedQboCanonicalTotal("net_income", "13799.97")
    ]),
    missingProviderTotal: normalizedQboReconciliationEvidence(normalizedQuickBooksProviderReportResponses.profitAndLoss, [
      normalizedQboCanonicalTotal("income", "20000.00"),
      normalizedQboCanonicalTotal("expenses", "6200.00"),
      normalizedQboCanonicalTotal("net_income", "13800.00"),
      normalizedQboCanonicalTotal("other_income", "25.00")
    ])
  },
  serviceHealth: {
    ready: {
      request: normalizedQuickBooksServiceHealthRequests.ready,
      response: normalizedQuickBooksServiceHealthResponses.ready
    },
    degraded: {
      request: normalizedQuickBooksServiceHealthRequests.degraded,
      response: normalizedQuickBooksServiceHealthResponses.degraded
    },
    unavailable: {
      request: normalizedQuickBooksServiceHealthRequests.unavailable,
      response: normalizedQuickBooksServiceHealthResponses.unavailable
    }
  }
};

function normalizedQboResource<ResourceType extends string, Resource>(
  resourceType: ResourceType,
  resourceId: string,
  fixtureImportBatchId: string,
  fixtureCheckpointId: string,
  resource: Resource,
  sourceUpdatedAt = "2026-02-01T09:59:59.000Z"
): NormalizedQuickBooksResourceEnvelope<ResourceType, Resource> {
  return {
    sourceSystem: "quickbooks",
    tenantId: normalizedQuickBooksIdentity.tenantId,
    sourceId: normalizedQuickBooksIdentity.sourceId,
    providerEnvironment: normalizedQuickBooksIdentity.providerEnvironment,
    realmId: normalizedQuickBooksIdentity.realmId,
    resourceType,
    resourceId,
    importBatchId: fixtureImportBatchId,
    checkpointId: fixtureCheckpointId,
    sourceUpdatedAt,
    sourcePayloadRef: normalizedQboSourcePayloadRef(resourceType, resourceId, sourceUpdatedAt, {
      sourceObjectType: resourceType,
      sourceObjectId: resourceId
    }),
    resource
  };
}

function normalizedQboSourcePayloadRef(
  sourceObjectType: string,
  sourceObjectId: string,
  sourceUpdatedAt: IsoDateTime,
  preview: NonNullable<SafeSourcePayloadRef["preview"]>
): SafeSourcePayloadRef {
  return {
    sourceObjectType,
    sourceObjectId,
    sourceUpdatedAt,
    storageRef: `quickbooks-sdk://sandbox/realm/${normalizedQuickBooksIdentity.realmId}/${sourceObjectType}/${sourceObjectId}`,
    checksum: `sha256:${sourceObjectType}:${sourceObjectId}:${sourceUpdatedAt}`,
    preview
  };
}

function normalizedQboLedgerLine(
  sourceLineId: string,
  lineNumber: number,
  description: string,
  amount: DecimalString,
  sourceAccountId: string,
  accountName: string,
  postingKind: "debit" | "credit" | "net",
  postingDate: IsoDate,
  sourcePostingId: string,
  dimensionRefs: readonly NormalizedQuickBooksDimensionRef[] = []
): NormalizedQuickBooksLedgerLine {
  const sourcePayloadRef = normalizedQboSourcePayloadRef("JournalEntryLine", sourcePostingId, `${postingDate}T16:00:00.000Z`, {
    lineNumber
  });
  return {
    sourceLineId,
    lineNumber,
    description,
    amount,
    accountRef: {
      sourceObjectId: sourceAccountId,
      displayName: accountName
    },
    ...(dimensionRefs.length === 0 ? {} : { dimensionRefs }),
    sourcePayloadRef,
    postings: [
      {
        sourcePostingId,
        accountRef: {
          sourceObjectId: sourceAccountId,
          displayName: accountName
        },
        postingDate,
        accountingBasis,
        ...(postingKind === "debit" ? { debitAmount: amount } : {}),
        ...(postingKind === "credit" ? { creditAmount: amount.startsWith("-") ? amount.slice(1) : amount } : {}),
        ...(postingKind === "net" ? { netAmount: amount } : {}),
        currencyCode,
        ...(dimensionRefs.length === 0 ? {} : { dimensionRefs }),
        sourcePayloadRef
      }
    ]
  };
}

function normalizedQboProviderReportRequest(reportName: "profit_and_loss"): NormalizedQuickBooksProfitAndLossReportRequestEnvelope;
function normalizedQboProviderReportRequest(reportName: "balance_sheet"): NormalizedQuickBooksBalanceSheetReportRequestEnvelope;
function normalizedQboProviderReportRequest(reportName: "trial_balance"): NormalizedQuickBooksTrialBalanceReportRequestEnvelope;
function normalizedQboProviderReportRequest(reportName: "cash_flow"): NormalizedQuickBooksCashFlowParityReportRequestEnvelope;
function normalizedQboProviderReportRequest(reportName: NormalizedQuickBooksProviderReportName): NormalizedQuickBooksProviderReportRequestEnvelope {
  const base = {
    sourceIdentity: normalizedQuickBooksIdentity,
    reportName,
    accountingBasis: "accrual" as const,
    currencyCode: "USD" as const,
    importBatchId: "batch_qbo_full_fixture_2026_01",
    checkpointId: "checkpoint_qbo_full_fixture_2026_01",
    sourceFreshThrough: "2026-02-01T10:00:00.000Z",
    importedThrough: "2026-02-01T10:00:00.000Z",
    latestSourceUpdatedAt: "2026-02-01T09:59:59.000Z",
    requestedAt: "2026-02-01T10:02:00.000Z",
    idempotencyKey: `tenant_qbo_sync_fixture:source_qbo_sync_fixture:report:${reportName}:2026-01`
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

function normalizedQboServiceHealthRequest(requestedAt: IsoDateTime): NormalizedQuickBooksServiceHealthProbeRequest {
  return {
    sourceIdentity: normalizedQuickBooksIdentity,
    providerMode: normalizedQuickBooksIdentity.providerEnvironment,
    serviceEnvironment: "staging",
    checkpointId: "checkpoint_qbo_full_fixture_2026_01",
    requestedAt
  };
}

function normalizedQboHealthCapability(
  status: NormalizedQuickBooksServiceHealthProbeResponseEnvelope["capabilities"]["fullSync"]["status"],
  message: string
): NormalizedQuickBooksServiceHealthProbeResponseEnvelope["capabilities"]["fullSync"] {
  return {
    status,
    available: status !== "unavailable",
    message
  };
}

function normalizedQboProviderReportResult(
  request: NormalizedQuickBooksProviderReportRequestEnvelope,
  totals: readonly NormalizedQuickBooksProviderReportTotal[]
): NormalizedQuickBooksProviderReportResult {
  return {
    providerReportRef: normalizedQboProviderReportRef(request),
    sourceUpdatedAt: "2026-02-01T10:01:00.000Z",
    generatedAt: "2026-02-01T10:02:00.000Z",
    totals
  };
}

function normalizedQboProviderReportRef(
  request: NormalizedQuickBooksProviderReportRequestEnvelope
): NormalizedQuickBooksProviderReportResult["providerReportRef"] {
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
    sourcePayloadRef: normalizedQboSourcePayloadRef("Report", `${request.reportName}:${periodRef}`, "2026-02-01T10:01:00.000Z", {
      reportName: request.reportName,
      accountingBasis: request.accountingBasis
    })
  };
}

function normalizedQboProviderReportTotal(
  reportName: Exclude<NormalizedQuickBooksProviderReportName, "cash_flow">,
  totalKey: string,
  label: string,
  amount: DecimalString
): NormalizedQuickBooksProviderReportTotal {
  return {
    totalKey,
    label,
    amount,
    currencyCode,
    sourceUpdatedAt: "2026-02-01T10:01:00.000Z",
    drilldownRef: normalizedQboSourcePayloadRef("ReportTotal", `${reportName}:${totalKey}`, "2026-02-01T10:01:00.000Z", {
      reportName,
      totalKey
    })
  };
}

function normalizedQboCanonicalTotal(totalKey: string, amount: DecimalString): NormalizedQuickBooksCanonicalReportTotal {
  return {
    totalKey,
    amount,
    currencyCode
  };
}

function normalizedQboReconciliationEvidence(
  providerReport: NormalizedQuickBooksProviderReportReconciliationEvidenceInput["providerReport"],
  canonicalTotals: readonly NormalizedQuickBooksCanonicalReportTotal[]
): NormalizedAccountingReconciliationEvidence {
  return buildQuickBooksProviderReportReconciliationEvidence({
    providerReport,
    canonicalTotals,
    toleranceAmount: "0.00",
    generatedAt: "2026-02-01T10:03:00.000Z"
  });
}

function account(
  accountId: string,
  accountNumber: string,
  name: string,
  classification: Account["classification"],
  subtype: string,
  parentAccountId?: string
): Account {
  return {
    tenantId,
    sourceId,
    accountId,
    sourceAccountId: accountId.replace("acct_", ""),
    accountNumber,
    name,
    type: classification,
    subtype,
    classification,
    ...(parentAccountId === undefined ? {} : { parentAccountId }),
    currencyCode,
    active: true
  };
}

function party(partyId: string, partyType: Party["partyType"], displayName: string): Party {
  return {
    tenantId,
    sourceId,
    partyId,
    sourcePartyId: partyId.replace("party_", ""),
    partyType,
    displayName,
    active: true
  };
}

function item(
  itemId: string,
  itemType: Item["itemType"],
  name: string,
  incomeAccountId: string | undefined,
  expenseAccountId: string | undefined,
  assetAccountId: string | undefined
): Item {
  return {
    tenantId,
    sourceId,
    itemId,
    sourceItemId: itemId.replace("item_", ""),
    itemType,
    name,
    ...(incomeAccountId === undefined ? {} : { incomeAccountId }),
    ...(expenseAccountId === undefined ? {} : { expenseAccountId }),
    ...(assetAccountId === undefined ? {} : { assetAccountId }),
    active: true
  };
}

function dimension(dimensionId: string, dimensionKind: string, sourceDimensionId: string, name: string): AccountingDimension {
  return {
    tenantId,
    sourceId,
    dimensionId,
    dimensionKind,
    sourceDimensionId,
    name,
    active: true
  };
}

function transaction(
  transactionId: string,
  sourceTransactionType: string,
  transactionNumber: string,
  transactionDate: string,
  memo: string,
  partyId: string | undefined
): AccountingTransaction {
  return {
    tenantId,
    sourceId,
    transactionId,
    sourceTransactionId: transactionId.replace("txn_", ""),
    sourceTransactionType,
    transactionNumber,
    transactionDate,
    postedAt: `${transactionDate}T12:00:00.000Z`,
    updatedAt: `${transactionDate}T12:00:00.000Z`,
    ...(partyId === undefined ? {} : { partyId }),
    currencyCode,
    exchangeRate: "1.00",
    status: "posted",
    memo,
    sourcePayloadRef: {
      sourceObjectType: sourceTransactionType,
      sourceObjectId: transactionId.replace("txn_", ""),
      sourceUpdatedAt: `${transactionDate}T12:00:00.000Z`,
      checksum: `sha256:${transactionId}`
    }
  };
}

function line(
  transactionLineId: string,
  transactionId: string,
  lineNumber: number,
  accountId: string,
  amount: string,
  partyId: string | undefined,
  itemId: string | undefined,
  dimensionRefs: readonly DimensionRef[]
): TransactionLine {
  return {
    tenantId,
    transactionLineId,
    transactionId,
    lineNumber,
    accountId,
    ...(partyId === undefined ? {} : { partyId }),
    ...(itemId === undefined ? {} : { itemId }),
    amount,
    dimensionRefs
  };
}

function posting(
  postingId: string,
  transactionId: string,
  transactionLineId: string,
  accountId: string,
  postingDate: string,
  debitAmount: string,
  creditAmount: string,
  dimensionRefs: readonly DimensionRef[]
): LedgerPosting {
  return {
    tenantId,
    sourceId,
    postingId,
    sourcePostingId: postingId.replace("post_", ""),
    transactionId,
    transactionLineId,
    accountId,
    postingDate,
    accountingBasis,
    debitAmount,
    creditAmount,
    netAmount: netAmount(debitAmount, creditAmount),
    currencyCode,
    dimensionHash: dimensionHash(dimensionRefs),
    dimensionRefs,
    sourcePayloadRef: {
      sourceObjectType: "LedgerPosting",
      sourceObjectId: postingId.replace("post_", ""),
      checksum: `sha256:${postingId}`
    },
    importBatchId,
    checkpointId
  };
}

function dimensionHash(dimensionRefs: readonly DimensionRef[]): string {
  if (dimensionRefs === chicagoOps) {
    return opsHash;
  }
  if (dimensionRefs === chicagoAdmin) {
    return adminHash;
  }
  return emptyHash;
}

function netAmount(debitAmount: string, creditAmount: string): string {
  const debit = Number(debitAmount);
  const credit = Number(creditAmount);
  return (debit - credit).toFixed(2);
}

function reportRequestFromFacts(
  facts: CanonicalAccountingFactSet,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  asOfDate: IsoDate,
  generatedAt: IsoDateTime
): ReportBuilderInput {
  const freshness: ReportFreshness = {
    status: "fresh",
    sourceId: facts.source.sourceId,
    importBatchId: facts.importBatch.importBatchId,
    checkpointId: facts.checkpoint.checkpointId,
    ...(facts.checkpoint.freshThrough === undefined ? {} : { freshThrough: facts.checkpoint.freshThrough })
  };
  return {
    tenantId: facts.company.tenantId,
    accounts: facts.accounts,
    postings: facts.postings,
    accountingBasis: facts.postings[0]?.accountingBasis ?? "accrual",
    currencyCode: facts.company.baseCurrencyCode,
    periodStart,
    periodEnd,
    asOfDate,
    generatedAt,
    freshness
  };
}

function providerReportEvidence(
  facts: CanonicalAccountingFactSet,
  request: ReportBuilderInput,
  reportName: ReportName,
  report: BuiltReport,
  providerTotals: Readonly<Record<string, DecimalString>>
): ProviderReportReconciliationEvidence {
  const toleranceMinor = 0n;
  const totals = Object.entries(providerTotals).map(([totalKey, providerAmount]): ProviderReportTotalComparison => {
    const erpTotal = report.totals.find((total) => total.totalKey === totalKey);
    if (erpTotal === undefined) {
      throw new Error(`Missing ERP report total for provider comparison: ${reportName}:${totalKey}`);
    }
    const differenceMinor = parseMoney(providerAmount) - parseMoney(erpTotal.amount);
    return {
      totalKey,
      providerAmount,
      erpAmount: erpTotal.amount,
      difference: formatMoney(differenceMinor),
      status: absolute(differenceMinor) <= toleranceMinor ? "matched" : "mismatched",
      drilldownRef: erpTotal.drilldownRef
    };
  });
  const largestDifference = totals.reduce((largest, total) => {
    const difference = absolute(parseMoney(total.difference));
    return difference > largest ? difference : largest;
  }, 0n);
  return {
    provider: "quickbooks",
    reportName,
    sourceId: facts.source.sourceId,
    importBatchId: facts.importBatch.importBatchId,
    checkpointId: facts.checkpoint.checkpointId,
    accountingBasis: request.accountingBasis,
    currencyCode: request.currencyCode,
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    ...(request.asOfDate === undefined ? {} : { asOfDate: request.asOfDate }),
    comparedAt: request.generatedAt ?? "1970-01-01T00:00:00.000Z",
    toleranceAmount: "0.00",
    reconciliationStatus: totals.every((total) => total.status === "matched") ? "balanced" : "out_of_balance",
    reconciliationDifference: formatMoney(largestDifference),
    providerReportRef: {
      sourceObjectType: "QuickBooksReport",
      sourceObjectId: reportName,
      ...(facts.checkpoint.latestSourceUpdatedAt === undefined ? {} : { sourceUpdatedAt: facts.checkpoint.latestSourceUpdatedAt }),
      storageRef: `quickbooks://${facts.source.providerEnvironment}/realm/${facts.company.sourceCompanyRef}/Report/${reportName}`,
      preview: {
        provider: "quickbooks",
        reportName,
        periodStart: request.periodStart,
        periodEnd: request.periodEnd,
        comparedTotalKeys: Object.keys(providerTotals)
      }
    },
    totals
  };
}

function parseMoney(value: DecimalString): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(`Decimal value must have at most two fractional digits: ${value}`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? "").padEnd(2, "0"));
  return sign * (whole * 100n + fraction);
}

function formatMoney(value: bigint): DecimalString {
  const sign = value < 0n ? "-" : "";
  const absoluteValue = absolute(value);
  const whole = absoluteValue / 100n;
  const fraction = absoluteValue % 100n;
  return `${sign}${whole.toString()}.${fraction.toString().padStart(2, "0")}`;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}
