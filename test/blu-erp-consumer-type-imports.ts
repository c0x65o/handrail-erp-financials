import { createErpFinancialsSdk } from "@handrail/erp-financials/sdk";

import type {
  AgingReport,
  BankReconciliationListItem,
  BankReconciliationSummary,
  BillPaymentDetail,
  BillPaymentListItem,
  BillPaymentSummary,
  ChartOfAccountsItem,
  CreateErpFinancialsSdkInput,
  CustomerPaymentDetail,
  CustomerStatement,
  ErpFinancialsSdk,
  FinancialDashboardSummary,
  FinancialStatement,
  FiscalPeriodReadModel,
  GeneralLedgerLine,
  GeneralLedgerSummary,
  InvoiceDetail,
  InvoiceListItem,
  InvoiceSummary,
  JournalEntryDetail,
  JournalEntryListItem,
  PaymentApplicationDetail,
  PaymentApplicationListItem,
  PaymentListItem,
  PaymentSummary,
  PostingLockReadModel,
  VendorBillDetail,
  VendorBillListItem,
  VendorBillSummary
} from "@handrail/erp-financials/sdk";

export const BLU_FINANCIAL_SCOPE = {
  tenantId: "tenant_blu",
  companyId: "company_blu",
  bookId: "book_blu_usd_accrual",
  writeSourceId: "source_blu_native",
  currencyCode: "USD",
  accountingBasis: "accrual",
  postingPolicy: "enforce_fiscal_periods"
} as const satisfies Pick<
  CreateErpFinancialsSdkInput,
  | "tenantId"
  | "companyId"
  | "bookId"
  | "writeSourceId"
  | "currencyCode"
  | "accountingBasis"
  | "postingPolicy"
>;

export const BLU_FINANCIAL_IDS = {
  customerId: "customer_blu_acme",
  vendorId: "vendor_blu_supply",
  cashAccountKey: "asset.cash",
  receivableAccountKey: "asset.receivable",
  payableAccountKey: "liability.payable",
  revenueAccountKey: "income.sales",
  expenseAccountKey: "expense.supplies",
  fiscalPeriodId: "period_blu_2026_08",
  invoiceDraftId: "invoice_draft_blu_1001",
  invoiceId: "invoice_blu_1001",
  customerPaymentId: "customer_payment_blu_1001",
  vendorBillId: "vendor_bill_blu_1001",
  billPaymentId: "bill_payment_blu_1001",
  transactionId: "transaction_blu_1001",
  bankStatementLineId: "bank_line_blu_1001",
  bankReconciliationMatchId: "bank_match_blu_1001",
  paymentApplicationId: "application_blu_1001"
} as const;

type BluCustomerPaymentInput = Parameters<ErpFinancialsSdk["commands"]["customerPayments"]["record"]>[0];
type BluOperation = BluCustomerPaymentInput["operation"];
type BluMoney = BluCustomerPaymentInput["amount"];
type BluInvoiceLine = Parameters<ErpFinancialsSdk["invoices"]["createDraft"]>[0]["revenueLines"][number];
type Exact<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;
type Assert<Condition extends true> = Condition;

/** BLU owns this adapter; the SDK boundary begins after integer cents become a fixed decimal string. */
export type BluIntegerCentsAdapter = (integerCents: bigint) => BluMoney;

export const BLU_FIXED_DECIMAL_AMOUNT: BluMoney = "1250.00";

// @ts-expect-error -- BLU integer cents must be converted by the host adapter before crossing the SDK boundary.
export const BLU_INTEGER_CENTS_ARE_NOT_SDK_MONEY: BluMoney = 125000;

export type BluDecimalStringContract = readonly [
  Assert<Exact<BluMoney, string>>,
  Assert<Exact<BluInvoiceLine["amount"], string>>,
  Assert<Exact<InvoiceListItem["originalAmount"], string>>,
  Assert<Exact<CustomerStatement["totals"]["outstandingAmount"], string>>,
  Assert<Exact<VendorBillListItem["openAmount"], string>>,
  Assert<Exact<PaymentListItem["amount"], string>>,
  Assert<Exact<GeneralLedgerLine["debitAmount"], string>>,
  Assert<Exact<FinancialStatement["lines"][number]["amount"], string>>,
  Assert<Exact<AgingReport["totals"]["total"], string>>,
  Assert<Exact<BankReconciliationSummary["unmatchedAbsoluteAmount"], string>>
];

export function createBluFinancialsSdk(database: CreateErpFinancialsSdkInput["database"]): ErpFinancialsSdk {
  return createErpFinancialsSdk({
    database,
    ...BLU_FINANCIAL_SCOPE
  });
}

export async function compileBluCommandContract(sdk: ErpFinancialsSdk): Promise<void> {
  const operation = bluOperation("blu-contract-command");
  const approvedOperation = bluOperation("blu-contract-approved-command", true);

  await sdk.books.define({
    operation,
    bookId: BLU_FINANCIAL_SCOPE.bookId,
    name: "BLU USD Accrual Reporting Book",
    baseCurrencyCode: "USD",
    accountingBasis: "accrual",
    status: "active"
  });
  await sdk.books.bindSource({
    operation,
    bookId: BLU_FINANCIAL_SCOPE.bookId,
    sourceId: BLU_FINANCIAL_SCOPE.writeSourceId,
    sourceRole: "active",
    effectiveFrom: "2026-01-01"
  });
  await sdk.books.defineAccount({
    operation,
    bookId: BLU_FINANCIAL_SCOPE.bookId,
    bookAccountKey: BLU_FINANCIAL_IDS.cashAccountKey,
    accountNumber: "1000",
    name: "Cash",
    classification: "asset",
    accountRole: "posting",
    currencyCode: "USD",
    expectedVersion: 0
  });
  await sdk.books.mapAccount({
    operation,
    bookId: BLU_FINANCIAL_SCOPE.bookId,
    sourceId: BLU_FINANCIAL_SCOPE.writeSourceId,
    accountId: "account_blu_cash",
    bookAccountKey: BLU_FINANCIAL_IDS.cashAccountKey
  });

  await sdk.commands.accounts.upsertTree({
    operation,
    parent: {
      accountKey: "asset",
      accountNumber: "1000",
      name: "Assets",
      classification: "asset"
    },
    children: [
      {
        accountKey: BLU_FINANCIAL_IDS.cashAccountKey,
        accountNumber: "1010",
        name: "Operating Cash",
        classification: "asset"
      },
      {
        accountKey: BLU_FINANCIAL_IDS.receivableAccountKey,
        accountNumber: "1100",
        name: "Accounts Receivable",
        classification: "asset"
      }
    ],
    staleReason: "BLU chart changed"
  });

  await sdk.commands.journalEntries.post({
    operation,
    idempotencyKey: "blu-journal-1001",
    date: "2026-08-01",
    transactionNumber: "JE-1001",
    memo: "BLU native journal",
    currencyCode: "USD",
    accountingBasis: "accrual",
    lines: [
      { accountKey: BLU_FINANCIAL_IDS.cashAccountKey, debit: "1250.00" },
      { accountKey: BLU_FINANCIAL_IDS.revenueAccountKey, credit: "1250.00" }
    ]
  });
  await sdk.commands.journalEntries.reverse({
    operation: approvedOperation,
    originalTransactionId: BLU_FINANCIAL_IDS.transactionId,
    idempotencyKey: "blu-journal-1001-reverse",
    date: "2026-08-02",
    memo: "Reverse BLU native journal"
  });
  await sdk.commands.journalEntries.correct({
    operation: approvedOperation,
    originalTransactionId: BLU_FINANCIAL_IDS.transactionId,
    idempotencyKey: "blu-journal-1001-correct",
    date: "2026-08-02",
    memo: "Correct BLU native journal",
    replacement: {
      idempotencyKey: "blu-journal-1001-replacement",
      date: "2026-08-02",
      transactionNumber: "JE-1001-C",
      currencyCode: "USD",
      lines: [
        { accountKey: BLU_FINANCIAL_IDS.cashAccountKey, debit: "1249.50" },
        { accountKey: BLU_FINANCIAL_IDS.revenueAccountKey, credit: "1249.50" }
      ]
    }
  });

  await sdk.commands.fiscalPeriods.define({
    operation,
    fiscalYear: 2026,
    periodNumber: 8,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31"
  });
  await sdk.commands.fiscalPeriods.beginClose({
    operation: approvedOperation,
    fiscalPeriodId: BLU_FINANCIAL_IDS.fiscalPeriodId,
    expectedVersion: 1
  });
  await sdk.commands.fiscalPeriods.close({
    operation: approvedOperation,
    fiscalPeriodId: BLU_FINANCIAL_IDS.fiscalPeriodId,
    expectedVersion: 2,
    evidence: {
      trialBalanceSnapshotId: "snapshot_blu_2026_08",
      reconciliationRefs: ["reconciliation_blu_2026_08"],
      checklistRef: "blu-close-checklist-2026-08",
      postingMaxUpdatedAt: "2026-08-31T23:59:59.000Z",
      evidenceChecksum: "blu-close-evidence-checksum"
    }
  });
  await sdk.commands.fiscalPeriods.reopen({
    operation: approvedOperation,
    fiscalPeriodId: BLU_FINANCIAL_IDS.fiscalPeriodId,
    expectedVersion: 3
  });
  await sdk.commands.fiscalPeriods.setPostingLockDate({
    operation: approvedOperation,
    postingLockDate: "2026-07-31",
    expectedVersion: 0
  });

  await compileBluInvoiceCommands(sdk, operation, approvedOperation);
  await compileBluPaymentAndPayablesCommands(sdk, operation, approvedOperation);
  await compileBluBankReconciliationCommands(sdk, operation, approvedOperation);
}

export async function compileBluReadContract(sdk: ErpFinancialsSdk): Promise<void> {
  const chart: readonly ChartOfAccountsItem[] = await sdk.queries.listChartOfAccounts({
    asOfDate: "2026-08-31",
    includeInactive: false
  });
  const journalPage = await sdk.queries.listJournalEntries({
    sourceId: BLU_FINANCIAL_SCOPE.writeSourceId,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    limit: 50
  });
  const journals: readonly JournalEntryListItem[] = journalPage.items;
  const journal: JournalEntryDetail = await sdk.queries.getJournalEntry(BLU_FINANCIAL_IDS.transactionId);
  const fiscalPeriodPage = await sdk.queries.listFiscalPeriods({
    sourceId: BLU_FINANCIAL_SCOPE.writeSourceId,
    fiscalYear: 2026,
    limit: 24
  });
  const fiscalPeriods: readonly FiscalPeriodReadModel[] = fiscalPeriodPage.items;
  const postingLock: PostingLockReadModel = await sdk.queries.getPostingLock(BLU_FINANCIAL_SCOPE.writeSourceId);

  const ledgerPage = await sdk.queries.listGeneralLedger({
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    sourceId: BLU_FINANCIAL_SCOPE.writeSourceId,
    limit: 100
  });
  const ledger: readonly GeneralLedgerLine[] = ledgerPage.items;
  const ledgerSummary: GeneralLedgerSummary = await sdk.queries.getGeneralLedgerSummary({
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    sourceId: BLU_FINANCIAL_SCOPE.writeSourceId
  });

  const invoicePage = await sdk.queries.listInvoices({ asOfDate: "2026-08-31", limit: 50 });
  const invoices: readonly InvoiceListItem[] = invoicePage.items;
  const invoice: InvoiceDetail = await sdk.queries.getInvoice(BLU_FINANCIAL_IDS.invoiceId, "2026-08-31");
  const invoiceSummary: InvoiceSummary = await sdk.queries.getInvoiceSummary({ asOfDate: "2026-08-31" });
  const customerStatement: CustomerStatement = await sdk.queries.getCustomerStatement({
    customerId: BLU_FINANCIAL_IDS.customerId,
    asOfDate: "2026-08-31",
    limit: 50
  });

  const vendorBillPage = await sdk.queries.listVendorBills({
    vendorId: BLU_FINANCIAL_IDS.vendorId,
    asOfDate: "2026-08-31",
    limit: 50
  });
  const vendorBills: readonly VendorBillListItem[] = vendorBillPage.items;
  const vendorBill: VendorBillDetail = await sdk.queries.getVendorBill(BLU_FINANCIAL_IDS.vendorBillId, "2026-08-31");
  const vendorBillSummary: VendorBillSummary = await sdk.queries.getVendorBillSummary({
    vendorId: BLU_FINANCIAL_IDS.vendorId,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    asOfDate: "2026-08-31"
  });

  const customerPaymentPage = await sdk.queries.listPayments({
    paymentType: "customer_payment",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    limit: 50
  });
  const customerPayments: readonly PaymentListItem[] = customerPaymentPage.items;
  const customerPayment: CustomerPaymentDetail = await sdk.queries.getCustomerPayment(
    BLU_FINANCIAL_IDS.customerPaymentId
  );
  const billPaymentPage = await sdk.queries.listBillPayments({
    vendorId: BLU_FINANCIAL_IDS.vendorId,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    limit: 50
  });
  const billPayments: readonly BillPaymentListItem[] = billPaymentPage.items;
  const billPayment: BillPaymentDetail = await sdk.queries.getBillPayment(BLU_FINANCIAL_IDS.billPaymentId);
  const billPaymentSummary: BillPaymentSummary = await sdk.queries.getBillPaymentSummary({
    vendorId: BLU_FINANCIAL_IDS.vendorId,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31"
  });
  const applicationPage = await sdk.queries.listPaymentApplications({
    sourcePaymentId: BLU_FINANCIAL_IDS.customerPaymentId,
    limit: 50
  });
  const applications: readonly PaymentApplicationListItem[] = applicationPage.items;
  const application: PaymentApplicationDetail = await sdk.queries.getPaymentApplication(
    BLU_FINANCIAL_IDS.paymentApplicationId
  );
  const paymentSummary: PaymentSummary = await sdk.queries.getPaymentSummary({
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31"
  });

  const bankReconciliationPage = await sdk.queries.listBankReconciliation({ limit: 50 });
  const bankReconciliation: readonly BankReconciliationListItem[] = bankReconciliationPage.items;
  const bankReconciliationSummary: BankReconciliationSummary = await sdk.queries.getBankReconciliationSummary();

  const profitAndLoss: FinancialStatement = await sdk.queries.getFinancialStatement({
    reportName: "profit_and_loss",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31"
  });
  const balanceSheet: FinancialStatement = await sdk.queries.getFinancialStatement({
    reportName: "balance_sheet",
    periodStart: "2026-01-01",
    periodEnd: "2026-08-31",
    asOfDate: "2026-08-31"
  });
  const trialBalance: FinancialStatement = await sdk.queries.getFinancialStatement({
    reportName: "trial_balance",
    periodStart: "2026-01-01",
    periodEnd: "2026-08-31",
    asOfDate: "2026-08-31"
  });
  const receivablesAging: AgingReport = await sdk.queries.getAging({
    kind: "receivables",
    asOfDate: "2026-08-31"
  });
  const payablesAging: AgingReport = await sdk.queries.getAging({
    kind: "payables",
    asOfDate: "2026-08-31"
  });
  const dashboard: FinancialDashboardSummary = await sdk.queries.getDashboardSummary({
    periodStart: "2026-08-01",
    asOfDate: "2026-08-31"
  });

  void [
    chart,
    journals,
    journal,
    fiscalPeriods,
    postingLock,
    ledger,
    ledgerSummary,
    invoices,
    invoice,
    invoiceSummary,
    customerStatement,
    vendorBills,
    vendorBill,
    vendorBillSummary,
    customerPayments,
    customerPayment,
    billPayments,
    billPayment,
    billPaymentSummary,
    applications,
    application,
    paymentSummary,
    bankReconciliation,
    bankReconciliationSummary,
    profitAndLoss,
    balanceSheet,
    trialBalance,
    receivablesAging,
    payablesAging,
    dashboard
  ];
}

async function compileBluInvoiceCommands(
  sdk: ErpFinancialsSdk,
  operation: BluOperation,
  approvedOperation: BluOperation
): Promise<void> {
  await sdk.invoices.createDraft({
    operation,
    idempotencyKey: "blu-invoice-draft-1001",
    customerId: BLU_FINANCIAL_IDS.customerId,
    receivableAccount: { accountKey: BLU_FINANCIAL_IDS.receivableAccountKey },
    documentNumber: "INV-1001",
    documentDate: "2026-08-01",
    dueDate: "2026-08-31",
    currencyCode: "USD",
    revenueLines: [
      {
        accountKey: BLU_FINANCIAL_IDS.revenueAccountKey,
        description: "BLU order revenue",
        quantity: "10.0000",
        unitAmount: "125.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        amount: "1250.00"
      }
    ]
  });
  await sdk.invoices.updateDraft({
    operation,
    invoiceDraftId: BLU_FINANCIAL_IDS.invoiceDraftId,
    expectedVersion: 1,
    customerId: BLU_FINANCIAL_IDS.customerId,
    receivableAccount: { accountKey: BLU_FINANCIAL_IDS.receivableAccountKey },
    documentNumber: "INV-1001",
    documentDate: "2026-08-01",
    dueDate: "2026-08-31",
    currencyCode: "USD",
    revenueLines: [
      {
        accountKey: BLU_FINANCIAL_IDS.revenueAccountKey,
        quantity: "10.0000",
        unitAmount: "124.95",
        amount: "1249.50"
      }
    ]
  });
  await sdk.invoices.voidDraft({
    operation,
    invoiceDraftId: BLU_FINANCIAL_IDS.invoiceDraftId,
    expectedVersion: 2
  });
  await sdk.invoices.issue({
    operation,
    invoiceDraftId: BLU_FINANCIAL_IDS.invoiceDraftId,
    expectedVersion: 2,
    idempotencyKey: "blu-invoice-1001-issue"
  });
  await sdk.invoices.voidIssued({
    operation: approvedOperation,
    invoiceDocumentId: BLU_FINANCIAL_IDS.invoiceId,
    expectedVersion: 1,
    idempotencyKey: "blu-invoice-1001-void",
    date: "2026-08-15",
    memo: "Void issued BLU invoice"
  });
  await sdk.invoices.recordDelivery({
    operation,
    invoiceDocumentId: BLU_FINANCIAL_IDS.invoiceId,
    idempotencyKey: "blu-invoice-1001-delivered",
    status: "delivered",
    channel: "email",
    recipientRef: "customer_blu_acme:billing",
    occurredAt: "2026-08-01T15:00:00.000Z"
  });
}

async function compileBluPaymentAndPayablesCommands(
  sdk: ErpFinancialsSdk,
  operation: BluOperation,
  approvedOperation: BluOperation
): Promise<void> {
  await sdk.commands.customerPayments.record({
    operation,
    idempotencyKey: "blu-customer-payment-1001",
    date: "2026-08-10",
    documentNumber: "RCPT-1001",
    customerId: BLU_FINANCIAL_IDS.customerId,
    amount: "1250.00",
    cashAccount: { accountKey: BLU_FINANCIAL_IDS.cashAccountKey },
    receivableAccount: { accountKey: BLU_FINANCIAL_IDS.receivableAccountKey }
  });
  await sdk.commands.paymentApplications.apply({
    operation,
    idempotencyKey: "blu-customer-payment-1001-apply",
    applicationType: "customer_payment_to_invoice",
    sourceDocumentId: BLU_FINANCIAL_IDS.customerPaymentId,
    targetDocumentId: BLU_FINANCIAL_IDS.invoiceId,
    amount: "1250.00",
    applicationDate: "2026-08-10",
    expectedSourceVersion: 1,
    expectedTargetVersion: 1
  });
  await sdk.commands.paymentApplications.unapply({
    operation: approvedOperation,
    applicationId: BLU_FINANCIAL_IDS.paymentApplicationId,
    effectiveDate: "2026-08-11",
    expectedVersion: 1
  });

  await sdk.commands.vendorBills.create({
    operation,
    idempotencyKey: "blu-vendor-bill-1001",
    date: "2026-08-03",
    documentNumber: "BILL-1001",
    vendorId: BLU_FINANCIAL_IDS.vendorId,
    dueDate: "2026-09-02",
    payableAccount: { accountKey: BLU_FINANCIAL_IDS.payableAccountKey },
    expenseLines: [
      {
        accountKey: BLU_FINANCIAL_IDS.expenseAccountKey,
        quantity: "5.0000",
        unitAmount: "100.00",
        amount: "500.00"
      }
    ]
  });
  await sdk.commands.vendorBills.voidPosted({
    operation: approvedOperation,
    vendorBillId: BLU_FINANCIAL_IDS.vendorBillId,
    expectedVersion: 1,
    idempotencyKey: "blu-vendor-bill-1001-void",
    date: "2026-08-04"
  });
  await sdk.commands.vendorBills.replacePosted({
    operation: approvedOperation,
    vendorBillId: BLU_FINANCIAL_IDS.vendorBillId,
    expectedVersion: 1,
    idempotencyKey: "blu-vendor-bill-1001-replace",
    date: "2026-08-04",
    replacement: {
      idempotencyKey: "blu-vendor-bill-1001-replacement",
      date: "2026-08-04",
      vendorId: BLU_FINANCIAL_IDS.vendorId,
      dueDate: "2026-09-03",
      payableAccount: { accountKey: BLU_FINANCIAL_IDS.payableAccountKey },
      expenseLines: [{ accountKey: BLU_FINANCIAL_IDS.expenseAccountKey, amount: "499.50" }]
    }
  });

  await sdk.commands.billPayments.recordAndApply({
    operation,
    idempotencyKey: "blu-bill-payment-1001",
    date: "2026-08-20",
    vendorId: BLU_FINANCIAL_IDS.vendorId,
    amount: "500.00",
    paymentMethod: "ach",
    payableAccount: { accountKey: BLU_FINANCIAL_IDS.payableAccountKey },
    cashAccount: { accountKey: BLU_FINANCIAL_IDS.cashAccountKey },
    allocations: [
      { billId: BLU_FINANCIAL_IDS.vendorBillId, amount: "500.00", expectedBillVersion: 1 }
    ]
  });
  await sdk.commands.billPayments.schedule({
    operation,
    idempotencyKey: "blu-bill-payment-1002-schedule",
    date: "2026-08-21",
    vendorId: BLU_FINANCIAL_IDS.vendorId,
    amount: "499.50",
    paymentMethod: "check",
    payableAccount: { accountKey: BLU_FINANCIAL_IDS.payableAccountKey },
    cashAccount: { accountKey: BLU_FINANCIAL_IDS.cashAccountKey },
    allocations: [
      { billId: BLU_FINANCIAL_IDS.vendorBillId, amount: "499.50", expectedBillVersion: 1 }
    ]
  });
  await sdk.commands.billPayments.clear({
    operation,
    billPaymentId: BLU_FINANCIAL_IDS.billPaymentId,
    expectedVersion: 1,
    idempotencyKey: "blu-bill-payment-1002-clear"
  });
  await sdk.commands.billPayments.cancel({
    operation,
    billPaymentId: BLU_FINANCIAL_IDS.billPaymentId,
    expectedVersion: 1,
    idempotencyKey: "blu-bill-payment-1002-cancel"
  });
  await sdk.commands.billPayments.voidAndUnapply({
    operation: approvedOperation,
    billPaymentId: BLU_FINANCIAL_IDS.billPaymentId,
    expectedVersion: 2,
    idempotencyKey: "blu-bill-payment-1001-void",
    date: "2026-08-22"
  });
}

async function compileBluBankReconciliationCommands(
  sdk: ErpFinancialsSdk,
  operation: BluOperation,
  approvedOperation: BluOperation
): Promise<void> {
  await sdk.bankReconciliation.ingest({
    operation,
    externalLineId: "blu-bank-line-1001",
    bankAccountId: "account_blu_cash",
    postedDate: "2026-08-10",
    amount: "1250.00",
    currencyCode: "USD",
    description: "Customer receipt"
  });
  await sdk.bankReconciliation.match({
    operation,
    bankStatementLineId: BLU_FINANCIAL_IDS.bankStatementLineId,
    transactionId: BLU_FINANCIAL_IDS.transactionId,
    expectedVersion: 1,
    idempotencyKey: "blu-bank-line-1001-match",
    method: "manual"
  });
  await sdk.bankReconciliation.unmatch({
    operation: approvedOperation,
    bankReconciliationMatchId: BLU_FINANCIAL_IDS.bankReconciliationMatchId,
    expectedVersion: 1
  });
  await sdk.bankReconciliation.ignore({
    operation,
    bankStatementLineId: BLU_FINANCIAL_IDS.bankStatementLineId,
    expectedVersion: 2
  });
}

function bluOperation(requestId: string, independentlyApproved = false): BluOperation {
  return {
    actorRef: "user_blu_finance",
    ...(independentlyApproved ? { approverRef: "user_blu_controller" } : {}),
    requestId,
    correlationId: "correlation_blu_contract",
    reasonCode: "blu_financial_operation",
    occurredAt: "2026-08-01T12:00:00.000Z"
  };
}
