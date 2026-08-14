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
      discountAmount: "2.00",
      taxAmount: "1.50",
      itemId: "item_1"
    })).toMatchObject({
      amount: "24.50",
      quantity: "2.5",
      unitAmount: "10.00",
      discountAmount: "2.00",
      taxAmount: "1.50"
    });

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
