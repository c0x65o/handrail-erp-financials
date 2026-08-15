import { ErpFinancialsError } from "./sdk-errors.js";

import type {
  AccountClassification,
  AccountingBasis,
  DecimalString,
  IsoCurrencyCode,
  IsoDate,
  JsonValue
} from "./canonical-model.js";
import type { ErpFinancialsTransactionRunner } from "./erp-financials-service.js";
import type { PostgresQueryClient } from "./postgres-storage.js";

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

export type PaymentListItem = {
  readonly paymentId: string;
  readonly sourceId: string;
  readonly paymentType: "customer_payment" | "bill_payment";
  readonly partyId: string;
  readonly partyName?: string;
  readonly documentNumber?: string;
  readonly paymentDate: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly amount: DecimalString;
  readonly unappliedAmount: DecimalString;
  readonly status: "unapplied" | "partial" | "applied";
  readonly matchedApplicationCount: number;
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

export type GeneralLedgerLine = {
  readonly postingId: string;
  readonly sourceId: string;
  readonly transactionId: string;
  readonly transactionNumber?: string;
  readonly transactionDate: IsoDate;
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
};

export type ChartOfAccountsItem = {
  readonly bookAccountKey: string;
  readonly sourceAccountIds: readonly string[];
  readonly accountNumber?: string;
  readonly name: string;
  readonly classification: AccountClassification;
  readonly type?: string;
  readonly subtype?: string;
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

export type FinancialReadModels = {
  listInvoices(input?: PageRequest & { readonly status?: InvoiceListStatus; readonly asOfDate?: IsoDate }): Promise<Page<InvoiceListItem>>;
  getInvoice(invoiceId: string, asOfDate?: IsoDate): Promise<InvoiceDetail>;
  getInvoiceSummary(input?: { readonly asOfDate?: IsoDate }): Promise<InvoiceSummary>;
  listVendorBills(input?: PageRequest & { readonly status?: VendorBillStatus; readonly asOfDate?: IsoDate; readonly vendorId?: string }): Promise<Page<VendorBillListItem>>;
  getVendorBill(billId: string, asOfDate?: IsoDate): Promise<VendorBillDetail>;
  getVendorBillSummary(input?: {
    readonly asOfDate?: IsoDate;
    readonly periodStart?: IsoDate;
    readonly periodEnd?: IsoDate;
    readonly vendorId?: string;
  }): Promise<VendorBillSummary>;
  listPayments(input?: PageRequest & { readonly paymentType?: PaymentListItem["paymentType"] }): Promise<Page<PaymentListItem>>;
  getPaymentSummary(input: { readonly periodStart: IsoDate; readonly periodEnd: IsoDate }): Promise<PaymentSummary>;
  listAdjustments(input?: PageRequest & { readonly adjustmentType?: AdjustmentType; readonly status?: AdjustmentStatus }): Promise<Page<AdjustmentListItem>>;
  getAdjustment(adjustmentId: string): Promise<AdjustmentDetail>;
  listGeneralLedger(input: PageRequest & { readonly periodStart: IsoDate; readonly periodEnd: IsoDate; readonly accountKey?: string }): Promise<Page<GeneralLedgerLine>>;
  getGeneralLedgerSummary(input: { readonly periodStart: IsoDate; readonly periodEnd: IsoDate }): Promise<GeneralLedgerSummary>;
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
    listInvoices: (request = {}) => listInvoices(input, request),
    getInvoice: (invoiceId, asOfDate) => getInvoice(input, invoiceId, asOfDate),
    getInvoiceSummary: (request = {}) => getInvoiceSummary(input, request),
    listVendorBills: (request = {}) => listVendorBills(input, request),
    getVendorBill: (billId, asOfDate) => getVendorBill(input, billId, asOfDate),
    getVendorBillSummary: (request = {}) => getVendorBillSummary(input, request),
    listPayments: (request = {}) => listPayments(input, request),
    getPaymentSummary: (request) => getPaymentSummary(input, request),
    listAdjustments: (request = {}) => listAdjustments(input, request),
    getAdjustment: (adjustmentId) => getAdjustment(input, adjustmentId),
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
  input: PageRequest & { readonly paymentType?: PaymentListItem["paymentType"] }
): Promise<Page<PaymentListItem>> {
  const page = pageInput(input, "payments", scope.bookId);
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `select document."subledger_document_id" as "payment_id", document."source_id", document."document_type",
  document."party_id", party."display_name" as "party_name", document."document_number", document."document_date",
  document."currency_code", document."original_amount", document."open_amount",
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
  and ($6::date is null or (document."document_date", document."subledger_document_id") < ($6::date, $7::text))
group by document."subledger_document_id", party."display_name"
order by document."document_date" desc, document."subledger_document_id" desc
limit $8`,
      [scope.tenantId, scope.companyId, scope.bookId, book.currencyCode, input.paymentType, page.date, page.id, page.limit + 1]
    );
    return toPage(result.rows.map(paymentFromRow), page.limit, "payments", scope.bookId, (item) => ({
      date: item.paymentDate,
      id: item.paymentId
    }));
  });
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
      `select transaction."memo"
from "erp_financials"."transactions" transaction
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
    const memo = optionalString(header.rows[0]?.memo);
    return {
      ...adjustment,
      ...(memo === undefined ? {} : { memo }),
      lines: lines.rows.map(commercialLineFromRow),
      postings: postings.rows.map(adjustmentPostingFromRow),
      applications: applications.rows.map(adjustmentApplicationFromRow)
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
  input: PageRequest & { readonly periodStart: IsoDate; readonly periodEnd: IsoDate; readonly accountKey?: string }
): Promise<Page<GeneralLedgerLine>> {
  assertWindow(input.periodStart, input.periodEnd);
  const page = pageInput(input, "general-ledger", scope.bookId);
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `select posting."posting_id", posting."source_id", posting."transaction_id", transaction."transaction_number",
  transaction."transaction_date", posting."account_id",
  coalesce(mapping."book_account_key", posting."source_id" || ':' || posting."account_id") as "book_account_key",
  account."account_number", account."name" as "account_name", posting."party_id", posting."item_id",
  line."description", posting."debit_amount", posting."credit_amount", posting."net_amount", posting."currency_code"
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
where posting."tenant_id" = $1 and posting."accounting_basis" = $4 and posting."currency_code" = $5
  and posting."posting_date" between $6::date and $7::date
  and ($8::text is null or coalesce(mapping."book_account_key", posting."source_id" || ':' || posting."account_id") = $8)
  and ($9::date is null or (posting."posting_date", posting."posting_id") < ($9::date, $10::text))
order by posting."posting_date" desc, posting."posting_id" desc
limit $11`,
      [scope.tenantId, scope.companyId, scope.bookId, book.accountingBasis, book.currencyCode, input.periodStart, input.periodEnd, input.accountKey, page.date, page.id, page.limit + 1]
    );
    return toPage(result.rows.map(ledgerLineFromRow), page.limit, "general-ledger", scope.bookId, (item) => ({
      date: item.transactionDate,
      id: item.postingId
    }));
  });
}

async function getGeneralLedgerSummary(
  scope: Scope,
  input: { readonly periodStart: IsoDate; readonly periodEnd: IsoDate }
): Promise<GeneralLedgerSummary> {
  assertWindow(input.periodStart, input.periodEnd);
  return scope.database.transaction(async (client) => {
    const book = await resolveBook(client, scope);
    const result = await client.query(
      `select count(*)::integer as "posting_count", coalesce(sum(posting."debit_amount"), 0) as "debits",
  coalesce(sum(posting."credit_amount"), 0) as "credits"
from "erp_financials"."ledger_postings" posting
join "erp_financials"."reporting_book_sources" source
  on source."tenant_id" = $1 and source."company_id" = $2 and source."book_id" = $3 and source."source_id" = posting."source_id"
 and (source."effective_from" is null or source."effective_from" <= posting."posting_date")
 and (source."effective_through" is null or source."effective_through" >= posting."posting_date")
where posting."tenant_id" = $1 and posting."accounting_basis" = $4 and posting."currency_code" = $5
  and posting."posting_date" between $6::date and $7::date`,
      [scope.tenantId, scope.companyId, scope.bookId, book.accountingBasis, book.currencyCode,
        input.periodStart, input.periodEnd]
    );
    const row = requiredRow(result.rows[0], "general ledger summary");
    const totalDebits = money(row.debits, "debits");
    const totalCredits = money(row.credits, "credits");
    return {
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
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
  "account_type", "account_subtype", "parent_book_account_key", "active"
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
  const partyName = optionalString(row.party_name);
  const documentNumber = optionalString(row.document_number);
  return {
    paymentId: string(row.payment_id, "payment_id"),
    sourceId: string(row.source_id, "source_id"),
    paymentType: string(row.document_type, "document_type") as PaymentListItem["paymentType"],
    partyId: string(row.party_id, "party_id"),
    ...(partyName === undefined ? {} : { partyName }),
    ...(documentNumber === undefined ? {} : { documentNumber }),
    paymentDate: date(row.document_date, "document_date"),
    currencyCode: string(row.currency_code, "currency_code"),
    amount,
    unappliedAmount: unapplied,
    status: unapplied === "0.00" ? "applied" : unapplied === amount ? "unapplied" : "partial",
    matchedApplicationCount: integer(row.application_count, "application_count")
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
    currencyCode: string(row.currency_code, "currency_code")
  };
}

function chartAccountFromRow(row: Readonly<Record<string, unknown>>, currencyCode: IsoCurrencyCode): ChartOfAccountsItem {
  const accountNumber = optionalString(row.account_number);
  const type = optionalString(row.account_type);
  const subtype = optionalString(row.account_subtype);
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
    const parentBookAccountKey = optionalString(row.parent_book_account_key);
    return {
      bookAccountKey,
      sourceAccountIds: source?.sourceAccountIds ?? [],
      ...(accountNumber === undefined ? {} : { accountNumber }),
      name: string(row.account_name, "account_name"),
      classification: string(row.classification, "classification") as AccountClassification,
      ...(type === undefined ? {} : { type }),
      ...(subtype === undefined ? {} : { subtype }),
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
  const dimensionRefs = typeof row.dimension_refs === "string" ? JSON.parse(row.dimension_refs) as JsonValue : row.dimension_refs as JsonValue;
  return {
    lineId: string(row.line_id, "line_id"),
    lineNumber: integer(row.line_number, "line_number"),
    accountId: string(row.account_id, "account_id"),
    ...(itemId === undefined ? {} : { itemId }),
    ...(description === undefined ? {} : { description }),
    quantity: decimal(row.quantity, "quantity"),
    unitAmount: money(row.unit_amount, "unit_amount"),
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

function requiredRow(row: Readonly<Record<string, unknown>> | undefined, label: string): Readonly<Record<string, unknown>> {
  if (row === undefined) throw new Error(`Missing ${label} row`);
  return row;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
