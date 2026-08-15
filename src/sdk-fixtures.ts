import type { FinancialOperationContext } from "./financial-lifecycle.js";
import type {
  BindReportingBookSourceInput,
  DefineReportingBookAccountInput,
  DefineReportingBookInput,
  MapReportingBookAccountInput
} from "./reporting-books.js";

const operation: FinancialOperationContext = {
  actorRef: "fixture:accountant",
  approverRef: "fixture:controller",
  requestId: "fixture-request-sdk-v1",
  correlationId: "fixture-correlation-sdk-v1",
  reasonCode: "sdk_acceptance_fixture",
  occurredAt: "2026-08-12T12:00:00.000Z"
};

/**
 * Provider-neutral cutover fixture: imported history ends before the native
 * write source begins, while both source charts map onto one book-owned chart.
 */
export const ERP_FINANCIALS_SDK_ACCEPTANCE_FIXTURE = {
  scope: {
    tenantId: "tenant_sdk_fixture",
    companyId: "company_sdk_fixture",
    bookId: "book_sdk_fixture",
    historicalSourceId: "source_imported_history",
    writeSourceId: "source_native_erp",
    currencyCode: "USD"
  },
  operation,
  book: {
    operation,
    bookId: "book_sdk_fixture",
    name: "Primary Financial Book",
    baseCurrencyCode: "USD",
    accountingBasis: "accrual"
  } satisfies DefineReportingBookInput,
  sources: [
    {
      operation,
      bookId: "book_sdk_fixture",
      sourceId: "source_imported_history",
      sourceRole: "historical",
      effectiveThrough: "2025-12-31"
    },
    {
      operation,
      bookId: "book_sdk_fixture",
      sourceId: "source_native_erp",
      sourceRole: "active",
      effectiveFrom: "2026-01-01"
    }
  ] satisfies readonly BindReportingBookSourceInput[],
  bookAccounts: [
    {
      operation,
      bookId: "book_sdk_fixture",
      bookAccountKey: "assets",
      name: "Assets",
      classification: "asset",
      accountRole: "header",
      expectedVersion: 0
    },
    {
      operation,
      bookId: "book_sdk_fixture",
      bookAccountKey: "accounts_receivable",
      accountNumber: "1200",
      name: "Accounts Receivable",
      classification: "asset",
      accountRole: "posting",
      expectedVersion: 0,
      parentBookAccountKey: "assets"
    },
    {
      operation,
      bookId: "book_sdk_fixture",
      bookAccountKey: "service_revenue",
      accountNumber: "4000",
      name: "Service Revenue",
      classification: "income",
      accountRole: "posting",
      expectedVersion: 0
    }
  ] satisfies readonly DefineReportingBookAccountInput[],
  mappings: [
    {
      operation,
      bookId: "book_sdk_fixture",
      sourceId: "source_imported_history",
      accountId: "imported_ar",
      bookAccountKey: "accounts_receivable"
    },
    {
      operation,
      bookId: "book_sdk_fixture",
      sourceId: "source_native_erp",
      accountId: "native_ar",
      bookAccountKey: "accounts_receivable"
    }
  ] satisfies readonly MapReportingBookAccountInput[]
} as const;
