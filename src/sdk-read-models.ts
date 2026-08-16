import { createHash } from "node:crypto";

import { ErpFinancialsError } from "./sdk-errors.js";

import type {
  AccountClassification,
  AccountingBasis,
  DecimalString,
  IsoCurrencyCode,
  IsoDate,
  IsoDateTime,
  JsonValue
} from "./canonical-model.js";
import type { ErpFinancialsTransactionRunner } from "./erp-financials-service.js";
import type { PostgresQueryClient } from "./postgres-storage.js";
import type { ReportingBookAccountRole } from "./reporting-books.js";

export type PageRequest = {
  readonly limit?: number;
  readonly cursor?: string;
};

export type Page<Result> = {
  readonly items: readonly Result[];
  readonly nextCursor?: string;
};

export type InvoiceListStatus = "draft" | "open" | "sent" | "overdue" | "partial" | "paid" | "voided";

export type InvoiceListItem = {
  readonly invoiceId: string;
  readonly sourceId: string;
  readonly sourceProvenance: "draft" | "posted";
  readonly customerId: string;
  readonly customerName?: string;
  readonly documentNumber?: string;
  readonly documentDate: IsoDate;
  readonly dueDate: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly originalAmount: DecimalString;
  readonly openAmount: DecimalString;
  readonly status: InvoiceListStatus;
  readonly version: number;
};

export type CommercialDocumentLineReadModel = {
  readonly lineId: string;
  readonly lineNumber: number;
  readonly accountId: string;
  readonly itemId?: string;
  readonly description?: string;
  readonly quantity: DecimalString;
  readonly unitAmount: DecimalString;
  /** Immutable exact unit cost captured on the commercial line, when supplied. */
  readonly unitCost?: DecimalString;
  readonly discountAmount: DecimalString;
  readonly taxCode?: string;
  readonly taxAmount: DecimalString;
  readonly servicePeriodStart?: IsoDate;
  readonly servicePeriodEnd?: IsoDate;
  readonly dimensionRefs: JsonValue;
  readonly amount: DecimalString;
};

export type InvoiceDetail = InvoiceListItem & {
  readonly memo?: string;
  readonly lines: readonly CommercialDocumentLineReadModel[];
};

export type InvoiceDeliveryEvent = {
  readonly deliveryEventId: string;
  readonly invoiceId: string;
  readonly status: "sent" | "delivered" | "failed";
  readonly channel: string;
  readonly recipientRef?: string;
  readonly occurredAt: IsoDateTime;
  readonly lifecycleEventId: string;
};

export type VendorBillStatus = "open" | "overdue" | "partial" | "paid" | "voided" | "replaced";

const VENDOR_BILL_STATUSES: ReadonlySet<VendorBillStatus> = new Set([
  "open",
  "overdue",
  "partial",
  "paid",
  "voided",
  "replaced"
]);

export type VendorBillListItem = {
  /** Canonical ERP Financials bill identifier. */
  readonly billId: string;
  readonly sourceId: string;
  readonly sourceProvenance: "posted";
  readonly transactionId: string;
  readonly vendorId: string;
  readonly vendorName?: string;
  readonly documentNumber?: string;
  readonly documentDate: IsoDate;
  readonly dueDate: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly originalAmount: DecimalString;
  readonly openAmount: DecimalString;
  readonly status: VendorBillStatus;
  readonly version: number;
};

export type VendorBillLineReadModel = CommercialDocumentLineReadModel & {
  /** Stable account key from the source system; falls back to sourceId:accountId for legacy facts. */
  readonly sourceAccountKey: string;
  readonly bookAccountKey?: string;
  readonly accountMappingProvenance: "reporting_book_mapping" | "source_account";
  readonly accountMappingId?: string;
  readonly sourceItemId?: string;
  readonly itemName?: string;
  readonly itemCategoryAccountId?: string;
  readonly categoryMappingProvenance: "item_expense_account" | "line_account_override" | "uncategorized";
};

export type VendorBillApplicationReadModel = {
  readonly applicationId: string;
  readonly sourcePaymentId: string;
  readonly applicationDate: IsoDate;
  readonly amount: DecimalString;
  readonly status: "applied" | "unapplied" | "voided";
  readonly version: number;
};

export type VendorBillDetail = VendorBillListItem & {
  readonly memo?: string;
  readonly lines: readonly VendorBillLineReadModel[];
  readonly applications: readonly VendorBillApplicationReadModel[];
};

export type VendorBillSummary = {
  readonly asOfDate: IsoDate;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly outstandingAmount: DecimalString;
  readonly outstandingVendorBillCount: number;
  readonly overdueAmount: DecimalString;
  readonly overdueVendorBillCount: number;
  /** Cumulative amount applied to non-voided bills as of asOfDate. */
  readonly paidAmount: DecimalString;
  /** Amount applied during periodStart..periodEnd that remains applied as of asOfDate. */
  readonly paidInPeriodAmount: DecimalString;
  readonly paidInPeriodVendorBillCount: number;
  readonly settledVendorBillCount: number;
  readonly voidedVendorBillCount: number;
  readonly replacedVendorBillCount: number;
};

export type PaymentStatus = "unapplied" | "partial" | "applied" | "voided";

const PAYMENT_STATUSES: ReadonlySet<PaymentStatus> = new Set(["unapplied", "partial", "applied", "voided"]);

export type PaymentListItem = {
  readonly paymentId: string;
  readonly sourceId: string;
  readonly paymentType: "customer_payment" | "bill_payment";
  /** Canonical immutable posting transaction for history-safe corrections. */
  readonly transactionId: string;
  readonly partyId: string;
  readonly partyName?: string;
  readonly documentNumber?: string;
  readonly paymentDate: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly amount: DecimalString;
  readonly unappliedAmount: DecimalString;
  readonly status: PaymentStatus;
  readonly version: number;
  /** Lifecycle event that originally posted the canonical payment. */
  readonly lifecycleEventId: string;
  readonly matchedApplicationCount: number;
};

export type CustomerPaymentProvenanceReadModel = {
  readonly externalBankMatch?: {
    readonly externalMatchId: string;
    readonly bankStatementLineId?: string;
    readonly providerReference?: string;
    readonly matchedAt?: IsoDateTime;
  };
  readonly deposit?: {
    readonly depositId: string;
    readonly externalDepositReference?: string;
    readonly depositedAt?: IsoDateTime;
  };
};

export type PaymentApplicationMatchProvenance = {
  readonly matchCandidateId: string;
  readonly matchDecisionId: string;
  readonly method: "automatic" | "manual";
  readonly score: DecimalString;
  readonly evidence?: JsonValue;
};

export type PaymentApplicationListItem = {
  readonly applicationId: string;
  readonly sourceId: string;
  readonly applicationType: "customer_payment_to_invoice" | "bill_payment_to_bill" | "credit_to_invoice";
  readonly status: "applied" | "unapplied" | "voided";
  readonly version: number;
  readonly applicationDate: IsoDate;
  readonly sourcePaymentId: string;
  readonly targetDocumentId: string;
  readonly amount: DecimalString;
  readonly currencyCode: IsoCurrencyCode;
  readonly appliedLifecycleEventId: string;
  readonly endedLifecycleEventId?: string;
  readonly matchProvenance?: PaymentApplicationMatchProvenance;
};

export type PaymentApplicationDetail = PaymentApplicationListItem;

export type CustomerPaymentDetail = PaymentListItem & {
  readonly memo?: string;
  readonly provenance?: CustomerPaymentProvenanceReadModel;
  readonly applications: readonly PaymentApplicationListItem[];
};

export type FinancialLifecycleProvenance = {
  readonly lifecycleEventId: string;
  readonly actorRef: string;
  readonly approverRef?: string;
  readonly requestId: string;
  readonly reasonCode: string;
};

export type BillPaymentLifecycleEvidence = {
  readonly scheduled?: FinancialLifecycleProvenance;
  readonly cleared?: FinancialLifecycleProvenance;
  /** Low-level posting event retained for ledger audit compatibility. */
  readonly posted?: FinancialLifecycleProvenance;
  readonly voided?: FinancialLifecycleProvenance;
  readonly reversalTransactionId?: string;
};

export type BillPaymentLifecycleStatus = "scheduled" | "cleared" | "voided";

export type BillPaymentMethod = "ach" | "card" | "check";

const BILL_PAYMENT_LIFECYCLE_STATUSES: ReadonlySet<BillPaymentLifecycleStatus> = new Set([
  "scheduled",
  "cleared",
  "voided"
]);
const BILL_PAYMENT_METHODS: ReadonlySet<BillPaymentMethod> = new Set(["ach", "card", "check"]);

export type BillPaymentAccountEvidence = {
  readonly accountId: string;
  readonly postingId?: string;
  readonly debitAmount?: DecimalString;
  readonly creditAmount?: DecimalString;
};

export type BillPaymentListItem = {
  readonly paymentId: string;
  readonly sourceId: string;
  readonly paymentType: "bill_payment";
  readonly vendorId: string;
  /** Compatibility alias for generic payment consumers. */
  readonly partyId: string;
  readonly vendorName?: string;
  readonly partyName?: string;
  readonly documentNumber?: string;
  readonly paymentDate: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly amount: DecimalString;
  readonly status: BillPaymentLifecycleStatus;
  /** Optimistic version of the scheduled/cleared/voided disbursement lifecycle. */
  readonly version: number;
  readonly paymentMethod?: BillPaymentMethod;
  readonly reference?: string;
  readonly fundingAccountId?: string;
  readonly payableAccountId?: string;
  readonly transactionId?: string;
  readonly unappliedAmount?: DecimalString;
  readonly documentVersion?: number;
  readonly lifecycleEventId?: string;
  readonly applicationStatus?: PaymentStatus;
  readonly matchedApplicationCount: number;
};

export type BillPaymentDetail = BillPaymentListItem & {
  readonly memo?: string;
  readonly lifecycle: BillPaymentLifecycleEvidence;
  readonly fundingAccount?: BillPaymentAccountEvidence;
  readonly payableAccount?: BillPaymentAccountEvidence;
  readonly applications: readonly PaymentApplicationListItem[];
};

export type BillPaymentSummary = {
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly scheduledAmount: DecimalString;
  readonly scheduledCount: number;
  readonly clearedAmount: DecimalString;
  readonly clearedCount: number;
  readonly voidedAmount: DecimalString;
  readonly voidedCount: number;
  readonly totalAmount: DecimalString;
  readonly totalCount: number;
};

export type WriteOffListItem = {
  readonly writeOffId: string;
  readonly sourceId: string;
  readonly transactionId: string;
  readonly customerId: string;
  readonly customerName?: string;
  readonly relatedInvoiceId?: string;
  readonly documentNumber?: string;
  readonly writeOffDate: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly amount: DecimalString;
  readonly status: "settled" | "voided" | "replaced";
  readonly version: number;
  readonly reason?: string;
  readonly reversalTransactionId?: string;
  readonly replacementWriteOffId?: string;
  readonly replacesWriteOffId?: string;
};

export type WriteOffDetail = WriteOffListItem & {
  readonly memo?: string;
  readonly balanceType: "receivable" | "payable";
  readonly balanceAccountId: string;
  readonly writeOffAccountId: string;
  readonly lifecycle: FinancialLifecycleProvenance;
};

export type AdjustmentType = "credit" | "refund";

export type AdjustmentStatus = "open" | "partially_applied" | "settled" | "voided" | "replaced";

export type AdjustmentListItem = {
  readonly adjustmentId: string;
  readonly sourceId: string;
  readonly transactionId: string;
  readonly adjustmentType: AdjustmentType;
  readonly customerId: string;
  readonly customerName?: string;
  readonly documentNumber?: string;
  readonly adjustmentDate: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly originalAmount: DecimalString;
  readonly remainingAmount: DecimalString;
  readonly status: AdjustmentStatus;
  readonly version: number;
  readonly reversalTransactionId?: string;
  readonly replacementAdjustmentId?: string;
  readonly replacesAdjustmentId?: string;
};

export type AdjustmentPostingReadModel = {
  readonly postingId: string;
  readonly accountId: string;
  readonly bookAccountKey: string;
  readonly accountName: string;
  readonly itemId?: string;
  readonly description?: string;
  readonly debitAmount: DecimalString;
  readonly creditAmount: DecimalString;
  readonly currencyCode: IsoCurrencyCode;
  readonly dimensionRefs: JsonValue;
};

export type AdjustmentApplicationReadModel = {
  readonly applicationId: string;
  readonly invoiceId: string;
  readonly applicationDate: IsoDate;
  readonly amount: DecimalString;
  readonly status: "applied" | "unapplied" | "voided";
  readonly version: number;
};

export type AdjustmentDetail = AdjustmentListItem & {
  readonly memo?: string;
  readonly lines: readonly CommercialDocumentLineReadModel[];
  readonly postings: readonly AdjustmentPostingReadModel[];
  readonly applications: readonly AdjustmentApplicationReadModel[];
  readonly lifecycle?: FinancialLifecycleProvenance;
  readonly refundProvenance?: {
    readonly relatedInvoiceId?: string;
    readonly refundMethod?: string;
    readonly lifecycleReference?: string;
  };
};

export type InvoiceSummary = {
  readonly asOfDate: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly outstandingAmount: DecimalString;
  readonly outstandingInvoiceCount: number;
  readonly overdueAmount: DecimalString;
  readonly overdueInvoiceCount: number;
  readonly unsentDraftAmount: DecimalString;
  readonly unsentDraftCount: number;
  /** Cash applied through customer-payment applications, excluding credits. */
  readonly collectedAmount: DecimalString;
  readonly settledInvoiceCount: number;
};

export type PaymentSummary = {
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly receivedAmount: DecimalString;
  readonly receivedPaymentCount: number;
  readonly automaticallyMatchedPaymentCount: number;
  readonly matchedPaymentCount: number;
  readonly automaticMatchRatePercent: DecimalString;
  readonly unappliedAmount: DecimalString;
  readonly unappliedPaymentCount: number;
  readonly awaitingBankReviewCount: number;
};

export type GeneralLedgerSummary = {
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly postingCount: number;
  readonly totalDebits: DecimalString;
  readonly totalCredits: DecimalString;
  readonly difference: DecimalString;
};

export type GeneralLedgerPolarity = "debit" | "credit";

/**
 * One validated filter contract is deliberately shared by the ledger page and
 * its summary cards so a host cannot accidentally summarize a different set of
 * postings than the rows it displays.
 */
export type GeneralLedgerFilters = {
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly accountKey?: string;
  readonly sourceId?: string;
  readonly transactionType?: string;
  /** Matches a canonical class dimension by dimensionId or sourceDimensionId. */
  readonly classId?: string;
  /** Generic canonical dimension filter; kind and id must be supplied together. */
  readonly dimensionKind?: string;
  readonly dimensionId?: string;
  readonly polarity?: GeneralLedgerPolarity;
  /** Literal, case-insensitive search. Wildcard characters have no special meaning. */
  readonly search?: string;
};

export type GeneralLedgerDimensionProvenance = {
  readonly dimensionKind: string;
  readonly dimensionId?: string;
  readonly sourceDimensionId?: string;
  readonly name?: string;
};

export type GeneralLedgerSourceProvenance = {
  readonly sourceId: string;
  readonly sourceRole: "historical" | "active" | "adjustment";
  readonly sourceSystem: string;
  readonly providerEnvironment: string;
  readonly sourceTransactionType: string;
  readonly sourceTransactionId: string;
  readonly sourcePostingId: string;
  readonly sourceObjectType?: string;
  readonly sourceObjectId?: string;
  readonly sourceUpdatedAt?: IsoDateTime;
  readonly checksum?: string;
};

export type GeneralLedgerLine = {
  readonly postingId: string;
  readonly sourceId: string;
  readonly transactionId: string;
  readonly transactionNumber?: string;
  readonly transactionDate: IsoDate;
  readonly postingDate: IsoDate;
  readonly transactionType: string;
  readonly accountId: string;
  readonly bookAccountKey: string;
  readonly accountNumber?: string;
  readonly accountName: string;
  readonly partyId?: string;
  readonly itemId?: string;
  readonly description?: string;
  readonly debitAmount: DecimalString;
  readonly creditAmount: DecimalString;
  readonly netAmount: DecimalString;
  readonly currencyCode: IsoCurrencyCode;
  readonly dimensions: readonly GeneralLedgerDimensionProvenance[];
  /** Number of canonical dimensions omitted after the public per-row bound. */
  readonly omittedDimensionCount: number;
  readonly sourceProvenance: GeneralLedgerSourceProvenance;
};

export type ChartOfAccountsItem = {
  readonly bookAccountKey: string;
  readonly sourceAccountIds: readonly string[];
  readonly accountNumber?: string;
  readonly name: string;
  readonly classification: AccountClassification;
  readonly type?: string;
  readonly subtype?: string;
  /** Present for a reporting-book-owned account; absent for an unmapped source fallback. */
  readonly accountRole?: ReportingBookAccountRole;
  /** Current mutation version for a reporting-book-owned account. */
  readonly version?: number;
  readonly parentBookAccountKey?: string;
  readonly active: boolean;
  readonly debitAmount: DecimalString;
  readonly creditAmount: DecimalString;
  readonly directBalance: DecimalString;
  readonly balance: DecimalString;
  readonly currencyCode: IsoCurrencyCode;
};

export type FinancialDashboardSummary = {
  readonly asOfDate: IsoDate;
  readonly periodStart: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly assets: DecimalString;
  readonly liabilities: DecimalString;
  readonly equity: DecimalString;
  readonly revenue: DecimalString;
  readonly expenses: DecimalString;
  readonly netIncome: DecimalString;
  readonly accountsReceivable: DecimalString;
  readonly accountsPayable: DecimalString;
  readonly overdueReceivables: DecimalString;
  readonly overduePayables: DecimalString;
};

export type FinancialStatementName = "profit_and_loss" | "balance_sheet" | "trial_balance";

export type FinancialStatementLine = {
  readonly bookAccountKey: string;
  readonly parentBookAccountKey?: string;
  readonly accountNumber?: string;
  readonly name: string;
  readonly classification: AccountClassification;
  /** Activity on this account before descendant roll-up. */
  readonly directAmount: DecimalString;
  /** Activity on this account plus every descendant. */
  readonly amount: DecimalString;
  readonly debitAmount: DecimalString;
  readonly creditAmount: DecimalString;
};

export type FinancialStatement = {
  readonly reportName: FinancialStatementName;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly asOfDate: IsoDate;
  readonly accountingBasis: AccountingBasis;
  readonly currencyCode: IsoCurrencyCode;
  readonly lines: readonly FinancialStatementLine[];
  readonly totals: Readonly<Record<string, DecimalString>>;
};

export type AgingBucket = "current" | "days_1_30" | "days_31_60" | "days_61_90" | "days_over_90";

export type AgingRow = {
  readonly partyId: string;
  readonly partyName?: string;
  readonly current: DecimalString;
  readonly days1To30: DecimalString;
  readonly days31To60: DecimalString;
  readonly days61To90: DecimalString;
  readonly daysOver90: DecimalString;
  readonly total: DecimalString;
};

export type AgingReport = {
  readonly kind: "receivables" | "payables";
  readonly asOfDate: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly rows: readonly AgingRow[];
  readonly totals: Omit<AgingRow, "partyId" | "partyName">;
};

export type BankReconciliationListItem = {
  readonly bankStatementLineId: string;
  readonly sourceId: string;
  readonly bankAccountId: string;
  readonly externalLineId: string;
  readonly postedDate: IsoDate;
  readonly amount: DecimalString;
  readonly currencyCode: IsoCurrencyCode;
  readonly description?: string;
  readonly reference?: string;
  readonly status: "unmatched" | "matched" | "ignored";
  readonly version: number;
  readonly matchedTransactionId?: string;
  readonly matchMethod?: "automatic" | "manual";
};

export type BankReconciliationSummary = {
  readonly currencyCode: IsoCurrencyCode;
  readonly unmatchedCount: number;
  readonly matchedCount: number;
  readonly ignoredCount: number;
  readonly unmatchedAbsoluteAmount: DecimalString;
  readonly matchedAbsoluteAmount: DecimalString;
};

export type AccountingLifecycleProvenance = {
  readonly lifecycleEventId: string;
  readonly eventType: string;
  readonly actorRef: string;
  readonly approverRef?: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly reasonCode: string;
  readonly reasonDetail?: string;
  readonly occurredAt: IsoDateTime;
  readonly recordedAt: IsoDateTime;
  readonly payloadChecksum: string;
  readonly priorEventId?: string;
};

export type JournalEntryStatus = "posted" | "reversed" | "voided" | "corrected" | "replaced";

export type JournalEntrySourceProvenance = {
  readonly sourceId: string;
  readonly sourceRole: "historical" | "active" | "adjustment";
  readonly sourceSystem: string;
  readonly providerEnvironment: string;
  readonly sourceTransactionId: string;
  readonly sourceTransactionType: string;
  readonly sourceObjectType?: string;
  readonly sourceObjectId?: string;
  readonly sourceUpdatedAt?: IsoDateTime;
  readonly checksum?: string;
};

export type JournalEntryListItem = {
  readonly journalEntryId: string;
  /** The immutable first transaction in a reversal/correction/replacement chain. */
  readonly originalTransactionId: string;
  readonly sourceId: string;
  readonly transactionNumber?: string;
  readonly transactionDate: IsoDate;
  readonly postedAt: IsoDateTime;
  readonly memo?: string;
  readonly currencyCode: IsoCurrencyCode;
  readonly accountingBasis: AccountingBasis;
  readonly status: JournalEntryStatus;
  readonly totalDebit: DecimalString;
  readonly totalCredit: DecimalString;
  readonly lineCount: number;
  /** One plus the number of immutable lifecycle links owned by this transaction. */
  readonly version: number;
  readonly sourceProvenance: JournalEntrySourceProvenance;
  readonly preparerProvenance: AccountingLifecycleProvenance;
};

export type JournalEntryAccountReference = {
  readonly accountId: string;
  readonly sourceAccountId: string;
  readonly bookAccountKey: string;
  readonly accountNumber?: string;
  readonly accountName: string;
  readonly classification: AccountClassification;
};

export type JournalEntryLineReadModel = {
  readonly transactionLineId: string;
  readonly postingId: string;
  readonly sourcePostingId: string;
  readonly lineNumber: number;
  readonly account: JournalEntryAccountReference;
  readonly partyId?: string;
  readonly itemId?: string;
  readonly description?: string;
  readonly debitAmount: DecimalString;
  readonly creditAmount: DecimalString;
  readonly netAmount: DecimalString;
  readonly dimensionRefs: JsonValue;
};

export type JournalEntryLifecycleLinkReadModel = {
  readonly journalEntryLinkId: string;
  readonly linkType: "reversal" | "void" | "correction" | "replacement";
  readonly originalTransactionId: string;
  readonly relatedTransactionId: string;
  readonly createdAt: IsoDateTime;
  readonly lifecycle: AccountingLifecycleProvenance;
};

export type JournalEntryDetail = JournalEntryListItem & {
  readonly lines: readonly JournalEntryLineReadModel[];
  readonly lifecycle: readonly AccountingLifecycleProvenance[];
  readonly links: readonly JournalEntryLifecycleLinkReadModel[];
};

export type FiscalPeriodReadModel = {
  readonly fiscalPeriodId: string;
  readonly sourceId: string;
  readonly fiscalYear: number;
  readonly periodNumber: number;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly status: "open" | "closing" | "closed";
  readonly version: number;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly closeEvidence?: {
    readonly trialBalanceSnapshotId: string;
    readonly reconciliationRefs: readonly string[];
    readonly checklistRef: string;
    readonly postingMaxUpdatedAt: IsoDateTime;
    readonly evidenceChecksum: string;
  };
  readonly closeLifecycle?: AccountingLifecycleProvenance;
  readonly reopenLifecycle?: AccountingLifecycleProvenance;
  readonly latestLifecycle: AccountingLifecycleProvenance;
};

export type PostingLockReadModel = {
  readonly sourceId: string;
  readonly postingLockDate?: IsoDate;
  /** Zero denotes that no lock control has been created and is the create command's expectedVersion. */
  readonly version: number;
  readonly lifecycle?: AccountingLifecycleProvenance;
};

export type FinancialReadModels = {
  listJournalEntries(input?: PageRequest & {
    readonly sourceId?: string;
    readonly status?: JournalEntryStatus;
    readonly periodStart?: IsoDate;
    readonly periodEnd?: IsoDate;
    readonly transactionType?: string;
    readonly preparerRef?: string;
    readonly search?: string;
  }): Promise<Page<JournalEntryListItem>>;
  getJournalEntry(journalEntryId: string): Promise<JournalEntryDetail>;
  listFiscalPeriods(input: PageRequest & {
    readonly sourceId: string;
    readonly status?: FiscalPeriodReadModel["status"];
    readonly fiscalYear?: number;
  }): Promise<Page<FiscalPeriodReadModel>>;
  getFiscalPeriod(sourceId: string, fiscalPeriodId: string): Promise<FiscalPeriodReadModel>;
  getPostingLock(sourceId: string): Promise<PostingLockReadModel>;
  listInvoices(input?: PageRequest & { readonly status?: InvoiceListStatus; readonly asOfDate?: IsoDate }): Promise<Page<InvoiceListItem>>;
  getInvoice(invoiceId: string, asOfDate?: IsoDate): Promise<InvoiceDetail>;
  listInvoiceDeliveries(invoiceId: string, input?: PageRequest): Promise<Page<InvoiceDeliveryEvent>>;
  getInvoiceSummary(input?: { readonly asOfDate?: IsoDate }): Promise<InvoiceSummary>;
  listVendorBills(input?: PageRequest & { readonly status?: VendorBillStatus; readonly asOfDate?: IsoDate; readonly vendorId?: string }): Promise<Page<VendorBillListItem>>;
  getVendorBill(billId: string, asOfDate?: IsoDate): Promise<VendorBillDetail>;
  getVendorBillSummary(input?: {
    readonly asOfDate?: IsoDate;
    readonly periodStart?: IsoDate;
    readonly periodEnd?: IsoDate;
    readonly vendorId?: string;
  }): Promise<VendorBillSummary>;
  listPayments(input?: PageRequest & {
    readonly paymentType?: PaymentListItem["paymentType"];
    readonly vendorId?: string;
    readonly periodStart?: IsoDate;
    readonly periodEnd?: IsoDate;
    readonly status?: PaymentStatus;
  }): Promise<Page<PaymentListItem>>;
  listBillPayments(input?: PageRequest & {
    readonly vendorId?: string;
    readonly periodStart?: IsoDate;
    readonly periodEnd?: IsoDate;
    readonly status?: BillPaymentLifecycleStatus;
    readonly paymentMethod?: BillPaymentMethod;
  }): Promise<Page<BillPaymentListItem>>;
  getCustomerPayment(paymentId: string): Promise<CustomerPaymentDetail>;
  getBillPayment(paymentId: string): Promise<BillPaymentDetail>;
  getBillPaymentSummary(input: {
    readonly periodStart: IsoDate;
    readonly periodEnd: IsoDate;
    readonly vendorId?: string;
    readonly status?: BillPaymentLifecycleStatus;
    readonly paymentMethod?: BillPaymentMethod;
  }): Promise<BillPaymentSummary>;
  listPaymentApplications(input?: PageRequest & {
    readonly applicationType?: PaymentApplicationListItem["applicationType"];
    readonly status?: PaymentApplicationListItem["status"];
    readonly sourcePaymentId?: string;
    readonly targetDocumentId?: string;
  }): Promise<Page<PaymentApplicationListItem>>;
  getPaymentApplication(applicationId: string): Promise<PaymentApplicationDetail>;
  getPaymentSummary(input: { readonly periodStart: IsoDate; readonly periodEnd: IsoDate }): Promise<PaymentSummary>;
  listAdjustments(input?: PageRequest & { readonly adjustmentType?: AdjustmentType; readonly status?: AdjustmentStatus }): Promise<Page<AdjustmentListItem>>;
  getAdjustment(adjustmentId: string): Promise<AdjustmentDetail>;
  listWriteOffs(input?: PageRequest & { readonly customerId?: string; readonly status?: WriteOffListItem["status"] }): Promise<Page<WriteOffListItem>>;
  getWriteOff(writeOffId: string): Promise<WriteOffDetail>;
  listGeneralLedger(input: PageRequest & GeneralLedgerFilters): Promise<Page<GeneralLedgerLine>>;
  getGeneralLedgerSummary(input: GeneralLedgerFilters): Promise<GeneralLedgerSummary>;
  listChartOfAccounts(input?: { readonly asOfDate?: IsoDate; readonly includeInactive?: boolean }): Promise<readonly ChartOfAccountsItem[]>;
  getDashboardSummary(input: { readonly periodStart: IsoDate; readonly asOfDate: IsoDate }): Promise<FinancialDashboardSummary>;
  getFinancialStatement(input: { readonly reportName: FinancialStatementName; readonly periodStart: IsoDate; readonly periodEnd: IsoDate; readonly asOfDate?: IsoDate }): Promise<FinancialStatement>;
  getAging(input: { readonly kind: "receivables" | "payables"; readonly asOfDate: IsoDate }): Promise<AgingReport>;
  listBankReconciliation(input?: PageRequest & { readonly status?: BankReconciliationListItem["status"] }): Promise<Page<BankReconciliationListItem>>;
  getBankReconciliationSummary(): Promise<BankReconciliationSummary>;
};

type Scope = {
  readonly database: ErpFinancialsTransactionRunner;
  readonly tenantId: string;
  readonly companyId: string;
  readonly bookId: string;
};

type ResolvedBook = {
  readonly currencyCode: IsoCurrencyCode;
  readonly accountingBasis: AccountingBasis;
};

export function createFinancialReadModels(input: Scope): FinancialReadModels {
  assertNonEmpty(input.tenantId, "tenantId");
  assertNonEmpty(input.companyId, "companyId");
  assertNonEmpty(input.bookId, "bookId");
  return {
    listJournalEntries: (request = {}) => listJournalEntries(input, request),
    getJournalEntry: (journalEntryId) => getJournalEntry(input, journalEntryId),
    listFiscalPeriods: (request) => listFiscalPeriods(input, request),
    getFiscalPeriod: (sourceId, fiscalPeriodId) => getFiscalPeriod(input, sourceId, fiscalPeriodId),
    getPostingLock: (sourceId) => getPostingLock(input, sourceId),
    listInvoices: (request = {}) => listInvoices(input, request),
    getInvoice: (invoiceId, asOfDate) => getInvoice(input, invoiceId, asOfDate),
    listInvoiceDeliveries: (invoiceId, request = {}) => listInvoiceDeliveries(input, invoiceId, request),
    getInvoiceSummary: (request = {}) => getInvoiceSummary(input, request),
    listVendorBills: (request = {}) => listVendorBills(input, request),
    getVendorBill: (billId, asOfDate) => getVendorBill(input, billId, asOfDate),
    getVendorBillSummary: (request = {}) => getVendorBillSummary(input, request),
    listPayments: (request = {}) => listPayments(input, request),
    listBillPayments: (request = {}) => listBillPayments(input, request),
    getCustomerPayment: (paymentId) => getCustomerPayment(input, paymentId),
    getBillPayment: (paymentId) => getBillPayment(input, paymentId),
    getBillPaymentSummary: (request) => getBillPaymentSummary(input, request),
    listPaymentApplications: (request = {}) => listPaymentApplications(input, request),
    getPaymentApplication: (applicationId) => getPaymentApplication(input, applicationId),
    getPaymentSummary: (request) => getPaymentSummary(input, request),
    listAdjustments: (request = {}) => listAdjustments(input, request),
    getAdjustment: (adjustmentId) => getAdjustment(input, adjustmentId),
    listWriteOffs: (request = {}) => listWriteOffs(input, request),
    getWriteOff: (writeOffId) => getWriteOff(input, writeOffId),
    listGeneralLedger: (request) => listGeneralLedger(input, request),
    getGeneralLedgerSummary: (request) => getGeneralLedgerSummary(input, request),
    listChartOfAccounts: (request = {}) => listChartOfAccounts(input, request),
    getDashboardSummary: (request) => getDashboardSummary(input, request),
    getFinancialStatement: (request) => getFinancialStatement(input, request),
    getAging: (request) => getAging(input, request),
    listBankReconciliation: (request = {}) => listBankReconciliation(input, request),
    getBankReconciliationSummary: () => getBankReconciliationSummary(input)
  };
}

type JournalEntryFilters = {
  readonly sourceId?: string;
  readonly status?: JournalEntryStatus;
  readonly periodStart?: IsoDate;
  readonly periodEnd?: IsoDate;
  readonly transactionType?: string;
  readonly preparerRef?: string;
  readonly search?: string;
};

async function listJournalEntries(
  scope: Scope,
  input: PageRequest & JournalEntryFilters
): Promise<Page<JournalEntryListItem>> {
  const filters = journalEntryFilters(input);
  const pageKind = `journal-entries:${readFilterFingerprint(filters)}`;
  const page = pageInput(input, pageKind, scope.bookId);
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `with journal as (
  select transaction."transaction_id" as "journal_entry_id",
    coalesce(inbound."original_transaction_id", transaction."transaction_id") as "original_transaction_id",
    transaction."source_id", transaction."source_transaction_id", transaction."source_transaction_type",
    transaction."transaction_number", transaction."transaction_date", transaction."posted_at", transaction."memo",
    transaction."currency_code", posting."accounting_basis", posting."total_debit", posting."total_credit",
    posting."line_count", source."source_role", accounting_source."source_system",
    accounting_source."provider_environment", transaction."source_payload_ref",
    case
      when links."replacement_count" > 0 then 'replaced'
      when links."correction_count" > 0 then 'corrected'
      when links."void_count" > 0 then 'voided'
      when links."reversal_count" > 0 then 'reversed'
      else 'posted'
    end as "canonical_status",
    1 + links."link_count" as "version",
    prepared."event_id" as "preparer_event_id", prepared."event_type" as "preparer_event_type",
    prepared."actor_ref" as "preparer_actor_ref", prepared."approver_ref" as "preparer_approver_ref",
    prepared."request_id" as "preparer_request_id", prepared."correlation_id" as "preparer_correlation_id",
    prepared."reason_code" as "preparer_reason_code", prepared."reason_detail" as "preparer_reason_detail",
    prepared."occurred_at" as "preparer_occurred_at", prepared."recorded_at" as "preparer_recorded_at",
    prepared."payload_checksum" as "preparer_payload_checksum", prepared."prior_event_id" as "preparer_prior_event_id"
  from "erp_financials"."transactions" transaction
  join "erp_financials"."reporting_book_sources" source
    on source."tenant_id" = $1 and source."company_id" = $2 and source."book_id" = $3
   and source."source_id" = transaction."source_id"
   and (source."effective_from" is null or source."effective_from" <= transaction."transaction_date")
   and (source."effective_through" is null or source."effective_through" >= transaction."transaction_date")
  join "erp_financials"."accounting_sources" accounting_source
    on accounting_source."tenant_id" = transaction."tenant_id" and accounting_source."source_id" = transaction."source_id"
  join lateral (
    select coalesce(sum(posting."debit_amount"), 0) as "total_debit",
      coalesce(sum(posting."credit_amount"), 0) as "total_credit", count(*)::integer as "line_count",
      min(posting."accounting_basis") as "accounting_basis"
    from "erp_financials"."ledger_postings" posting
    where posting."tenant_id" = transaction."tenant_id" and posting."source_id" = transaction."source_id"
      and posting."transaction_id" = transaction."transaction_id"
      and posting."accounting_basis" = $4 and posting."currency_code" = $5
  ) posting on posting."line_count" > 0
  join lateral (
    select event.* from "erp_financials"."financial_lifecycle_events" event
    where event."tenant_id" = $1 and event."company_id" = $2
      and event."source_id" = transaction."source_id" and event."aggregate_type" = 'journal_entry'
      and event."aggregate_id" = transaction."transaction_id"
      and event."event_type" in ('journal_entry.posted', 'journal_entry.adjustment_posted')
    order by event."occurred_at", event."recorded_at", event."event_id" limit 1
  ) prepared on true
  left join lateral (
    select count(*)::integer as "link_count",
      count(*) filter (where link."link_type" = 'reversal')::integer as "reversal_count",
      count(*) filter (where link."link_type" = 'void')::integer as "void_count",
      count(*) filter (where link."link_type" = 'correction')::integer as "correction_count",
      count(*) filter (where link."link_type" = 'replacement')::integer as "replacement_count"
    from "erp_financials"."journal_entry_links" link
    where link."tenant_id" = $1 and link."company_id" = $2 and link."source_id" = transaction."source_id"
      and link."original_transaction_id" = transaction."transaction_id"
  ) links on true
  left join lateral (
    select link."original_transaction_id" from "erp_financials"."journal_entry_links" link
    where link."tenant_id" = $1 and link."company_id" = $2 and link."source_id" = transaction."source_id"
      and link."related_transaction_id" = transaction."transaction_id"
    order by link."created_at", link."journal_entry_link_id" limit 1
  ) inbound on true
  where transaction."tenant_id" = $1 and transaction."status" = 'posted'
)
select * from journal
where ($6::text is null or "source_id" = $6)
  and ($7::text is null or "canonical_status" = $7)
  and ($8::date is null or "transaction_date" >= $8)
  and ($9::date is null or "transaction_date" <= $9)
  and ($10::text is null or "source_transaction_type" = $10)
  and ($11::text is null or "preparer_actor_ref" = $11)
  and ($12::text is null or strpos(lower(concat_ws(' ', "transaction_number", "memo", "journal_entry_id")), lower($12)) > 0)
  and ($13::date is null or ("transaction_date", "journal_entry_id") < ($13::date, $14::text))
order by "transaction_date" desc, "journal_entry_id" desc
limit $15`,
      [scope.tenantId, scope.companyId, scope.bookId, book.accountingBasis, book.currencyCode,
        filters.sourceId, filters.status, filters.periodStart, filters.periodEnd, filters.transactionType,
        filters.preparerRef, filters.search, page.date, page.id, page.limit + 1]
    );
    return toPage(result.rows.map(journalEntryFromRow), page.limit, pageKind, scope.bookId, (item) => ({
      date: item.transactionDate,
      id: item.journalEntryId
    }));
  });
}

async function getJournalEntry(scope: Scope, journalEntryId: string): Promise<JournalEntryDetail> {
  assertNonEmpty(journalEntryId, "journalEntryId");
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const header = await client.query(
      `select transaction."transaction_id" as "journal_entry_id",
  coalesce(inbound."original_transaction_id", transaction."transaction_id") as "original_transaction_id",
  transaction."source_id", transaction."source_transaction_id", transaction."source_transaction_type",
  transaction."transaction_number", transaction."transaction_date", transaction."posted_at", transaction."memo",
  transaction."currency_code", posting."accounting_basis", posting."total_debit", posting."total_credit",
  posting."line_count", source."source_role", accounting_source."source_system",
  accounting_source."provider_environment", transaction."source_payload_ref",
  case when links."replacement_count" > 0 then 'replaced' when links."correction_count" > 0 then 'corrected'
    when links."void_count" > 0 then 'voided' when links."reversal_count" > 0 then 'reversed' else 'posted' end as "canonical_status",
  1 + links."link_count" as "version",
  prepared."event_id" as "preparer_event_id", prepared."event_type" as "preparer_event_type",
  prepared."actor_ref" as "preparer_actor_ref", prepared."approver_ref" as "preparer_approver_ref",
  prepared."request_id" as "preparer_request_id", prepared."correlation_id" as "preparer_correlation_id",
  prepared."reason_code" as "preparer_reason_code", prepared."reason_detail" as "preparer_reason_detail",
  prepared."occurred_at" as "preparer_occurred_at", prepared."recorded_at" as "preparer_recorded_at",
  prepared."payload_checksum" as "preparer_payload_checksum", prepared."prior_event_id" as "preparer_prior_event_id"
from "erp_financials"."transactions" transaction
join "erp_financials"."reporting_book_sources" source
  on source."tenant_id" = $1 and source."company_id" = $2 and source."book_id" = $3 and source."source_id" = transaction."source_id"
 and (source."effective_from" is null or source."effective_from" <= transaction."transaction_date")
 and (source."effective_through" is null or source."effective_through" >= transaction."transaction_date")
join "erp_financials"."accounting_sources" accounting_source
  on accounting_source."tenant_id" = transaction."tenant_id" and accounting_source."source_id" = transaction."source_id"
join lateral (
  select coalesce(sum("debit_amount"), 0) as "total_debit", coalesce(sum("credit_amount"), 0) as "total_credit",
    count(*)::integer as "line_count", min("accounting_basis") as "accounting_basis"
  from "erp_financials"."ledger_postings"
  where "tenant_id" = transaction."tenant_id" and "source_id" = transaction."source_id"
    and "transaction_id" = transaction."transaction_id" and "accounting_basis" = $4 and "currency_code" = $5
) posting on posting."line_count" > 0
join lateral (
  select event.* from "erp_financials"."financial_lifecycle_events" event
  where event."tenant_id" = $1 and event."company_id" = $2 and event."source_id" = transaction."source_id"
    and event."aggregate_type" = 'journal_entry' and event."aggregate_id" = transaction."transaction_id"
    and event."event_type" in ('journal_entry.posted', 'journal_entry.adjustment_posted')
  order by event."occurred_at", event."recorded_at", event."event_id" limit 1
) prepared on true
left join lateral (
  select count(*)::integer as "link_count",
    count(*) filter (where "link_type" = 'reversal')::integer as "reversal_count",
    count(*) filter (where "link_type" = 'void')::integer as "void_count",
    count(*) filter (where "link_type" = 'correction')::integer as "correction_count",
    count(*) filter (where "link_type" = 'replacement')::integer as "replacement_count"
  from "erp_financials"."journal_entry_links"
  where "tenant_id" = $1 and "company_id" = $2 and "source_id" = transaction."source_id"
    and "original_transaction_id" = transaction."transaction_id"
) links on true
left join lateral (
  select "original_transaction_id" from "erp_financials"."journal_entry_links"
  where "tenant_id" = $1 and "company_id" = $2 and "source_id" = transaction."source_id"
    and "related_transaction_id" = transaction."transaction_id"
  order by "created_at", "journal_entry_link_id" limit 1
) inbound on true
where transaction."tenant_id" = $1 and transaction."transaction_id" = $6 and transaction."status" = 'posted'`,
      [scope.tenantId, scope.companyId, scope.bookId, book.accountingBasis, book.currencyCode, journalEntryId]
    );
    const headerRow = header.rows[0];
    if (headerRow === undefined) {
      throw new ErpFinancialsError("missing_document", `Journal entry ${journalEntryId} does not exist in this book`, {
        details: { bookId: scope.bookId, journalEntryId }
      });
    }
    const item = journalEntryFromRow(headerRow);
    const linesResult = await client.query(
      `select line."transaction_line_id", posting."posting_id", posting."source_posting_id", line."line_number",
  account."account_id", account."source_account_id",
  coalesce(mapping."book_account_key", posting."source_id" || ':' || posting."account_id") as "book_account_key",
  account."account_number", account."name" as "account_name", account."classification",
  posting."party_id", posting."item_id", line."description", posting."debit_amount", posting."credit_amount",
  posting."net_amount", posting."dimension_refs"
from "erp_financials"."ledger_postings" posting
join "erp_financials"."transaction_lines" line
  on line."tenant_id" = posting."tenant_id" and line."source_id" = posting."source_id"
 and line."transaction_line_id" = posting."transaction_line_id"
join "erp_financials"."accounts" account
  on account."tenant_id" = posting."tenant_id" and account."source_id" = posting."source_id" and account."account_id" = posting."account_id"
left join "erp_financials"."reporting_book_account_mappings" mapping
  on mapping."tenant_id" = $1 and mapping."company_id" = $2 and mapping."book_id" = $3
 and mapping."source_id" = posting."source_id" and mapping."account_id" = posting."account_id"
where posting."tenant_id" = $1 and posting."source_id" = $4 and posting."transaction_id" = $5
  and posting."accounting_basis" = $6 and posting."currency_code" = $7
order by line."line_number", line."transaction_line_id", posting."posting_id"`,
      [scope.tenantId, scope.companyId, scope.bookId, item.sourceId, journalEntryId,
        book.accountingBasis, book.currencyCode]
    );
    const lines = linesResult.rows.map(journalEntryLineFromRow);
    assertBalancedJournalDetail(item, lines);
    const lifecycleResult = await client.query(
      `select * from "erp_financials"."financial_lifecycle_events"
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3
  and "aggregate_type" = 'journal_entry' and "aggregate_id" = $4
order by "occurred_at", "recorded_at", "event_id"`,
      [scope.tenantId, scope.companyId, item.sourceId, journalEntryId]
    );
    const linksResult = await client.query(
      `select link.*, event."event_type", event."actor_ref", event."approver_ref", event."request_id",
  event."correlation_id", event."reason_code", event."reason_detail", event."occurred_at", event."recorded_at",
  event."payload_checksum", event."prior_event_id"
from "erp_financials"."journal_entry_links" link
join "erp_financials"."financial_lifecycle_events" event
  on event."tenant_id" = link."tenant_id" and event."company_id" = link."company_id"
 and event."source_id" = link."source_id" and event."event_id" = link."lifecycle_event_id"
where link."tenant_id" = $1 and link."company_id" = $2 and link."source_id" = $3
  and (link."original_transaction_id" = $4 or link."related_transaction_id" = $4)
order by link."created_at", link."journal_entry_link_id"`,
      [scope.tenantId, scope.companyId, item.sourceId, journalEntryId]
    );
    return {
      ...item,
      lines,
      lifecycle: lifecycleResult.rows.map((row) => accountingLifecycleFromRow(row)),
      links: linksResult.rows.map(journalEntryLinkFromRow)
    };
  });
}

async function listFiscalPeriods(
  scope: Scope,
  input: PageRequest & { readonly sourceId: string; readonly status?: FiscalPeriodReadModel["status"]; readonly fiscalYear?: number }
): Promise<Page<FiscalPeriodReadModel>> {
  const filters = fiscalPeriodFilters(input);
  const pageKind = `fiscal-periods:${readFilterFingerprint(filters)}`;
  const page = pageInput(input, pageKind, scope.bookId);
  return scope.database.transaction(async (client) => {
    await resolveBook(client, scope);
    const result = await client.query(
      `${fiscalPeriodSelectSql()}
where period."tenant_id" = $1 and period."company_id" = $2 and period."source_id" = $4
  and ($5::text is null or period."status" = $5)
  and ($6::integer is null or period."fiscal_year" = $6)
  and ($7::date is null or (period."period_start", period."fiscal_period_id") < ($7::date, $8::text))
order by period."period_start" desc, period."fiscal_period_id" desc
limit $9`,
      [scope.tenantId, scope.companyId, scope.bookId, filters.sourceId, filters.status, filters.fiscalYear,
        page.date, page.id, page.limit + 1]
    );
    return toPage(result.rows.map(fiscalPeriodFromRow), page.limit, pageKind, scope.bookId, (item) => ({
      date: item.periodStart,
      id: item.fiscalPeriodId
    }));
  });
}

async function getFiscalPeriod(scope: Scope, sourceId: string, fiscalPeriodId: string): Promise<FiscalPeriodReadModel> {
  assertReadFilterText(sourceId, "sourceId");
  assertReadFilterText(fiscalPeriodId, "fiscalPeriodId");
  return scope.database.transaction(async (client) => {
    await resolveBook(client, scope);
    const result = await client.query(
      `${fiscalPeriodSelectSql()}
where period."tenant_id" = $1 and period."company_id" = $2 and period."source_id" = $4
  and period."fiscal_period_id" = $5`,
      [scope.tenantId, scope.companyId, scope.bookId, sourceId, fiscalPeriodId]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ErpFinancialsError("missing_document", `Fiscal period ${fiscalPeriodId} does not exist in this book/source`, {
        details: { bookId: scope.bookId, fiscalPeriodId, sourceId }
      });
    }
    return fiscalPeriodFromRow(row);
  });
}

async function getPostingLock(scope: Scope, sourceId: string): Promise<PostingLockReadModel> {
  assertReadFilterText(sourceId, "sourceId");
  return scope.database.transaction(async (client) => {
    await resolveBook(client, scope);
    const result = await client.query(
      `select source."source_id", controls."posting_lock_date", coalesce(controls."version", 0) as "version",
  event."event_id", event."event_type", event."actor_ref", event."approver_ref", event."request_id",
  event."correlation_id", event."reason_code", event."reason_detail", event."occurred_at", event."recorded_at",
  event."payload_checksum", event."prior_event_id"
from "erp_financials"."reporting_book_sources" source
left join "erp_financials"."accounting_book_controls" controls
  on controls."tenant_id" = source."tenant_id" and controls."company_id" = source."company_id"
 and controls."source_id" = source."source_id"
left join "erp_financials"."financial_lifecycle_events" event
  on event."tenant_id" = controls."tenant_id" and event."company_id" = controls."company_id"
 and event."source_id" = controls."source_id" and event."event_id" = controls."last_event_id"
where source."tenant_id" = $1 and source."company_id" = $2 and source."book_id" = $3 and source."source_id" = $4`,
      [scope.tenantId, scope.companyId, scope.bookId, sourceId]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ErpFinancialsError("scope_mismatch", `Accounting source ${sourceId} does not belong to this book`, {
        details: { bookId: scope.bookId, sourceId }
      });
    }
    const postingLockDate = optionalDate(row.posting_lock_date, "posting_lock_date");
    const lifecycle = optionalString(row.event_id) === undefined ? undefined : accountingLifecycleFromRow(row);
    return {
      sourceId: string(row.source_id, "source_id"),
      ...(postingLockDate === undefined ? {} : { postingLockDate }),
      version: integer(row.version, "version"),
      ...(lifecycle === undefined ? {} : { lifecycle })
    };
  });
}

function fiscalPeriodSelectSql(): string {
  return `select period.*, close_event."payload" as "close_payload",
  close_event."event_id" as "close_event_id_read", close_event."event_type" as "close_event_type",
  close_event."actor_ref" as "close_actor_ref", close_event."approver_ref" as "close_approver_ref",
  close_event."request_id" as "close_request_id", close_event."correlation_id" as "close_correlation_id",
  close_event."reason_code" as "close_reason_code", close_event."reason_detail" as "close_reason_detail",
  close_event."occurred_at" as "close_occurred_at", close_event."recorded_at" as "close_recorded_at",
  close_event."payload_checksum" as "close_payload_checksum", close_event."prior_event_id" as "close_prior_event_id",
  reopen_event."event_id" as "reopen_event_id_read", reopen_event."event_type" as "reopen_event_type",
  reopen_event."actor_ref" as "reopen_actor_ref", reopen_event."approver_ref" as "reopen_approver_ref",
  reopen_event."request_id" as "reopen_request_id", reopen_event."correlation_id" as "reopen_correlation_id",
  reopen_event."reason_code" as "reopen_reason_code", reopen_event."reason_detail" as "reopen_reason_detail",
  reopen_event."occurred_at" as "reopen_occurred_at", reopen_event."recorded_at" as "reopen_recorded_at",
  reopen_event."payload_checksum" as "reopen_payload_checksum", reopen_event."prior_event_id" as "reopen_prior_event_id",
  latest."event_id" as "latest_event_id", latest."event_type" as "latest_event_type",
  latest."actor_ref" as "latest_actor_ref", latest."approver_ref" as "latest_approver_ref",
  latest."request_id" as "latest_request_id", latest."correlation_id" as "latest_correlation_id",
  latest."reason_code" as "latest_reason_code", latest."reason_detail" as "latest_reason_detail",
  latest."occurred_at" as "latest_occurred_at", latest."recorded_at" as "latest_recorded_at",
  latest."payload_checksum" as "latest_payload_checksum", latest."prior_event_id" as "latest_prior_event_id"
from "erp_financials"."fiscal_periods" period
join "erp_financials"."reporting_book_sources" source
  on source."tenant_id" = $1 and source."company_id" = $2 and source."book_id" = $3 and source."source_id" = period."source_id"
left join "erp_financials"."financial_lifecycle_events" close_event
  on close_event."tenant_id" = period."tenant_id" and close_event."company_id" = period."company_id"
 and close_event."source_id" = period."source_id" and close_event."event_id" = period."close_event_id"
left join "erp_financials"."financial_lifecycle_events" reopen_event
  on reopen_event."tenant_id" = period."tenant_id" and reopen_event."company_id" = period."company_id"
 and reopen_event."source_id" = period."source_id" and reopen_event."event_id" = period."reopen_event_id"
join lateral (
  select event.* from "erp_financials"."financial_lifecycle_events" event
  where event."tenant_id" = period."tenant_id" and event."company_id" = period."company_id"
    and event."source_id" = period."source_id" and event."aggregate_type" = 'fiscal_period'
    and event."aggregate_id" = period."fiscal_period_id"
  order by event."occurred_at" desc, event."recorded_at" desc, event."event_id" desc limit 1
) latest on true`;
}

async function listInvoices(
  scope: Scope,
  input: PageRequest & { readonly status?: InvoiceListStatus; readonly asOfDate?: IsoDate; readonly invoiceId?: string }
): Promise<Page<InvoiceListItem>> {
  const page = pageInput(input, "invoices", scope.bookId);
  const asOfDate = input.asOfDate ?? today();
  assertDate(asOfDate, "asOfDate");
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `with invoice_rows as (
  select draft."invoice_draft_id" as "invoice_id", draft."source_id", 'draft'::text as "provenance",
    draft."customer_id" as "party_id", party."display_name" as "party_name", draft."document_number",
    draft."document_date", draft."due_date", draft."currency_code",
    coalesce(lines."original_amount", 0)::numeric as "original_amount",
    coalesce(lines."original_amount", 0)::numeric as "open_amount", draft."status", draft."version"
  from "erp_financials"."invoice_drafts" draft
  join "erp_financials"."reporting_book_sources" source
    on source."tenant_id" = draft."tenant_id" and source."company_id" = draft."company_id"
   and source."book_id" = draft."book_id" and source."source_id" = draft."source_id"
   and (source."effective_from" is null or source."effective_from" <= draft."document_date")
   and (source."effective_through" is null or source."effective_through" >= draft."document_date")
  left join "erp_financials"."parties" party
    on party."tenant_id" = draft."tenant_id" and party."source_id" = draft."source_id" and party."party_id" = draft."customer_id"
  left join lateral (
    select sum(line."line_amount") as "original_amount" from "erp_financials"."invoice_draft_lines" line
    where line."tenant_id" = draft."tenant_id" and line."company_id" = draft."company_id"
      and line."book_id" = draft."book_id" and line."invoice_draft_id" = draft."invoice_draft_id"
  ) lines on true
  where draft."tenant_id" = $1 and draft."company_id" = $2 and draft."book_id" = $3 and draft."status" <> 'issued'
    and ($9::text is null or draft."invoice_draft_id" = $9)
  union all
  select document."subledger_document_id", document."source_id", 'posted'::text, document."party_id", party."display_name",
    document."document_number", document."document_date", document."due_date", document."currency_code",
    document."original_amount", document."open_amount",
    case
      when void."invoice_void_id" is not null then 'voided'
      when document."status" = 'settled' or document."open_amount" = 0 then 'paid'
      when document."due_date" < $4::date then 'overdue'
      when document."open_amount" < document."original_amount" then 'partial'
      when delivery."delivery_status" in ('sent', 'delivered') then 'sent'
      else 'open'
    end, document."version"
  from "erp_financials"."subledger_documents" document
  join "erp_financials"."reporting_book_sources" source
    on source."tenant_id" = document."tenant_id" and source."company_id" = document."company_id"
   and source."book_id" = $3 and source."source_id" = document."source_id"
   and (source."effective_from" is null or source."effective_from" <= document."document_date")
   and (source."effective_through" is null or source."effective_through" >= document."document_date")
  left join "erp_financials"."parties" party
    on party."tenant_id" = document."tenant_id" and party."source_id" = document."source_id" and party."party_id" = document."party_id"
  left join "erp_financials"."invoice_voids" void
    on void."tenant_id" = document."tenant_id" and void."company_id" = document."company_id" and void."book_id" = $3
   and void."source_id" = document."source_id" and void."invoice_document_id" = document."subledger_document_id"
  left join lateral (
    select event."delivery_status" from "erp_financials"."subledger_document_delivery_events" event
    where event."tenant_id" = document."tenant_id" and event."company_id" = document."company_id"
      and event."source_id" = document."source_id" and event."subledger_document_id" = document."subledger_document_id"
    order by event."occurred_at" desc, event."delivery_event_id" desc limit 1
  ) delivery on true
  where document."tenant_id" = $1 and document."company_id" = $2 and document."document_type" = 'invoice'
    and ($9::text is null or document."subledger_document_id" = $9)
)
select * from invoice_rows
where "currency_code" = $5 and ($6::text is null or "status" = $6)
  and ($7::date is null or ("document_date", "invoice_id") < ($7::date, $8::text))
order by "document_date" desc, "invoice_id" desc
limit $10`,
      [scope.tenantId, scope.companyId, scope.bookId, asOfDate, book.currencyCode, input.status, page.date, page.id, input.invoiceId, page.limit + 1]
    );
    return toPage(result.rows.map(invoiceFromRow), page.limit, "invoices", scope.bookId, (item) => ({
      date: item.documentDate,
      id: item.invoiceId
    }));
  });
}

async function getInvoice(scope: Scope, invoiceId: string, asOfDate = today()): Promise<InvoiceDetail> {
  assertNonEmpty(invoiceId, "invoiceId");
  const page = await listInvoices(scope, { limit: 1, asOfDate, invoiceId });
  const invoice = page.items[0];
  if (invoice === undefined) {
    throw new ErpFinancialsError("missing_document", `Invoice ${invoiceId} does not exist in reporting book ${scope.bookId}`, {
      details: { bookId: scope.bookId, invoiceId }
    });
  }
  return scope.database.transaction(async (client) => {
    const isDraft = invoice.sourceProvenance === "draft";
    const header = await client.query(
      isDraft
        ? `select "memo" from "erp_financials"."invoice_drafts" where "tenant_id" = $1 and "company_id" = $2 and "book_id" = $3 and "invoice_draft_id" = $4`
        : `select transaction."memo" from "erp_financials"."subledger_documents" document join "erp_financials"."transactions" transaction on transaction."tenant_id" = document."tenant_id" and transaction."source_id" = document."source_id" and transaction."transaction_id" = document."transaction_id" where document."tenant_id" = $1 and document."company_id" = $2 and document."source_id" = $3 and document."subledger_document_id" = $4`,
      isDraft
        ? [scope.tenantId, scope.companyId, scope.bookId, invoiceId]
        : [scope.tenantId, scope.companyId, invoice.sourceId, invoiceId]
    );
    const lines = await client.query(
      isDraft
        ? `select "invoice_draft_line_id" as "line_id", * from "erp_financials"."invoice_draft_lines" where "tenant_id" = $1 and "company_id" = $2 and "book_id" = $3 and "invoice_draft_id" = $4 order by "line_number"`
        : `select "subledger_document_line_id" as "line_id", * from "erp_financials"."subledger_document_lines" where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3 and "subledger_document_id" = $4 order by "line_number"`,
      isDraft
        ? [scope.tenantId, scope.companyId, scope.bookId, invoiceId]
        : [scope.tenantId, scope.companyId, invoice.sourceId, invoiceId]
    );
    const memo = optionalString(header.rows[0]?.memo);
    return {
      ...invoice,
      ...(memo === undefined ? {} : { memo }),
      lines: lines.rows.map(commercialLineFromRow)
    };
  });
}

async function listInvoiceDeliveries(
  scope: Scope,
  invoiceId: string,
  input: PageRequest
): Promise<Page<InvoiceDeliveryEvent>> {
  assertNonEmpty(invoiceId, "invoiceId");
  const invoice = await getInvoice(scope, invoiceId);
  if (invoice.sourceProvenance === "draft") return { items: [] };
  const page = pageInput(input, `invoice-deliveries:${invoiceId}`, scope.bookId);
  return scope.database.transaction(async (client) => {
    const result = await client.query(
      `select event."delivery_event_id", event."subledger_document_id" as "invoice_id", event."delivery_status",
  event."channel", event."recipient_ref", event."occurred_at", event."lifecycle_event_id"
from "erp_financials"."subledger_document_delivery_events" event
join "erp_financials"."subledger_documents" document
  on document."tenant_id" = event."tenant_id" and document."company_id" = event."company_id"
 and document."source_id" = event."source_id" and document."subledger_document_id" = event."subledger_document_id"
join "erp_financials"."reporting_book_sources" source
  on source."tenant_id" = document."tenant_id" and source."company_id" = document."company_id"
 and source."book_id" = $3 and source."source_id" = document."source_id"
where event."tenant_id" = $1 and event."company_id" = $2 and event."subledger_document_id" = $4
  and document."document_type" = 'invoice'
  and ($5::date is null or (event."occurred_at"::date, event."delivery_event_id") < ($5::date, $6::text))
order by event."occurred_at" desc, event."delivery_event_id" desc
limit $7`,
      [scope.tenantId, scope.companyId, scope.bookId, invoiceId, page.date, page.id, page.limit + 1]
    );
    return toPage(result.rows.map(invoiceDeliveryFromRow), page.limit, `invoice-deliveries:${invoiceId}`, scope.bookId, (item) => ({
      date: item.occurredAt.slice(0, 10),
      id: item.deliveryEventId
    }));
  });
}

async function getInvoiceSummary(
  scope: Scope,
  input: { readonly asOfDate?: IsoDate }
): Promise<InvoiceSummary> {
  const asOfDate = input.asOfDate ?? today();
  assertDate(asOfDate, "asOfDate");
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `with posted as (
  select document."subledger_document_id", document."open_amount", document."due_date",
    not exists (
      select 1 from "erp_financials"."invoice_voids" void
      where void."tenant_id" = document."tenant_id" and void."company_id" = document."company_id"
        and void."book_id" = $3 and void."source_id" = document."source_id"
        and void."invoice_document_id" = document."subledger_document_id"
    ) as "not_voided"
  from "erp_financials"."subledger_documents" document
  join "erp_financials"."reporting_book_sources" source
    on source."tenant_id" = document."tenant_id" and source."company_id" = document."company_id"
   and source."book_id" = $3 and source."source_id" = document."source_id"
   and (source."effective_from" is null or source."effective_from" <= document."document_date")
   and (source."effective_through" is null or source."effective_through" >= document."document_date")
  where document."tenant_id" = $1 and document."company_id" = $2 and document."document_type" = 'invoice'
    and document."currency_code" = $4 and document."document_date" <= $5::date
), drafts as (
  select draft."invoice_draft_id", coalesce(sum(line."line_amount"), 0) as "amount"
  from "erp_financials"."invoice_drafts" draft
  join "erp_financials"."reporting_book_sources" source
    on source."tenant_id" = draft."tenant_id" and source."company_id" = draft."company_id"
   and source."book_id" = draft."book_id" and source."source_id" = draft."source_id"
   and (source."effective_from" is null or source."effective_from" <= draft."document_date")
   and (source."effective_through" is null or source."effective_through" >= draft."document_date")
  left join "erp_financials"."invoice_draft_lines" line
    on line."tenant_id" = draft."tenant_id" and line."company_id" = draft."company_id"
   and line."book_id" = draft."book_id" and line."source_id" = draft."source_id"
   and line."invoice_draft_id" = draft."invoice_draft_id"
  where draft."tenant_id" = $1 and draft."company_id" = $2 and draft."book_id" = $3
    and draft."status" = 'draft' and draft."currency_code" = $4 and draft."document_date" <= $5::date
  group by draft."invoice_draft_id"
), collected as (
  select coalesce(sum(application."applied_amount"), 0) as "amount"
  from "erp_financials"."subledger_applications" application
  join posted on posted."subledger_document_id" = application."target_document_id" and posted."not_voided"
  where application."tenant_id" = $1 and application."company_id" = $2
    and application."application_type" = 'customer_payment_to_invoice' and application."status" = 'applied'
    and application."application_date" <= $5::date
)
select
  coalesce(sum("open_amount") filter (where "not_voided" and "open_amount" > 0), 0) as "outstanding_amount",
  count(*) filter (where "not_voided" and "open_amount" > 0)::integer as "outstanding_count",
  coalesce(sum("open_amount") filter (where "not_voided" and "open_amount" > 0 and "due_date" < $5::date), 0) as "overdue_amount",
  count(*) filter (where "not_voided" and "open_amount" > 0 and "due_date" < $5::date)::integer as "overdue_count",
  coalesce((select sum("amount") from drafts), 0) as "draft_amount",
  (select count(*)::integer from drafts) as "draft_count",
  (select "amount" from collected) as "collected_amount",
  count(*) filter (where "not_voided" and "open_amount" = 0)::integer as "settled_count"
from posted`,
      [scope.tenantId, scope.companyId, scope.bookId, book.currencyCode, asOfDate]
    );
    const row = requiredRow(result.rows[0], "invoice summary");
    return {
      asOfDate,
      currencyCode: book.currencyCode,
      outstandingAmount: money(row.outstanding_amount, "outstanding_amount"),
      outstandingInvoiceCount: integer(row.outstanding_count, "outstanding_count"),
      overdueAmount: money(row.overdue_amount, "overdue_amount"),
      overdueInvoiceCount: integer(row.overdue_count, "overdue_count"),
      unsentDraftAmount: money(row.draft_amount, "draft_amount"),
      unsentDraftCount: integer(row.draft_count, "draft_count"),
      collectedAmount: money(row.collected_amount, "collected_amount"),
      settledInvoiceCount: integer(row.settled_count, "settled_count")
    };
  });
}

async function listVendorBills(
  scope: Scope,
  input: PageRequest & {
    readonly status?: VendorBillStatus;
    readonly asOfDate?: IsoDate;
    readonly vendorId?: string;
    readonly billId?: string;
  }
): Promise<Page<VendorBillListItem>> {
  const page = pageInput(input, "vendor-bills", scope.bookId);
  const asOfDate = input.asOfDate ?? today();
  assertDate(asOfDate, "asOfDate");
  if (input.vendorId !== undefined) assertNonEmpty(input.vendorId, "vendorId");
  if (input.status !== undefined && !VENDOR_BILL_STATUSES.has(input.status)) {
    throw new ErpFinancialsError("invalid_input", `Unsupported vendor bill status ${input.status}`);
  }
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `with bill_balances as (
  select document."subledger_document_id" as "bill_id", document."source_id", document."transaction_id",
    document."party_id", party."display_name" as "party_name", document."document_number",
    document."document_date", document."due_date", document."currency_code", document."original_amount",
    greatest(document."original_amount" - coalesce(applied."amount", 0), 0)::numeric as "calculated_open_amount",
    document."version",
    coalesce(terminal."correction_date", case
      when document."status" = 'voided' and document."updated_at" < ($4::date + interval '1 day')
        then document."updated_at"::date
      else null
    end) as "correction_date",
    replacement."has_replacement"
  from "erp_financials"."subledger_documents" document
  join "erp_financials"."reporting_book_sources" source
    on source."tenant_id" = document."tenant_id" and source."company_id" = document."company_id"
   and source."book_id" = $3 and source."source_id" = document."source_id"
   and (source."effective_from" is null or source."effective_from" <= document."document_date")
   and (source."effective_through" is null or source."effective_through" >= document."document_date")
  left join "erp_financials"."parties" party
    on party."tenant_id" = document."tenant_id" and party."source_id" = document."source_id"
   and party."party_id" = document."party_id" and party."party_type" = 'vendor'
  left join lateral (
    select sum(application."applied_amount") as "amount"
    from "erp_financials"."subledger_applications" application
    join "erp_financials"."financial_lifecycle_events" applied_event
      on applied_event."tenant_id" = application."tenant_id" and applied_event."company_id" = application."company_id"
     and applied_event."source_id" = application."source_id" and applied_event."event_id" = application."applied_event_id"
    left join "erp_financials"."financial_lifecycle_events" ended_event
      on ended_event."tenant_id" = application."tenant_id" and ended_event."company_id" = application."company_id"
     and ended_event."source_id" = application."source_id" and ended_event."event_id" = application."ended_event_id"
    where application."tenant_id" = document."tenant_id" and application."company_id" = document."company_id"
      and application."source_id" = document."source_id" and application."target_document_id" = document."subledger_document_id"
      and application."application_type" = 'bill_payment_to_bill' and application."application_date" <= $4::date
      and applied_event."occurred_at" < ($4::date + interval '1 day')
      and (ended_event."event_id" is null or ended_event."occurred_at" >= ($4::date + interval '1 day'))
  ) applied on true
  left join lateral (
    select related."transaction_date" as "correction_date"
    from "erp_financials"."journal_entry_links" link
    join "erp_financials"."transactions" related
      on related."tenant_id" = link."tenant_id" and related."source_id" = link."source_id"
     and related."transaction_id" = link."related_transaction_id"
    where link."tenant_id" = document."tenant_id" and link."company_id" = document."company_id"
      and link."source_id" = document."source_id" and link."original_transaction_id" = document."transaction_id"
      and link."link_type" in ('reversal', 'void')
    order by related."transaction_date", link."created_at" limit 1
  ) terminal on true
  left join lateral (
    select true as "has_replacement" from "erp_financials"."journal_entry_links" link
    where link."tenant_id" = document."tenant_id" and link."company_id" = document."company_id"
      and link."source_id" = document."source_id" and link."original_transaction_id" = document."transaction_id"
      and link."link_type" = 'replacement' limit 1
  ) replacement on true
  where document."tenant_id" = $1 and document."company_id" = $2 and document."document_type" = 'vendor_bill'
    and document."currency_code" = $5 and document."document_date" <= $4::date
    and ($6::text is null or document."party_id" = $6)
    and ($10::text is null or document."subledger_document_id" = $10)
), bill_rows as (
  select *,
    case when "correction_date" <= $4::date then 0 else "calculated_open_amount" end as "open_amount",
    case
      when "correction_date" <= $4::date and "has_replacement" then 'replaced'
      when "correction_date" <= $4::date then 'voided'
      when "calculated_open_amount" = 0 then 'paid'
      when "due_date" < $4::date then 'overdue'
      when "calculated_open_amount" < "original_amount" then 'partial'
      else 'open'
    end as "status"
  from bill_balances
)
select * from bill_rows
where ($7::text is null or "status" = $7)
  and ($8::date is null or ("document_date", "bill_id") < ($8::date, $9::text))
order by "document_date" desc, "bill_id" desc
limit $11`,
      [
        scope.tenantId,
        scope.companyId,
        scope.bookId,
        asOfDate,
        book.currencyCode,
        input.vendorId,
        input.status,
        page.date,
        page.id,
        input.billId,
        page.limit + 1
      ]
    );
    return toPage(result.rows.map(vendorBillFromRow), page.limit, "vendor-bills", scope.bookId, (item) => ({
      date: item.documentDate,
      id: item.billId
    }));
  });
}

async function getVendorBill(
  scope: Scope,
  billId: string,
  asOfDate = today()
): Promise<VendorBillDetail> {
  assertNonEmpty(billId, "billId");
  assertDate(asOfDate, "asOfDate");
  const page = await listVendorBills(scope, { billId, limit: 1, asOfDate });
  const bill = page.items[0];
  if (bill === undefined) {
    throw new ErpFinancialsError(
      "missing_document",
      `Vendor bill ${billId} does not exist in reporting book ${scope.bookId} as of ${asOfDate}`,
      { details: { asOfDate, billId, bookId: scope.bookId } }
    );
  }
  return scope.database.transaction(async (client) => {
    const header = await client.query(
      `select transaction."memo"
from "erp_financials"."subledger_documents" document
join "erp_financials"."transactions" transaction
  on transaction."tenant_id" = document."tenant_id" and transaction."source_id" = document."source_id"
 and transaction."transaction_id" = document."transaction_id"
where document."tenant_id" = $1 and document."company_id" = $2 and document."source_id" = $3
  and document."subledger_document_id" = $4 and document."document_type" = 'vendor_bill'`,
      [scope.tenantId, scope.companyId, bill.sourceId, bill.billId]
    );
    const lines = await client.query(
      `select line."subledger_document_line_id" as "line_id", line.*,
  account."source_account_id", mapping."book_account_mapping_id", mapping."book_account_key",
  item."source_item_id", item."name" as "item_name", item."expense_account_id" as "item_expense_account_id"
from "erp_financials"."subledger_document_lines" line
join "erp_financials"."accounts" account
  on account."tenant_id" = line."tenant_id" and account."source_id" = line."source_id"
 and account."account_id" = line."account_id"
left join "erp_financials"."reporting_book_account_mappings" mapping
  on mapping."tenant_id" = line."tenant_id" and mapping."company_id" = line."company_id"
 and mapping."book_id" = $3 and mapping."source_id" = line."source_id" and mapping."account_id" = line."account_id"
left join "erp_financials"."items" item
  on item."tenant_id" = line."tenant_id" and item."source_id" = line."source_id" and item."item_id" = line."item_id"
where line."tenant_id" = $1 and line."company_id" = $2 and line."source_id" = $4
  and line."subledger_document_id" = $5
order by line."line_number"`,
      [scope.tenantId, scope.companyId, scope.bookId, bill.sourceId, bill.billId]
    );
    const applications = await client.query(
      `select application."subledger_application_id" as "application_id",
  application."source_document_id" as "source_payment_id", application."application_date",
  application."applied_amount", application."version",
  case when ended_event."occurred_at" < ($5::date + interval '1 day') then application."status" else 'applied' end as "status"
from "erp_financials"."subledger_applications" application
join "erp_financials"."financial_lifecycle_events" applied_event
  on applied_event."tenant_id" = application."tenant_id" and applied_event."company_id" = application."company_id"
 and applied_event."source_id" = application."source_id" and applied_event."event_id" = application."applied_event_id"
left join "erp_financials"."financial_lifecycle_events" ended_event
  on ended_event."tenant_id" = application."tenant_id" and ended_event."company_id" = application."company_id"
 and ended_event."source_id" = application."source_id" and ended_event."event_id" = application."ended_event_id"
where application."tenant_id" = $1 and application."company_id" = $2 and application."source_id" = $3
  and application."target_document_id" = $4 and application."application_type" = 'bill_payment_to_bill'
  and application."application_date" <= $5::date and applied_event."occurred_at" < ($5::date + interval '1 day')
order by application."application_date", application."subledger_application_id"`,
      [scope.tenantId, scope.companyId, bill.sourceId, bill.billId, asOfDate]
    );
    const memo = optionalString(header.rows[0]?.memo);
    return {
      ...bill,
      ...(memo === undefined ? {} : { memo }),
      lines: lines.rows.map(vendorBillLineFromRow),
      applications: applications.rows.map(vendorBillApplicationFromRow)
    };
  });
}

async function getVendorBillSummary(
  scope: Scope,
  input: {
    readonly asOfDate?: IsoDate;
    readonly periodStart?: IsoDate;
    readonly periodEnd?: IsoDate;
    readonly vendorId?: string;
  }
): Promise<VendorBillSummary> {
  const asOfDate = input.asOfDate ?? today();
  assertDate(asOfDate, "asOfDate");
  const periodEnd = input.periodEnd ?? asOfDate;
  const periodStart = input.periodStart ?? `${periodEnd.slice(0, 7)}-01`;
  assertWindow(periodStart, periodEnd);
  if (periodEnd > asOfDate) {
    throw new ErpFinancialsError("invalid_input", "periodEnd must be on or before asOfDate");
  }
  if (input.vendorId !== undefined) assertNonEmpty(input.vendorId, "vendorId");
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `with bills as (
  select document."original_amount", document."due_date",
    greatest(document."original_amount" - coalesce(applied."amount", 0), 0)::numeric as "open_amount",
    coalesce(period_applied."amount", 0)::numeric as "paid_in_period_amount",
    coalesce(terminal."correction_date", case
      when document."status" = 'voided' and document."updated_at" < ($4::date + interval '1 day')
        then document."updated_at"::date
      else null
    end) as "correction_date",
    replacement."has_replacement"
  from "erp_financials"."subledger_documents" document
  join "erp_financials"."reporting_book_sources" source
    on source."tenant_id" = document."tenant_id" and source."company_id" = document."company_id"
   and source."book_id" = $3 and source."source_id" = document."source_id"
   and (source."effective_from" is null or source."effective_from" <= document."document_date")
   and (source."effective_through" is null or source."effective_through" >= document."document_date")
  left join lateral (
    select sum(application."applied_amount") as "amount"
    from "erp_financials"."subledger_applications" application
    join "erp_financials"."financial_lifecycle_events" applied_event
      on applied_event."tenant_id" = application."tenant_id" and applied_event."company_id" = application."company_id"
     and applied_event."source_id" = application."source_id" and applied_event."event_id" = application."applied_event_id"
    left join "erp_financials"."financial_lifecycle_events" ended_event
      on ended_event."tenant_id" = application."tenant_id" and ended_event."company_id" = application."company_id"
     and ended_event."source_id" = application."source_id" and ended_event."event_id" = application."ended_event_id"
    where application."tenant_id" = document."tenant_id" and application."company_id" = document."company_id"
      and application."source_id" = document."source_id" and application."target_document_id" = document."subledger_document_id"
      and application."application_type" = 'bill_payment_to_bill' and application."application_date" <= $4::date
      and applied_event."occurred_at" < ($4::date + interval '1 day')
      and (ended_event."event_id" is null or ended_event."occurred_at" >= ($4::date + interval '1 day'))
  ) applied on true
  left join lateral (
    select sum(application."applied_amount") as "amount"
    from "erp_financials"."subledger_applications" application
    join "erp_financials"."financial_lifecycle_events" applied_event
      on applied_event."tenant_id" = application."tenant_id" and applied_event."company_id" = application."company_id"
     and applied_event."source_id" = application."source_id" and applied_event."event_id" = application."applied_event_id"
    left join "erp_financials"."financial_lifecycle_events" ended_event
      on ended_event."tenant_id" = application."tenant_id" and ended_event."company_id" = application."company_id"
     and ended_event."source_id" = application."source_id" and ended_event."event_id" = application."ended_event_id"
    where application."tenant_id" = document."tenant_id" and application."company_id" = document."company_id"
      and application."source_id" = document."source_id" and application."target_document_id" = document."subledger_document_id"
      and application."application_type" = 'bill_payment_to_bill'
      and application."application_date" between $7::date and $8::date
      and applied_event."occurred_at" < ($4::date + interval '1 day')
      and (ended_event."event_id" is null or ended_event."occurred_at" >= ($4::date + interval '1 day'))
  ) period_applied on true
  left join lateral (
    select related."transaction_date" as "correction_date"
    from "erp_financials"."journal_entry_links" link
    join "erp_financials"."transactions" related
      on related."tenant_id" = link."tenant_id" and related."source_id" = link."source_id"
     and related."transaction_id" = link."related_transaction_id"
    where link."tenant_id" = document."tenant_id" and link."company_id" = document."company_id"
      and link."source_id" = document."source_id" and link."original_transaction_id" = document."transaction_id"
      and link."link_type" in ('reversal', 'void')
    order by related."transaction_date", link."created_at" limit 1
  ) terminal on true
  left join lateral (
    select true as "has_replacement" from "erp_financials"."journal_entry_links" link
    where link."tenant_id" = document."tenant_id" and link."company_id" = document."company_id"
      and link."source_id" = document."source_id" and link."original_transaction_id" = document."transaction_id"
      and link."link_type" = 'replacement' limit 1
  ) replacement on true
  where document."tenant_id" = $1 and document."company_id" = $2 and document."document_type" = 'vendor_bill'
    and document."currency_code" = $5 and document."document_date" <= $4::date
    and ($6::text is null or document."party_id" = $6)
)
select
  coalesce(sum("open_amount") filter (where "correction_date" is null or "correction_date" > $4::date), 0) as "outstanding_amount",
  count(*) filter (where "open_amount" > 0 and ("correction_date" is null or "correction_date" > $4::date))::integer as "outstanding_count",
  coalesce(sum("open_amount") filter (where "open_amount" > 0 and "due_date" < $4::date
    and ("correction_date" is null or "correction_date" > $4::date)), 0) as "overdue_amount",
  count(*) filter (where "open_amount" > 0 and "due_date" < $4::date
    and ("correction_date" is null or "correction_date" > $4::date))::integer as "overdue_count",
  coalesce(sum("original_amount" - "open_amount") filter (where "correction_date" is null or "correction_date" > $4::date), 0) as "paid_amount",
  coalesce(sum("paid_in_period_amount") filter (where "correction_date" is null or "correction_date" > $4::date), 0) as "paid_in_period_amount",
  count(*) filter (where "paid_in_period_amount" > 0
    and ("correction_date" is null or "correction_date" > $4::date))::integer as "paid_in_period_count",
  count(*) filter (where "open_amount" = 0 and ("correction_date" is null or "correction_date" > $4::date))::integer as "settled_count",
  count(*) filter (where "correction_date" <= $4::date and "has_replacement" is not true)::integer as "voided_count",
  count(*) filter (where "correction_date" <= $4::date and "has_replacement")::integer as "replaced_count"
from bills`,
      [
        scope.tenantId,
        scope.companyId,
        scope.bookId,
        asOfDate,
        book.currencyCode,
        input.vendorId,
        periodStart,
        periodEnd
      ]
    );
    const row = requiredRow(result.rows[0], "vendor bill summary");
    return {
      asOfDate,
      periodStart,
      periodEnd,
      currencyCode: book.currencyCode,
      outstandingAmount: money(row.outstanding_amount, "outstanding_amount"),
      outstandingVendorBillCount: integer(row.outstanding_count, "outstanding_count"),
      overdueAmount: money(row.overdue_amount, "overdue_amount"),
      overdueVendorBillCount: integer(row.overdue_count, "overdue_count"),
      paidAmount: money(row.paid_amount, "paid_amount"),
      paidInPeriodAmount: money(row.paid_in_period_amount, "paid_in_period_amount"),
      paidInPeriodVendorBillCount: integer(row.paid_in_period_count, "paid_in_period_count"),
      settledVendorBillCount: integer(row.settled_count, "settled_count"),
      voidedVendorBillCount: integer(row.voided_count, "voided_count"),
      replacedVendorBillCount: integer(row.replaced_count, "replaced_count")
    };
  });
}

async function listPayments(
  scope: Scope,
  input: PageRequest & {
    readonly paymentType?: PaymentListItem["paymentType"];
    readonly vendorId?: string;
    readonly periodStart?: IsoDate;
    readonly periodEnd?: IsoDate;
    readonly status?: PaymentStatus;
    readonly paymentId?: string;
  }
): Promise<Page<PaymentListItem>> {
  const page = pageInput(input, "payments", scope.bookId);
  if (input.vendorId !== undefined) assertNonEmpty(input.vendorId, "vendorId");
  if (input.periodStart !== undefined) assertDate(input.periodStart, "periodStart");
  if (input.periodEnd !== undefined) assertDate(input.periodEnd, "periodEnd");
  if (input.periodStart !== undefined && input.periodEnd !== undefined) {
    assertWindow(input.periodStart, input.periodEnd);
  }
  if (input.status !== undefined && !PAYMENT_STATUSES.has(input.status)) {
    throw new ErpFinancialsError("invalid_input", `Unsupported payment status ${input.status}`);
  }
  if (input.paymentId !== undefined) assertNonEmpty(input.paymentId, "paymentId");
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `with payment_rows as (
select document."subledger_document_id" as "payment_id", document."source_id", document."document_type",
  document."transaction_id", document."party_id", party."display_name" as "party_name", document."document_number",
  document."document_date", document."currency_code", document."original_amount", document."open_amount",
  document."version", document."lifecycle_event_id",
  case
    when document."status" = 'voided' then 'voided'
    when document."open_amount" = 0 then 'applied'
    when document."open_amount" = document."original_amount" then 'unapplied'
    else 'partial'
  end as "payment_status",
  count(application."subledger_application_id") filter (where application."status" = 'applied')::integer as "application_count"
from "erp_financials"."subledger_documents" document
join "erp_financials"."reporting_book_sources" source
  on source."tenant_id" = document."tenant_id" and source."company_id" = document."company_id"
 and source."book_id" = $3 and source."source_id" = document."source_id"
 and (source."effective_from" is null or source."effective_from" <= document."document_date")
 and (source."effective_through" is null or source."effective_through" >= document."document_date")
left join "erp_financials"."parties" party
  on party."tenant_id" = document."tenant_id" and party."source_id" = document."source_id" and party."party_id" = document."party_id"
left join "erp_financials"."subledger_applications" application
  on application."tenant_id" = document."tenant_id" and application."company_id" = document."company_id"
 and application."source_id" = document."source_id" and application."source_document_id" = document."subledger_document_id"
where document."tenant_id" = $1 and document."company_id" = $2
  and document."document_type" in ('customer_payment', 'bill_payment') and document."currency_code" = $4
  and ($5::text is null or document."document_type" = $5)
  and ($6::text is null or (document."document_type" = 'bill_payment' and document."party_id" = $6))
  and ($7::date is null or document."document_date" >= $7::date)
  and ($8::date is null or document."document_date" <= $8::date)
  and ($12::text is null or document."subledger_document_id" = $12)
group by document."subledger_document_id", party."display_name"
)
select * from payment_rows
where ($9::text is null or "payment_status" = $9)
  and ($10::date is null or ("document_date", "payment_id") < ($10::date, $11::text))
order by "document_date" desc, "payment_id" desc
limit $13`,
      [
        scope.tenantId,
        scope.companyId,
        scope.bookId,
        book.currencyCode,
        input.paymentType,
        input.vendorId,
        input.periodStart,
        input.periodEnd,
        input.status,
        page.date,
        page.id,
        input.paymentId,
        page.limit + 1
      ]
    );
    return toPage(result.rows.map(paymentFromRow), page.limit, "payments", scope.bookId, (item) => ({
      date: item.paymentDate,
      id: item.paymentId
    }));
  });
}

async function listBillPayments(
  scope: Scope,
  input: PageRequest & {
    readonly vendorId?: string;
    readonly periodStart?: IsoDate;
    readonly periodEnd?: IsoDate;
    readonly status?: BillPaymentLifecycleStatus;
    readonly paymentMethod?: BillPaymentMethod;
    readonly paymentId?: string;
  }
): Promise<Page<BillPaymentListItem>> {
  const page = pageInput(input, "bill-payments", scope.bookId);
  assertBillPaymentFilters(input);
  if (input.paymentId !== undefined) assertNonEmpty(input.paymentId, "paymentId");
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `with canonical_bill_payments as (
select disbursement."bill_payment_id" as "payment_id", disbursement."source_id", disbursement."vendor_id",
  party."display_name" as "vendor_name", disbursement."document_number", disbursement."payment_date",
  disbursement."currency_code", disbursement."amount", disbursement."status", disbursement."version",
  disbursement."payment_method", disbursement."payment_reference", disbursement."funding_account_id",
  disbursement."payable_account_id", document."open_amount" as "unapplied_amount",
  coalesce(disbursement."voided_event_id", disbursement."cleared_event_id", disbursement."scheduled_event_id") as "lifecycle_event_id",
  document."transaction_id", document."version" as "document_version",
  case when document."subledger_document_id" is null then null
    when document."status" = 'voided' then 'voided'
    when document."open_amount" = 0 then 'applied'
    when document."open_amount" = document."original_amount" then 'unapplied'
    else 'partial' end as "application_status",
  count(application."subledger_application_id") filter (where application."status" = 'applied')::integer as "application_count"
from "erp_financials"."bill_payment_disbursements" disbursement
join "erp_financials"."reporting_book_sources" source
  on source."tenant_id" = disbursement."tenant_id" and source."company_id" = disbursement."company_id"
 and source."book_id" = $3 and source."source_id" = disbursement."source_id"
 and (source."effective_from" is null or source."effective_from" <= disbursement."payment_date")
 and (source."effective_through" is null or source."effective_through" >= disbursement."payment_date")
left join "erp_financials"."subledger_documents" document
  on document."tenant_id" = disbursement."tenant_id" and document."company_id" = disbursement."company_id"
 and document."source_id" = disbursement."source_id" and document."subledger_document_id" = disbursement."subledger_document_id"
left join "erp_financials"."parties" party
  on party."tenant_id" = disbursement."tenant_id" and party."source_id" = disbursement."source_id"
 and party."party_id" = disbursement."vendor_id"
left join "erp_financials"."subledger_applications" application
  on application."tenant_id" = disbursement."tenant_id" and application."company_id" = disbursement."company_id"
 and application."source_id" = disbursement."source_id" and application."source_document_id" = disbursement."bill_payment_id"
where disbursement."tenant_id" = $1 and disbursement."company_id" = $2 and disbursement."currency_code" = $4
group by disbursement."bill_payment_id", party."display_name", document."subledger_document_id"
union all
select document."subledger_document_id", document."source_id", document."party_id", party."display_name",
  document."document_number", document."document_date", document."currency_code", document."original_amount",
  case when document."status" = 'voided' then 'voided' else 'cleared' end, document."version",
  document."metadata" #>> '{billPaymentProvenance,paymentMethod}',
  document."metadata" #>> '{billPaymentProvenance,reference}',
  document."metadata" #>> '{billPaymentProvenance,fundingAccountId}',
  document."metadata" #>> '{billPaymentProvenance,payableAccountId}',
  document."open_amount", document."lifecycle_event_id", document."transaction_id", document."version",
  case when document."status" = 'voided' then 'voided'
    when document."open_amount" = 0 then 'applied'
    when document."open_amount" = document."original_amount" then 'unapplied'
    else 'partial' end,
  count(application."subledger_application_id") filter (where application."status" = 'applied')::integer
from "erp_financials"."subledger_documents" document
join "erp_financials"."reporting_book_sources" source
  on source."tenant_id" = document."tenant_id" and source."company_id" = document."company_id"
 and source."book_id" = $3 and source."source_id" = document."source_id"
 and (source."effective_from" is null or source."effective_from" <= document."document_date")
 and (source."effective_through" is null or source."effective_through" >= document."document_date")
left join "erp_financials"."parties" party
  on party."tenant_id" = document."tenant_id" and party."source_id" = document."source_id" and party."party_id" = document."party_id"
left join "erp_financials"."subledger_applications" application
  on application."tenant_id" = document."tenant_id" and application."company_id" = document."company_id"
 and application."source_id" = document."source_id" and application."source_document_id" = document."subledger_document_id"
where document."tenant_id" = $1 and document."company_id" = $2 and document."document_type" = 'bill_payment'
  and document."currency_code" = $4 and not exists (
    select 1 from "erp_financials"."bill_payment_disbursements" disbursement
    where disbursement."tenant_id" = document."tenant_id" and disbursement."company_id" = document."company_id"
      and disbursement."source_id" = document."source_id" and disbursement."bill_payment_id" = document."subledger_document_id"
  )
group by document."subledger_document_id", party."display_name"
)
select * from canonical_bill_payments
where ($5::text is null or "vendor_id" = $5)
  and ($6::date is null or "payment_date" >= $6::date)
  and ($7::date is null or "payment_date" <= $7::date)
  and ($8::text is null or "status" = $8)
  and ($9::text is null or "payment_method" = $9)
  and ($12::text is null or "payment_id" = $12)
  and ($10::date is null or ("payment_date", "payment_id") < ($10::date, $11::text))
order by "payment_date" desc, "payment_id" desc
limit $13`,
      [
        scope.tenantId,
        scope.companyId,
        scope.bookId,
        book.currencyCode,
        input.vendorId,
        input.periodStart,
        input.periodEnd,
        input.status,
        input.paymentMethod,
        page.date,
        page.id,
        input.paymentId,
        page.limit + 1
      ]
    );
    return toPage(result.rows.map(billPaymentFromRow), page.limit, "bill-payments", scope.bookId, (item) => ({
      date: item.paymentDate,
      id: item.paymentId
    }));
  });
}

function assertBillPaymentFilters(input: {
  readonly vendorId?: string;
  readonly periodStart?: IsoDate;
  readonly periodEnd?: IsoDate;
  readonly status?: BillPaymentLifecycleStatus;
  readonly paymentMethod?: BillPaymentMethod;
}): void {
  if (input.vendorId !== undefined) assertNonEmpty(input.vendorId, "vendorId");
  if (input.periodStart !== undefined) assertDate(input.periodStart, "periodStart");
  if (input.periodEnd !== undefined) assertDate(input.periodEnd, "periodEnd");
  if (input.periodStart !== undefined && input.periodEnd !== undefined) {
    assertWindow(input.periodStart, input.periodEnd);
  }
  if (input.status !== undefined && !BILL_PAYMENT_LIFECYCLE_STATUSES.has(input.status)) {
    throw new ErpFinancialsError("invalid_input", `Unsupported bill payment status ${input.status}`);
  }
  if (input.paymentMethod !== undefined && !BILL_PAYMENT_METHODS.has(input.paymentMethod)) {
    throw new ErpFinancialsError("invalid_input", `Unsupported bill payment method ${input.paymentMethod}`);
  }
}

async function getBillPayment(scope: Scope, paymentId: string): Promise<BillPaymentDetail> {
  assertNonEmpty(paymentId, "paymentId");
  const page = await listBillPayments(scope, { paymentId, limit: 1 });
  const payment = page.items[0];
  if (payment === undefined) {
    throw new ErpFinancialsError(
      "missing_document",
      `Bill payment ${paymentId} does not exist in reporting book ${scope.bookId}`,
      { details: { bookId: scope.bookId, paymentId } }
    );
  }
  return scope.database.transaction(async (client) => {
    const header = await client.query(
      `select coalesce(transaction."memo", disbursement."memo") as "memo", disbursement."allocations",
  scheduled."event_id" as "scheduled_event_id", scheduled."actor_ref" as "scheduled_actor_ref",
  scheduled."approver_ref" as "scheduled_approver_ref", scheduled."request_id" as "scheduled_request_id",
  scheduled."reason_code" as "scheduled_reason_code",
  cleared."event_id" as "cleared_event_id", cleared."actor_ref" as "cleared_actor_ref",
  cleared."approver_ref" as "cleared_approver_ref", cleared."request_id" as "cleared_request_id",
  cleared."reason_code" as "cleared_reason_code",
  posted."event_id" as "posted_event_id", posted."actor_ref" as "posted_actor_ref",
  posted."approver_ref" as "posted_approver_ref", posted."request_id" as "posted_request_id",
  posted."reason_code" as "posted_reason_code",
  voided."event_id" as "voided_event_id", voided."actor_ref" as "voided_actor_ref",
  voided."approver_ref" as "voided_approver_ref", voided."request_id" as "voided_request_id",
  voided."reason_code" as "voided_reason_code", void_link."related_transaction_id" as "reversal_transaction_id",
  coalesce(disbursement."funding_account_id", document."metadata" #>> '{billPaymentProvenance,fundingAccountId}') as "funding_account_id",
  funding_posting."posting_id" as "funding_posting_id", funding_posting."debit_amount" as "funding_debit_amount",
  funding_posting."credit_amount" as "funding_credit_amount",
  coalesce(disbursement."payable_account_id", document."metadata" #>> '{billPaymentProvenance,payableAccountId}') as "payable_account_id",
  payable_posting."posting_id" as "payable_posting_id", payable_posting."debit_amount" as "payable_debit_amount",
  payable_posting."credit_amount" as "payable_credit_amount"
from "erp_financials"."subledger_documents" document
full join "erp_financials"."bill_payment_disbursements" disbursement
  on disbursement."tenant_id" = document."tenant_id" and disbursement."company_id" = document."company_id"
 and disbursement."source_id" = document."source_id" and disbursement."bill_payment_id" = document."subledger_document_id"
left join "erp_financials"."transactions" transaction
  on transaction."tenant_id" = document."tenant_id" and transaction."source_id" = document."source_id"
 and transaction."transaction_id" = document."transaction_id"
left join "erp_financials"."financial_lifecycle_events" scheduled
  on scheduled."tenant_id" = disbursement."tenant_id" and scheduled."company_id" = disbursement."company_id"
 and scheduled."source_id" = disbursement."source_id" and scheduled."event_id" = disbursement."scheduled_event_id"
left join "erp_financials"."financial_lifecycle_events" cleared
  on cleared."tenant_id" = disbursement."tenant_id" and cleared."company_id" = disbursement."company_id"
 and cleared."source_id" = disbursement."source_id" and cleared."event_id" = disbursement."cleared_event_id"
left join "erp_financials"."financial_lifecycle_events" posted
  on posted."tenant_id" = document."tenant_id" and posted."company_id" = document."company_id"
 and posted."source_id" = document."source_id" and posted."event_id" = document."lifecycle_event_id"
left join lateral (
  select event."event_id", event."actor_ref", event."approver_ref", event."request_id", event."reason_code"
  from "erp_financials"."financial_lifecycle_events" event
  where event."tenant_id" = coalesce(disbursement."tenant_id", document."tenant_id")
    and event."company_id" = coalesce(disbursement."company_id", document."company_id")
    and event."source_id" = coalesce(disbursement."source_id", document."source_id")
    and (
      event."event_id" = disbursement."voided_event_id"
      or (disbursement."voided_event_id" is null and event."aggregate_type" = 'bill_payment'
        and event."aggregate_id" = document."subledger_document_id" and event."event_type" = 'bill_payment.voided')
    )
  order by event."occurred_at" desc, event."event_id" desc limit 1
) voided on true
left join lateral (
  select link."related_transaction_id"
  from "erp_financials"."journal_entry_links" link
  where link."tenant_id" = document."tenant_id" and link."company_id" = document."company_id"
    and link."source_id" = document."source_id" and link."original_transaction_id" = document."transaction_id"
    and link."link_type" = 'void'
  order by link."created_at" desc, link."journal_entry_link_id" desc limit 1
) void_link on true
left join lateral (
  select posting."posting_id", posting."debit_amount", posting."credit_amount"
  from "erp_financials"."ledger_postings" posting
  where posting."tenant_id" = document."tenant_id" and posting."source_id" = document."source_id"
    and posting."transaction_id" = document."transaction_id"
    and posting."account_id" = coalesce(disbursement."funding_account_id", document."metadata" #>> '{billPaymentProvenance,fundingAccountId}')
  order by posting."posting_id" limit 1
) funding_posting on true
left join lateral (
  select posting."posting_id", posting."debit_amount", posting."credit_amount"
  from "erp_financials"."ledger_postings" posting
  where posting."tenant_id" = document."tenant_id" and posting."source_id" = document."source_id"
    and posting."transaction_id" = document."transaction_id"
    and posting."account_id" = coalesce(disbursement."payable_account_id", document."metadata" #>> '{billPaymentProvenance,payableAccountId}')
  order by posting."posting_id" limit 1
) payable_posting on true
where coalesce(disbursement."tenant_id", document."tenant_id") = $1
  and coalesce(disbursement."company_id", document."company_id") = $2
  and coalesce(disbursement."source_id", document."source_id") = $3
  and coalesce(disbursement."bill_payment_id", document."subledger_document_id") = $4
  and (document."subledger_document_id" is null or document."document_type" = 'bill_payment')`,
      [scope.tenantId, scope.companyId, payment.sourceId, paymentId]
    );
    const row = requiredRow(header.rows[0], `bill payment ${paymentId}`);
    const reversalTransactionId = optionalString(row.reversal_transaction_id);
    const memo = optionalString(row.memo);
    const applications = orderBillPaymentApplications(
      await queryPaymentApplications(client, scope, { sourcePaymentId: paymentId }),
      row.allocations
    );
    const scheduled = optionalPrefixedLifecycleFromRow(row, "scheduled");
    const cleared = optionalPrefixedLifecycleFromRow(row, "cleared");
    const posted = optionalPrefixedLifecycleFromRow(row, "posted");
    const voided = optionalPrefixedLifecycleFromRow(row, "voided");
    const fundingAccount = accountEvidenceFromRow(row, "funding");
    const payableAccount = accountEvidenceFromRow(row, "payable");
    return {
      ...payment,
      ...(memo === undefined ? {} : { memo }),
      lifecycle: {
        ...(scheduled === undefined ? {} : { scheduled }),
        ...(cleared === undefined ? {} : { cleared }),
        ...(posted === undefined ? {} : { posted }),
        ...(voided === undefined ? {} : { voided }),
        ...(reversalTransactionId === undefined ? {} : { reversalTransactionId })
      },
      ...(fundingAccount === undefined ? {} : { fundingAccount }),
      ...(payableAccount === undefined ? {} : { payableAccount }),
      applications
    };
  });
}

async function getBillPaymentSummary(
  scope: Scope,
  input: {
    readonly periodStart: IsoDate;
    readonly periodEnd: IsoDate;
    readonly vendorId?: string;
    readonly status?: BillPaymentLifecycleStatus;
    readonly paymentMethod?: BillPaymentMethod;
  }
): Promise<BillPaymentSummary> {
  assertBillPaymentFilters(input);
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `with canonical_bill_payments as (
select disbursement."vendor_id", disbursement."payment_date", disbursement."amount", disbursement."status",
  disbursement."payment_method"
from "erp_financials"."bill_payment_disbursements" disbursement
join "erp_financials"."reporting_book_sources" source
  on source."tenant_id" = disbursement."tenant_id" and source."company_id" = disbursement."company_id"
 and source."book_id" = $3 and source."source_id" = disbursement."source_id"
 and (source."effective_from" is null or source."effective_from" <= disbursement."payment_date")
 and (source."effective_through" is null or source."effective_through" >= disbursement."payment_date")
where disbursement."tenant_id" = $1 and disbursement."company_id" = $2 and disbursement."currency_code" = $4
union all
select document."party_id", document."document_date", document."original_amount",
  case when document."status" = 'voided' then 'voided' else 'cleared' end,
  document."metadata" #>> '{billPaymentProvenance,paymentMethod}'
from "erp_financials"."subledger_documents" document
join "erp_financials"."reporting_book_sources" source
  on source."tenant_id" = document."tenant_id" and source."company_id" = document."company_id"
 and source."book_id" = $3 and source."source_id" = document."source_id"
 and (source."effective_from" is null or source."effective_from" <= document."document_date")
 and (source."effective_through" is null or source."effective_through" >= document."document_date")
where document."tenant_id" = $1 and document."company_id" = $2 and document."document_type" = 'bill_payment'
  and document."currency_code" = $4 and not exists (
    select 1 from "erp_financials"."bill_payment_disbursements" disbursement
    where disbursement."tenant_id" = document."tenant_id" and disbursement."company_id" = document."company_id"
      and disbursement."source_id" = document."source_id" and disbursement."bill_payment_id" = document."subledger_document_id"
  )
), filtered as (
  select * from canonical_bill_payments where "payment_date" between $5::date and $6::date
    and ($7::text is null or "vendor_id" = $7)
    and ($8::text is null or "status" = $8)
    and ($9::text is null or "payment_method" = $9)
)
select coalesce(sum("amount") filter (where "status" = 'scheduled'), 0)::numeric as "scheduled_amount",
  count(*) filter (where "status" = 'scheduled')::integer as "scheduled_count",
  coalesce(sum("amount") filter (where "status" = 'cleared'), 0)::numeric as "cleared_amount",
  count(*) filter (where "status" = 'cleared')::integer as "cleared_count",
  coalesce(sum("amount") filter (where "status" = 'voided'), 0)::numeric as "voided_amount",
  count(*) filter (where "status" = 'voided')::integer as "voided_count",
  coalesce(sum("amount"), 0)::numeric as "total_amount", count(*)::integer as "total_count"
from filtered`,
      [
        scope.tenantId,
        scope.companyId,
        scope.bookId,
        book.currencyCode,
        input.periodStart,
        input.periodEnd,
        input.vendorId,
        input.status,
        input.paymentMethod
      ]
    );
    const row = requiredRow(result.rows[0], "bill payment summary");
    return {
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      currencyCode: book.currencyCode,
      scheduledAmount: money(row.scheduled_amount, "scheduled_amount"),
      scheduledCount: integer(row.scheduled_count, "scheduled_count"),
      clearedAmount: money(row.cleared_amount, "cleared_amount"),
      clearedCount: integer(row.cleared_count, "cleared_count"),
      voidedAmount: money(row.voided_amount, "voided_amount"),
      voidedCount: integer(row.voided_count, "voided_count"),
      totalAmount: money(row.total_amount, "total_amount"),
      totalCount: integer(row.total_count, "total_count")
    };
  });
}

async function getCustomerPayment(scope: Scope, paymentId: string): Promise<CustomerPaymentDetail> {
  assertNonEmpty(paymentId, "paymentId");
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `select document."subledger_document_id" as "payment_id", document."source_id", document."document_type",
  document."transaction_id", document."party_id", party."display_name" as "party_name", document."document_number",
  document."document_date", document."currency_code", document."original_amount", document."open_amount",
  document."version", document."lifecycle_event_id", document."metadata", transaction."memo",
  count(application."subledger_application_id") filter (where application."status" = 'applied')::integer as "application_count"
from "erp_financials"."subledger_documents" document
join "erp_financials"."reporting_book_sources" source
  on source."tenant_id" = document."tenant_id" and source."company_id" = document."company_id"
 and source."book_id" = $3 and source."source_id" = document."source_id"
join "erp_financials"."transactions" transaction
  on transaction."tenant_id" = document."tenant_id" and transaction."source_id" = document."source_id"
 and transaction."transaction_id" = document."transaction_id"
left join "erp_financials"."parties" party
  on party."tenant_id" = document."tenant_id" and party."source_id" = document."source_id" and party."party_id" = document."party_id"
left join "erp_financials"."subledger_applications" application
  on application."tenant_id" = document."tenant_id" and application."company_id" = document."company_id"
 and application."source_id" = document."source_id" and application."source_document_id" = document."subledger_document_id"
where document."tenant_id" = $1 and document."company_id" = $2 and document."subledger_document_id" = $4
  and document."document_type" = 'customer_payment' and document."currency_code" = $5
group by document."subledger_document_id", party."display_name", transaction."memo"`,
      [scope.tenantId, scope.companyId, scope.bookId, paymentId, book.currencyCode]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ErpFinancialsError("missing_document", `Customer payment ${paymentId} does not exist in reporting book ${scope.bookId}`, {
        details: { bookId: scope.bookId, paymentId }
      });
    }
    const applications = await queryPaymentApplications(client, scope, { sourcePaymentId: paymentId });
    const item = paymentFromRow(row);
    const memo = optionalString(row.memo);
    const provenance = customerPaymentProvenanceFromMetadata(row.metadata);
    return {
      ...item,
      transactionId: string(row.transaction_id, "transaction_id"),
      version: integer(row.version, "version"),
      lifecycleEventId: string(row.lifecycle_event_id, "lifecycle_event_id"),
      ...(memo === undefined ? {} : { memo }),
      ...(provenance === undefined ? {} : { provenance }),
      applications
    };
  });
}

async function listPaymentApplications(
  scope: Scope,
  input: PageRequest & {
    readonly applicationType?: PaymentApplicationListItem["applicationType"];
    readonly status?: PaymentApplicationListItem["status"];
    readonly sourcePaymentId?: string;
    readonly targetDocumentId?: string;
    readonly applicationId?: string;
  }
): Promise<Page<PaymentApplicationListItem>> {
  const page = pageInput(input, "payment-applications", scope.bookId);
  return scope.database.transaction(async (client) => {
    const rows = await queryPaymentApplications(client, scope, input, page);
    return toPage(rows, page.limit, "payment-applications", scope.bookId, (item) => ({
      date: item.applicationDate,
      id: item.applicationId
    }));
  });
}

async function getPaymentApplication(scope: Scope, applicationId: string): Promise<PaymentApplicationDetail> {
  assertNonEmpty(applicationId, "applicationId");
  const page = await listPaymentApplications(scope, { applicationId, limit: 1 });
  const application = page.items[0];
  if (application === undefined) {
    throw new ErpFinancialsError("missing_document", `Payment application ${applicationId} does not exist in reporting book ${scope.bookId}`, {
      details: { applicationId, bookId: scope.bookId }
    });
  }
  return application;
}

async function queryPaymentApplications(
  client: PostgresQueryClient,
  scope: Scope,
  input: {
    readonly applicationType?: PaymentApplicationListItem["applicationType"];
    readonly status?: PaymentApplicationListItem["status"];
    readonly sourcePaymentId?: string;
    readonly targetDocumentId?: string;
    readonly applicationId?: string;
  },
  page?: ReturnType<typeof pageInput>
): Promise<readonly PaymentApplicationListItem[]> {
  const result = await client.query(
    `select application."subledger_application_id" as "application_id", application."source_id",
  application."application_type", application."status", application."version", application."application_date",
  application."source_document_id" as "source_payment_id", application."target_document_id",
  application."applied_amount", application."currency_code", application."applied_event_id", application."ended_event_id",
  application."match_candidate_id", application."match_decision_id", application."match_method", application."match_score",
  application."match_evidence"
from "erp_financials"."subledger_applications" application
join "erp_financials"."subledger_documents" source_document
  on source_document."tenant_id" = application."tenant_id" and source_document."company_id" = application."company_id"
 and source_document."source_id" = application."source_id" and source_document."subledger_document_id" = application."source_document_id"
join "erp_financials"."subledger_documents" target_document
  on target_document."tenant_id" = application."tenant_id" and target_document."company_id" = application."company_id"
 and target_document."source_id" = application."source_id" and target_document."subledger_document_id" = application."target_document_id"
join "erp_financials"."reporting_book_sources" source
  on source."tenant_id" = application."tenant_id" and source."company_id" = application."company_id"
 and source."book_id" = $3 and source."source_id" = application."source_id"
where application."tenant_id" = $1 and application."company_id" = $2
  and ($4::text is null or application."application_type" = $4)
  and ($5::text is null or application."status" = $5)
  and ($6::text is null or application."source_document_id" = $6)
  and ($7::text is null or application."target_document_id" = $7)
  and ($8::text is null or application."subledger_application_id" = $8)
  and ($9::date is null or (application."application_date", application."subledger_application_id") < ($9::date, $10::text))
order by application."application_date" desc, application."subledger_application_id" desc
limit $11`,
    [scope.tenantId, scope.companyId, scope.bookId, input.applicationType, input.status, input.sourcePaymentId,
      input.targetDocumentId, input.applicationId, page?.date, page?.id, (page?.limit ?? 100) + 1]
  );
  return result.rows.map(paymentApplicationFromRow);
}

async function listAdjustments(
  scope: Scope,
  input: PageRequest & {
    readonly adjustmentType?: AdjustmentType;
    readonly status?: AdjustmentStatus;
    readonly adjustmentId?: string;
  }
): Promise<Page<AdjustmentListItem>> {
  const page = pageInput(input, "adjustments", scope.bookId);
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `with adjustment_rows as (
  select document."subledger_document_id" as "adjustment_id", document."source_id", document."transaction_id",
    case when document."document_type" = 'credit_memo' then 'credit' else 'refund' end as "adjustment_type",
    document."party_id", party."display_name" as "party_name", document."document_number", document."document_date",
    document."currency_code", document."original_amount", document."open_amount", document."version",
    void_link."related_transaction_id" as "reversal_transaction_id",
    replacement."subledger_document_id" as "replacement_adjustment_id",
    replaced_original."subledger_document_id" as "replaces_adjustment_id",
    case when replacement."subledger_document_id" is not null then 'replaced' else document."status" end as "status"
  from "erp_financials"."subledger_documents" document
  join "erp_financials"."reporting_book_sources" source
    on source."tenant_id" = document."tenant_id" and source."company_id" = document."company_id"
   and source."book_id" = $3 and source."source_id" = document."source_id"
   and (source."effective_from" is null or source."effective_from" <= document."document_date")
   and (source."effective_through" is null or source."effective_through" >= document."document_date")
  left join "erp_financials"."parties" party
    on party."tenant_id" = document."tenant_id" and party."source_id" = document."source_id"
   and party."party_id" = document."party_id"
  left join lateral (
    select link."related_transaction_id"
    from "erp_financials"."journal_entry_links" link
    where link."tenant_id" = document."tenant_id" and link."company_id" = document."company_id"
      and link."source_id" = document."source_id" and link."original_transaction_id" = document."transaction_id"
      and link."link_type" in ('reversal', 'void')
    limit 1
  ) void_link on true
  left join lateral (
    select link."related_transaction_id"
    from "erp_financials"."journal_entry_links" link
    where link."tenant_id" = document."tenant_id" and link."company_id" = document."company_id"
      and link."source_id" = document."source_id" and link."original_transaction_id" = document."transaction_id"
      and link."link_type" = 'replacement'
    limit 1
  ) replacement_link on true
  left join "erp_financials"."subledger_documents" replacement
    on replacement."tenant_id" = document."tenant_id" and replacement."company_id" = document."company_id"
   and replacement."source_id" = document."source_id"
   and replacement."transaction_id" = replacement_link."related_transaction_id"
   and replacement."document_type" = document."document_type"
  left join lateral (
    select link."original_transaction_id"
    from "erp_financials"."journal_entry_links" link
    where link."tenant_id" = document."tenant_id" and link."company_id" = document."company_id"
      and link."source_id" = document."source_id" and link."related_transaction_id" = document."transaction_id"
      and link."link_type" = 'replacement'
    limit 1
  ) replaced_link on true
  left join "erp_financials"."subledger_documents" replaced_original
    on replaced_original."tenant_id" = document."tenant_id" and replaced_original."company_id" = document."company_id"
   and replaced_original."source_id" = document."source_id"
   and replaced_original."transaction_id" = replaced_link."original_transaction_id"
   and replaced_original."document_type" = document."document_type"
  where document."tenant_id" = $1 and document."company_id" = $2
    and document."document_type" in ('credit_memo', 'refund') and document."currency_code" = $4
    and ($9::text is null or document."subledger_document_id" = $9)
)
select * from adjustment_rows
where ($5::text is null or "adjustment_type" = $5)
  and ($6::text is null or "status" = $6)
  and ($7::date is null or ("document_date", "adjustment_id") < ($7::date, $8::text))
order by "document_date" desc, "adjustment_id" desc
limit $10`,
      [
        scope.tenantId,
        scope.companyId,
        scope.bookId,
        book.currencyCode,
        input.adjustmentType,
        input.status,
        page.date,
        page.id,
        input.adjustmentId,
        page.limit + 1
      ]
    );
    return toPage(result.rows.map(adjustmentFromRow), page.limit, "adjustments", scope.bookId, (item) => ({
      date: item.adjustmentDate,
      id: item.adjustmentId
    }));
  });
}

async function getAdjustment(scope: Scope, adjustmentId: string): Promise<AdjustmentDetail> {
  assertNonEmpty(adjustmentId, "adjustmentId");
  const page = await listAdjustments(scope, { adjustmentId, limit: 1 });
  const adjustment = page.items[0];
  if (adjustment === undefined) {
    throw new ErpFinancialsError(
      "missing_document",
      `Adjustment ${adjustmentId} does not exist in reporting book ${scope.bookId}`,
      { details: { adjustmentId, bookId: scope.bookId } }
    );
  }
  return scope.database.transaction(async (client) => {
    const header = await client.query(
      `select transaction."memo", document."metadata", lifecycle."event_id" as "lifecycle_event_id",
  lifecycle."actor_ref", lifecycle."approver_ref", lifecycle."request_id", lifecycle."reason_code"
from "erp_financials"."transactions" transaction
join "erp_financials"."subledger_documents" document
  on document."tenant_id" = transaction."tenant_id" and document."source_id" = transaction."source_id"
 and document."transaction_id" = transaction."transaction_id"
join "erp_financials"."financial_lifecycle_events" lifecycle
  on lifecycle."tenant_id" = document."tenant_id" and lifecycle."company_id" = document."company_id"
 and lifecycle."source_id" = document."source_id" and lifecycle."event_id" = document."lifecycle_event_id"
where transaction."tenant_id" = $1 and transaction."source_id" = $2 and transaction."transaction_id" = $3`,
      [scope.tenantId, adjustment.sourceId, adjustment.transactionId]
    );
    const lines = await client.query(
      `select "subledger_document_line_id" as "line_id", *
from "erp_financials"."subledger_document_lines"
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3 and "subledger_document_id" = $4
order by "line_number"`,
      [scope.tenantId, scope.companyId, adjustment.sourceId, adjustment.adjustmentId]
    );
    const postings = await client.query(
      `select posting."posting_id", posting."account_id", posting."item_id", posting."description",
  posting."debit_amount", posting."credit_amount", posting."currency_code", posting."dimension_refs",
  coalesce(mapping."book_account_key", posting."source_id" || ':' || posting."account_id") as "book_account_key",
  coalesce(book_account."name", account."name") as "account_name"
from "erp_financials"."ledger_postings" posting
join "erp_financials"."accounts" account
  on account."tenant_id" = posting."tenant_id" and account."source_id" = posting."source_id"
 and account."account_id" = posting."account_id"
left join "erp_financials"."reporting_book_account_mappings" mapping
  on mapping."tenant_id" = $1 and mapping."company_id" = $2 and mapping."book_id" = $3
 and mapping."source_id" = posting."source_id" and mapping."source_account_id" = posting."account_id"
left join "erp_financials"."reporting_book_accounts" book_account
  on book_account."tenant_id" = $1 and book_account."company_id" = $2 and book_account."book_id" = $3
 and book_account."book_account_key" = mapping."book_account_key"
where posting."tenant_id" = $1 and posting."source_id" = $4 and posting."transaction_id" = $5
order by posting."posting_id"`,
      [scope.tenantId, scope.companyId, scope.bookId, adjustment.sourceId, adjustment.transactionId]
    );
    const applications = await client.query(
      `select application."subledger_application_id" as "application_id",
  application."target_document_id" as "invoice_id", application."application_date",
  application."applied_amount", application."status", application."version"
from "erp_financials"."subledger_applications" application
where application."tenant_id" = $1 and application."company_id" = $2 and application."source_id" = $3
  and application."source_document_id" = $4 and application."application_type" = 'credit_to_invoice'
order by application."application_date", application."subledger_application_id"`,
      [scope.tenantId, scope.companyId, adjustment.sourceId, adjustment.adjustmentId]
    );
    const headerRow = header.rows[0];
    const memo = optionalString(headerRow?.memo);
    const lifecycle = headerRow?.lifecycle_event_id === undefined ? undefined : lifecycleFromRow(headerRow);
    const refundProvenance = adjustment.adjustmentType === "refund"
      ? refundProvenanceFromMetadata(headerRow?.metadata)
      : undefined;
    return {
      ...adjustment,
      ...(memo === undefined ? {} : { memo }),
      lines: lines.rows.map(commercialLineFromRow),
      postings: postings.rows.map(adjustmentPostingFromRow),
      applications: applications.rows.map(adjustmentApplicationFromRow),
      ...(lifecycle === undefined ? {} : { lifecycle }),
      ...(refundProvenance === undefined ? {} : { refundProvenance })
    };
  });
}

async function listWriteOffs(
  scope: Scope,
  input: PageRequest & { readonly customerId?: string; readonly status?: WriteOffListItem["status"]; readonly writeOffId?: string }
): Promise<Page<WriteOffListItem>> {
  const page = pageInput(input, "write-offs", scope.bookId);
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `with write_off_rows as (
  select document."subledger_document_id" as "write_off_id", document."source_id", document."transaction_id",
    document."party_id", party."display_name" as "party_name", document."document_number", document."document_date",
    document."currency_code", document."original_amount", document."version", document."metadata",
    void_link."related_transaction_id" as "reversal_transaction_id",
    replacement."subledger_document_id" as "replacement_write_off_id",
    replaced_original."subledger_document_id" as "replaces_write_off_id",
    case when replacement."subledger_document_id" is not null then 'replaced' else document."status" end as "status"
  from "erp_financials"."subledger_documents" document
  join "erp_financials"."reporting_book_sources" source
    on source."tenant_id" = document."tenant_id" and source."company_id" = document."company_id"
   and source."book_id" = $3 and source."source_id" = document."source_id"
  left join "erp_financials"."parties" party
    on party."tenant_id" = document."tenant_id" and party."source_id" = document."source_id" and party."party_id" = document."party_id"
  left join lateral (
    select link."related_transaction_id" from "erp_financials"."journal_entry_links" link
    where link."tenant_id" = document."tenant_id" and link."company_id" = document."company_id"
      and link."source_id" = document."source_id" and link."original_transaction_id" = document."transaction_id"
      and link."link_type" in ('reversal', 'void') limit 1
  ) void_link on true
  left join lateral (
    select link."related_transaction_id" from "erp_financials"."journal_entry_links" link
    where link."tenant_id" = document."tenant_id" and link."company_id" = document."company_id"
      and link."source_id" = document."source_id" and link."original_transaction_id" = document."transaction_id"
      and link."link_type" = 'replacement' limit 1
  ) replacement_link on true
  left join "erp_financials"."subledger_documents" replacement
    on replacement."tenant_id" = document."tenant_id" and replacement."company_id" = document."company_id"
   and replacement."source_id" = document."source_id" and replacement."transaction_id" = replacement_link."related_transaction_id"
   and replacement."document_type" = 'write_off'
  left join lateral (
    select link."original_transaction_id" from "erp_financials"."journal_entry_links" link
    where link."tenant_id" = document."tenant_id" and link."company_id" = document."company_id"
      and link."source_id" = document."source_id" and link."related_transaction_id" = document."transaction_id"
      and link."link_type" = 'replacement' limit 1
  ) replaced_link on true
  left join "erp_financials"."subledger_documents" replaced_original
    on replaced_original."tenant_id" = document."tenant_id" and replaced_original."company_id" = document."company_id"
   and replaced_original."source_id" = document."source_id" and replaced_original."transaction_id" = replaced_link."original_transaction_id"
   and replaced_original."document_type" = 'write_off'
  where document."tenant_id" = $1 and document."company_id" = $2 and document."document_type" = 'write_off'
    and document."currency_code" = $4 and ($9::text is null or document."subledger_document_id" = $9)
)
select * from write_off_rows
where ($5::text is null or "party_id" = $5) and ($6::text is null or "status" = $6)
  and ($7::date is null or ("document_date", "write_off_id") < ($7::date, $8::text))
order by "document_date" desc, "write_off_id" desc
limit $10`,
      [scope.tenantId, scope.companyId, scope.bookId, book.currencyCode, input.customerId, input.status,
        page.date, page.id, input.writeOffId, page.limit + 1]
    );
    return toPage(result.rows.map(writeOffFromRow), page.limit, "write-offs", scope.bookId, (item) => ({
      date: item.writeOffDate,
      id: item.writeOffId
    }));
  });
}

async function getWriteOff(scope: Scope, writeOffId: string): Promise<WriteOffDetail> {
  assertNonEmpty(writeOffId, "writeOffId");
  const page = await listWriteOffs(scope, { writeOffId, limit: 1 });
  const writeOff = page.items[0];
  if (writeOff === undefined) {
    throw new ErpFinancialsError("missing_document", `Write-off ${writeOffId} does not exist in reporting book ${scope.bookId}`, {
      details: { bookId: scope.bookId, writeOffId }
    });
  }
  return scope.database.transaction(async (client) => {
    const result = await client.query(
      `select transaction."memo", document."metadata", lifecycle."event_id" as "lifecycle_event_id",
  lifecycle."actor_ref", lifecycle."approver_ref", lifecycle."request_id", lifecycle."reason_code"
from "erp_financials"."subledger_documents" document
join "erp_financials"."transactions" transaction
  on transaction."tenant_id" = document."tenant_id" and transaction."source_id" = document."source_id"
 and transaction."transaction_id" = document."transaction_id"
join "erp_financials"."financial_lifecycle_events" lifecycle
  on lifecycle."tenant_id" = document."tenant_id" and lifecycle."company_id" = document."company_id"
 and lifecycle."source_id" = document."source_id" and lifecycle."event_id" = document."lifecycle_event_id"
where document."tenant_id" = $1 and document."company_id" = $2 and document."source_id" = $3
  and document."subledger_document_id" = $4 and document."document_type" = 'write_off'`,
      [scope.tenantId, scope.companyId, writeOff.sourceId, writeOffId]
    );
    const row = requiredRow(result.rows[0], "write-off detail");
    const provenance = requiredObjectProperty(row.metadata, "writeOffProvenance");
    const memo = optionalString(row.memo);
    return {
      ...writeOff,
      ...(memo === undefined ? {} : { memo }),
      balanceType: string(provenance.balanceType, "writeOffProvenance.balanceType") as WriteOffDetail["balanceType"],
      balanceAccountId: string(provenance.balanceAccountId, "writeOffProvenance.balanceAccountId"),
      writeOffAccountId: string(provenance.writeOffAccountId, "writeOffProvenance.writeOffAccountId"),
      lifecycle: lifecycleFromRow(row)
    };
  });
}

async function getPaymentSummary(
  scope: Scope,
  input: { readonly periodStart: IsoDate; readonly periodEnd: IsoDate }
): Promise<PaymentSummary> {
  assertWindow(input.periodStart, input.periodEnd);
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `with payments as (
  select document."subledger_document_id", document."original_amount", document."open_amount"
  from "erp_financials"."subledger_documents" document
  join "erp_financials"."reporting_book_sources" source
    on source."tenant_id" = document."tenant_id" and source."company_id" = document."company_id"
   and source."book_id" = $3 and source."source_id" = document."source_id"
   and (source."effective_from" is null or source."effective_from" <= document."document_date")
   and (source."effective_through" is null or source."effective_through" >= document."document_date")
  where document."tenant_id" = $1 and document."company_id" = $2 and document."document_type" = 'customer_payment'
    and document."currency_code" = $4 and document."document_date" between $5::date and $6::date
), matched as (
  select payment."subledger_document_id",
    bool_or(application."match_method" = 'automatic') as "automatic"
  from payments payment
  join "erp_financials"."subledger_applications" application
    on application."tenant_id" = $1 and application."company_id" = $2
   and application."source_document_id" = payment."subledger_document_id" and application."status" = 'applied'
  group by payment."subledger_document_id"
)
select coalesce(sum("original_amount"), 0) as "received_amount", count(*)::integer as "received_count",
  coalesce(sum("open_amount") filter (where "open_amount" > 0), 0) as "unapplied_amount",
  count(*) filter (where "open_amount" > 0)::integer as "unapplied_count",
  (select count(*)::integer from matched) as "matched_count",
  (select count(*) filter (where "automatic")::integer from matched) as "automatic_count",
  (select count(*)::integer from "erp_financials"."bank_statement_lines" bank
    where bank."tenant_id" = $1 and bank."company_id" = $2 and bank."book_id" = $3
      and bank."currency_code" = $4 and bank."status" = 'unmatched' and bank."posted_date" <= $6::date) as "awaiting_count"
from payments`,
      [scope.tenantId, scope.companyId, scope.bookId, book.currencyCode, input.periodStart, input.periodEnd]
    );
    const row = requiredRow(result.rows[0], "payment summary");
    const matchedPaymentCount = integer(row.matched_count, "matched_count");
    const automaticallyMatchedPaymentCount = integer(row.automatic_count, "automatic_count");
    return {
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      currencyCode: book.currencyCode,
      receivedAmount: money(row.received_amount, "received_amount"),
      receivedPaymentCount: integer(row.received_count, "received_count"),
      automaticallyMatchedPaymentCount,
      matchedPaymentCount,
      automaticMatchRatePercent: percentage(automaticallyMatchedPaymentCount, matchedPaymentCount),
      unappliedAmount: money(row.unapplied_amount, "unapplied_amount"),
      unappliedPaymentCount: integer(row.unapplied_count, "unapplied_count"),
      awaitingBankReviewCount: integer(row.awaiting_count, "awaiting_count")
    };
  });
}

async function listGeneralLedger(
  scope: Scope,
  input: PageRequest & GeneralLedgerFilters
): Promise<Page<GeneralLedgerLine>> {
  const filters = generalLedgerFilters(input);
  const pageKind = `general-ledger:${generalLedgerFilterFingerprint(filters)}`;
  const page = pageInput(input, pageKind, scope.bookId);
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `select posting."posting_id", posting."source_id", posting."source_posting_id", posting."transaction_id",
  transaction."source_transaction_id", transaction."source_transaction_type", transaction."transaction_number",
  transaction."transaction_date", posting."posting_date", posting."account_id",
  coalesce(mapping."book_account_key", posting."source_id" || ':' || posting."account_id") as "book_account_key",
  account."account_number", account."name" as "account_name", posting."party_id", posting."item_id",
  line."description", posting."debit_amount", posting."credit_amount", posting."net_amount", posting."currency_code",
  posting."dimension_refs", source."source_role", accounting_source."source_system",
  accounting_source."provider_environment",
  coalesce(posting."source_payload_ref", transaction."source_payload_ref") as "source_payload_ref"
from "erp_financials"."ledger_postings" posting
join "erp_financials"."transactions" transaction
  on transaction."tenant_id" = posting."tenant_id" and transaction."source_id" = posting."source_id" and transaction."transaction_id" = posting."transaction_id"
join "erp_financials"."accounts" account
  on account."tenant_id" = posting."tenant_id" and account."source_id" = posting."source_id" and account."account_id" = posting."account_id"
join "erp_financials"."accounting_sources" accounting_source
  on accounting_source."tenant_id" = posting."tenant_id" and accounting_source."source_id" = posting."source_id"
join "erp_financials"."reporting_book_sources" source
  on source."tenant_id" = $1 and source."company_id" = $2 and source."book_id" = $3 and source."source_id" = posting."source_id"
 and (source."effective_from" is null or source."effective_from" <= posting."posting_date")
 and (source."effective_through" is null or source."effective_through" >= posting."posting_date")
left join "erp_financials"."reporting_book_account_mappings" mapping
  on mapping."tenant_id" = $1 and mapping."company_id" = $2 and mapping."book_id" = $3
 and mapping."source_id" = posting."source_id" and mapping."account_id" = posting."account_id"
left join "erp_financials"."transaction_lines" line
  on line."tenant_id" = posting."tenant_id" and line."source_id" = posting."source_id" and line."transaction_line_id" = posting."transaction_line_id"
left join "erp_financials"."parties" party
  on party."tenant_id" = posting."tenant_id" and party."source_id" = posting."source_id" and party."party_id" = posting."party_id"
where posting."tenant_id" = $1 and posting."accounting_basis" = $4 and posting."currency_code" = $5
  and posting."posting_date" between $6::date and $7::date
  and ($8::text is null or coalesce(mapping."book_account_key", posting."source_id" || ':' || posting."account_id") = $8)
  and ($9::text is null or posting."source_id" = $9)
  and ($10::text is null or transaction."source_transaction_type" = $10)
  and ($11::text is null or exists (
    select 1 from jsonb_array_elements(coalesce(posting."dimension_refs", '[]'::jsonb)) class_ref
    where lower(class_ref ->> 'dimensionKind') = 'class'
      and (class_ref ->> 'dimensionId' = $11 or class_ref ->> 'sourceDimensionId' = $11)
  ))
  and ($12::text is null or exists (
    select 1 from jsonb_array_elements(coalesce(posting."dimension_refs", '[]'::jsonb)) dimension_ref
    where dimension_ref ->> 'dimensionKind' = $12
      and (dimension_ref ->> 'dimensionId' = $13 or dimension_ref ->> 'sourceDimensionId' = $13)
  ))
  and ($14::text is null or ($14 = 'debit' and posting."debit_amount" > 0) or ($14 = 'credit' and posting."credit_amount" > 0))
  and ($15::text is null or strpos(lower(concat_ws(' ', transaction."transaction_number", transaction."memo",
    line."description", account."account_number", account."name", party."display_name", posting."posting_id",
    transaction."transaction_id")), lower($15)) > 0)
  and ($16::date is null or (posting."posting_date", posting."posting_id") < ($16::date, $17::text))
order by posting."posting_date" desc, posting."posting_id" desc
limit $18`,
      [scope.tenantId, scope.companyId, scope.bookId, book.accountingBasis, book.currencyCode,
        filters.periodStart, filters.periodEnd, filters.accountKey, filters.sourceId, filters.transactionType,
        filters.classId, filters.dimensionKind, filters.dimensionId, filters.polarity, filters.search,
        page.date, page.id, page.limit + 1]
    );
    return toPage(result.rows.map(ledgerLineFromRow), page.limit, pageKind, scope.bookId, (item) => ({
      date: item.postingDate,
      id: item.postingId
    }));
  });
}

async function getGeneralLedgerSummary(
  scope: Scope,
  input: GeneralLedgerFilters
): Promise<GeneralLedgerSummary> {
  const filters = generalLedgerFilters(input);
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `select count(*)::integer as "posting_count", coalesce(sum(posting."debit_amount"), 0) as "debits",
  coalesce(sum(posting."credit_amount"), 0) as "credits"
from "erp_financials"."ledger_postings" posting
join "erp_financials"."transactions" transaction
  on transaction."tenant_id" = posting."tenant_id" and transaction."source_id" = posting."source_id" and transaction."transaction_id" = posting."transaction_id"
join "erp_financials"."accounts" account
  on account."tenant_id" = posting."tenant_id" and account."source_id" = posting."source_id" and account."account_id" = posting."account_id"
join "erp_financials"."reporting_book_sources" source
  on source."tenant_id" = $1 and source."company_id" = $2 and source."book_id" = $3 and source."source_id" = posting."source_id"
 and (source."effective_from" is null or source."effective_from" <= posting."posting_date")
 and (source."effective_through" is null or source."effective_through" >= posting."posting_date")
left join "erp_financials"."reporting_book_account_mappings" mapping
  on mapping."tenant_id" = $1 and mapping."company_id" = $2 and mapping."book_id" = $3
 and mapping."source_id" = posting."source_id" and mapping."account_id" = posting."account_id"
left join "erp_financials"."transaction_lines" line
  on line."tenant_id" = posting."tenant_id" and line."source_id" = posting."source_id" and line."transaction_line_id" = posting."transaction_line_id"
left join "erp_financials"."parties" party
  on party."tenant_id" = posting."tenant_id" and party."source_id" = posting."source_id" and party."party_id" = posting."party_id"
where posting."tenant_id" = $1 and posting."accounting_basis" = $4 and posting."currency_code" = $5
  and posting."posting_date" between $6::date and $7::date
  and ($8::text is null or coalesce(mapping."book_account_key", posting."source_id" || ':' || posting."account_id") = $8)
  and ($9::text is null or posting."source_id" = $9)
  and ($10::text is null or transaction."source_transaction_type" = $10)
  and ($11::text is null or exists (
    select 1 from jsonb_array_elements(coalesce(posting."dimension_refs", '[]'::jsonb)) class_ref
    where lower(class_ref ->> 'dimensionKind') = 'class'
      and (class_ref ->> 'dimensionId' = $11 or class_ref ->> 'sourceDimensionId' = $11)
  ))
  and ($12::text is null or exists (
    select 1 from jsonb_array_elements(coalesce(posting."dimension_refs", '[]'::jsonb)) dimension_ref
    where dimension_ref ->> 'dimensionKind' = $12
      and (dimension_ref ->> 'dimensionId' = $13 or dimension_ref ->> 'sourceDimensionId' = $13)
  ))
  and ($14::text is null or ($14 = 'debit' and posting."debit_amount" > 0) or ($14 = 'credit' and posting."credit_amount" > 0))
  and ($15::text is null or strpos(lower(concat_ws(' ', transaction."transaction_number", transaction."memo",
    line."description", account."account_number", account."name", party."display_name", posting."posting_id",
    transaction."transaction_id")), lower($15)) > 0)`,
      [scope.tenantId, scope.companyId, scope.bookId, book.accountingBasis, book.currencyCode,
        filters.periodStart, filters.periodEnd, filters.accountKey, filters.sourceId, filters.transactionType,
        filters.classId, filters.dimensionKind, filters.dimensionId, filters.polarity, filters.search]
    );
    const row = requiredRow(result.rows[0], "general ledger summary");
    const totalDebits = money(row.debits, "debits");
    const totalCredits = money(row.credits, "credits");
    return {
      periodStart: filters.periodStart,
      periodEnd: filters.periodEnd,
      currencyCode: book.currencyCode,
      postingCount: integer(row.posting_count, "posting_count"),
      totalDebits,
      totalCredits,
      difference: subtractMoney(totalDebits, totalCredits)
    };
  });
}

async function listChartOfAccounts(
  scope: Scope,
  input: { readonly asOfDate?: IsoDate; readonly includeInactive?: boolean }
): Promise<readonly ChartOfAccountsItem[]> {
  const asOfDate = input.asOfDate ?? today();
  assertDate(asOfDate, "asOfDate");
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `select coalesce(mapping."book_account_key", account."source_id" || ':' || account."account_id") as "book_account_key",
  array_agg(account."source_id" || ':' || account."account_id" order by account."source_id", account."account_id") as "source_account_ids",
  coalesce(min(book_account."account_number"), min(account."account_number")) as "account_number",
  coalesce(min(book_account."name"), min(account."name")) as "account_name",
  coalesce(min(book_account."classification"), min(account."classification")) as "classification",
  coalesce(min(book_account."account_type"), min(account."type")) as "account_type",
  coalesce(min(book_account."account_subtype"), min(account."subtype")) as "account_subtype",
  min(book_account."account_role") as "account_role", min(book_account."version") as "version",
  min(book_account."parent_book_account_key") as "parent_book_account_key",
  coalesce(bool_or(book_account."active"), bool_or(account."active")) as "active",
  coalesce(sum(posting."debit_amount"), 0) as "debit_amount",
  coalesce(sum(posting."credit_amount"), 0) as "credit_amount", coalesce(sum(posting."net_amount"), 0) as "balance"
from "erp_financials"."accounts" account
join "erp_financials"."reporting_book_sources" source
  on source."tenant_id" = $1 and source."company_id" = $2 and source."book_id" = $3 and source."source_id" = account."source_id"
 and (source."effective_from" is null or source."effective_from" <= $4::date)
left join "erp_financials"."reporting_book_account_mappings" mapping
  on mapping."tenant_id" = $1 and mapping."company_id" = $2 and mapping."book_id" = $3
 and mapping."source_id" = account."source_id" and mapping."account_id" = account."account_id"
left join "erp_financials"."reporting_book_accounts" book_account
  on book_account."tenant_id" = $1 and book_account."company_id" = $2 and book_account."book_id" = $3
 and book_account."book_account_key" = mapping."book_account_key"
left join "erp_financials"."ledger_postings" posting
  on posting."tenant_id" = account."tenant_id" and posting."source_id" = account."source_id" and posting."account_id" = account."account_id"
 and posting."accounting_basis" = $5 and posting."currency_code" = $6 and posting."posting_date" <= $4::date
 and (source."effective_from" is null or source."effective_from" <= posting."posting_date")
 and (source."effective_through" is null or source."effective_through" >= posting."posting_date")
where account."tenant_id" = $1 and ($7::boolean or coalesce(book_account."active", account."active"))
group by coalesce(mapping."book_account_key", account."source_id" || ':' || account."account_id")
order by min(account."account_number") nulls last, min(account."name"), "book_account_key"`,
      [scope.tenantId, scope.companyId, scope.bookId, asOfDate, book.accountingBasis, book.currencyCode, input.includeInactive === true]
    );
    const defined = await client.query(
      `select "book_account_key", "account_number", "name" as "account_name", "classification",
  "account_type", "account_subtype", "account_role", "version", "parent_book_account_key", "active"
from "erp_financials"."reporting_book_accounts"
where "tenant_id" = $1 and "company_id" = $2 and "book_id" = $3 and ($4::boolean or "active")
order by "account_number" nulls last, "name", "book_account_key"`,
      [scope.tenantId, scope.companyId, scope.bookId, input.includeInactive === true]
    );
    return rollupChartAccounts(mergeBookChartAccounts(
      result.rows.map((row) => chartAccountFromRow(row, book.currencyCode)),
      defined.rows,
      book.currencyCode
    ));
  });
}

async function getDashboardSummary(
  scope: Scope,
  input: { readonly periodStart: IsoDate; readonly asOfDate: IsoDate }
): Promise<FinancialDashboardSummary> {
  assertWindow(input.periodStart, input.asOfDate);
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `with scoped_postings as (
  select account."classification", posting."net_amount", posting."posting_date"
  from "erp_financials"."ledger_postings" posting
  join "erp_financials"."accounts" account
    on account."tenant_id" = posting."tenant_id" and account."source_id" = posting."source_id" and account."account_id" = posting."account_id"
  join "erp_financials"."reporting_book_sources" source
    on source."tenant_id" = $1 and source."company_id" = $2 and source."book_id" = $3 and source."source_id" = posting."source_id"
   and (source."effective_from" is null or source."effective_from" <= posting."posting_date")
   and (source."effective_through" is null or source."effective_through" >= posting."posting_date")
  where posting."tenant_id" = $1 and posting."accounting_basis" = $4 and posting."currency_code" = $5
    and posting."posting_date" <= $6::date
), scoped_documents as (
  select document."document_type", document."open_amount", document."due_date"
  from "erp_financials"."subledger_documents" document
  join "erp_financials"."reporting_book_sources" source
    on source."tenant_id" = document."tenant_id" and source."company_id" = document."company_id"
   and source."book_id" = $3 and source."source_id" = document."source_id"
   and (source."effective_from" is null or source."effective_from" <= document."document_date")
   and (source."effective_through" is null or source."effective_through" >= document."document_date")
  where document."tenant_id" = $1 and document."company_id" = $2 and document."currency_code" = $5
    and document."document_type" in ('invoice', 'vendor_bill') and document."open_amount" > 0
)
select
  coalesce(sum("net_amount") filter (where "classification" = 'asset'), 0) as "assets",
  coalesce(-sum("net_amount") filter (where "classification" = 'liability'), 0) as "liabilities",
  coalesce(-sum("net_amount") filter (where "classification" = 'equity'), 0) as "equity",
  coalesce(-sum("net_amount") filter (where "classification" in ('income', 'other_income') and "posting_date" >= $7::date), 0) as "revenue",
  coalesce(sum("net_amount") filter (where "classification" in ('expense', 'cost_of_goods_sold', 'other_expense') and "posting_date" >= $7::date), 0) as "expenses",
  coalesce((select sum("open_amount") from scoped_documents where "document_type" = 'invoice'), 0) as "receivables",
  coalesce((select sum("open_amount") from scoped_documents where "document_type" = 'vendor_bill'), 0) as "payables",
  coalesce((select sum("open_amount") from scoped_documents where "document_type" = 'invoice' and "due_date" < $6::date), 0) as "overdue_receivables",
  coalesce((select sum("open_amount") from scoped_documents where "document_type" = 'vendor_bill' and "due_date" < $6::date), 0) as "overdue_payables"
from scoped_postings`,
      [scope.tenantId, scope.companyId, scope.bookId, book.accountingBasis, book.currencyCode, input.asOfDate, input.periodStart]
    );
    const row = requiredRow(result.rows[0], "dashboard summary");
    const revenue = money(row.revenue, "revenue");
    const expenses = money(row.expenses, "expenses");
    return {
      asOfDate: input.asOfDate,
      periodStart: input.periodStart,
      currencyCode: book.currencyCode,
      assets: money(row.assets, "assets"),
      liabilities: money(row.liabilities, "liabilities"),
      equity: money(row.equity, "equity"),
      revenue,
      expenses,
      netIncome: subtractMoney(revenue, expenses),
      accountsReceivable: money(row.receivables, "receivables"),
      accountsPayable: money(row.payables, "payables"),
      overdueReceivables: money(row.overdue_receivables, "overdue_receivables"),
      overduePayables: money(row.overdue_payables, "overdue_payables")
    };
  });
}

async function getFinancialStatement(
  scope: Scope,
  input: { readonly reportName: FinancialStatementName; readonly periodStart: IsoDate; readonly periodEnd: IsoDate; readonly asOfDate?: IsoDate }
): Promise<FinancialStatement> {
  assertWindow(input.periodStart, input.periodEnd);
  const asOfDate = input.asOfDate ?? input.periodEnd;
  assertDate(asOfDate, "asOfDate");
  if (!["profit_and_loss", "balance_sheet", "trial_balance"].includes(input.reportName)) {
    throw new ErpFinancialsError("invalid_input", `Unsupported financial statement ${input.reportName}`);
  }
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `select coalesce(mapping."book_account_key", account."source_id" || ':' || account."account_id") as "book_account_key",
  min(book_account."parent_book_account_key") as "parent_book_account_key",
  coalesce(min(book_account."account_number"), min(account."account_number")) as "account_number",
  coalesce(min(book_account."name"), min(account."name")) as "account_name",
  coalesce(min(book_account."classification"), min(account."classification")) as "classification",
  coalesce(sum(posting."debit_amount"), 0) as "debit_amount",
  coalesce(sum(posting."credit_amount"), 0) as "credit_amount",
  coalesce(sum(posting."net_amount"), 0) as "net_amount"
from "erp_financials"."accounts" account
join "erp_financials"."reporting_book_sources" source
  on source."tenant_id" = $1 and source."company_id" = $2 and source."book_id" = $3 and source."source_id" = account."source_id"
left join "erp_financials"."reporting_book_account_mappings" mapping
  on mapping."tenant_id" = $1 and mapping."company_id" = $2 and mapping."book_id" = $3
 and mapping."source_id" = account."source_id" and mapping."account_id" = account."account_id"
left join "erp_financials"."reporting_book_accounts" book_account
  on book_account."tenant_id" = $1 and book_account."company_id" = $2 and book_account."book_id" = $3
 and book_account."book_account_key" = mapping."book_account_key"
left join "erp_financials"."ledger_postings" posting
  on posting."tenant_id" = account."tenant_id" and posting."source_id" = account."source_id" and posting."account_id" = account."account_id"
 and posting."accounting_basis" = $4 and posting."currency_code" = $5
 and (($8 = 'profit_and_loss' and posting."posting_date" between $6::date and $7::date)
   or ($8 <> 'profit_and_loss' and posting."posting_date" <= $9::date))
 and (source."effective_from" is null or source."effective_from" <= posting."posting_date")
 and (source."effective_through" is null or source."effective_through" >= posting."posting_date")
where account."tenant_id" = $1 and coalesce(book_account."active", account."active")
  and (($8 = 'profit_and_loss' and coalesce(book_account."classification", account."classification") in ('income', 'cost_of_goods_sold', 'expense', 'other_income', 'other_expense'))
    or ($8 = 'balance_sheet' and coalesce(book_account."classification", account."classification") in ('asset', 'liability', 'equity'))
    or $8 = 'trial_balance')
group by coalesce(mapping."book_account_key", account."source_id" || ':' || account."account_id")
order by coalesce(min(book_account."account_number"), min(account."account_number")) nulls last,
  coalesce(min(book_account."name"), min(account."name")), "book_account_key"`,
      [scope.tenantId, scope.companyId, scope.bookId, book.accountingBasis, book.currencyCode,
        input.periodStart, input.periodEnd, input.reportName, asOfDate]
    );
    const defined = await client.query(
      `select "book_account_key", "parent_book_account_key", "account_number", "name" as "account_name", "classification"
from "erp_financials"."reporting_book_accounts"
where "tenant_id" = $1 and "company_id" = $2 and "book_id" = $3 and "active"
  and (($4 = 'profit_and_loss' and "classification" in ('income', 'cost_of_goods_sold', 'expense', 'other_income', 'other_expense'))
    or ($4 = 'balance_sheet' and "classification" in ('asset', 'liability', 'equity'))
    or $4 = 'trial_balance')
order by "account_number" nulls last, "name", "book_account_key"`,
      [scope.tenantId, scope.companyId, scope.bookId, input.reportName]
    );
    const direct = mergeBookStatementLines(result.rows.map(statementLineFromRow), defined.rows);
    const lines = rollupStatementLines(direct);
    return {
      reportName: input.reportName,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      asOfDate,
      accountingBasis: book.accountingBasis,
      currencyCode: book.currencyCode,
      lines,
      totals: statementTotals(input.reportName, lines)
    };
  });
}

async function getAging(
  scope: Scope,
  input: { readonly kind: "receivables" | "payables"; readonly asOfDate: IsoDate }
): Promise<AgingReport> {
  assertDate(input.asOfDate, "asOfDate");
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const documentType = input.kind === "receivables" ? "invoice" : "vendor_bill";
    const result = await client.query(
      `select document."party_id", party."display_name" as "party_name",
  coalesce(sum(document."open_amount") filter (where document."due_date" >= $6::date), 0) as "current_amount",
  coalesce(sum(document."open_amount") filter (where $6::date - document."due_date" between 1 and 30), 0) as "days_1_30",
  coalesce(sum(document."open_amount") filter (where $6::date - document."due_date" between 31 and 60), 0) as "days_31_60",
  coalesce(sum(document."open_amount") filter (where $6::date - document."due_date" between 61 and 90), 0) as "days_61_90",
  coalesce(sum(document."open_amount") filter (where $6::date - document."due_date" > 90), 0) as "days_over_90",
  sum(document."open_amount") as "total_amount"
from "erp_financials"."subledger_documents" document
join "erp_financials"."reporting_book_sources" source
  on source."tenant_id" = document."tenant_id" and source."company_id" = document."company_id"
 and source."book_id" = $3 and source."source_id" = document."source_id"
 and (source."effective_from" is null or source."effective_from" <= document."document_date")
 and (source."effective_through" is null or source."effective_through" >= document."document_date")
left join "erp_financials"."parties" party
  on party."tenant_id" = document."tenant_id" and party."source_id" = document."source_id" and party."party_id" = document."party_id"
where document."tenant_id" = $1 and document."company_id" = $2 and document."document_type" = $4
  and document."currency_code" = $5 and document."open_amount" > 0 and document."document_date" <= $6::date
group by document."party_id", party."display_name"
order by "total_amount" desc, document."party_id"`,
      [scope.tenantId, scope.companyId, scope.bookId, documentType, book.currencyCode, input.asOfDate]
    );
    const rows = result.rows.map(agingRowFromRow);
    return {
      kind: input.kind,
      asOfDate: input.asOfDate,
      currencyCode: book.currencyCode,
      rows,
      totals: rows.reduce(
        (total, row) => ({
          current: addMoney(total.current, row.current),
          days1To30: addMoney(total.days1To30, row.days1To30),
          days31To60: addMoney(total.days31To60, row.days31To60),
          days61To90: addMoney(total.days61To90, row.days61To90),
          daysOver90: addMoney(total.daysOver90, row.daysOver90),
          total: addMoney(total.total, row.total)
        }),
        { current: "0.00", days1To30: "0.00", days31To60: "0.00", days61To90: "0.00", daysOver90: "0.00", total: "0.00" }
      )
    };
  });
}

async function listBankReconciliation(
  scope: Scope,
  input: PageRequest & { readonly status?: BankReconciliationListItem["status"] }
): Promise<Page<BankReconciliationListItem>> {
  const page = pageInput(input, "bank-reconciliation", scope.bookId);
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `select line.*, match."transaction_id", match."method"
from "erp_financials"."bank_statement_lines" line
left join "erp_financials"."bank_reconciliation_matches" match
  on match."tenant_id" = line."tenant_id" and match."company_id" = line."company_id" and match."book_id" = line."book_id"
 and match."bank_statement_line_id" = line."bank_statement_line_id" and match."status" = 'matched'
where line."tenant_id" = $1 and line."company_id" = $2 and line."book_id" = $3 and line."currency_code" = $4
  and ($5::text is null or line."status" = $5)
  and ($6::date is null or (line."posted_date", line."bank_statement_line_id") < ($6::date, $7::text))
order by line."posted_date" desc, line."bank_statement_line_id" desc
limit $8`,
      [scope.tenantId, scope.companyId, scope.bookId, book.currencyCode, input.status, page.date, page.id, page.limit + 1]
    );
    return toPage(result.rows.map(bankLineFromRow), page.limit, "bank-reconciliation", scope.bookId, (item) => ({
      date: item.postedDate,
      id: item.bankStatementLineId
    }));
  });
}

async function getBankReconciliationSummary(scope: Scope): Promise<BankReconciliationSummary> {
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `select count(*) filter (where "status" = 'unmatched')::integer as "unmatched_count",
  count(*) filter (where "status" = 'matched')::integer as "matched_count",
  count(*) filter (where "status" = 'ignored')::integer as "ignored_count",
  coalesce(sum(abs("amount")) filter (where "status" = 'unmatched'), 0) as "unmatched_amount",
  coalesce(sum(abs("amount")) filter (where "status" = 'matched'), 0) as "matched_amount"
from "erp_financials"."bank_statement_lines"
where "tenant_id" = $1 and "company_id" = $2 and "book_id" = $3 and "currency_code" = $4`,
      [scope.tenantId, scope.companyId, scope.bookId, book.currencyCode]
    );
    const row = requiredRow(result.rows[0], "bank reconciliation summary");
    return {
      currencyCode: book.currencyCode,
      unmatchedCount: integer(row.unmatched_count, "unmatched_count"),
      matchedCount: integer(row.matched_count, "matched_count"),
      ignoredCount: integer(row.ignored_count, "ignored_count"),
      unmatchedAbsoluteAmount: money(row.unmatched_amount, "unmatched_amount"),
      matchedAbsoluteAmount: money(row.matched_amount, "matched_amount")
    };
  });
}

const JOURNAL_ENTRY_STATUSES: ReadonlySet<string> = new Set(["posted", "reversed", "voided", "corrected", "replaced"]);
const FISCAL_PERIOD_READ_STATUSES: ReadonlySet<string> = new Set(["open", "closing", "closed"]);

function journalEntryFilters(input: JournalEntryFilters): JournalEntryFilters {
  const sourceId = readFilterText(input.sourceId, "sourceId");
  const transactionType = readFilterText(input.transactionType, "transactionType");
  const preparerRef = readFilterText(input.preparerRef, "preparerRef");
  const search = readFilterText(input.search, "search", 100);
  if (input.status !== undefined && !JOURNAL_ENTRY_STATUSES.has(input.status)) {
    throw new ErpFinancialsError("invalid_input", "status is not a canonical journal-entry status");
  }
  if ((input.periodStart === undefined) !== (input.periodEnd === undefined)) {
    throw new ErpFinancialsError("invalid_input", "periodStart and periodEnd must be supplied together");
  }
  if (input.periodStart !== undefined && input.periodEnd !== undefined) {
    assertWindow(input.periodStart, input.periodEnd);
  }
  return {
    ...(sourceId === undefined ? {} : { sourceId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.periodStart === undefined ? {} : { periodStart: input.periodStart }),
    ...(input.periodEnd === undefined ? {} : { periodEnd: input.periodEnd }),
    ...(transactionType === undefined ? {} : { transactionType }),
    ...(preparerRef === undefined ? {} : { preparerRef }),
    ...(search === undefined ? {} : { search })
  };
}

function fiscalPeriodFilters(
  input: { readonly sourceId: string; readonly status?: FiscalPeriodReadModel["status"]; readonly fiscalYear?: number }
): { readonly sourceId: string; readonly status?: FiscalPeriodReadModel["status"]; readonly fiscalYear?: number } {
  const sourceId = assertReadFilterText(input.sourceId, "sourceId");
  if (input.status !== undefined && !FISCAL_PERIOD_READ_STATUSES.has(input.status)) {
    throw new ErpFinancialsError("invalid_input", "status is not a canonical fiscal-period status");
  }
  if (input.fiscalYear !== undefined && (!Number.isInteger(input.fiscalYear) || input.fiscalYear < 1)) {
    throw new ErpFinancialsError("invalid_input", "fiscalYear must be a positive integer");
  }
  return {
    sourceId,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.fiscalYear === undefined ? {} : { fiscalYear: input.fiscalYear })
  };
}

function readFilterText(value: string | undefined, field: string, max = 300): string | undefined {
  return value === undefined ? undefined : assertReadFilterText(value, field, max);
}

function assertReadFilterText(value: string, field: string, max = 300): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max) {
    throw new ErpFinancialsError("invalid_input", `${field} must contain between 1 and ${String(max)} characters`);
  }
  return normalized;
}

function readFilterFingerprint(filters: object): string {
  return createHash("sha256").update(JSON.stringify(filters)).digest("hex").slice(0, 20);
}

function journalEntryFromRow(row: Readonly<Record<string, unknown>>): JournalEntryListItem {
  const transactionNumber = optionalString(row.transaction_number);
  const memo = optionalString(row.memo);
  const sourcePayloadRef = row.source_payload_ref === null || row.source_payload_ref === undefined
    ? undefined
    : jsonObject(row.source_payload_ref, "source_payload_ref");
  const status = string(row.canonical_status, "canonical_status");
  if (!JOURNAL_ENTRY_STATUSES.has(status)) throw new Error("Stored canonical journal-entry status is invalid");
  return {
    journalEntryId: string(row.journal_entry_id, "journal_entry_id"),
    originalTransactionId: string(row.original_transaction_id, "original_transaction_id"),
    sourceId: string(row.source_id, "source_id"),
    ...(transactionNumber === undefined ? {} : { transactionNumber }),
    transactionDate: date(row.transaction_date, "transaction_date"),
    postedAt: isoDateTime(row.posted_at, "posted_at"),
    ...(memo === undefined ? {} : { memo }),
    currencyCode: string(row.currency_code, "currency_code"),
    accountingBasis: string(row.accounting_basis, "accounting_basis") as AccountingBasis,
    status: status as JournalEntryStatus,
    totalDebit: money(row.total_debit, "total_debit"),
    totalCredit: money(row.total_credit, "total_credit"),
    lineCount: integer(row.line_count, "line_count"),
    version: integer(row.version, "version"),
    sourceProvenance: {
      sourceId: string(row.source_id, "source_id"),
      sourceRole: reportingBookSourceRole(row.source_role),
      sourceSystem: string(row.source_system, "source_system"),
      providerEnvironment: string(row.provider_environment, "provider_environment"),
      sourceTransactionId: string(row.source_transaction_id, "source_transaction_id"),
      sourceTransactionType: string(row.source_transaction_type, "source_transaction_type"),
      ...sourceRefFields(sourcePayloadRef)
    },
    preparerProvenance: accountingLifecycleFromRow(row, "preparer")
  };
}

function journalEntryLineFromRow(row: Readonly<Record<string, unknown>>): JournalEntryLineReadModel {
  const accountNumber = optionalString(row.account_number);
  const partyId = optionalString(row.party_id);
  const itemId = optionalString(row.item_id);
  const description = optionalString(row.description);
  const dimensionRefs = row.dimension_refs === null || row.dimension_refs === undefined
    ? []
    : (typeof row.dimension_refs === "string" ? JSON.parse(row.dimension_refs) : row.dimension_refs) as JsonValue;
  return {
    transactionLineId: string(row.transaction_line_id, "transaction_line_id"),
    postingId: string(row.posting_id, "posting_id"),
    sourcePostingId: string(row.source_posting_id, "source_posting_id"),
    lineNumber: integer(row.line_number, "line_number"),
    account: {
      accountId: string(row.account_id, "account_id"),
      sourceAccountId: string(row.source_account_id, "source_account_id"),
      bookAccountKey: string(row.book_account_key, "book_account_key"),
      ...(accountNumber === undefined ? {} : { accountNumber }),
      accountName: string(row.account_name, "account_name"),
      classification: string(row.classification, "classification") as AccountClassification
    },
    ...(partyId === undefined ? {} : { partyId }),
    ...(itemId === undefined ? {} : { itemId }),
    ...(description === undefined ? {} : { description }),
    debitAmount: money(row.debit_amount, "debit_amount"),
    creditAmount: money(row.credit_amount, "credit_amount"),
    netAmount: money(row.net_amount, "net_amount"),
    dimensionRefs
  };
}

function assertBalancedJournalDetail(
  item: JournalEntryListItem,
  lines: readonly JournalEntryLineReadModel[]
): void {
  const debit = lines.reduce((sum, line) => sum + moneyMinor(line.debitAmount), 0n);
  const credit = lines.reduce((sum, line) => sum + moneyMinor(line.creditAmount), 0n);
  if (lines.length !== item.lineCount || debit !== credit || debit !== moneyMinor(item.totalDebit) ||
    credit !== moneyMinor(item.totalCredit)) {
    throw new ErpFinancialsError("posting_unbalanced", `Stored journal entry ${item.journalEntryId} is not exactly balanced`, {
      details: { journalEntryId: item.journalEntryId }
    });
  }
}

function journalEntryLinkFromRow(row: Readonly<Record<string, unknown>>): JournalEntryLifecycleLinkReadModel {
  const linkType = string(row.link_type, "link_type");
  if (!new Set<string>(["reversal", "void", "correction", "replacement"]).has(linkType)) {
    throw new Error("Stored journal-entry link type is invalid");
  }
  return {
    journalEntryLinkId: string(row.journal_entry_link_id, "journal_entry_link_id"),
    linkType: linkType as JournalEntryLifecycleLinkReadModel["linkType"],
    originalTransactionId: string(row.original_transaction_id, "original_transaction_id"),
    relatedTransactionId: string(row.related_transaction_id, "related_transaction_id"),
    createdAt: isoDateTime(row.created_at, "created_at"),
    lifecycle: accountingLifecycleFromRow(row)
  };
}

function fiscalPeriodFromRow(row: Readonly<Record<string, unknown>>): FiscalPeriodReadModel {
  const status = string(row.status, "status");
  if (!FISCAL_PERIOD_READ_STATUSES.has(status)) throw new Error("Stored fiscal-period status is invalid");
  const closeLifecycle = optionalString(row.close_event_id_read) === undefined
    ? undefined
    : accountingLifecycleFromRow(row, "close");
  const reopenLifecycle = optionalString(row.reopen_event_id_read) === undefined
    ? undefined
    : accountingLifecycleFromRow(row, "reopen");
  const closeEvidence = closeLifecycle === undefined ? undefined : fiscalCloseEvidenceFromPayload(row.close_payload);
  return {
    fiscalPeriodId: string(row.fiscal_period_id, "fiscal_period_id"),
    sourceId: string(row.source_id, "source_id"),
    fiscalYear: integer(row.fiscal_year, "fiscal_year"),
    periodNumber: integer(row.period_number, "period_number"),
    periodStart: date(row.period_start, "period_start"),
    periodEnd: date(row.period_end, "period_end"),
    status: status as FiscalPeriodReadModel["status"],
    version: integer(row.version, "version"),
    createdAt: isoDateTime(row.created_at, "created_at"),
    updatedAt: isoDateTime(row.updated_at, "updated_at"),
    ...(closeEvidence === undefined ? {} : { closeEvidence }),
    ...(closeLifecycle === undefined ? {} : { closeLifecycle }),
    ...(reopenLifecycle === undefined ? {} : { reopenLifecycle }),
    latestLifecycle: accountingLifecycleFromRow(row, "latest")
  };
}

function fiscalCloseEvidenceFromPayload(value: unknown): NonNullable<FiscalPeriodReadModel["closeEvidence"]> {
  const payload = jsonObject(value, "close_payload");
  if (!Array.isArray(payload.reconciliationRefs) || payload.reconciliationRefs.length === 0 ||
    payload.reconciliationRefs.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new Error("Stored fiscal close reconciliationRefs must be a non-empty string array");
  }
  return {
    trialBalanceSnapshotId: string(payload.trialBalanceSnapshotId, "trialBalanceSnapshotId"),
    reconciliationRefs: payload.reconciliationRefs as readonly string[],
    checklistRef: string(payload.checklistRef, "checklistRef"),
    postingMaxUpdatedAt: isoDateTime(payload.postingMaxUpdatedAt, "postingMaxUpdatedAt"),
    evidenceChecksum: string(payload.evidenceChecksum, "evidenceChecksum")
  };
}

function accountingLifecycleFromRow(
  row: Readonly<Record<string, unknown>>,
  prefix?: "preparer" | "close" | "reopen" | "latest"
): AccountingLifecycleProvenance {
  const field = (name: string): string => prefix === undefined ? name : `${prefix}_${name}`;
  const approverRef = optionalString(row[field("approver_ref")]);
  const reasonDetail = optionalString(row[field("reason_detail")]);
  const priorEventId = optionalString(row[field("prior_event_id")]);
  return {
    lifecycleEventId: string(row[field("event_id")], field("event_id")),
    eventType: string(row[field("event_type")], field("event_type")),
    actorRef: string(row[field("actor_ref")], field("actor_ref")),
    ...(approverRef === undefined ? {} : { approverRef }),
    requestId: string(row[field("request_id")], field("request_id")),
    correlationId: string(row[field("correlation_id")], field("correlation_id")),
    reasonCode: string(row[field("reason_code")], field("reason_code")),
    ...(reasonDetail === undefined ? {} : { reasonDetail }),
    occurredAt: isoDateTime(row[field("occurred_at")], field("occurred_at")),
    recordedAt: isoDateTime(row[field("recorded_at")], field("recorded_at")),
    payloadChecksum: string(row[field("payload_checksum")], field("payload_checksum")),
    ...(priorEventId === undefined ? {} : { priorEventId })
  };
}

async function resolveBook(client: PostgresQueryClient, scope: Scope): Promise<ResolvedBook> {
  const result = await client.query(
    `select "base_currency_code", "accounting_basis", "status"
from "erp_financials"."reporting_books"
where "tenant_id" = $1 and "company_id" = $2 and "book_id" = $3`,
    [scope.tenantId, scope.companyId, scope.bookId]
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ErpFinancialsError("missing_book", `Reporting book ${scope.bookId} does not exist`, {
      details: { bookId: scope.bookId }
    });
  }
  if (row.status !== "active") {
    throw new ErpFinancialsError("terminal_state_conflict", `Reporting book ${scope.bookId} is not active`, {
      details: { bookId: scope.bookId }
    });
  }
  return {
    currencyCode: string(row.base_currency_code, "base_currency_code"),
    accountingBasis: string(row.accounting_basis, "accounting_basis") as AccountingBasis
  };
}

function invoiceFromRow(row: Readonly<Record<string, unknown>>): InvoiceListItem {
  const provenance = string(row.provenance, "provenance") as InvoiceListItem["sourceProvenance"];
  const storedStatus = string(row.status, "status");
  const status = provenance === "draft" && storedStatus === "voided" ? "voided" : storedStatus;
  const partyName = optionalString(row.party_name);
  const documentNumber = optionalString(row.document_number);
  return {
    invoiceId: string(row.invoice_id, "invoice_id"),
    sourceId: string(row.source_id, "source_id"),
    sourceProvenance: provenance,
    customerId: string(row.party_id, "party_id"),
    ...(partyName === undefined ? {} : { customerName: partyName }),
    ...(documentNumber === undefined ? {} : { documentNumber }),
    documentDate: date(row.document_date, "document_date"),
    dueDate: date(row.due_date, "due_date"),
    currencyCode: string(row.currency_code, "currency_code"),
    originalAmount: money(row.original_amount, "original_amount"),
    openAmount: money(row.open_amount, "open_amount"),
    status: status as InvoiceListStatus,
    version: integer(row.version, "version")
  };
}

function invoiceDeliveryFromRow(row: Readonly<Record<string, unknown>>): InvoiceDeliveryEvent {
  const recipientRef = optionalString(row.recipient_ref);
  return {
    deliveryEventId: string(row.delivery_event_id, "delivery_event_id"),
    invoiceId: string(row.invoice_id, "invoice_id"),
    status: string(row.delivery_status, "delivery_status") as InvoiceDeliveryEvent["status"],
    channel: string(row.channel, "channel"),
    ...(recipientRef === undefined ? {} : { recipientRef }),
    occurredAt: isoDateTime(row.occurred_at, "occurred_at"),
    lifecycleEventId: string(row.lifecycle_event_id, "lifecycle_event_id")
  };
}

function vendorBillFromRow(row: Readonly<Record<string, unknown>>): VendorBillListItem {
  const vendorName = optionalString(row.party_name);
  const documentNumber = optionalString(row.document_number);
  return {
    billId: string(row.bill_id, "bill_id"),
    sourceId: string(row.source_id, "source_id"),
    sourceProvenance: "posted",
    transactionId: string(row.transaction_id, "transaction_id"),
    vendorId: string(row.party_id, "party_id"),
    ...(vendorName === undefined ? {} : { vendorName }),
    ...(documentNumber === undefined ? {} : { documentNumber }),
    documentDate: date(row.document_date, "document_date"),
    dueDate: date(row.due_date, "due_date"),
    currencyCode: string(row.currency_code, "currency_code"),
    originalAmount: money(row.original_amount, "original_amount"),
    openAmount: money(row.open_amount, "open_amount"),
    status: string(row.status, "status") as VendorBillStatus,
    version: integer(row.version, "version")
  };
}

function vendorBillLineFromRow(row: Readonly<Record<string, unknown>>): VendorBillLineReadModel {
  const line = commercialLineFromRow(row);
  const sourceItemId = optionalString(row.source_item_id);
  const itemName = optionalString(row.item_name);
  const itemCategoryAccountId = optionalString(row.item_expense_account_id);
  const bookAccountKey = optionalString(row.book_account_key);
  const accountMappingId = optionalString(row.book_account_mapping_id);
  const sourceAccountId = optionalString(row.source_account_id);
  const sourceId = string(row.source_id, "source_id");
  return {
    ...line,
    sourceAccountKey: sourceAccountId ?? `${sourceId}:${line.accountId}`,
    ...(bookAccountKey === undefined ? {} : { bookAccountKey }),
    accountMappingProvenance: accountMappingId === undefined ? "source_account" : "reporting_book_mapping",
    ...(accountMappingId === undefined ? {} : { accountMappingId }),
    ...(sourceItemId === undefined ? {} : { sourceItemId }),
    ...(itemName === undefined ? {} : { itemName }),
    ...(itemCategoryAccountId === undefined ? {} : { itemCategoryAccountId }),
    categoryMappingProvenance: line.itemId === undefined
      ? "uncategorized"
      : itemCategoryAccountId === line.accountId
        ? "item_expense_account"
        : "line_account_override"
  };
}

function vendorBillApplicationFromRow(
  row: Readonly<Record<string, unknown>>
): VendorBillApplicationReadModel {
  return {
    applicationId: string(row.application_id, "application_id"),
    sourcePaymentId: string(row.source_payment_id, "source_payment_id"),
    applicationDate: date(row.application_date, "application_date"),
    amount: money(row.applied_amount, "applied_amount"),
    status: string(row.status, "status") as VendorBillApplicationReadModel["status"],
    version: integer(row.version, "version")
  };
}

function paymentFromRow(row: Readonly<Record<string, unknown>>): PaymentListItem {
  const amount = money(row.original_amount, "original_amount");
  const unapplied = money(row.open_amount, "open_amount");
  const storedStatus = optionalString(row.payment_status);
  const partyName = optionalString(row.party_name);
  const documentNumber = optionalString(row.document_number);
  return {
    paymentId: string(row.payment_id, "payment_id"),
    sourceId: string(row.source_id, "source_id"),
    paymentType: string(row.document_type, "document_type") as PaymentListItem["paymentType"],
    transactionId: string(row.transaction_id, "transaction_id"),
    partyId: string(row.party_id, "party_id"),
    ...(partyName === undefined ? {} : { partyName }),
    ...(documentNumber === undefined ? {} : { documentNumber }),
    paymentDate: date(row.document_date, "document_date"),
    currencyCode: string(row.currency_code, "currency_code"),
    amount,
    unappliedAmount: unapplied,
    status: storedStatus === undefined
      ? unapplied === "0.00" ? "applied" : unapplied === amount ? "unapplied" : "partial"
      : storedStatus as PaymentStatus,
    version: integer(row.version, "version"),
    lifecycleEventId: string(row.lifecycle_event_id, "lifecycle_event_id"),
    matchedApplicationCount: integer(row.application_count, "application_count")
  };
}

function billPaymentFromRow(row: Readonly<Record<string, unknown>>): BillPaymentListItem {
  const vendorName = optionalString(row.vendor_name);
  const documentNumber = optionalString(row.document_number);
  const paymentMethodValue = optionalString(row.payment_method);
  if (paymentMethodValue !== undefined && !BILL_PAYMENT_METHODS.has(paymentMethodValue as BillPaymentMethod)) {
    throw new Error(`Stored bill payment method ${paymentMethodValue} is invalid`);
  }
  const reference = optionalString(row.payment_reference);
  const fundingAccountId = optionalString(row.funding_account_id);
  const payableAccountId = optionalString(row.payable_account_id);
  const transactionId = optionalString(row.transaction_id);
  const unappliedAmount = row.unapplied_amount == null ? undefined : money(row.unapplied_amount, "unapplied_amount");
  const documentVersion = optionalInteger(row.document_version, "document_version");
  const lifecycleEventId = optionalString(row.lifecycle_event_id);
  const applicationStatusValue = optionalString(row.application_status);
  if (applicationStatusValue !== undefined && !PAYMENT_STATUSES.has(applicationStatusValue as PaymentStatus)) {
    throw new Error(`Stored bill payment application status ${applicationStatusValue} is invalid`);
  }
  return {
    paymentId: string(row.payment_id, "payment_id"),
    sourceId: string(row.source_id, "source_id"),
    paymentType: "bill_payment",
    vendorId: string(row.vendor_id, "vendor_id"),
    partyId: string(row.vendor_id, "vendor_id"),
    ...(vendorName === undefined ? {} : { vendorName }),
    ...(vendorName === undefined ? {} : { partyName: vendorName }),
    ...(documentNumber === undefined ? {} : { documentNumber }),
    paymentDate: date(row.payment_date, "payment_date"),
    currencyCode: string(row.currency_code, "currency_code"),
    amount: money(row.amount, "amount"),
    status: string(row.status, "status") as BillPaymentLifecycleStatus,
    version: integer(row.version, "version"),
    ...(paymentMethodValue === undefined ? {} : { paymentMethod: paymentMethodValue as BillPaymentMethod }),
    ...(reference === undefined ? {} : { reference }),
    ...(fundingAccountId === undefined ? {} : { fundingAccountId }),
    ...(payableAccountId === undefined ? {} : { payableAccountId }),
    ...(transactionId === undefined ? {} : { transactionId }),
    ...(unappliedAmount === undefined ? {} : { unappliedAmount }),
    ...(documentVersion === undefined ? {} : { documentVersion }),
    ...(lifecycleEventId === undefined ? {} : { lifecycleEventId }),
    ...(applicationStatusValue === undefined ? {} : { applicationStatus: applicationStatusValue as PaymentStatus }),
    matchedApplicationCount: integer(row.application_count, "application_count")
  };
}

function orderBillPaymentApplications(
  applications: readonly PaymentApplicationListItem[],
  allocationsValue: unknown
): readonly PaymentApplicationListItem[] {
  if (allocationsValue === null || allocationsValue === undefined) return applications;
  const parsed = typeof allocationsValue === "string" ? JSON.parse(allocationsValue) as unknown : allocationsValue;
  if (!Array.isArray(parsed)) throw new Error("Stored bill payment allocations must be an array");
  const order = new Map<string, number>();
  parsed.forEach((allocation, index) => {
    if (typeof allocation === "object" && allocation !== null && !Array.isArray(allocation)) {
      const billId = optionalString((allocation as Readonly<Record<string, unknown>>).billId);
      if (billId !== undefined) order.set(billId, index);
    }
  });
  return [...applications].sort((left, right) =>
    (order.get(left.targetDocumentId) ?? Number.MAX_SAFE_INTEGER) -
    (order.get(right.targetDocumentId) ?? Number.MAX_SAFE_INTEGER)
  );
}

function accountEvidenceFromRow(
  row: Readonly<Record<string, unknown>>,
  prefix: "funding" | "payable"
): BillPaymentAccountEvidence | undefined {
  const accountId = optionalString(row[`${prefix}_account_id`]);
  if (accountId === undefined) return undefined;
  const postingId = optionalString(row[`${prefix}_posting_id`]);
  const debitAmount = row[`${prefix}_debit_amount`] == null
    ? undefined
    : money(row[`${prefix}_debit_amount`], `${prefix}_debit_amount`);
  const creditAmount = row[`${prefix}_credit_amount`] == null
    ? undefined
    : money(row[`${prefix}_credit_amount`], `${prefix}_credit_amount`);
  return {
    accountId,
    ...(postingId === undefined ? {} : { postingId }),
    ...(debitAmount === undefined ? {} : { debitAmount }),
    ...(creditAmount === undefined ? {} : { creditAmount })
  };
}

function paymentApplicationFromRow(row: Readonly<Record<string, unknown>>): PaymentApplicationListItem {
  const endedLifecycleEventId = optionalString(row.ended_event_id);
  const matchCandidateId = optionalString(row.match_candidate_id);
  const evidence = optionalJson(row.match_evidence);
  const matchProvenance = matchCandidateId === undefined ? undefined : {
    matchCandidateId,
    matchDecisionId: string(row.match_decision_id, "match_decision_id"),
    method: string(row.match_method, "match_method") as PaymentApplicationMatchProvenance["method"],
    score: decimal(row.match_score, "match_score"),
    ...(evidence === undefined ? {} : { evidence })
  };
  return {
    applicationId: string(row.application_id, "application_id"),
    sourceId: string(row.source_id, "source_id"),
    applicationType: string(row.application_type, "application_type") as PaymentApplicationListItem["applicationType"],
    status: string(row.status, "status") as PaymentApplicationListItem["status"],
    version: integer(row.version, "version"),
    applicationDate: date(row.application_date, "application_date"),
    sourcePaymentId: string(row.source_payment_id, "source_payment_id"),
    targetDocumentId: string(row.target_document_id, "target_document_id"),
    amount: money(row.applied_amount, "applied_amount"),
    currencyCode: string(row.currency_code, "currency_code"),
    appliedLifecycleEventId: string(row.applied_event_id, "applied_event_id"),
    ...(endedLifecycleEventId === undefined ? {} : { endedLifecycleEventId }),
    ...(matchProvenance === undefined ? {} : { matchProvenance })
  };
}

function writeOffFromRow(row: Readonly<Record<string, unknown>>): WriteOffListItem {
  const metadata = requiredObjectProperty(row.metadata, "writeOffProvenance");
  const customerName = optionalString(row.party_name);
  const documentNumber = optionalString(row.document_number);
  const relatedInvoiceId = optionalString(metadata.relatedInvoiceId);
  const reason = optionalString(metadata.reason);
  const reversalTransactionId = optionalString(row.reversal_transaction_id);
  const replacementWriteOffId = optionalString(row.replacement_write_off_id);
  const replacesWriteOffId = optionalString(row.replaces_write_off_id);
  return {
    writeOffId: string(row.write_off_id, "write_off_id"),
    sourceId: string(row.source_id, "source_id"),
    transactionId: string(row.transaction_id, "transaction_id"),
    customerId: string(row.party_id, "party_id"),
    ...(customerName === undefined ? {} : { customerName }),
    ...(relatedInvoiceId === undefined ? {} : { relatedInvoiceId }),
    ...(documentNumber === undefined ? {} : { documentNumber }),
    writeOffDate: date(row.document_date, "document_date"),
    currencyCode: string(row.currency_code, "currency_code"),
    amount: money(row.original_amount, "original_amount"),
    status: string(row.status, "status") as WriteOffListItem["status"],
    version: integer(row.version, "version"),
    ...(reason === undefined ? {} : { reason }),
    ...(reversalTransactionId === undefined ? {} : { reversalTransactionId }),
    ...(replacementWriteOffId === undefined ? {} : { replacementWriteOffId }),
    ...(replacesWriteOffId === undefined ? {} : { replacesWriteOffId })
  };
}

function adjustmentFromRow(row: Readonly<Record<string, unknown>>): AdjustmentListItem {
  const customerName = optionalString(row.party_name);
  const documentNumber = optionalString(row.document_number);
  const reversalTransactionId = optionalString(row.reversal_transaction_id);
  const replacementAdjustmentId = optionalString(row.replacement_adjustment_id);
  const replacesAdjustmentId = optionalString(row.replaces_adjustment_id);
  return {
    adjustmentId: string(row.adjustment_id, "adjustment_id"),
    sourceId: string(row.source_id, "source_id"),
    transactionId: string(row.transaction_id, "transaction_id"),
    adjustmentType: string(row.adjustment_type, "adjustment_type") as AdjustmentType,
    customerId: string(row.party_id, "party_id"),
    ...(customerName === undefined ? {} : { customerName }),
    ...(documentNumber === undefined ? {} : { documentNumber }),
    adjustmentDate: date(row.document_date, "document_date"),
    currencyCode: string(row.currency_code, "currency_code"),
    originalAmount: money(row.original_amount, "original_amount"),
    remainingAmount: money(row.open_amount, "open_amount"),
    status: string(row.status, "status") as AdjustmentStatus,
    version: integer(row.version, "version"),
    ...(reversalTransactionId === undefined ? {} : { reversalTransactionId }),
    ...(replacementAdjustmentId === undefined ? {} : { replacementAdjustmentId }),
    ...(replacesAdjustmentId === undefined ? {} : { replacesAdjustmentId })
  };
}

function adjustmentPostingFromRow(row: Readonly<Record<string, unknown>>): AdjustmentPostingReadModel {
  const itemId = optionalString(row.item_id);
  const description = optionalString(row.description);
  const dimensionRefs = typeof row.dimension_refs === "string"
    ? JSON.parse(row.dimension_refs) as JsonValue
    : row.dimension_refs as JsonValue;
  return {
    postingId: string(row.posting_id, "posting_id"),
    accountId: string(row.account_id, "account_id"),
    bookAccountKey: string(row.book_account_key, "book_account_key"),
    accountName: string(row.account_name, "account_name"),
    ...(itemId === undefined ? {} : { itemId }),
    ...(description === undefined ? {} : { description }),
    debitAmount: money(row.debit_amount, "debit_amount"),
    creditAmount: money(row.credit_amount, "credit_amount"),
    currencyCode: string(row.currency_code, "currency_code"),
    dimensionRefs
  };
}

function adjustmentApplicationFromRow(row: Readonly<Record<string, unknown>>): AdjustmentApplicationReadModel {
  return {
    applicationId: string(row.application_id, "application_id"),
    invoiceId: string(row.invoice_id, "invoice_id"),
    applicationDate: date(row.application_date, "application_date"),
    amount: money(row.applied_amount, "applied_amount"),
    status: string(row.status, "status") as AdjustmentApplicationReadModel["status"],
    version: integer(row.version, "version")
  };
}

function ledgerLineFromRow(row: Readonly<Record<string, unknown>>): GeneralLedgerLine {
  const dimensions = generalLedgerDimensions(row.dimension_refs);
  const sourcePayloadRef = optionalRecord(row.source_payload_ref, "source_payload_ref");
  const optionalFields = {
    transactionNumber: optionalString(row.transaction_number),
    accountNumber: optionalString(row.account_number),
    partyId: optionalString(row.party_id),
    itemId: optionalString(row.item_id),
    description: optionalString(row.description)
  };
  return {
    postingId: string(row.posting_id, "posting_id"),
    sourceId: string(row.source_id, "source_id"),
    transactionId: string(row.transaction_id, "transaction_id"),
    ...(optionalFields.transactionNumber === undefined ? {} : { transactionNumber: optionalFields.transactionNumber }),
    transactionDate: date(row.transaction_date, "transaction_date"),
    postingDate: date(row.posting_date, "posting_date"),
    transactionType: boundedStoredString(row.source_transaction_type, "source_transaction_type", 200),
    accountId: string(row.account_id, "account_id"),
    bookAccountKey: string(row.book_account_key, "book_account_key"),
    ...(optionalFields.accountNumber === undefined ? {} : { accountNumber: optionalFields.accountNumber }),
    accountName: string(row.account_name, "account_name"),
    ...(optionalFields.partyId === undefined ? {} : { partyId: optionalFields.partyId }),
    ...(optionalFields.itemId === undefined ? {} : { itemId: optionalFields.itemId }),
    ...(optionalFields.description === undefined ? {} : { description: optionalFields.description }),
    debitAmount: money(row.debit_amount, "debit_amount"),
    creditAmount: money(row.credit_amount, "credit_amount"),
    netAmount: money(row.net_amount, "net_amount"),
    currencyCode: string(row.currency_code, "currency_code"),
    dimensions: dimensions.slice(0, GENERAL_LEDGER_MAX_DIMENSIONS),
    omittedDimensionCount: Math.max(0, dimensions.length - GENERAL_LEDGER_MAX_DIMENSIONS),
    sourceProvenance: {
      sourceId: string(row.source_id, "source_id"),
      sourceRole: reportingBookSourceRole(row.source_role),
      sourceSystem: boundedStoredString(row.source_system, "source_system", 200),
      providerEnvironment: boundedStoredString(row.provider_environment, "provider_environment", 100),
      sourceTransactionType: boundedStoredString(row.source_transaction_type, "source_transaction_type", 200),
      sourceTransactionId: boundedStoredString(row.source_transaction_id, "source_transaction_id", 300),
      sourcePostingId: boundedStoredString(row.source_posting_id, "source_posting_id", 300),
      ...sourceRefFields(sourcePayloadRef)
    }
  };
}

const GENERAL_LEDGER_MAX_FILTER_TEXT = 200;
const GENERAL_LEDGER_MAX_SEARCH_TEXT = 100;
const GENERAL_LEDGER_MAX_DIMENSIONS = 20;
const GENERAL_LEDGER_MAX_PROVENANCE_TEXT = 300;

type ValidatedGeneralLedgerFilters = GeneralLedgerFilters;

function generalLedgerFilters(input: GeneralLedgerFilters): ValidatedGeneralLedgerFilters {
  assertWindow(input.periodStart, input.periodEnd);
  const accountKey = ledgerFilterText(input.accountKey, "accountKey");
  const sourceId = ledgerFilterText(input.sourceId, "sourceId");
  const transactionType = ledgerFilterText(input.transactionType, "transactionType");
  const classId = ledgerFilterText(input.classId, "classId");
  const dimensionKind = ledgerFilterText(input.dimensionKind, "dimensionKind");
  const dimensionId = ledgerFilterText(input.dimensionId, "dimensionId");
  if ((dimensionKind === undefined) !== (dimensionId === undefined)) {
    throw new ErpFinancialsError("invalid_input", "dimensionKind and dimensionId must be supplied together");
  }
  if (input.polarity !== undefined && !new Set<string>(["debit", "credit"]).has(input.polarity)) {
    throw new ErpFinancialsError("invalid_input", "polarity must be debit or credit");
  }
  const search = ledgerFilterText(input.search, "search", GENERAL_LEDGER_MAX_SEARCH_TEXT);
  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    ...(accountKey === undefined ? {} : { accountKey }),
    ...(sourceId === undefined ? {} : { sourceId }),
    ...(transactionType === undefined ? {} : { transactionType }),
    ...(classId === undefined ? {} : { classId }),
    ...(dimensionKind === undefined ? {} : { dimensionKind }),
    ...(dimensionId === undefined ? {} : { dimensionId }),
    ...(input.polarity === undefined ? {} : { polarity: input.polarity }),
    ...(search === undefined ? {} : { search })
  };
}

function ledgerFilterText(value: string | undefined, field: string, max = GENERAL_LEDGER_MAX_FILTER_TEXT): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max) {
    throw new ErpFinancialsError("invalid_input", `${field} must contain between 1 and ${String(max)} characters`);
  }
  return normalized;
}

function generalLedgerFilterFingerprint(filters: ValidatedGeneralLedgerFilters): string {
  return createHash("sha256").update(JSON.stringify(filters)).digest("hex").slice(0, 20);
}

function generalLedgerDimensions(value: unknown): readonly GeneralLedgerDimensionProvenance[] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (parsed === null || parsed === undefined) return [];
  if (!Array.isArray(parsed)) throw new Error("Stored dimension_refs must be an array");
  return parsed.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Stored dimension_refs[${String(index)}] must be an object`);
    const dimensionKind = boundedStoredString(entry.dimensionKind, `dimension_refs[${String(index)}].dimensionKind`, 200);
    const dimensionId = optionalBoundedStoredString(entry.dimensionId, `dimension_refs[${String(index)}].dimensionId`);
    const sourceDimensionId = optionalBoundedStoredString(entry.sourceDimensionId, `dimension_refs[${String(index)}].sourceDimensionId`);
    const name = optionalBoundedStoredString(entry.name, `dimension_refs[${String(index)}].name`);
    return {
      dimensionKind,
      ...(dimensionId === undefined ? {} : { dimensionId }),
      ...(sourceDimensionId === undefined ? {} : { sourceDimensionId }),
      ...(name === undefined ? {} : { name })
    };
  });
}

function sourceRefFields(value: Readonly<Record<string, unknown>> | undefined): Partial<GeneralLedgerSourceProvenance> {
  if (value === undefined) return {};
  const sourceObjectType = optionalBoundedStoredString(value.sourceObjectType, "source_payload_ref.sourceObjectType");
  const sourceObjectId = optionalBoundedStoredString(value.sourceObjectId, "source_payload_ref.sourceObjectId");
  const checksum = optionalBoundedStoredString(value.checksum, "source_payload_ref.checksum");
  const sourceUpdatedAtValue = optionalString(value.sourceUpdatedAt);
  if (sourceUpdatedAtValue !== undefined && Number.isNaN(Date.parse(sourceUpdatedAtValue))) {
    throw new Error("Stored source_payload_ref.sourceUpdatedAt must be a date-time");
  }
  return {
    ...(sourceObjectType === undefined ? {} : { sourceObjectType }),
    ...(sourceObjectId === undefined ? {} : { sourceObjectId }),
    ...(sourceUpdatedAtValue === undefined ? {} : { sourceUpdatedAt: sourceUpdatedAtValue }),
    ...(checksum === undefined ? {} : { checksum })
  };
}

function optionalRecord(value: unknown, field: string): Readonly<Record<string, unknown>> | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!isRecord(parsed)) throw new Error(`Stored ${field} must be an object`);
  return parsed;
}

function boundedStoredString(value: unknown, field: string, max = GENERAL_LEDGER_MAX_PROVENANCE_TEXT): string {
  const result = string(value, field);
  if (result.length > max) throw new Error(`Stored ${field} exceeds the public ${String(max)} character bound`);
  return result;
}

function optionalBoundedStoredString(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  return boundedStoredString(value, field);
}

function reportingBookSourceRole(value: unknown): GeneralLedgerSourceProvenance["sourceRole"] {
  if (value !== "historical" && value !== "active" && value !== "adjustment") {
    throw new Error("Stored source_role must be historical, active, or adjustment");
  }
  return value;
}

function chartAccountFromRow(row: Readonly<Record<string, unknown>>, currencyCode: IsoCurrencyCode): ChartOfAccountsItem {
  const accountNumber = optionalString(row.account_number);
  const type = optionalString(row.account_type);
  const subtype = optionalString(row.account_subtype);
  const accountRole = optionalReportingBookAccountRole(row.account_role);
  const version = optionalInteger(row.version, "version");
  const parentBookAccountKey = optionalString(row.parent_book_account_key);
  if (!Array.isArray(row.source_account_ids) || !row.source_account_ids.every((value) => typeof value === "string")) {
    throw new Error("Stored source_account_ids must be an array of strings");
  }
  return {
    bookAccountKey: string(row.book_account_key, "book_account_key"),
    sourceAccountIds: row.source_account_ids,
    ...(accountNumber === undefined ? {} : { accountNumber }),
    name: string(row.account_name, "account_name"),
    classification: string(row.classification, "classification") as AccountClassification,
    ...(type === undefined ? {} : { type }),
    ...(subtype === undefined ? {} : { subtype }),
    ...(accountRole === undefined ? {} : { accountRole }),
    ...(version === undefined ? {} : { version }),
    ...(parentBookAccountKey === undefined ? {} : { parentBookAccountKey }),
    active: row.active === true,
    debitAmount: money(row.debit_amount, "debit_amount"),
    creditAmount: money(row.credit_amount, "credit_amount"),
    directBalance: money(row.balance, "balance"),
    balance: money(row.balance, "balance"),
    currencyCode
  };
}

function mergeBookChartAccounts(
  sourceAccounts: readonly ChartOfAccountsItem[],
  bookRows: readonly Readonly<Record<string, unknown>>[],
  currencyCode: IsoCurrencyCode
): readonly ChartOfAccountsItem[] {
  const remaining = new Map(sourceAccounts.map((account) => [account.bookAccountKey, account]));
  const canonical = bookRows.map((row): ChartOfAccountsItem => {
    const bookAccountKey = string(row.book_account_key, "book_account_key");
    const source = remaining.get(bookAccountKey);
    remaining.delete(bookAccountKey);
    const accountNumber = optionalString(row.account_number);
    const type = optionalString(row.account_type);
    const subtype = optionalString(row.account_subtype);
    const accountRole = optionalReportingBookAccountRole(row.account_role);
    const version = optionalInteger(row.version, "version");
    const parentBookAccountKey = optionalString(row.parent_book_account_key);
    return {
      bookAccountKey,
      sourceAccountIds: source?.sourceAccountIds ?? [],
      ...(accountNumber === undefined ? {} : { accountNumber }),
      name: string(row.account_name, "account_name"),
      classification: string(row.classification, "classification") as AccountClassification,
      ...(type === undefined ? {} : { type }),
      ...(subtype === undefined ? {} : { subtype }),
      ...(accountRole === undefined ? {} : { accountRole }),
      ...(version === undefined ? {} : { version }),
      ...(parentBookAccountKey === undefined ? {} : { parentBookAccountKey }),
      active: row.active === true,
      debitAmount: source?.debitAmount ?? "0.00",
      creditAmount: source?.creditAmount ?? "0.00",
      directBalance: source?.directBalance ?? "0.00",
      balance: source?.directBalance ?? "0.00",
      currencyCode
    };
  });
  return [...canonical, ...remaining.values()];
}

function rollupChartAccounts(accounts: readonly ChartOfAccountsItem[]): readonly ChartOfAccountsItem[] {
  const byKey = new Map(accounts.map((account) => [account.bookAccountKey, account]));
  const children = new Map<string, ChartOfAccountsItem[]>();
  for (const account of accounts) {
    if (account.parentBookAccountKey !== undefined && byKey.has(account.parentBookAccountKey)) {
      const entries = children.get(account.parentBookAccountKey) ?? [];
      entries.push(account);
      children.set(account.parentBookAccountKey, entries);
    }
  }
  const memo = new Map<string, Pick<ChartOfAccountsItem, "debitAmount" | "creditAmount" | "balance">>();
  const visit = (account: ChartOfAccountsItem, path: ReadonlySet<string>): Pick<ChartOfAccountsItem, "debitAmount" | "creditAmount" | "balance"> => {
    const cached = memo.get(account.bookAccountKey);
    if (cached !== undefined) return cached;
    if (path.has(account.bookAccountKey)) throw new ErpFinancialsError("invalid_account_hierarchy", "Reporting-book account hierarchy contains a cycle");
    const nextPath = new Set(path).add(account.bookAccountKey);
    const total = (children.get(account.bookAccountKey) ?? []).reduce(
      (current, child) => {
        const childTotal = visit(child, nextPath);
        return {
          debitAmount: addMoney(current.debitAmount, childTotal.debitAmount),
          creditAmount: addMoney(current.creditAmount, childTotal.creditAmount),
          balance: addMoney(current.balance, childTotal.balance)
        };
      },
      { debitAmount: account.debitAmount, creditAmount: account.creditAmount, balance: account.directBalance }
    );
    memo.set(account.bookAccountKey, total);
    return total;
  };
  return accounts.map((account) => ({ ...account, ...visit(account, new Set()) }));
}

function statementLineFromRow(row: Readonly<Record<string, unknown>>): FinancialStatementLine {
  const classification = string(row.classification, "classification") as AccountClassification;
  const net = money(row.net_amount, "net_amount");
  const amount = ["liability", "equity", "income", "other_income"].includes(classification)
    ? minorMoney(-moneyMinor(net))
    : net;
  const parentBookAccountKey = optionalString(row.parent_book_account_key);
  const accountNumber = optionalString(row.account_number);
  return {
    bookAccountKey: string(row.book_account_key, "book_account_key"),
    ...(parentBookAccountKey === undefined ? {} : { parentBookAccountKey }),
    ...(accountNumber === undefined ? {} : { accountNumber }),
    name: string(row.account_name, "account_name"),
    classification,
    directAmount: amount,
    amount,
    debitAmount: money(row.debit_amount, "debit_amount"),
    creditAmount: money(row.credit_amount, "credit_amount")
  };
}

function mergeBookStatementLines(
  sourceLines: readonly FinancialStatementLine[],
  bookRows: readonly Readonly<Record<string, unknown>>[]
): readonly FinancialStatementLine[] {
  const remaining = new Map(sourceLines.map((line) => [line.bookAccountKey, line]));
  const canonical = bookRows.map((row): FinancialStatementLine => {
    const bookAccountKey = string(row.book_account_key, "book_account_key");
    const source = remaining.get(bookAccountKey);
    remaining.delete(bookAccountKey);
    if (source !== undefined) return source;
    const parentBookAccountKey = optionalString(row.parent_book_account_key);
    const accountNumber = optionalString(row.account_number);
    return {
      bookAccountKey,
      ...(parentBookAccountKey === undefined ? {} : { parentBookAccountKey }),
      ...(accountNumber === undefined ? {} : { accountNumber }),
      name: string(row.account_name, "account_name"),
      classification: string(row.classification, "classification") as AccountClassification,
      directAmount: "0.00",
      amount: "0.00",
      debitAmount: "0.00",
      creditAmount: "0.00"
    };
  });
  return [...canonical, ...remaining.values()];
}

function rollupStatementLines(lines: readonly FinancialStatementLine[]): readonly FinancialStatementLine[] {
  const byKey = new Map(lines.map((line) => [line.bookAccountKey, line]));
  const children = new Map<string, FinancialStatementLine[]>();
  for (const line of lines) {
    if (line.parentBookAccountKey !== undefined && byKey.has(line.parentBookAccountKey)) {
      const entries = children.get(line.parentBookAccountKey) ?? [];
      entries.push(line);
      children.set(line.parentBookAccountKey, entries);
    }
  }
  const memo = new Map<string, Pick<FinancialStatementLine, "amount" | "debitAmount" | "creditAmount">>();
  const visit = (line: FinancialStatementLine, path: ReadonlySet<string>): Pick<FinancialStatementLine, "amount" | "debitAmount" | "creditAmount"> => {
    const cached = memo.get(line.bookAccountKey);
    if (cached !== undefined) return cached;
    if (path.has(line.bookAccountKey)) throw new ErpFinancialsError("invalid_account_hierarchy", "Reporting-book account hierarchy contains a cycle");
    const nextPath = new Set(path).add(line.bookAccountKey);
    const total = (children.get(line.bookAccountKey) ?? []).reduce(
      (current, child) => {
        const childTotal = visit(child, nextPath);
        return {
          amount: addMoney(current.amount, childTotal.amount),
          debitAmount: addMoney(current.debitAmount, childTotal.debitAmount),
          creditAmount: addMoney(current.creditAmount, childTotal.creditAmount)
        };
      },
      { amount: line.directAmount, debitAmount: line.debitAmount, creditAmount: line.creditAmount }
    );
    memo.set(line.bookAccountKey, total);
    return total;
  };
  return lines.map((line) => ({ ...line, ...visit(line, new Set()) }));
}

function statementTotals(
  reportName: FinancialStatementName,
  lines: readonly FinancialStatementLine[]
): Readonly<Record<string, DecimalString>> {
  const known = new Set(lines.map((line) => line.bookAccountKey));
  const roots = lines.filter((line) => line.parentBookAccountKey === undefined || !known.has(line.parentBookAccountKey));
  const totalFor = (classifications: readonly AccountClassification[]) => roots
    .filter((line) => classifications.includes(line.classification))
    .reduce((total, line) => addMoney(total, line.amount), "0.00");
  if (reportName === "profit_and_loss") {
    const income = totalFor(["income", "other_income"]);
    const costOfGoodsSold = totalFor(["cost_of_goods_sold"]);
    const expenses = totalFor(["expense", "other_expense"]);
    return {
      income,
      costOfGoodsSold,
      grossProfit: subtractMoney(income, costOfGoodsSold),
      expenses,
      netIncome: subtractMoney(subtractMoney(income, costOfGoodsSold), expenses)
    };
  }
  if (reportName === "balance_sheet") {
    const assets = totalFor(["asset"]);
    const liabilities = totalFor(["liability"]);
    const equity = totalFor(["equity"]);
    return { assets, liabilities, equity, difference: subtractMoney(assets, addMoney(liabilities, equity)) };
  }
  const debits = roots.reduce((total, line) => addMoney(total, line.debitAmount), "0.00");
  const credits = roots.reduce((total, line) => addMoney(total, line.creditAmount), "0.00");
  return { debits, credits, difference: subtractMoney(debits, credits) };
}

function agingRowFromRow(row: Readonly<Record<string, unknown>>): AgingRow {
  const partyName = optionalString(row.party_name);
  return {
    partyId: string(row.party_id, "party_id"),
    ...(partyName === undefined ? {} : { partyName }),
    current: money(row.current_amount, "current_amount"),
    days1To30: money(row.days_1_30, "days_1_30"),
    days31To60: money(row.days_31_60, "days_31_60"),
    days61To90: money(row.days_61_90, "days_61_90"),
    daysOver90: money(row.days_over_90, "days_over_90"),
    total: money(row.total_amount, "total_amount")
  };
}

function commercialLineFromRow(row: Readonly<Record<string, unknown>>): CommercialDocumentLineReadModel {
  const itemId = optionalString(row.item_id);
  const description = optionalString(row.description);
  const taxCode = optionalString(row.tax_code);
  const servicePeriodStart = optionalDate(row.service_period_start, "service_period_start");
  const servicePeriodEnd = optionalDate(row.service_period_end, "service_period_end");
  const unitCost = row.unit_cost === null || row.unit_cost === undefined
    ? undefined
    : decimal(row.unit_cost, "unit_cost");
  const dimensionRefs = typeof row.dimension_refs === "string" ? JSON.parse(row.dimension_refs) as JsonValue : row.dimension_refs as JsonValue;
  return {
    lineId: string(row.line_id, "line_id"),
    lineNumber: integer(row.line_number, "line_number"),
    accountId: string(row.account_id, "account_id"),
    ...(itemId === undefined ? {} : { itemId }),
    ...(description === undefined ? {} : { description }),
    quantity: decimal(row.quantity, "quantity"),
    unitAmount: money(row.unit_amount, "unit_amount"),
    ...(unitCost === undefined ? {} : { unitCost }),
    discountAmount: money(row.discount_amount, "discount_amount"),
    ...(taxCode === undefined ? {} : { taxCode }),
    taxAmount: money(row.tax_amount, "tax_amount"),
    ...(servicePeriodStart === undefined ? {} : { servicePeriodStart }),
    ...(servicePeriodEnd === undefined ? {} : { servicePeriodEnd }),
    dimensionRefs,
    amount: money(row.line_amount, "line_amount")
  };
}

function bankLineFromRow(row: Readonly<Record<string, unknown>>): BankReconciliationListItem {
  const description = optionalString(row.description);
  const reference = optionalString(row.reference);
  const transactionId = optionalString(row.transaction_id);
  const method = optionalString(row.method) as BankReconciliationListItem["matchMethod"];
  return {
    bankStatementLineId: string(row.bank_statement_line_id, "bank_statement_line_id"),
    sourceId: string(row.source_id, "source_id"),
    bankAccountId: string(row.bank_account_id, "bank_account_id"),
    externalLineId: string(row.external_line_id, "external_line_id"),
    postedDate: date(row.posted_date, "posted_date"),
    amount: money(row.amount, "amount"),
    currencyCode: string(row.currency_code, "currency_code"),
    ...(description === undefined ? {} : { description }),
    ...(reference === undefined ? {} : { reference }),
    status: string(row.status, "status") as BankReconciliationListItem["status"],
    version: integer(row.version, "version"),
    ...(transactionId === undefined ? {} : { matchedTransactionId: transactionId }),
    ...(method === undefined ? {} : { matchMethod: method })
  };
}

type DecodedPage = { readonly limit: number; readonly date?: IsoDate; readonly id?: string };

function pageInput(input: PageRequest, kind: string, bookId: string): DecodedPage {
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new ErpFinancialsError("invalid_input", "Page limit must be an integer between 1 and 200");
  }
  if (input.cursor === undefined) return { limit };
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"));
  } catch {
    throw new ErpFinancialsError("invalid_input", "Page cursor is invalid");
  }
  if (!isRecord(value) || value.v !== 1 || value.kind !== kind || value.bookId !== bookId ||
    typeof value.date !== "string" || typeof value.id !== "string") {
    throw new ErpFinancialsError("invalid_input", "Page cursor does not belong to this read model scope");
  }
  assertDate(value.date, "cursor.date");
  return { limit, date: value.date, id: value.id };
}

function toPage<Item>(
  values: readonly Item[],
  limit: number,
  kind: string,
  bookId: string,
  key: (item: Item) => { readonly date: IsoDate; readonly id: string }
): Page<Item> {
  const items = values.slice(0, limit);
  if (values.length <= limit) return { items };
  const last = items.at(-1);
  if (last === undefined) return { items };
  const cursorKey = key(last);
  return {
    items,
    nextCursor: Buffer.from(JSON.stringify({ v: 1, kind, bookId, ...cursorKey }), "utf8").toString("base64url")
  };
}

function today(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}

function assertWindow(start: string, end: string): void {
  assertDate(start, "periodStart");
  assertDate(end, "periodEnd");
  if (start > end) throw new ErpFinancialsError("invalid_input", "periodStart must be on or before periodEnd");
}

function assertDate(value: string, field: string): asserts value is IsoDate {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ErpFinancialsError("invalid_input", `${field} must be a valid ISO date`);
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) throw new ErpFinancialsError("invalid_input", `${field} must not be empty`);
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Stored ${field} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Stored optional value must be a string");
  return value;
}

function isoDateTime(value: unknown, field: string): IsoDateTime {
  const result = value instanceof Date ? value.toISOString() : string(value, field);
  const parsed = new Date(result);
  if (Number.isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}T/u.test(result)) {
    throw new Error(`Stored ${field} must be an ISO date-time`);
  }
  return result;
}

function optionalJson(value: unknown): JsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  return (typeof value === "string" ? JSON.parse(value) : value) as JsonValue;
}

function jsonObject(value: unknown, field: string): Readonly<Record<string, JsonValue>> {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Stored ${field} must be a JSON object`);
  }
  return parsed as Readonly<Record<string, JsonValue>>;
}

function requiredObjectProperty(value: unknown, property: string): Readonly<Record<string, JsonValue>> {
  const object = jsonObject(value, "metadata");
  return jsonObject(object[property], `metadata.${property}`);
}

function customerPaymentProvenanceFromMetadata(value: unknown): CustomerPaymentProvenanceReadModel | undefined {
  const metadata = jsonObject(value, "metadata");
  const raw = metadata.customerPaymentProvenance;
  if (raw === undefined) return undefined;
  const provenance = jsonObject(raw, "metadata.customerPaymentProvenance");
  const bank = provenance.externalBankMatch === undefined
    ? undefined
    : jsonObject(provenance.externalBankMatch, "metadata.customerPaymentProvenance.externalBankMatch");
  const deposit = provenance.deposit === undefined
    ? undefined
    : jsonObject(provenance.deposit, "metadata.customerPaymentProvenance.deposit");
  const bankStatementLineId = optionalString(bank?.bankStatementLineId);
  const providerReference = optionalString(bank?.providerReference);
  const externalDepositReference = optionalString(deposit?.externalDepositReference);
  return {
    ...(bank === undefined ? {} : { externalBankMatch: {
      externalMatchId: string(bank.externalMatchId, "externalMatchId"),
      ...(bankStatementLineId === undefined ? {} : { bankStatementLineId }),
      ...(providerReference === undefined ? {} : { providerReference }),
      ...(bank.matchedAt === undefined ? {} : { matchedAt: isoDateTime(bank.matchedAt, "matchedAt") })
    } }),
    ...(deposit === undefined ? {} : { deposit: {
      depositId: string(deposit.depositId, "depositId"),
      ...(externalDepositReference === undefined ? {} : { externalDepositReference }),
      ...(deposit.depositedAt === undefined ? {} : { depositedAt: isoDateTime(deposit.depositedAt, "depositedAt") })
    } })
  };
}

function refundProvenanceFromMetadata(value: unknown): AdjustmentDetail["refundProvenance"] | undefined {
  if (value === undefined || value === null) return undefined;
  const metadata = jsonObject(value, "metadata");
  if (metadata.refundProvenance === undefined) return undefined;
  const provenance = jsonObject(metadata.refundProvenance, "metadata.refundProvenance");
  const relatedInvoiceId = optionalString(provenance.relatedInvoiceId);
  const refundMethod = optionalString(provenance.refundMethod);
  const lifecycleReference = optionalString(provenance.lifecycleReference);
  return {
    ...(relatedInvoiceId === undefined ? {} : { relatedInvoiceId }),
    ...(refundMethod === undefined ? {} : { refundMethod }),
    ...(lifecycleReference === undefined ? {} : { lifecycleReference })
  };
}

function lifecycleFromRow(row: Readonly<Record<string, unknown>>): FinancialLifecycleProvenance {
  const approverRef = optionalString(row.approver_ref);
  return {
    lifecycleEventId: string(row.lifecycle_event_id, "lifecycle_event_id"),
    actorRef: string(row.actor_ref, "actor_ref"),
    ...(approverRef === undefined ? {} : { approverRef }),
    requestId: string(row.request_id, "request_id"),
    reasonCode: string(row.reason_code, "reason_code")
  };
}

function prefixedLifecycleFromRow(
  row: Readonly<Record<string, unknown>>,
  prefix: "scheduled" | "cleared" | "posted" | "voided"
): FinancialLifecycleProvenance {
  const approverRef = optionalString(row[`${prefix}_approver_ref`]);
  return {
    lifecycleEventId: string(row[`${prefix}_event_id`], `${prefix}_event_id`),
    actorRef: string(row[`${prefix}_actor_ref`], `${prefix}_actor_ref`),
    ...(approverRef === undefined ? {} : { approverRef }),
    requestId: string(row[`${prefix}_request_id`], `${prefix}_request_id`),
    reasonCode: string(row[`${prefix}_reason_code`], `${prefix}_reason_code`)
  };
}

function optionalPrefixedLifecycleFromRow(
  row: Readonly<Record<string, unknown>>,
  prefix: "scheduled" | "cleared" | "posted" | "voided"
): FinancialLifecycleProvenance | undefined {
  return optionalString(row[`${prefix}_event_id`]) === undefined
    ? undefined
    : prefixedLifecycleFromRow(row, prefix);
}

function date(value: unknown, field: string): IsoDate {
  const result = value instanceof Date ? value.toISOString().slice(0, 10) : string(value, field).slice(0, 10);
  assertDate(result, field);
  return result;
}

function optionalDate(value: unknown, field: string): IsoDate | undefined {
  return value === null || value === undefined ? undefined : date(value, field);
}

function decimal(value: unknown, field: string): DecimalString {
  const result = typeof value === "number" ? String(value) : string(value, field);
  if (!/^-?\d+(?:\.\d+)?$/u.test(result)) throw new Error(`Stored ${field} must be decimal`);
  return result;
}

function money(value: unknown, field: string): DecimalString {
  const parsed = decimal(value, field);
  const [whole = "0", fraction = ""] = parsed.split(".");
  return `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function moneyMinor(value: DecimalString): bigint {
  const negative = value.startsWith("-");
  const raw = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = raw.split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  return negative ? -minor : minor;
}

function minorMoney(value: bigint): DecimalString {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${(absolute / 100n).toString()}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

function addMoney(left: DecimalString, right: DecimalString): DecimalString {
  return minorMoney(moneyMinor(left) + moneyMinor(right));
}

function subtractMoney(left: DecimalString, right: DecimalString): DecimalString {
  return minorMoney(moneyMinor(left) - moneyMinor(right));
}

function percentage(numerator: number, denominator: number): DecimalString {
  if (denominator === 0) return "0.00";
  const basisPoints = (BigInt(numerator) * 10_000n + BigInt(Math.floor(denominator / 2))) / BigInt(denominator);
  return minorMoney(basisPoints);
}

function integer(value: unknown, field: string): number {
  const result = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(result)) throw new Error(`Stored ${field} must be an integer`);
  return result;
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === null || value === undefined) return undefined;
  return integer(value, field);
}

function optionalReportingBookAccountRole(value: unknown): ReportingBookAccountRole | undefined {
  if (value === null || value === undefined) return undefined;
  if (value !== "header" && value !== "posting") throw new Error("Stored account_role must be header or posting");
  return value;
}

function requiredRow(row: Readonly<Record<string, unknown>> | undefined, label: string): Readonly<Record<string, unknown>> {
  if (row === undefined) throw new Error(`Missing ${label} row`);
  return row;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
