import type {
  Account,
  AccountingCompany,
  AccountingDimension,
  AccountingSource,
  AccountingTransaction,
  DimensionRef,
  ImportBatch,
  Item,
  LedgerPosting,
  Party,
  SyncCheckpoint,
  TransactionLine
} from "./canonical-model.js";
import { createDimensionHash } from "./canonical-model.js";
import type { CashFlowActivity } from "./report-builders.js";

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
      accounts: 11,
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
    account("acct_expense", "6100", "Operating Expense", "expense", "Expense")
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
    line("line_accrued_bill_expense", "txn_accrued_bill", 1, "acct_expense", "1200.00", "party_vendor_supply", undefined, chicagoAdmin),
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
    posting("post_accrued_bill_expense", "txn_accrued_bill", "line_accrued_bill_expense", "acct_expense", "2026-01-30", "1200.00", "0.00", chicagoAdmin),
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

function account(accountId: string, accountNumber: string, name: string, classification: Account["classification"], subtype: string): Account {
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
