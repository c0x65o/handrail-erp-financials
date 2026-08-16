import { createBankReconciliationService } from "./bank-reconciliation.js";
import { createErpFinancials } from "./erp-financials-service.js";
import { createFinancialOutboxService } from "./financial-outbox.js";
import { createFinancialRuntime } from "./financial-runtime.js";
import { createInvoiceWorkflow } from "./invoice-workflow.js";
import { createPaymentMatchingService } from "./payment-matching.js";
import { createReportingBookService } from "./reporting-books.js";
import { createFinancialReadModels } from "./sdk-read-models.js";

import type { AccountingBasis, IsoCurrencyCode, IsoDateTime } from "./canonical-model.js";
import type { BankReconciliationService } from "./bank-reconciliation.js";
import type { ErpFinancials, ErpFinancialsDatabase, ErpFinancialsTransactionRunner } from "./erp-financials-service.js";
import type { FinancialOutboxService } from "./financial-outbox.js";
import type { FinancialRuntime, FinancialRuntimeHandlers } from "./financial-runtime.js";
import type { InvoiceWorkflow } from "./invoice-workflow.js";
import type { PaymentMatchingService } from "./payment-matching.js";
import type { ReportingBookService } from "./reporting-books.js";
import type { FinancialReadModels } from "./sdk-read-models.js";
import type { PostgresQueryClient } from "./postgres-storage.js";

/**
 * Stable host-facing entry point. A host supplies scope and a transaction
 * runner once; the SDK owns posting, allocation, lifecycle, reconciliation,
 * pagination, aggregation, and outbox edge cases beneath this façade.
 */
export type ErpFinancialsSdk = {
  /** Low-level financial commands retained for explicit journal/subledger use. */
  readonly commands: ErpFinancials;
  readonly books: ReportingBookService;
  readonly invoices: InvoiceWorkflow;
  readonly paymentMatching: PaymentMatchingService;
  readonly bankReconciliation: BankReconciliationService;
  readonly queries: FinancialReadModels;
  readonly outbox: FinancialOutboxService;
  createRuntime(handlers: FinancialRuntimeHandlers): FinancialRuntime;
};

export type CreateErpFinancialsSdkInput = {
  readonly database: ErpFinancialsDatabase;
  readonly tenantId: string;
  readonly companyId: string;
  readonly bookId: string;
  /** The source that receives new native ERP financial facts. */
  readonly writeSourceId: string;
  readonly currencyCode: IsoCurrencyCode;
  readonly accountingBasis?: AccountingBasis;
  readonly postingPolicy?: "enforce_fiscal_periods" | "legacy_unrestricted";
  readonly now?: () => IsoDateTime;
};

export function createErpFinancialsSdk(input: CreateErpFinancialsSdkInput): ErpFinancialsSdk {
  const database = asTransactionRunner(input.database);
  const shared = {
    database,
    tenantId: input.tenantId,
    companyId: input.companyId,
    bookId: input.bookId,
    sourceId: input.writeSourceId,
    currencyCode: input.currencyCode,
    accountingBasis: input.accountingBasis ?? "accrual",
    postingPolicy: input.postingPolicy ?? "enforce_fiscal_periods",
    ...(input.now === undefined ? {} : { now: input.now })
  };
  const outbox = createFinancialOutboxService({
    database,
    tenantId: input.tenantId,
    companyId: input.companyId,
    bookId: input.bookId,
    ...(input.now === undefined ? {} : { now: input.now })
  });
  return {
    commands: createErpFinancials({
      database,
      tenantId: input.tenantId,
      companyId: input.companyId,
      sourceId: input.writeSourceId,
      bookId: input.bookId,
      currencyCode: input.currencyCode,
      currencyPolicy: "single_currency",
      ...(input.accountingBasis === undefined ? {} : { accountingBasis: input.accountingBasis }),
      ...(input.postingPolicy === undefined ? {} : { postingPolicy: input.postingPolicy }),
      ...(input.now === undefined ? {} : { now: input.now })
    }),
    books: createReportingBookService({
      database,
      tenantId: input.tenantId,
      companyId: input.companyId,
      ...(input.now === undefined ? {} : { now: input.now })
    }),
    invoices: createInvoiceWorkflow(shared),
    paymentMatching: createPaymentMatchingService(shared),
    bankReconciliation: createBankReconciliationService(shared),
    queries: createFinancialReadModels({
      database,
      tenantId: input.tenantId,
      companyId: input.companyId,
      bookId: input.bookId
    }),
    outbox,
    createRuntime: (handlers) => createFinancialRuntime({
      outbox,
      handlers,
      ...(input.now === undefined ? {} : { now: input.now })
    })
  };
}

function asTransactionRunner(database: ErpFinancialsDatabase): ErpFinancialsTransactionRunner {
  if ("transaction" in database) return database;
  const pool = database;
  return {
    async transaction<Result>(work: (client: PostgresQueryClient) => Promise<Result>): Promise<Result> {
      const client = await pool.connect();
      let started = false;
      try {
        await client.query("begin");
        started = true;
        const result = await work(client);
        await client.query("commit");
        return result;
      } catch (error) {
        if (started) await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

export { ErpFinancialsError, erpFinancialsError, isErpFinancialsError } from "./sdk-errors.js";
export { normalizeCommercialDocumentLine } from "./commercial-lines.js";
export { ERP_FINANCIALS_SDK_ACCEPTANCE_FIXTURE } from "./sdk-fixtures.js";

export type { ErpFinancialsErrorCode, ErpFinancialsErrorDetails } from "./sdk-errors.js";
export type { CommercialDocumentLineInput, NormalizedCommercialDocumentLine } from "./commercial-lines.js";
export type {
  AgingReport,
  AgingRow,
  AdjustmentApplicationReadModel,
  AdjustmentDetail,
  AdjustmentListItem,
  AdjustmentPostingReadModel,
  AdjustmentStatus,
  AdjustmentType,
  AccountingLifecycleProvenance,
  BankReconciliationListItem,
  BankReconciliationSummary,
  BillPaymentAccountEvidence,
  BillPaymentDetail,
  BillPaymentLifecycleEvidence,
  BillPaymentLifecycleStatus,
  BillPaymentListItem,
  BillPaymentMethod,
  BillPaymentSummary,
  ChartOfAccountsItem,
  CommercialDocumentLineReadModel,
  CustomerPaymentDetail,
  CustomerPaymentProvenanceReadModel,
  FinancialLifecycleProvenance,
  FinancialDashboardSummary,
  FinancialStatement,
  FinancialStatementLine,
  FinancialStatementName,
  FinancialReadModels,
  GeneralLedgerDimensionProvenance,
  GeneralLedgerFilters,
  GeneralLedgerLine,
  GeneralLedgerPolarity,
  GeneralLedgerSourceProvenance,
  GeneralLedgerSummary,
  InvoiceDetail,
  InvoiceDeliveryEvent,
  InvoiceListItem,
  InvoiceListStatus,
  InvoiceSummary,
  JournalEntryAccountReference,
  JournalEntryDetail,
  JournalEntryLifecycleLinkReadModel,
  JournalEntryLineReadModel,
  JournalEntryListItem,
  JournalEntrySourceProvenance,
  JournalEntryStatus,
  Page,
  PageRequest,
  PaymentListItem,
  PaymentApplicationDetail,
  PaymentApplicationListItem,
  PaymentApplicationMatchProvenance,
  PaymentSummary,
  PaymentStatus,
  FiscalPeriodReadModel,
  PostingLockReadModel,
  WriteOffDetail,
  WriteOffListItem,
  VendorBillApplicationReadModel,
  VendorBillDetail,
  VendorBillLineReadModel,
  VendorBillListItem,
  VendorBillStatus,
  VendorBillSummary
} from "./sdk-read-models.js";
export type {
  BillPaymentAllocationInput,
  BillPaymentMethod as BillPaymentCommandMethod,
  CancelScheduledBillPaymentInput,
  CancelledScheduledBillPaymentResult,
  ClearedBillPaymentResult,
  ClearScheduledBillPaymentInput,
  IssuedAdjustmentLifecycleResult,
  IssuedAdjustmentType,
  IssueCreditMemoInput,
  IssueRefundInput,
  CustomerPaymentProvenance,
  PostedBillPaymentLifecycleResult,
  PostedVendorBillLifecycleResult,
  ReplaceIssuedVendorBillInput,
  ReplaceIssuedAdjustmentInput,
  ReplaceIssuedCreditMemoInput,
  ReplaceIssuedRefundInput,
  ReplaceIssuedWriteOffInput,
  ReplacePostedVendorBillInput,
  RecordAndApplyBillPaymentInput,
  ScheduleBillPaymentInput,
  ScheduledBillPaymentResult,
  VoidIssuedAdjustmentInput,
  VoidIssuedBillPaymentInput,
  VoidIssuedCreditMemoInput,
  VoidIssuedRefundInput,
  VoidIssuedWriteOffInput,
  VoidIssuedVendorBillInput,
  VoidPostedBillPaymentInput,
  VoidAndUnapplyBillPaymentInput,
  VoidAndUnapplyBillPaymentResult,
  VoidPostedVendorBillInput
} from "./erp-financials-service.js";
export type {
  InvoiceDraft,
  InvoiceDraftStatus,
  InvoiceWorkflow,
  IssueInvoiceDraftInput,
  IssueInvoiceDraftResult,
  RecordInvoiceDeliveryInput,
  SaveInvoiceDraftInput,
  UpdateInvoiceDraftInput,
  VoidIssuedInvoiceInput,
  VoidIssuedInvoiceResult
} from "./invoice-workflow.js";
export type {
  BankReconciliationMatchResult,
  BankReconciliationService,
  BankStatementLineResult,
  IngestBankStatementLineInput,
  MatchBankStatementLineInput
} from "./bank-reconciliation.js";
export type { AcceptPaymentMatchInput, AcceptPaymentMatchResult, PaymentMatchingService } from "./payment-matching.js";
export type {
  BindReportingBookSourceInput,
  DefineReportingBookAccountInput,
  DefineReportingBookInput,
  MapReportingBookAccountInput,
  ReportingBook,
  ReportingBookAccount,
  ReportingBookAccountRole,
  ReportingBookAccountMapping,
  ReportingBookResolvedScope,
  ReportingBookService,
  ReportingBookSource,
  ReportingBookSourceRole,
  ReportingBookStatus
} from "./reporting-books.js";
export type { FinancialOutboxEvent, FinancialOutboxService, FinancialOutboxStatus } from "./financial-outbox.js";
export type { FinancialRuntime, FinancialRuntimeHandlers, FinancialRuntimeRunResult } from "./financial-runtime.js";
