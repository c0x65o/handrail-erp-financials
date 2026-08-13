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
