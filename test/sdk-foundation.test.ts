import { describe, expect, it } from "vitest";

import {
  ErpFinancialsError,
  createErpFinancials,
  createFinancialReadModels,
  createFinancialRuntime,
  normalizeCommercialDocumentLine
} from "../src/index.js";

import type {
  FinancialOutboxEvent,
  FinancialOutboxService,
  PostgresQueryClient,
  PostgresQueryResult
} from "../src/index.js";

describe("pre-v1 SDK foundation", () => {
  it("normalizes commercial lines with exact quantity, discount, and tax arithmetic", () => {
    expect(normalizeCommercialDocumentLine({
      amount: "24.50",
      quantity: "2.5",
      unitAmount: "10.00",
      unitCost: "6.125000",
      discountAmount: "2.00",
      taxAmount: "1.50",
      itemId: "item_1"
    })).toMatchObject({
      amount: "24.50",
      quantity: "2.5",
      unitAmount: "10.00",
      unitCost: "6.125000",
      discountAmount: "2.00",
      taxAmount: "1.50"
    });

    expect(() => normalizeCommercialDocumentLine({
      amount: "10.00",
      unitCost: "1.1234567"
    })).toThrow("at most six fractional digits");

    const invalidLine = () => normalizeCommercialDocumentLine({
      amount: "24.49",
      quantity: "2.5",
      unitAmount: "10.00",
      discountAmount: "2.00",
      taxAmount: "1.50"
    });
    expect(invalidLine).toThrow("amount must equal");
    try {
      invalidLine();
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_input" });
    }
  });

  it("fails closed on cross-currency subledger commands before opening a transaction", async () => {
    let transactions = 0;
    const service = createErpFinancials({
      database: {
        transaction<Result>(): Promise<Result> {
          transactions += 1;
          return Promise.reject(new Error("transaction should not start"));
        }
      },
      tenantId: "tenant_1",
      companyId: "company_1",
      sourceId: "source_1",
      currencyCode: "USD",
      currencyPolicy: "single_currency"
    });

    await expect(service.invoices.create({
      operation: operation(),
      idempotencyKey: "invoice-cad",
      date: "2026-08-12",
      dueDate: "2026-09-12",
      customerId: "customer_1",
      currencyCode: "CAD",
      receivableAccount: { accountId: "ar" },
      revenueLines: [{ accountId: "income", amount: "10.00" }]
    })).rejects.toMatchObject({ code: "currency_not_supported" } satisfies Partial<ErpFinancialsError>);
    expect(transactions).toBe(0);
  });

  it("rolls book-owned account hierarchies into statement rows and totals", async () => {
    const client = new StatementClient();
    const queries = createFinancialReadModels({
      database: { transaction: async (work) => work(client) },
      tenantId: "tenant_1",
      companyId: "company_1",
      bookId: "book_1"
    });

    const report = await queries.getFinancialStatement({
      reportName: "profit_and_loss",
      periodStart: "2026-01-01",
      periodEnd: "2026-08-12"
    });

    expect(report.lines).toEqual([
      expect.objectContaining({ bookAccountKey: "income", directAmount: "0.00", amount: "150.00" }),
      expect.objectContaining({ bookAccountKey: "services", directAmount: "150.00", amount: "150.00" }),
      expect.objectContaining({ bookAccountKey: "expenses", amount: "20.00" })
    ]);
    expect(report.totals).toMatchObject({ income: "150.00", expenses: "20.00", netIncome: "130.00" });
  });

  it("exposes canonical credit/refund register and adjustment detail models", async () => {
    const client = new AdjustmentClient();
    const queries = createFinancialReadModels({
      database: { transaction: async (work) => work(client) },
      tenantId: "tenant_1",
      companyId: "company_1",
      bookId: "book_1"
    });

    await expect(queries.listAdjustments({ adjustmentType: "credit", status: "replaced" })).resolves.toEqual({
      items: [expect.objectContaining({
        adjustmentId: "credit_1",
        adjustmentType: "credit",
        status: "replaced",
        reversalTransactionId: "reversal_1",
        replacementAdjustmentId: "credit_2"
      })]
    });
    await expect(queries.getAdjustment("credit_1")).resolves.toMatchObject({
      adjustmentId: "credit_1",
      memo: "Customer service adjustment",
      lines: [expect.objectContaining({ lineId: "credit_line_1", amount: "25.00" })],
      postings: [
        expect.objectContaining({ accountId: "revenue", debitAmount: "25.00", creditAmount: "0.00" }),
        expect.objectContaining({ accountId: "receivable", debitAmount: "0.00", creditAmount: "25.00" })
      ],
      applications: [expect.objectContaining({ applicationId: "application_1", amount: "5.00" })]
    });
  });

  it("exposes company-scoped vendor bill registers, KPI summary, immutable detail, and applications", async () => {
    const client = new VendorBillClient();
    const queries = createFinancialReadModels({
      database: { transaction: async (work) => work(client) },
      tenantId: "tenant_1",
      companyId: "company_1",
      bookId: "book_1"
    });

    await expect(queries.listVendorBills({
      asOfDate: "2026-08-14",
      status: "partial",
      vendorId: "vendor_1",
      limit: 25
    })).resolves.toEqual({
      items: [expect.objectContaining({
        billId: "bill_1",
        sourceId: "source_1",
        sourceProvenance: "posted",
        transactionId: "transaction_bill_1",
        vendorId: "vendor_1",
        originalAmount: "125.00",
        openAmount: "75.00",
        status: "partial",
        version: 2
      })]
    });

    await expect(queries.getVendorBill("bill_1", "2026-08-14")).resolves.toMatchObject({
      billId: "bill_1",
      memo: "Annual security subscription",
      lines: [expect.objectContaining({
        lineId: "bill_line_1",
        accountId: "expense_security",
        sourceAccountKey: "security-expense",
        bookAccountKey: "software-security",
        accountMappingProvenance: "reporting_book_mapping",
        accountMappingId: "mapping_1",
        itemId: "item_security",
        sourceItemId: "source-item-security",
        categoryMappingProvenance: "item_expense_account",
        quantity: "1",
        unitAmount: "125.00",
        amount: "125.00"
      })],
      applications: [expect.objectContaining({
        applicationId: "application_1",
        sourcePaymentId: "payment_1",
        applicationDate: "2026-08-10",
        amount: "50.00",
        status: "applied",
        version: 1
      })]
    });

    await expect(queries.getVendorBillSummary({
      asOfDate: "2026-08-14",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-14",
      vendorId: "vendor_1"
    })).resolves.toEqual({
      asOfDate: "2026-08-14",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-14",
      currencyCode: "USD",
      outstandingAmount: "75.00",
      outstandingVendorBillCount: 1,
      overdueAmount: "75.00",
      overdueVendorBillCount: 1,
      paidAmount: "50.00",
      paidInPeriodAmount: "50.00",
      paidInPeriodVendorBillCount: 1,
      settledVendorBillCount: 0,
      voidedVendorBillCount: 0,
      replacedVendorBillCount: 0
    });

    await expect(queries.getVendorBillSummary({
      asOfDate: "2026-08-14",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-15"
    })).rejects.toMatchObject({ code: "invalid_input" });

    expect(client.billListParams).toEqual(expect.arrayContaining([
      "tenant_1",
      "company_1",
      "book_1",
      "2026-08-14",
      "vendor_1",
      "partial"
    ]));
  });

  it("delivers outbox work through bounded runtime routing and publishes only successful events", async () => {
    const event = outboxEvent();
    const published: string[] = [];
    const failed: string[] = [];
    const outbox: FinancialOutboxService = {
      claim: () => Promise.resolve([event]),
      markPublished: (id) => { published.push(id); return Promise.resolve(); },
      markFailed: ({ outboxEventId }) => { failed.push(outboxEventId); return Promise.resolve(); }
    };
    const runtime = createFinancialRuntime({
      outbox,
      handlers: { onLedgerChanged: () => Promise.resolve() },
      now: () => "2026-08-12T12:00:00.000Z"
    });

    await expect(runtime.runOnce()).resolves.toEqual({
      claimed: 1,
      published: 1,
      failed: 0,
      eventIds: [event.outboxEventId]
    });
    expect(published).toEqual([event.outboxEventId]);
    expect(failed).toEqual([]);
  });

  it("routes issued-adjustment lifecycle events to the adjustment handler", async () => {
    const event = { ...outboxEvent(), eventType: "issued_adjustment.replaced" };
    const handled: string[] = [];
    const outbox: FinancialOutboxService = {
      claim: () => Promise.resolve([event]),
      markPublished: () => Promise.resolve(),
      markFailed: () => Promise.resolve()
    };
    const runtime = createFinancialRuntime({
      outbox,
      handlers: { onAdjustmentChanged: (candidate) => { handled.push(candidate.eventType); return Promise.resolve(); } }
    });

    await expect(runtime.runOnce()).resolves.toMatchObject({ published: 1, failed: 0 });
    expect(handled).toEqual(["issued_adjustment.replaced"]);
  });

  it("routes vendor-bill posting and correction events to the vendor-bill handler", async () => {
    const events = [
      { ...outboxEvent(), eventType: "subledger_document.vendor_bill.posted" },
      { ...outboxEvent(), outboxEventId: "outbox_vendor_bill_void", eventType: "vendor_bill.voided" }
    ];
    const handled: string[] = [];
    const outbox: FinancialOutboxService = {
      claim: () => Promise.resolve(events),
      markPublished: () => Promise.resolve(),
      markFailed: () => Promise.resolve()
    };
    const runtime = createFinancialRuntime({
      outbox,
      handlers: {
        onVendorBillChanged: (event) => {
          handled.push(event.eventType);
          return Promise.resolve();
        }
      }
    });

    await expect(runtime.runOnce()).resolves.toMatchObject({ published: 2, failed: 0 });
    expect(handled).toEqual(["subledger_document.vendor_bill.posted", "vendor_bill.voided"]);
  });
});

class StatementClient implements PostgresQueryClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string
  ): Promise<PostgresQueryResult<Row>> {
    if (sql.includes('from "erp_financials"."reporting_books"')) {
      return Promise.resolve({
        rows: [{ base_currency_code: "USD", accounting_basis: "accrual", status: "active" } as unknown as Row]
      });
    }
    if (sql.includes('from "erp_financials"."accounts"')) {
      return Promise.resolve({ rows: [
        {
          book_account_key: "services",
          parent_book_account_key: "income",
          account_number: "4010",
          account_name: "Services",
          classification: "income",
          debit_amount: "0",
          credit_amount: "150",
          net_amount: "-150"
        },
        {
          book_account_key: "expenses",
          parent_book_account_key: null,
          account_number: "6000",
          account_name: "Expenses",
          classification: "expense",
          debit_amount: "20",
          credit_amount: "0",
          net_amount: "20"
        }
      ] as unknown as Row[] });
    }
    if (sql.includes('from "erp_financials"."reporting_book_accounts"')) {
      return Promise.resolve({ rows: [
        {
          book_account_key: "income",
          parent_book_account_key: null,
          account_number: "4000",
          account_name: "Income",
          classification: "income"
        },
        {
          book_account_key: "services",
          parent_book_account_key: "income",
          account_number: "4010",
          account_name: "Services",
          classification: "income"
        },
        {
          book_account_key: "expenses",
          parent_book_account_key: null,
          account_number: "6000",
          account_name: "Expenses",
          classification: "expense"
        }
      ] as unknown as Row[] });
    }
    throw new Error(`Unexpected statement query: ${sql}`);
  }
}

class VendorBillClient implements PostgresQueryClient {
  billListParams: readonly unknown[] = [];

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    if (sql.includes('from "erp_financials"."reporting_books"')) {
      return Promise.resolve({
        rows: [{ base_currency_code: "USD", accounting_basis: "accrual", status: "active" } as unknown as Row]
      });
    }
    if (sql.includes("with bill_balances as")) {
      if (params[6] === "partial") this.billListParams = params;
      return Promise.resolve({ rows: [{
        bill_id: "bill_1",
        source_id: "source_1",
        transaction_id: "transaction_bill_1",
        party_id: "vendor_1",
        party_name: "Northwind Security",
        document_number: "BILL-100",
        document_date: "2026-08-01",
        due_date: "2026-08-12",
        currency_code: "USD",
        original_amount: "125",
        open_amount: "75",
        status: "partial",
        version: 2
      }] as unknown as Row[] });
    }
    if (sql.includes('select transaction."memo"') && sql.includes("document_type\" = 'vendor_bill'")) {
      return Promise.resolve({ rows: [{ memo: "Annual security subscription" } as unknown as Row] });
    }
    if (sql.includes('from "erp_financials"."subledger_document_lines" line')) {
      return Promise.resolve({ rows: [{
        line_id: "bill_line_1",
        line_number: 1,
        source_id: "source_1",
        account_id: "expense_security",
        source_account_id: "security-expense",
        book_account_mapping_id: "mapping_1",
        book_account_key: "software-security",
        item_id: "item_security",
        source_item_id: "source-item-security",
        item_name: "Security subscription",
        item_expense_account_id: "expense_security",
        description: "Annual security subscription",
        quantity: "1",
        unit_amount: "125",
        discount_amount: "0",
        tax_code: null,
        tax_amount: "0",
        service_period_start: "2026-08-01",
        service_period_end: "2027-07-31",
        dimension_refs: [],
        line_amount: "125"
      }] as unknown as Row[] });
    }
    if (sql.includes('application."source_document_id" as "source_payment_id"')) {
      return Promise.resolve({ rows: [{
        application_id: "application_1",
        source_payment_id: "payment_1",
        application_date: "2026-08-10",
        applied_amount: "50",
        status: "applied",
        version: 1
      }] as unknown as Row[] });
    }
    if (sql.includes("with bills as")) {
      return Promise.resolve({ rows: [{
        outstanding_amount: "75",
        outstanding_count: 1,
        overdue_amount: "75",
        overdue_count: 1,
        paid_amount: "50",
        paid_in_period_amount: "50",
        paid_in_period_count: 1,
        settled_count: 0,
        voided_count: 0,
        replaced_count: 0
      }] as unknown as Row[] });
    }
    throw new Error(`Unexpected vendor bill query: ${sql}`);
  }
}

class AdjustmentClient implements PostgresQueryClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string
  ): Promise<PostgresQueryResult<Row>> {
    if (sql.includes('from "erp_financials"."reporting_books"')) {
      return Promise.resolve({
        rows: [{ base_currency_code: "USD", accounting_basis: "accrual", status: "active" } as unknown as Row]
      });
    }
    if (sql.includes("with adjustment_rows as")) {
      return Promise.resolve({ rows: [{
        adjustment_id: "credit_1",
        source_id: "source_1",
        transaction_id: "transaction_1",
        adjustment_type: "credit",
        party_id: "customer_1",
        party_name: "Acme",
        document_number: "CM-1",
        document_date: "2026-08-12",
        currency_code: "USD",
        original_amount: "25",
        open_amount: "0",
        status: "replaced",
        version: 2,
        reversal_transaction_id: "reversal_1",
        replacement_adjustment_id: "credit_2",
        replaces_adjustment_id: null
      } as unknown as Row] });
    }
    if (sql.includes('from "erp_financials"."transactions" transaction')) {
      return Promise.resolve({ rows: [{ memo: "Customer service adjustment" } as unknown as Row] });
    }
    if (sql.includes('from "erp_financials"."subledger_document_lines"')) {
      return Promise.resolve({ rows: [{
        line_id: "credit_line_1",
        line_number: 1,
        account_id: "revenue",
        item_id: null,
        description: "Service credit",
        quantity: "1",
        unit_amount: "25",
        discount_amount: "0",
        tax_code: null,
        tax_amount: "0",
        service_period_start: null,
        service_period_end: null,
        dimension_refs: [],
        line_amount: "25"
      } as unknown as Row] });
    }
    if (sql.includes('from "erp_financials"."ledger_postings" posting')) {
      return Promise.resolve({ rows: [
        {
          posting_id: "posting_1", account_id: "revenue", book_account_key: "revenue",
          account_name: "Revenue", item_id: null, description: "Service credit",
          debit_amount: "25", credit_amount: "0", currency_code: "USD", dimension_refs: []
        },
        {
          posting_id: "posting_2", account_id: "receivable", book_account_key: "receivable",
          account_name: "Accounts Receivable", item_id: null, description: null,
          debit_amount: "0", credit_amount: "25", currency_code: "USD", dimension_refs: []
        }
      ] as unknown as Row[] });
    }
    if (sql.includes('from "erp_financials"."subledger_applications" application')) {
      return Promise.resolve({ rows: [{
        application_id: "application_1",
        invoice_id: "invoice_1",
        application_date: "2026-08-13",
        applied_amount: "5",
        status: "unapplied",
        version: 2
      } as unknown as Row] });
    }
    throw new Error(`Unexpected adjustment query: ${sql}`);
  }
}

function operation() {
  return {
    actorRef: "user:1",
    requestId: "request:1",
    correlationId: "correlation:1",
    reasonCode: "test",
    occurredAt: "2026-08-12T12:00:00.000Z"
  } as const;
}

function outboxEvent(): FinancialOutboxEvent {
  return {
    outboxEventId: "outbox_1",
    tenantId: "tenant_1",
    companyId: "company_1",
    bookId: "book_1",
    sourceId: "source_1",
    eventType: "ledger.posted",
    aggregateType: "journal_entry",
    aggregateId: "transaction_1",
    idempotencyKey: "ledger:1",
    payload: {},
    status: "processing",
    attemptCount: 1,
    availableAt: "2026-08-12T12:00:00.000Z",
    createdAt: "2026-08-12T12:00:00.000Z"
  };
}
