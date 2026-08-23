import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  POSTGRES_CANONICAL_SCHEMA_MANIFEST,
  createErpFinancials,
  createErpFinancialsSdk,
  createFiscalCloseEvidenceChecksum,
  migratePostgresSchema,
  persistQuickBooksSubledgerResources,
  validatePostgresMigrationHistory,
  validatePostgresSchema
} from "../src/index.js";

import type {
  CanonicalAccountingFactSet,
  HandrailQuickBooksSdkResourceSet,
  PostgresMigrationTransactionRunner,
  PostgresQueryClient,
  PostgresQueryResult
} from "../src/index.js";
import type { PoolClient, QueryResultRow } from "pg";

const databaseUrl = process.env.ERP_FINANCIALS_TEST_DATABASE_URL;
const runIntegration = databaseUrl !== undefined;
const describeIntegration = runIntegration ? describe.sequential : describe.skip;

describeIntegration("ERP Financials real PostgreSQL", () => {
  const safeDatabaseUrl = requiredSafeTestDatabaseUrl(databaseUrl);
  const pool = new Pool({ connectionString: safeDatabaseUrl, max: 6 });
  const runner = new PgTransactionRunner(pool);

  beforeEach(async () => {
    await pool.query('drop schema if exists "erp_financials" cascade');
  });

  afterAll(async () => {
    await pool.query('drop schema if exists "erp_financials" cascade');
    await pool.end();
  });

  it("migrates a blank database transactionally and validates schema plus immutable migration history", async () => {
    const result = await migratePostgresSchema(runner, { appliedByRef: "integration:blank-install" });
    const client = new PgQueryClient(pool);
    const schema = await validatePostgresSchema(client);
    const history = await validatePostgresMigrationHistory(client);

    expect(result.targetVersion).toBe(POSTGRES_CANONICAL_SCHEMA_MANIFEST.schemaVersion);
    expect(result.applied.at(-1)?.toVersion).toBe(POSTGRES_CANONICAL_SCHEMA_MANIFEST.schemaVersion);
    expect(schema).toMatchObject({ compatible: true, fixtureSupport: true, issues: [] });
    expect(history).toMatchObject({ compatible: true, currentVersion: 20, issues: [] });
    await expect(
      pool.query("update erp_financials.schema_migrations set name = 'tampered' where to_version = 20")
    ).rejects.toThrow("schema migration history is append-only");
  });

  it("imports and safely replays QuickBooks documents, lines, and applications", async () => {
    await migratePostgresSchema(runner, { appliedByRef: "integration:quickbooks-subledger" });
    await seedQuickBooksImportScope(pool);
    const facts = quickBooksSubledgerFacts();
    const initialResources = quickBooksSubledgerResources("40.00", true, "2026-08-10T10:00:00.000Z");
    const persist = (input: { readonly importedAt: string; readonly resources: HandrailQuickBooksSdkResourceSet }) =>
      runner.transaction((client) => persistQuickBooksSubledgerResources({
        client,
        companyId: "company_qbo",
        facts,
        ...input
      }));

    const first = await persist({
      importedAt: "2026-08-10T10:01:00.000Z",
      resources: initialResources
    });
    expect(first).toMatchObject({ documents: 2, applications: 1, skippedApplications: 0 });
    await expect(quickBooksDocumentState(pool)).resolves.toEqual([
      { source_id: "invoice_600", original_amount: "100.00", open_amount: "60.00", status: "partially_applied" },
      { source_id: "payment_700", original_amount: "40.00", open_amount: "0.00", status: "settled" }
    ]);

    const replay = await persist({
      importedAt: "2026-08-10T10:02:00.000Z",
      resources: initialResources
    });
    expect(replay).toMatchObject({ documents: 0, applications: 0, skippedApplications: 0 });
    await expect(quickBooksDocumentState(pool)).resolves.toEqual([
      { source_id: "invoice_600", original_amount: "100.00", open_amount: "60.00", status: "partially_applied" },
      { source_id: "payment_700", original_amount: "40.00", open_amount: "0.00", status: "settled" }
    ]);

    const revisedResources = quickBooksSubledgerResources("50.00", true, "2026-08-11T10:00:00.000Z");
    await persist({
      importedAt: "2026-08-11T10:01:00.000Z",
      resources: revisedResources
    });
    await expect(quickBooksDocumentState(pool)).resolves.toEqual([
      { source_id: "invoice_600", original_amount: "100.00", open_amount: "50.00", status: "partially_applied" },
      { source_id: "payment_700", original_amount: "50.00", open_amount: "0.00", status: "settled" }
    ]);

    await persist({
      importedAt: "2026-08-12T10:01:00.000Z",
      resources: quickBooksSubledgerResources("50.00", false, "2026-08-12T10:00:00.000Z")
    });
    await expect(quickBooksDocumentState(pool)).resolves.toEqual([
      { source_id: "invoice_600", original_amount: "100.00", open_amount: "100.00", status: "open" },
      { source_id: "payment_700", original_amount: "50.00", open_amount: "50.00", status: "open" }
    ]);
  });

  it("preserves every QuickBooks operational document family and application relationship", async () => {
    await migratePostgresSchema(runner, { appliedByRef: "integration:quickbooks-document-families" });
    await seedQuickBooksAllDocumentScope(pool);
    const facts = quickBooksAllDocumentFacts();
    const resources = quickBooksAllDocumentResources();

    const imported = await runner.transaction((client) => persistQuickBooksSubledgerResources({
      client,
      companyId: "company_qbo",
      importedAt: "2026-08-10T10:01:00.000Z",
      facts,
      resources
    }));

    expect(imported).toMatchObject({
      documents: 11,
      documentLines: 9,
      applications: 4,
      skippedTransactions: 0,
      skippedDocumentLines: 0,
      skippedApplications: 0,
      unresolvedApplications: []
    });
    const documents = await pool.query<{
      document_type: string;
      source_transaction_type: string;
    }>(`
select document_type, metadata ->> 'sourceTransactionType' as source_transaction_type
from erp_financials.subledger_documents
where tenant_id = 'tenant_qbo' and source_id = 'source_qbo'
order by document_type
`);
    expect(documents.rows).toEqual([
      { document_type: "bill_payment", source_transaction_type: "BillPayment" },
      { document_type: "credit_memo", source_transaction_type: "CreditMemo" },
      { document_type: "customer_payment", source_transaction_type: "Payment" },
      { document_type: "deposit", source_transaction_type: "Deposit" },
      { document_type: "invoice", source_transaction_type: "Invoice" },
      { document_type: "purchase", source_transaction_type: "Purchase" },
      { document_type: "refund", source_transaction_type: "RefundReceipt" },
      { document_type: "sales_receipt", source_transaction_type: "SalesReceipt" },
      { document_type: "transfer", source_transaction_type: "Transfer" },
      { document_type: "vendor_bill", source_transaction_type: "Bill" },
      { document_type: "vendor_credit", source_transaction_type: "VendorCredit" }
    ]);

    const applications = await pool.query<{ application_type: string }>(`
select application_type
from erp_financials.subledger_applications
where tenant_id = 'tenant_qbo' and source_id = 'source_qbo'
order by application_type
`);
    expect(applications.rows).toEqual([
      { application_type: "bill_payment_to_bill" },
      { application_type: "credit_to_invoice" },
      { application_type: "customer_payment_to_invoice" },
      { application_type: "vendor_credit_to_bill" }
    ]);

    const semantics = await pool.query<{
      invoice_due_date: string;
      bill_due_date: string;
      invoice_party_type: string;
      bill_party_type: string;
      invoice_quantity: string;
      invoice_unit_amount: string;
      invoice_tax_code: string;
    }>(`
select
  max(document.due_date::text) filter (where document.document_type = 'invoice') as invoice_due_date,
  max(document.due_date::text) filter (where document.document_type = 'vendor_bill') as bill_due_date,
  max(party.party_type) filter (where document.document_type = 'invoice') as invoice_party_type,
  max(party.party_type) filter (where document.document_type = 'vendor_bill') as bill_party_type,
  max(line.quantity::text) filter (where document.document_type = 'invoice') as invoice_quantity,
  max(line.unit_amount::text) filter (where document.document_type = 'invoice') as invoice_unit_amount,
  max(line.tax_code) filter (where document.document_type = 'invoice') as invoice_tax_code
from erp_financials.subledger_documents document
left join erp_financials.parties party on party.party_id = document.party_id
left join erp_financials.subledger_document_lines line
  on line.subledger_document_id = document.subledger_document_id
where document.tenant_id = 'tenant_qbo' and document.source_id = 'source_qbo'
`);
    expect(semantics.rows[0]).toEqual({
      invoice_due_date: "2026-08-31",
      bill_due_date: "2026-08-25",
      invoice_party_type: "customer",
      bill_party_type: "vendor",
      invoice_quantity: "2.00",
      invoice_unit_amount: "50.00",
      invoice_tax_code: "TAX"
    });

    const replay = await runner.transaction((client) => persistQuickBooksSubledgerResources({
      client,
      companyId: "company_qbo",
      importedAt: "2026-08-10T10:02:00.000Z",
      facts,
      resources
    }));
    expect(replay).toMatchObject({ documents: 0, applications: 0, skippedApplications: 0 });
  });

  it("persists and idempotently replays a zero-cash BillPayment as a vendor-credit application", async () => {
    await migratePostgresSchema(runner, { appliedByRef: "integration:quickbooks-credit-only-bill-payment" });
    await seedQuickBooksAllDocumentScope(pool);
    const baseFacts = quickBooksAllDocumentFacts();
    const baseResources = quickBooksAllDocumentResources();
    const resources: HandrailQuickBooksSdkResourceSet = {
      ...baseResources,
      operationalDocuments: baseResources.operationalDocuments?.map((resource) => {
        if (resource.resource.sourceTransactionId === "vendor_credit_all") {
          return {
            ...resource,
            resource: {
              ...resource.resource,
              lines: resource.resource.lines.map((line) => ({ ...line, linkedTransactions: [] }))
            }
          };
        }
        if (resource.resource.sourceTransactionId !== "bill_payment_all") return resource;
        const line = resource.resource.lines[0];
        if (line === undefined) throw new Error("BillPayment integration fixture requires a line.");
        return {
          ...resource,
          resource: {
            ...resource.resource,
            totalAmount: "0.00",
            openAmount: "0.00",
            unappliedAmount: "0.00",
            lines: [
              {
                ...line,
                sourceLineId: "bill-payment-credit-line",
                lineNumber: 1,
                sourceAmount: "10.00",
                linkedTransactions: [{
                  sourceTransactionId: "vendor_credit_all",
                  sourceTransactionType: "VendorCredit"
                }],
                postings: []
              },
              {
                ...line,
                sourceLineId: "bill-payment-bill-line",
                lineNumber: 2,
                sourceAmount: "10.00",
                linkedTransactions: [{ sourceTransactionId: "bill_all", sourceTransactionType: "Bill" }],
                postings: []
              }
            ]
          }
        };
      })
    };
    const facts: CanonicalAccountingFactSet = {
      ...baseFacts,
      transactions: baseFacts.transactions.filter((transaction) =>
        transaction.sourceTransactionId !== "bill_payment_all"
      )
    };
    const persist = (importedAt: string) => runner.transaction((client) =>
      persistQuickBooksSubledgerResources({ client, companyId: "company_qbo", importedAt, facts, resources })
    );

    await expect(persist("2026-08-10T10:01:00.000Z")).resolves.toMatchObject({
      documents: 10,
      applications: 3,
      skippedApplications: 0
    });
    const application = await pool.query<{
      application_type: string;
      source_type: string;
      target_type: string;
      applied_amount: string;
    }>(`
select application.application_type,
  source.metadata ->> 'sourceTransactionType' as source_type,
  target.metadata ->> 'sourceTransactionType' as target_type,
  application.applied_amount::text
from erp_financials.subledger_applications application
join erp_financials.subledger_documents source
  on source.subledger_document_id = application.source_document_id
join erp_financials.subledger_documents target
  on target.subledger_document_id = application.target_document_id
join erp_financials.financial_lifecycle_events event
  on event.event_id = application.applied_event_id
where event.payload ->> 'sourceTransactionId' = 'bill_payment_all'
`);
    expect(application.rows).toEqual([{
      application_type: "vendor_credit_to_bill",
      source_type: "VendorCredit",
      target_type: "Bill",
      applied_amount: "10.00"
    }]);
    await expect(persist("2026-08-10T10:02:00.000Z")).resolves.toMatchObject({
      documents: 0,
      applications: 0,
      skippedApplications: 0
    });
  });

  it("retires deleted delta documents and documents missing from an authoritative full snapshot", async () => {
    await migratePostgresSchema(runner, { appliedByRef: "integration:quickbooks-retirement" });
    await seedQuickBooksImportScope(pool);
    const facts = quickBooksSubledgerFacts();
    await runner.transaction((client) => persistQuickBooksSubledgerResources({
      client,
      companyId: "company_qbo",
      importedAt: "2026-08-10T10:01:00.000Z",
      facts,
      resources: quickBooksSubledgerResources("40.00", true, "2026-08-10T10:00:00.000Z")
    }));
    await pool.query(`
insert into erp_financials.transaction_lines (
  transaction_line_id, tenant_id, source_id, transaction_id, line_number, account_id, amount, dimension_refs
) values
  ('qbo_invoice_line', 'tenant_qbo', 'source_qbo', 'transaction_invoice_qbo', 1, 'account_revenue_qbo', 100, '[]'::jsonb),
  ('qbo_payment_line', 'tenant_qbo', 'source_qbo', 'transaction_payment_qbo', 1, 'account_cash_qbo', 40, '[]'::jsonb);
insert into erp_financials.ledger_postings (
  posting_id, tenant_id, source_id, source_posting_id, transaction_id, transaction_line_id,
  account_id, posting_date, accounting_basis, debit_amount, credit_amount, net_amount, currency_code,
  dimension_hash, dimension_refs,
  import_batch_id, source_payload_ref
) values
  ('qbo_invoice_posting', 'tenant_qbo', 'source_qbo', 'invoice-posting', 'transaction_invoice_qbo',
   'qbo_invoice_line', 'account_revenue_qbo', '2026-08-01', 'accrual', 0, 100, -100, 'USD', repeat('0', 64), '[]'::jsonb, 'batch_qbo', '{}'::jsonb),
  ('qbo_invoice_offset', 'tenant_qbo', 'source_qbo', 'invoice-offset', 'transaction_invoice_qbo',
   null, 'account_cash_qbo', '2026-08-01', 'accrual', 100, 0, 100, 'USD', repeat('0', 64), '[]'::jsonb, 'batch_qbo', '{}'::jsonb),
  ('qbo_payment_posting', 'tenant_qbo', 'source_qbo', 'payment-posting', 'transaction_payment_qbo',
   'qbo_payment_line', 'account_cash_qbo', '2026-08-10', 'accrual', 40, 0, 40, 'USD', repeat('0', 64), '[]'::jsonb, 'batch_qbo', '{}'::jsonb),
  ('qbo_payment_offset', 'tenant_qbo', 'source_qbo', 'payment-offset', 'transaction_payment_qbo',
   null, 'account_revenue_qbo', '2026-08-10', 'accrual', 0, 40, -40, 'USD', repeat('0', 64), '[]'::jsonb, 'batch_qbo', '{}'::jsonb);
`);

    const deltaResources = quickBooksSubledgerResources("40.00", true, "2026-08-11T10:00:00.000Z");
    const deletedPayment = {
      ...deltaResources,
      operationalDocuments: deltaResources.operationalDocuments?.map((resource) =>
        resource.resource.sourceTransactionId === "payment_700"
          ? { ...resource, syncAction: "deleted" as const }
          : resource
      )
    };
    const delta = await runner.transaction((client) => persistQuickBooksSubledgerResources({
      client,
      companyId: "company_qbo",
      importedAt: "2026-08-11T10:01:00.000Z",
      facts,
      resources: deletedPayment
    }));
    expect(delta).toMatchObject({ voidedDocuments: 1, removedLedgerPostings: 2 });
    await expect(quickBooksDocumentState(pool)).resolves.toEqual([
      { source_id: "invoice_600", original_amount: "100.00", open_amount: "100.00", status: "open" },
      { source_id: "payment_700", original_amount: "40.00", open_amount: "0", status: "voided" }
    ]);

    const invoiceOnly = {
      ...quickBooksSubledgerResources("40.00", false, "2026-08-12T10:00:00.000Z"),
      operationalDocuments: quickBooksSubledgerResources("40.00", false, "2026-08-12T10:00:00.000Z")
        .operationalDocuments?.filter((resource) => resource.resource.sourceTransactionId === "payment_700")
    };
    const full = await runner.transaction((client) => persistQuickBooksSubledgerResources({
      client,
      companyId: "company_qbo",
      importedAt: "2026-08-12T10:01:00.000Z",
      facts,
      resources: invoiceOnly,
      replaceMissingDocuments: true
    }));
    expect(full).toMatchObject({ voidedDocuments: 1, removedLedgerPostings: 2 });
    await expect(quickBooksDocumentState(pool)).resolves.toEqual([
      { source_id: "invoice_600", original_amount: "100.00", open_amount: "0", status: "voided" },
      { source_id: "payment_700", original_amount: "40.00", open_amount: "40.00", status: "open" }
    ]);
  });

  it("reads canonical journal and fiscal controls through the public SDK", async () => {
    await migratePostgresSchema(runner, { appliedByRef: "integration:accounting-control-reads" });
    await seedAccountingScope(pool);
    const sdk = createErpFinancialsSdk({
      database: runner,
      tenantId: "tenant_1",
      companyId: "company_1",
      bookId: "book_primary",
      writeSourceId: "source_1",
      currencyCode: "USD",
      postingPolicy: "legacy_unrestricted",
      now: () => "2026-08-31T23:30:00.000Z"
    });
    await sdk.books.define({
      operation: { ...sdkOperation(), requestId: "request:book" },
      bookId: "book_primary",
      name: "Primary",
      baseCurrencyCode: "USD"
    });
    await sdk.books.bindSource({
      operation: { ...sdkOperation(), requestId: "request:book-source" },
      bookId: "book_primary",
      sourceId: "source_1",
      sourceRole: "active",
      effectiveFrom: "2026-01-01"
    });
    const posted = await sdk.commands.journalEntries.post({
      operation: { ...sdkOperation(), requestId: "request:journal" },
      idempotencyKey: "integration-journal-read",
      date: "2026-08-15",
      transactionNumber: "JE-INTEGRATION-1",
      memo: "Accrued service revenue",
      lines: [
        { accountId: "account_ar", debit: "125.50" },
        { accountId: "account_income", credit: "125.50" }
      ]
    });
    const defined = await sdk.commands.fiscalPeriods.define({
      operation: { ...sdkOperation(), requestId: "request:period-define" },
      fiscalYear: 2026,
      periodNumber: 8,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31"
    });
    const closing = await sdk.commands.fiscalPeriods.beginClose({
      operation: { ...sdkOperation(), requestId: "request:period-begin-close" },
      fiscalPeriodId: defined.fiscalPeriodId,
      expectedVersion: defined.version
    });
    const evidenceMaterial = {
      trialBalanceSnapshotId: "trial_balance_integration",
      reconciliationRefs: ["reconciliation_integration"],
      checklistRef: "checklist_integration",
      postingMaxUpdatedAt: "2026-08-31T23:00:00.000Z"
    } as const;
    await sdk.commands.fiscalPeriods.close({
      operation: { ...sdkOperation(), requestId: "request:period-close" },
      fiscalPeriodId: defined.fiscalPeriodId,
      expectedVersion: closing.version,
      evidence: { ...evidenceMaterial, evidenceChecksum: createFiscalCloseEvidenceChecksum(evidenceMaterial) }
    });

    await expect(sdk.queries.listJournalEntries({ limit: 25 })).resolves.toMatchObject({
      items: [{ journalEntryId: posted.transactionId, totalDebit: "125.50", totalCredit: "125.50", version: 1 }]
    });
    await expect(sdk.queries.getJournalEntry(posted.transactionId)).resolves.toMatchObject({
      journalEntryId: posted.transactionId,
      lines: [{ debitAmount: "125.50" }, { creditAmount: "125.50" }]
    });
    await expect(sdk.queries.getFiscalPeriod("source_1", defined.fiscalPeriodId)).resolves.toMatchObject({
      status: "closed",
      version: 3,
      closeEvidence: { trialBalanceSnapshotId: "trial_balance_integration" }
    });
    await expect(sdk.queries.getPostingLock("source_1")).resolves.toMatchObject({
      postingLockDate: "2026-08-31",
      version: 1
    });
  });

  it("reads both sides of the QuickBooks-to-Spartan cutoff through one reporting book", async () => {
    await migratePostgresSchema(runner, { appliedByRef: "integration:cutoff-continuity" });
    await seedAccountingScope(pool);
    await pool.query(`
update erp_financials.accounting_sources set source_system = 'quickbooks' where source_id = 'source_1';
insert into erp_financials.company_sources values ('company_source_2', 'tenant_1', 'company_1', 'source_2', now());
insert into erp_financials.accounts (account_id, tenant_id, source_id, source_account_id, name, type, classification, active)
values ('native_cash', 'tenant_1', 'source_2', 'cash', 'Cash', 'Bank', 'asset', true),
       ('native_ar', 'tenant_1', 'source_2', 'ar', 'Receivable', 'Accounts Receivable', 'asset', true),
       ('native_ap', 'tenant_1', 'source_2', 'ap', 'Payable', 'Accounts Payable', 'liability', true),
       ('native_income', 'tenant_1', 'source_2', 'income', 'Service Revenue', 'Income', 'income', true);
insert into erp_financials.parties (party_id, tenant_id, source_id, source_party_id, party_type, display_name, active)
values ('native_customer', 'tenant_1', 'source_2', 'customer:1', 'customer', 'Customer One', true),
       ('native_vendor', 'tenant_1', 'source_2', 'vendor:1', 'vendor', 'Vendor One', true);
`);
    const operation = sdkOperation();
    const sdk = createErpFinancialsSdk({
      database: runner, tenantId: "tenant_1", companyId: "company_1", bookId: "book_cutoff",
      writeSourceId: "source_2", currencyCode: "USD", postingPolicy: "legacy_unrestricted",
      now: () => "2026-09-02T12:00:00.000Z"
    });
    await sdk.books.define({ operation, bookId: "book_cutoff", name: "Cutoff book", baseCurrencyCode: "USD" });
    await sdk.books.bindSource({
      operation, bookId: "book_cutoff", sourceId: "source_1", sourceRole: "historical",
      effectiveThrough: "2026-08-31"
    });
    await sdk.books.bindSource({
      operation, bookId: "book_cutoff", sourceId: "source_2", sourceRole: "active",
      effectiveFrom: "2026-09-01"
    });
    for (const account of [
      { bookAccountKey: "cash", accountNumber: "1000", name: "Cash", classification: "asset" as const },
      { bookAccountKey: "receivable", accountNumber: "1100", name: "Accounts receivable", classification: "asset" as const },
      { bookAccountKey: "payable", accountNumber: "2000", name: "Accounts payable", classification: "liability" as const },
      { bookAccountKey: "revenue", accountNumber: "4000", name: "Service revenue", classification: "income" as const },
    ]) {
      await sdk.books.defineAccount({ operation, bookId: "book_cutoff", expectedVersion: 0, accountRole: "posting", type: account.name, ...account });
    }
    for (const mapping of [
      ["source_1", "account_cash", "cash"], ["source_1", "account_ar", "receivable"],
      ["source_1", "account_ap", "payable"], ["source_1", "account_income", "revenue"],
      ["source_2", "native_cash", "cash"], ["source_2", "native_ar", "receivable"],
      ["source_2", "native_ap", "payable"], ["source_2", "native_income", "revenue"],
    ] as const) {
      await sdk.books.mapAccount({ operation, bookId: "book_cutoff", sourceId: mapping[0], accountId: mapping[1], bookAccountKey: mapping[2] });
    }
    const qbo = createErpFinancials({
      database: runner, tenantId: "tenant_1", companyId: "company_1", sourceId: "source_1",
      currencyCode: "USD", postingPolicy: "legacy_unrestricted", now: () => "2026-08-31T23:00:00.000Z"
    });
    const native = createErpFinancials({
      database: runner, tenantId: "tenant_1", companyId: "company_1", sourceId: "source_2",
      currencyCode: "USD", postingPolicy: "legacy_unrestricted", now: () => "2026-09-01T12:00:00.000Z"
    });
    await qbo.invoices.create({
      operation, idempotencyKey: "cutoff-qbo-invoice", date: "2026-08-31", dueDate: "2026-09-30",
      customerId: "customer_1", receivableAccount: { accountId: "account_ar" },
      revenueLines: [{ accountId: "account_income", amount: "100.00" }]
    });
    await qbo.vendorBills.create({
      operation, idempotencyKey: "cutoff-qbo-bill", date: "2026-08-31", dueDate: "2026-09-30",
      vendorId: "vendor_1", payableAccount: { accountId: "account_ap" },
      expenseLines: [{ accountId: "account_cash", amount: "40.00" }]
    });
    await expect(native.invoices.create({
      operation: { ...operation, requestId: "cutoff-backdated-native" },
      idempotencyKey: "cutoff-backdated-native", date: "2026-08-31", dueDate: "2026-09-30",
      customerId: "native_customer", receivableAccount: { accountId: "native_ar" },
      revenueLines: [{ accountId: "native_income", amount: "1.00" }]
    })).rejects.toThrow("outside every reporting-book window");
    await native.invoices.create({
      operation, idempotencyKey: "cutoff-native-invoice", date: "2026-09-01", dueDate: "2026-10-01",
      customerId: "native_customer", receivableAccount: { accountId: "native_ar" },
      revenueLines: [{ accountId: "native_income", amount: "100.00" }]
    });
    await native.vendorBills.create({
      operation, idempotencyKey: "cutoff-native-bill", date: "2026-09-01", dueDate: "2026-10-01",
      vendorId: "native_vendor", payableAccount: { accountId: "native_ap" },
      expenseLines: [{ accountId: "native_cash", amount: "40.00" }]
    });

    const window = { periodStart: "2026-08-31" as const, periodEnd: "2026-09-01" as const };
    const ledger = await sdk.queries.listGeneralLedger({ ...window, limit: 100 });
    expect(new Set(ledger.items.map((line) => line.sourceProvenance.sourceId))).toEqual(new Set(["source_1", "source_2"]));
    await expect(sdk.queries.getGeneralLedgerSummary(window)).resolves.toMatchObject({
      postingCount: 8, totalDebits: "280.00", totalCredits: "280.00", difference: "0.00"
    });
    await expect(sdk.queries.getFinancialStatement({ reportName: "profit_and_loss", ...window })).resolves.toMatchObject({
      totals: { income: "200.00" }
    });
    await expect(sdk.queries.getFinancialStatement({ reportName: "balance_sheet", ...window, asOfDate: "2026-09-01" })).resolves.toMatchObject({
      reportName: "balance_sheet",
      totals: { difference: "0.00" }
    });
    await expect(sdk.queries.getFinancialStatement({ reportName: "trial_balance", ...window, asOfDate: "2026-09-01" })).resolves.toMatchObject({
      reportName: "trial_balance"
    });
    await expect(sdk.queries.getAging({ kind: "receivables", asOfDate: "2026-09-01" })).resolves.toMatchObject({
      totals: { total: "200.00" }
    });
    await expect(sdk.queries.getAging({ kind: "payables", asOfDate: "2026-09-01" })).resolves.toMatchObject({
      totals: { total: "80.00" }
    });
  });

  it("upgrades a real v6 database through the scoped v7 migration before continuing", async () => {
    await migratePostgresSchema(runner, { appliedByRef: "integration:v6", targetVersion: 6 });
    await expect(snapshotScopeColumns(pool)).resolves.toEqual([]);

    const v7 = await migratePostgresSchema(runner, { appliedByRef: "integration:v7", targetVersion: 7 });

    expect(v7.currentVersion).toBe(6);
    expect(v7.applied.map((migration) => migration.toVersion)).toEqual([7]);
    await expect(snapshotScopeColumns(pool)).resolves.toEqual(["company_id", "source_id"]);
  });

  it("rolls back every DDL and ledger row when an ordered migration fails", async () => {
    const failingRunner: PostgresMigrationTransactionRunner = {
      transaction: (work) =>
        runner.transaction((client) =>
          work(new FailingMigrationClient(client, 'create table "erp_financials"."company_sources"'))
        )
    };

    await expect(
      migratePostgresSchema(failingRunner, { appliedByRef: "integration:rollback" })
    ).rejects.toThrow("injected real migration failure");

    const relation = await pool.query<{ relation_name: string | null }>(
      "select to_regclass('erp_financials.report_snapshots') as relation_name"
    );
    expect(relation.rows[0]?.relation_name).toBeNull();
  });

  it("enforces scoped foreign keys, posting arithmetic, and immutable posted journal facts", async () => {
    await migratePostgresSchema(runner, { appliedByRef: "integration:constraints" });
    await seedAccountingScope(pool);

    await pool.query(`
insert into erp_financials.transactions (
  transaction_id, tenant_id, source_id, source_transaction_id, source_transaction_type, transaction_date,
  posted_at, updated_at, currency_code, status, source_payload_ref
) values
  ('journal_reversal_1', 'tenant_1', 'source_1', 'reversal:1', 'JournalEntryAdjustment', '2026-08-02', now(), now(), 'USD', 'posted', '{}'::jsonb),
  ('journal_reversal_2', 'tenant_1', 'source_1', 'reversal:2', 'JournalEntryAdjustment', '2026-08-03', now(), now(), 'USD', 'posted', '{}'::jsonb);
insert into erp_financials.financial_lifecycle_events values
  ('event_reversal_1', 'tenant_1', 'company_1', 'source_1', 'journal_entry', 'journal_1', 'reversed', 'user:1', 'user:2', 'request:r1', 'correlation:r', 'test', null, now(), now(), 'event_reversal_1', repeat('a',64), '{}'::jsonb, null),
  ('event_reversal_2', 'tenant_1', 'company_1', 'source_1', 'journal_entry', 'journal_1', 'voided', 'user:1', 'user:2', 'request:r2', 'correlation:r', 'test', null, now(), now(), 'event_reversal_2', repeat('a',64), '{}'::jsonb, null);
insert into erp_financials.journal_entry_links values
  ('link_reversal_1', 'tenant_1', 'company_1', 'source_1', 'journal_1', 'journal_reversal_1', 'reversal', 'event_reversal_1', now());
`);
    await expect(
      pool.query(
        "insert into erp_financials.journal_entry_links values ('link_reversal_2', 'tenant_1', 'company_1', 'source_1', 'journal_1', 'journal_reversal_2', 'void', 'event_reversal_2', now())"
      )
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      pool.query(
        `insert into erp_financials.accounts (
  account_id, tenant_id, source_id, source_account_id, name, type, classification, parent_account_id, active
) values ('account_cross_scope', 'tenant_1', 'source_2', 'cross', 'Cross scope', 'asset', 'asset', 'account_cash', true)`
      )
    ).rejects.toMatchObject({ code: "23503" });

    await expect(
      pool.query(
        `insert into erp_financials.ledger_postings (
  posting_id, tenant_id, source_id, source_posting_id, transaction_id, transaction_line_id, account_id,
  posting_date, accounting_basis, debit_amount, credit_amount, net_amount, currency_code, dimension_hash,
  dimension_refs, import_batch_id
) values (
  'posting_bad', 'tenant_1', 'source_1', 'bad', 'journal_1', 'line_1', 'account_cash',
  '2026-08-01', 'accrual', 10, 2, 8, 'USD', repeat('a', 64), '[]'::jsonb, 'batch_1'
)`
      )
    ).rejects.toMatchObject({ code: "23514" });

    await pool.query(
      `insert into erp_financials.ledger_postings (
  posting_id, tenant_id, source_id, source_posting_id, transaction_id, transaction_line_id, account_id,
  posting_date, accounting_basis, debit_amount, credit_amount, net_amount, currency_code, dimension_hash,
  dimension_refs, import_batch_id
) values (
  'posting_1', 'tenant_1', 'source_1', 'good', 'journal_1', 'line_1', 'account_cash',
  '2026-08-01', 'accrual', 10, 0, 10, 'USD', repeat('a', 64), '[]'::jsonb, 'batch_1'
)`
    );
    await expect(
      pool.query("update erp_financials.transactions set memo = 'changed' where transaction_id = 'journal_1'")
    ).rejects.toThrow("posted journal entries are immutable");
    await expect(
      pool.query("delete from erp_financials.ledger_postings where posting_id = 'posting_1'")
    ).rejects.toThrow("posted journal entry facts are immutable");
  });

  it("serializes advisory locks and preserves repeatable-read snapshot isolation", async () => {
    await migratePostgresSchema(runner, { appliedByRef: "integration:locks" });
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query("begin isolation level repeatable read");
      await second.query("begin");
      await first.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", ["integration:lock"]);
      const unavailable = await second.query<{ acquired: boolean }>(
        "select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired",
        ["integration:lock"]
      );
      expect(unavailable.rows[0]?.acquired).toBe(false);

      const before = await first.query<{ count: string }>("select count(*)::text as count from erp_financials.schema_migrations");
      await second.query("insert into erp_financials.schema_migrations values ('integration_probe', 14, 15, 'probe', repeat('b', 64), 'probe', 0, 'integration', clock_timestamp())");
      await second.query("commit");
      const during = await first.query<{ count: string }>("select count(*)::text as count from erp_financials.schema_migrations");
      expect(during.rows[0]?.count).toBe(before.rows[0]?.count);
      await first.query("rollback");

      const third = await pool.connect();
      try {
        await third.query("begin");
        const available = await third.query<{ acquired: boolean }>(
          "select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired",
          ["integration:lock"]
        );
        expect(available.rows[0]?.acquired).toBe(true);
        await third.query("rollback");
      } finally {
        third.release();
      }
    } finally {
      await first.query("rollback").catch(() => undefined);
      await second.query("rollback").catch(() => undefined);
      first.release();
      second.release();
    }
  });

  it("atomically enforces application balance, party, currency, terminal state, and unapply restoration", async () => {
    await migratePostgresSchema(runner, { appliedByRef: "integration:applications" });
    await seedAccountingScope(pool);
    await seedSubledgerDocuments(pool);

    await expect(
      pool.query(
        `insert into erp_financials.subledger_documents (
  subledger_document_id, tenant_id, company_id, source_id, document_type, transaction_id, party_id,
  document_date, currency_code, original_amount, open_amount, status, version, idempotency_key,
  lifecycle_event_id, metadata, created_at, updated_at
) values ('document_mismatched_journal', 'tenant_1', 'company_1', 'source_1', 'invoice', 'txn_payment',
  'customer_1', '2026-08-05', 'USD', 10, 10, 'open', 1, 'document_mismatched_journal',
  'event_payment', '{}'::jsonb, now(), now())`
      )
    ).rejects.toThrow("must match its posted journal type, currency, and party");

    await expect(
      pool.query(
        `insert into erp_financials.subledger_applications (
  subledger_application_id, tenant_id, company_id, source_id, application_type, source_document_id,
  target_document_id, applied_amount, currency_code, application_date, status, version, idempotency_key,
  applied_event_id, ended_event_id, created_at, updated_at
) values ('application_invalid_initial', 'tenant_1', 'company_1', 'source_1', 'customer_payment_to_invoice',
  'payment_1', 'invoice_1', 1, 'USD', '2026-08-05', 'unapplied', 2, 'apply_invalid_initial',
  'event_apply', 'event_apply', now(), now())`
      )
    ).rejects.toThrow("must begin applied at version 1");

    await expect(
      pool.query(
        `insert into erp_financials.subledger_applications (
  subledger_application_id, tenant_id, company_id, source_id, application_type, source_document_id,
  target_document_id, applied_amount, currency_code, application_date, status, version, idempotency_key,
  applied_event_id, created_at, updated_at
) values ('application_party', 'tenant_1', 'company_1', 'source_1', 'customer_payment_to_invoice',
  'payment_other_party', 'invoice_1', 1, 'USD', '2026-08-05', 'applied', 1, 'apply_party', 'event_apply', now(), now())`
      )
    ).rejects.toThrow("same non-null party");
    await expect(
      pool.query(
        `insert into erp_financials.subledger_applications (
  subledger_application_id, tenant_id, company_id, source_id, application_type, source_document_id,
  target_document_id, applied_amount, currency_code, application_date, status, version, idempotency_key,
  applied_event_id, created_at, updated_at
) values ('application_currency', 'tenant_1', 'company_1', 'source_1', 'customer_payment_to_invoice',
  'payment_eur', 'invoice_1', 1, 'EUR', '2026-08-05', 'applied', 1, 'apply_currency', 'event_apply', now(), now())`
      )
    ).rejects.toThrow("currency must match");
    await expect(
      pool.query("update erp_financials.transactions set memo = 'changed' where transaction_id = 'txn_invoice'")
    ).rejects.toThrow("posted journal entries are immutable");
    await expect(
      pool.query("update erp_financials.subledger_documents set open_amount = 99 where subledger_document_id = 'invoice_1'")
    ).rejects.toThrow("posted subledger documents are immutable");

    await pool.query(
      `insert into erp_financials.subledger_applications (
  subledger_application_id, tenant_id, company_id, source_id, application_type, source_document_id,
  target_document_id, applied_amount, currency_code, application_date, status, version, idempotency_key,
  applied_event_id, created_at, updated_at
) values (
  'application_1', 'tenant_1', 'company_1', 'source_1', 'customer_payment_to_invoice', 'payment_1',
  'invoice_1', 60, 'USD', '2026-08-05', 'applied', 1, 'apply_1', 'event_apply', now(), now()
)`
    );
    await expect(documentBalances(pool)).resolves.toEqual([
      { subledger_document_id: "invoice_1", open_amount: "40", status: "partially_applied", version: 2 },
      { subledger_document_id: "payment_1", open_amount: "0", status: "settled", version: 2 }
    ]);

    await pool.query(
      `insert into erp_financials.financial_lifecycle_events values (
  'event_over', 'tenant_1', 'company_1', 'source_1', 'subledger_application', 'application_over', 'applied',
  'user:1', null, 'request:over', 'correlation:1', 'test', null, now(), now(), 'event_over', repeat('a',64), '{}'::jsonb, null
)`
    );
    await expect(
      pool.query(
        `insert into erp_financials.subledger_applications (
  subledger_application_id, tenant_id, company_id, source_id, application_type, source_document_id,
  target_document_id, applied_amount, currency_code, application_date, status, version, idempotency_key,
  applied_event_id, created_at, updated_at
) values ('application_over', 'tenant_1', 'company_1', 'source_1', 'customer_payment_to_invoice',
  'payment_1', 'invoice_1', 1, 'USD', '2026-08-05', 'applied', 1, 'apply_over', 'event_over', now(), now())`
      )
    ).rejects.toThrow("exceeds an available document balance");

    await pool.query(
      `insert into erp_financials.financial_lifecycle_events values (
  'event_unapply', 'tenant_1', 'company_1', 'source_1', 'subledger_application', 'application_1', 'unapplied',
  'user:1', 'user:2', 'request:unapply', 'correlation:1', 'test', null, now(), now(), 'event_unapply', repeat('a',64), '{}'::jsonb, 'event_apply'
)`
    );
    await expect(
      pool.query(
        "update erp_financials.subledger_applications set status = 'unapplied', version = 9, ended_event_id = 'event_unapply', updated_at = now() where subledger_application_id = 'application_1'"
      )
    ).rejects.toThrow("must increment version and timestamp");
    await pool.query(
      "update erp_financials.subledger_applications set status = 'unapplied', version = 2, ended_event_id = 'event_unapply', updated_at = now() where subledger_application_id = 'application_1'"
    );
    await expect(documentBalances(pool)).resolves.toEqual([
      { subledger_document_id: "invoice_1", open_amount: "100", status: "open", version: 3 },
      { subledger_document_id: "payment_1", open_amount: "60", status: "open", version: 3 }
    ]);
    await expect(
      pool.query("delete from erp_financials.subledger_applications where subledger_application_id = 'application_1'")
    ).rejects.toThrow("cannot be deleted");
  });

  it("atomically settles invoice write-offs and rejects locked application transitions", async () => {
    await migratePostgresSchema(runner, { appliedByRef: "integration:write-off-settlement" });
    await seedAccountingScope(pool);
    const unrestricted = createErpFinancials({
      database: runner,
      tenantId: "tenant_1",
      companyId: "company_1",
      sourceId: "source_1",
      currencyCode: "USD",
      postingPolicy: "legacy_unrestricted",
      now: () => "2026-08-12T12:00:00.000Z"
    });
    const invoice = await unrestricted.invoices.create({
      operation: sdkOperation(),
      idempotencyKey: "integration-write-off-invoice",
      date: "2026-08-01",
      dueDate: "2026-08-31",
      customerId: "customer_1",
      receivableAccount: { accountId: "account_ar" },
      revenueLines: [{ accountId: "account_income", amount: "40.00" }]
    });
    const settlementInput = {
      operation: sdkOperation(),
      idempotencyKey: "integration-write-off-settlement",
      date: "2026-08-08" as const,
      customerId: "customer_1",
      invoiceId: invoice.documentId,
      expectedInvoiceVersion: 1,
      amount: "15.00" as const,
      balanceAccount: { accountId: "account_ar" as const },
      writeOffAccount: { accountId: "account_income" as const },
      reason: "Approved integration write-off"
    };

    const settlement = await unrestricted.writeOffs.settleInvoice(settlementInput);
    await expect(unrestricted.writeOffs.settleInvoice(settlementInput)).resolves.toMatchObject({
      status: "already_settled",
      application: { status: "already_applied" }
    });
    expect(settlement).toMatchObject({
      status: "settled",
      invoiceOpenAmount: "25.00",
      invoiceStatus: "partially_applied",
      invoiceVersion: 2,
      writeOffVersion: 2,
      application: { appliedAmount: "15.00", version: 1 }
    });
    const facts = await pool.query<{
      application_type: string;
      invoice_open_amount: string;
      invoice_status: string;
      write_off_open_amount: string;
      write_off_status: string;
    }>(
      `select application.application_type,
  invoice.open_amount::text as invoice_open_amount, invoice.status as invoice_status,
  write_off.open_amount::text as write_off_open_amount, write_off.status as write_off_status
from erp_financials.subledger_applications application
join erp_financials.subledger_documents invoice on invoice.subledger_document_id = application.target_document_id
join erp_financials.subledger_documents write_off on write_off.subledger_document_id = application.source_document_id
where application.subledger_application_id = $1`,
      [settlement.application.applicationId]
    );
    expect(facts.rows).toEqual([{
      application_type: "write_off_to_invoice",
      invoice_open_amount: "25",
      invoice_status: "partially_applied",
      write_off_open_amount: "0",
      write_off_status: "settled"
    }]);

    await pool.query(
      `insert into erp_financials.fiscal_periods (
  fiscal_period_id, tenant_id, company_id, source_id, fiscal_year, period_number,
  period_start, period_end, status, version, created_at, updated_at
) values ('period_2026_08', 'tenant_1', 'company_1', 'source_1', 2026, 8,
  '2026-08-01', '2026-08-31', 'closing', 1, now(), now())`
    );
    const enforced = createErpFinancials({
      database: runner,
      tenantId: "tenant_1",
      companyId: "company_1",
      sourceId: "source_1",
      currencyCode: "USD",
      postingPolicy: "enforce_fiscal_periods",
      now: () => "2026-08-12T12:00:00.000Z"
    });
    await expect(enforced.paymentApplications.unapply({
      operation: sdkOperation(),
      applicationId: settlement.application.applicationId,
      effectiveDate: "2026-08-08",
      expectedVersion: 1
    })).rejects.toMatchObject({ code: "fiscal_period_closing" });
    await expect(
      pool.query("select status, version from erp_financials.subledger_applications where subledger_application_id = $1", [
        settlement.application.applicationId
      ])
    ).resolves.toMatchObject({ rows: [{ status: "applied", version: 1 }] });
  });

  it("voids and reloads a canonical bill payment through real PostgreSQL", async () => {
    await migratePostgresSchema(runner, { appliedByRef: "integration:bill-payment-void" });
    await seedAccountingScope(pool);
    const sdk = createErpFinancialsSdk({
      database: runner,
      tenantId: "tenant_1",
      companyId: "company_1",
      bookId: "book_primary",
      writeSourceId: "source_1",
      currencyCode: "USD",
      postingPolicy: "legacy_unrestricted",
      now: () => "2026-08-12T12:00:00.000Z"
    });
    const operation = sdkOperation();
    await sdk.books.define({
      operation,
      bookId: "book_primary",
      name: "Primary",
      baseCurrencyCode: "USD"
    });
    await sdk.books.bindSource({
      operation,
      bookId: "book_primary",
      sourceId: "source_1",
      sourceRole: "active",
      effectiveFrom: "2026-01-01"
    });
    const payment = await sdk.commands.billPayments.record({
      operation,
      idempotencyKey: "integration-bill-payment",
      date: "2026-08-05",
      documentNumber: "PAY-100",
      memo: "Duplicate payment",
      vendorId: "vendor_1",
      amount: "20.00",
      payableAccount: { accountId: "account_ap" },
      cashAccount: { accountId: "account_cash" }
    });
    await expect(sdk.queries.listPayments({
      paymentType: "bill_payment",
      vendorId: "vendor_1",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      status: "unapplied"
    })).resolves.toMatchObject({
      items: [{ paymentId: payment.documentId, transactionId: payment.journal.transactionId, version: 1 }]
    });

    const command = {
      operation,
      billPaymentId: payment.documentId,
      expectedVersion: 1,
      idempotencyKey: "integration-void-bill-payment",
      date: "2026-08-12" as const,
      memo: "Void duplicate payment"
    };
    await expect(sdk.commands.billPayments.void(command)).resolves.toMatchObject({
      status: "voided",
      originalBillPaymentId: payment.documentId,
      originalVersion: 2
    });
    await expect(sdk.commands.billPayments.void(command)).resolves.toMatchObject({
      status: "already_voided",
      reversal: { status: "already_posted" }
    });
    await expect(sdk.queries.getBillPayment(payment.documentId)).resolves.toMatchObject({
      paymentId: payment.documentId,
      vendorId: "vendor_1",
      transactionId: payment.journal.transactionId,
      amount: "20.00",
      status: "voided",
      version: 2,
      memo: "Duplicate payment",
      lifecycle: {
        posted: { actorRef: operation.actorRef },
        voided: { actorRef: operation.actorRef, approverRef: operation.approverRef }
      },
      applications: []
    });
    await expect(sdk.queries.listPayments({
      paymentType: "bill_payment",
      vendorId: "vendor_1",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      status: "voided"
    })).resolves.toMatchObject({ items: [{ paymentId: payment.documentId, version: 2 }] });
  });

  it("atomically clears ordered vendor bills, exposes provenance and summary, and compensates applications", async () => {
    await migratePostgresSchema(runner, { appliedByRef: "integration:bill-payment-disbursement" });
    await seedAccountingScope(pool);
    const operation = sdkOperation();
    const sdk = createErpFinancialsSdk({
      database: runner,
      tenantId: "tenant_1",
      companyId: "company_1",
      bookId: "book_primary",
      writeSourceId: "source_1",
      currencyCode: "USD",
      postingPolicy: "legacy_unrestricted",
      now: () => "2026-08-12T12:00:00.000Z"
    });
    await sdk.books.define({ operation, bookId: "book_primary", name: "Primary", baseCurrencyCode: "USD" });
    await sdk.books.bindSource({
      operation,
      bookId: "book_primary",
      sourceId: "source_1",
      sourceRole: "active",
      effectiveFrom: "2026-01-01"
    });
    const firstBill = await sdk.commands.vendorBills.create({
      operation,
      idempotencyKey: "integration-disbursement-bill-1",
      date: "2026-08-01",
      dueDate: "2026-08-31",
      vendorId: "vendor_1",
      payableAccount: { accountId: "account_ap" },
      expenseLines: [{ accountId: "account_cash", amount: "12.00" }]
    });
    const secondBill = await sdk.commands.vendorBills.create({
      operation,
      idempotencyKey: "integration-disbursement-bill-2",
      date: "2026-08-02",
      dueDate: "2026-08-31",
      vendorId: "vendor_1",
      payableAccount: { accountId: "account_ap" },
      expenseLines: [{ accountId: "account_cash", amount: "8.00" }]
    });
    const command = {
      operation,
      idempotencyKey: "integration-disbursement",
      date: "2026-08-10" as const,
      documentNumber: "PAY-200",
      vendorId: "vendor_1",
      amount: "20.00",
      paymentMethod: "ach" as const,
      reference: "ACH-200",
      payableAccount: { accountId: "account_ap" },
      cashAccount: { accountId: "account_cash" },
      allocations: [
        { billId: firstBill.documentId, amount: "12.00", expectedBillVersion: 1 },
        { billId: secondBill.documentId, amount: "8.00", expectedBillVersion: 1 }
      ]
    };
    const cleared = await sdk.commands.billPayments.recordAndApply(command);
    await expect(sdk.commands.billPayments.recordAndApply(command)).resolves.toMatchObject({
      status: "already_cleared",
      billPaymentId: cleared.billPaymentId
    });
    await expect(sdk.queries.getBillPayment(cleared.billPaymentId)).resolves.toMatchObject({
      status: "cleared",
      paymentMethod: "ach",
      reference: "ACH-200",
      fundingAccount: { accountId: "account_cash", creditAmount: "20.00" },
      payableAccount: { accountId: "account_ap", debitAmount: "20.00" },
      applications: [
        { targetDocumentId: firstBill.documentId, amount: "12.00" },
        { targetDocumentId: secondBill.documentId, amount: "8.00" }
      ]
    });
    await expect(sdk.queries.getBillPaymentSummary({
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      status: "cleared"
    })).resolves.toMatchObject({ clearedAmount: "20.00", clearedCount: 1, totalAmount: "20.00", totalCount: 1 });

    const compensated = await sdk.commands.billPayments.voidAndUnapply({
      operation: { ...operation, requestId: "request:compensate-disbursement" },
      billPaymentId: cleared.billPaymentId,
      expectedVersion: 2,
      idempotencyKey: "integration-compensate-disbursement",
      date: "2026-08-12",
      memo: "Rejected ACH"
    });
    expect(compensated).toMatchObject({ status: "voided", disbursementVersion: 3 });
    await expect(sdk.queries.getVendorBill(firstBill.documentId)).resolves.toMatchObject({
      status: "open",
      openAmount: "12.00"
    });
    await expect(sdk.queries.getVendorBill(secondBill.documentId)).resolves.toMatchObject({
      status: "open",
      openAmount: "8.00"
    });
  });

  it("uses the scoped transaction identity index for an important journal lookup", async () => {
    await migratePostgresSchema(runner, { appliedByRef: "integration:query-plan" });
    await seedAccountingScope(pool);
    const client = await pool.connect();
    try {
      await client.query("set enable_seqscan = off");
      const plan = await client.query<{ "QUERY PLAN": string }>(
        `explain select * from erp_financials.transactions
where tenant_id = 'tenant_1' and source_id = 'source_1' and transaction_id = 'journal_1'`
      );
      expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("transactions_scope_uidx");
    } finally {
      client.release();
    }
  });

  it("runs the host-facing SDK from book setup through invoice, atomic match, reconciliation, reads, and outbox delivery", async () => {
    await migratePostgresSchema(runner, { appliedByRef: "integration:sdk-v1" });
    await seedAccountingScope(pool);
    const operation = sdkOperation();
    const sdk = createErpFinancialsSdk({
      database: runner,
      tenantId: "tenant_1",
      companyId: "company_1",
      bookId: "book_primary",
      writeSourceId: "source_1",
      currencyCode: "USD",
      postingPolicy: "legacy_unrestricted",
      now: () => "2026-08-12T12:00:00.000Z"
    });

    await sdk.books.define({
      operation,
      bookId: "book_primary",
      name: "Primary",
      baseCurrencyCode: "USD"
    });
    await sdk.books.bindSource({
      operation,
      bookId: "book_primary",
      sourceId: "source_1",
      sourceRole: "active",
      effectiveFrom: "2026-01-01"
    });
    for (const account of [
      {
        bookAccountKey: "income", accountNumber: "4000", name: "Income", classification: "income" as const,
        accountRole: "header" as const
      },
      {
        bookAccountKey: "service_revenue",
        accountNumber: "4010",
        name: "Service Revenue",
        classification: "income" as const,
        accountRole: "posting" as const,
        parentBookAccountKey: "income"
      }
    ]) {
      await sdk.books.defineAccount({ operation, bookId: "book_primary", expectedVersion: 0, ...account });
    }
    await sdk.books.mapAccount({
      operation,
      bookId: "book_primary",
      sourceId: "source_1",
      accountId: "account_income",
      bookAccountKey: "service_revenue"
    });
    await expect(sdk.books.defineAccount({
      operation: { ...operation, requestId: "account-income-deactivate", correlationId: "account-income-deactivate" },
      bookId: "book_primary",
      bookAccountKey: "income",
      accountNumber: "4000",
      name: "Income",
      classification: "income",
      accountRole: "header",
      active: false,
      expectedVersion: 1
    })).rejects.toThrow("a reporting-book account with children must remain an active header account");
    await expect(sdk.books.defineAccount({
      operation: { ...operation, requestId: "account-service-role", correlationId: "account-service-role" },
      bookId: "book_primary",
      bookAccountKey: "service_revenue",
      accountNumber: "4010",
      name: "Service Revenue",
      classification: "income",
      accountRole: "header",
      parentBookAccountKey: "income",
      expectedVersion: 1
    })).rejects.toThrow("a mapped reporting-book account must remain an active posting account");
    await expect(sdk.books.defineAccount({
      operation: { ...operation, requestId: "account-number-duplicate", correlationId: "account-number-duplicate" },
      bookId: "book_primary",
      bookAccountKey: "duplicate_revenue",
      accountNumber: "4010",
      name: "Duplicate Revenue",
      classification: "income",
      accountRole: "posting",
      expectedVersion: 0
    })).rejects.toMatchObject({ code: "invalid_input" });
    const renamedAccountInput = {
      operation: { ...operation, requestId: "account-service-rename", correlationId: "account-service-rename" },
      bookId: "book_primary",
      bookAccountKey: "service_revenue",
      accountNumber: "4010",
      name: "Consulting Revenue",
      classification: "income" as const,
      accountRole: "posting" as const,
      parentBookAccountKey: "income",
      expectedVersion: 1
    };
    await expect(sdk.books.defineAccount(renamedAccountInput)).resolves.toMatchObject({
      name: "Consulting Revenue",
      version: 2
    });
    await expect(sdk.books.defineAccount(renamedAccountInput)).resolves.toMatchObject({
      name: "Consulting Revenue",
      version: 2
    });

    const draft = await sdk.invoices.createDraft({
      operation,
      idempotencyKey: "draft-1001",
      customerId: "customer_1",
      receivableAccount: { accountId: "account_ar" },
      documentNumber: "INV-1001",
      documentDate: "2026-08-01",
      dueDate: "2026-08-31",
      revenueLines: [{
        accountId: "account_income",
        amount: "25.00",
        quantity: "2.5",
        unitAmount: "10.00"
      }]
    });
    const issued = await sdk.invoices.issue({
      operation,
      invoiceDraftId: draft.invoiceDraftId,
      expectedVersion: draft.version,
      idempotencyKey: "invoice-1001"
    });
    const payment = await sdk.commands.customerPayments.record({
      operation,
      idempotencyKey: "payment-1001",
      date: "2026-08-05",
      customerId: "customer_1",
      amount: "25.00",
      cashAccount: { accountId: "account_cash" },
      receivableAccount: { accountId: "account_ar" }
    });
    await pool.query(
      `insert into erp_financials.transaction_match_candidates (
  match_candidate_id, tenant_id, source_id, match_kind, origin_transaction_id, target_transaction_id,
  matcher_version, score, suggested_application_amount, currency_code, status, evidence, created_at, expires_at
) values ($1, 'tenant_1', 'source_1', 'customer_payment_to_invoice', $2, $3, 'integration-v1', 1, 25, 'USD',
  'suggested', '[{"criterion":"party","matched":true,"weight":"1","score":"1"}]'::jsonb,
  '2026-08-06T00:00:00Z', '2026-09-01T00:00:00Z')`,
      ["candidate_sdk_1", payment.journal.transactionId, issued.transactionId]
    );
    const applied = await sdk.paymentMatching.acceptAndApply({
      operation,
      matchCandidateId: "candidate_sdk_1",
      sourceDocumentId: payment.documentId,
      targetDocumentId: issued.invoiceDocumentId,
      amount: "25.00",
      applicationDate: "2026-08-06",
      expectedSourceVersion: payment.version,
      expectedTargetVersion: 1,
      idempotencyKey: "apply-1001",
      method: "manual"
    });
    expect(applied.application).toMatchObject({ status: "applied", appliedAmount: "25.00" });

    const bankLine = await sdk.bankReconciliation.ingest({
      operation,
      externalLineId: "bank-line-1001",
      bankAccountId: "account_cash",
      postedDate: "2026-08-05",
      amount: "25.00"
    });
    await expect(sdk.bankReconciliation.match({
      operation,
      bankStatementLineId: bankLine.bankStatementLineId,
      transactionId: payment.journal.transactionId,
      expectedVersion: bankLine.version,
      idempotencyKey: "bank-match-1001",
      method: "manual"
    })).resolves.toMatchObject({ status: "matched", matchedAmount: "25.00" });

    const invoice = await sdk.queries.getInvoice(issued.invoiceDocumentId, "2026-08-12");
    expect(invoice).toMatchObject({ status: "paid", openAmount: "0.00", originalAmount: "25.00" });
    expect(invoice.lines).toEqual([expect.objectContaining({ quantity: "2.5", unitAmount: "10.00", amount: "25.00" })]);
    await expect(sdk.queries.getInvoiceSummary({ asOfDate: "2026-08-12" })).resolves.toMatchObject({
      outstandingAmount: "0.00",
      outstandingInvoiceCount: 0,
      unsentDraftCount: 0,
      collectedAmount: "25.00",
      settledInvoiceCount: 1
    });
    await expect(sdk.queries.getPaymentSummary({
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31"
    })).resolves.toMatchObject({
      receivedAmount: "25.00",
      receivedPaymentCount: 1,
      matchedPaymentCount: 1,
      automaticallyMatchedPaymentCount: 0,
      automaticMatchRatePercent: "0.00",
      unappliedAmount: "0.00",
      awaitingBankReviewCount: 0
    });
    await expect(sdk.queries.getGeneralLedgerSummary({
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31"
    })).resolves.toMatchObject({
      postingCount: 4,
      totalDebits: "50.00",
      totalCredits: "50.00",
      difference: "0.00"
    });
    const ledgerFilters = {
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      accountKey: "service_revenue",
      sourceId: "source_1",
      transactionType: "Subledger:invoice",
      polarity: "credit" as const,
      search: "INV-1001"
    };
    await expect(sdk.queries.listGeneralLedger({ ...ledgerFilters, limit: 25 })).resolves.toMatchObject({
      items: [{
        transactionType: "Subledger:invoice",
        bookAccountKey: "service_revenue",
        creditAmount: "25.00",
        sourceProvenance: {
          sourceId: "source_1",
          sourceRole: "active",
          sourceSystem: "native_erp",
          sourceTransactionType: "Subledger:invoice"
        }
      }]
    });
    await expect(sdk.queries.getGeneralLedgerSummary(ledgerFilters)).resolves.toMatchObject({
      postingCount: 1,
      totalDebits: "0.00",
      totalCredits: "25.00",
      difference: "-25.00"
    });
    const statement = await sdk.queries.getFinancialStatement({
      reportName: "profit_and_loss",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31"
    });
    expect(statement.lines).toEqual([
      expect.objectContaining({ bookAccountKey: "income", directAmount: "0.00", amount: "25.00" }),
      expect.objectContaining({ bookAccountKey: "service_revenue", directAmount: "25.00", amount: "25.00" })
    ]);
    await expect(sdk.queries.getBankReconciliationSummary()).resolves.toMatchObject({ matchedCount: 1 });

    const delivered: string[] = [];
    const runtimeResult = await sdk.createRuntime({
      onEvent: (event) => {
        delivered.push(event.outboxEventId);
        return Promise.resolve();
      }
    }).runOnce({ limit: 500 });
    expect(runtimeResult).toMatchObject({ claimed: delivered.length, published: delivered.length, failed: 0 });
    expect(delivered.length).toBeGreaterThan(0);
  });
});

class PgQueryClient implements PostgresQueryClient {
  constructor(private readonly queryable: Pick<Pool | PoolClient, "query">) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    const result = await this.queryable.query<QueryResultRow>(sql, [...params]);
    return { rows: result.rows as unknown as readonly Row[], rowCount: result.rowCount };
  }
}

class PgTransactionRunner implements PostgresMigrationTransactionRunner {
  constructor(private readonly pool: Pool) {}

  async transaction<Result>(work: (client: PostgresQueryClient) => Promise<Result>): Promise<Result> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await work(new PgQueryClient(client));
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

class FailingMigrationClient implements PostgresQueryClient {
  constructor(
    private readonly client: PostgresQueryClient,
    private readonly failingSqlFragment: string
  ) {}

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    if (sql.includes(this.failingSqlFragment)) {
      return Promise.reject(new Error("injected real migration failure"));
    }
    return this.client.query<Row>(sql, params);
  }
}

function requiredSafeTestDatabaseUrl(value: string | undefined): string {
  if (value === undefined) {
    return "postgres://unused:unused@127.0.0.1:1/erp_financials_test_skipped";
  }
  const parsed = new URL(value);
  const databaseName = parsed.pathname.slice(1);
  if (!/^erp_financials(?:_|-)test(?:_|-|$)/u.test(databaseName)) {
    throw new Error("ERP_FINANCIALS_TEST_DATABASE_URL must target a database named erp_financials_test*");
  }
  return value;
}

async function snapshotScopeColumns(pool: Pool): Promise<readonly string[]> {
  const result = await pool.query<{ column_name: string }>(
    `select column_name from information_schema.columns
where table_schema = 'erp_financials' and table_name = 'report_snapshots'
  and column_name in ('company_id', 'source_id') order by column_name`
  );
  return result.rows.map((row) => row.column_name);
}

async function seedQuickBooksImportScope(pool: Pool): Promise<void> {
  await pool.query(`
insert into erp_financials.accounting_companies values
  ('company_qbo', 'tenant_qbo', 'Spartan', 'Spartan', 'USD', 1, 'sandbox', 'quickbooks', 'realm_qbo');
insert into erp_financials.accounting_sources (
  source_id, tenant_id, source_system, provider_environment, connection_ref,
  import_batch_id, checkpoint_id, latest_synced_at, status
) values (
  'source_qbo', 'tenant_qbo', 'quickbooks', 'sandbox', 'connection:qbo',
  'batch_qbo', 'checkpoint_qbo', '2026-08-10T10:00:00Z', 'active'
);
insert into erp_financials.company_sources values
  ('company_source_qbo', 'tenant_qbo', 'company_qbo', 'source_qbo', '2026-08-10T10:00:00Z');
insert into erp_financials.import_batches (
  import_batch_id, tenant_id, source_id, mode, status, started_at, completed_at, source_object_counts
) values (
  'batch_qbo', 'tenant_qbo', 'source_qbo', 'initial', 'completed',
  '2026-08-10T09:00:00Z', '2026-08-10T10:00:00Z', '{}'::jsonb
);
insert into erp_financials.sync_checkpoints (
  checkpoint_id, tenant_id, source_id, source_object, cursor_kind, cursor_value,
  fresh_through, latest_source_updated_at, status
) values (
  'checkpoint_qbo', 'tenant_qbo', 'source_qbo', 'quickbooks_full_sync', 'full_scan', 'full:realm_qbo',
  '2026-08-10T10:00:00Z', '2026-08-10T10:00:00Z', 'current'
);
insert into erp_financials.accounts (
  account_id, tenant_id, source_id, source_account_id, name, type, classification, active
) values
  ('account_cash_qbo', 'tenant_qbo', 'source_qbo', 'cash', 'Cash', 'Bank', 'asset', true),
  ('account_revenue_qbo', 'tenant_qbo', 'source_qbo', 'revenue', 'Revenue', 'Income', 'income', true);
insert into erp_financials.parties (
  party_id, tenant_id, source_id, source_party_id, party_type, display_name, active
) values ('customer_qbo', 'tenant_qbo', 'source_qbo', 'customer_20', 'customer', 'Acme', true);
insert into erp_financials.transactions (
  transaction_id, tenant_id, source_id, source_transaction_id, source_transaction_type,
  transaction_number, transaction_date, posted_at, updated_at, party_id, currency_code, status,
  source_payload_ref
) values
  ('transaction_invoice_qbo', 'tenant_qbo', 'source_qbo', 'invoice_600', 'Invoice', 'INV-600',
    '2026-08-01', '2026-08-01T12:00:00Z', '2026-08-10T10:00:00Z', 'customer_qbo', 'USD', 'posted', '{}'::jsonb),
  ('transaction_payment_qbo', 'tenant_qbo', 'source_qbo', 'payment_700', 'Payment', 'PMT-700',
    '2026-08-10', '2026-08-10T12:00:00Z', '2026-08-10T10:00:00Z', 'customer_qbo', 'USD', 'posted', '{}'::jsonb);
`);
}

function quickBooksSubledgerFacts(): CanonicalAccountingFactSet {
  return {
    company: {
      companyId: "company_qbo", tenantId: "tenant_qbo", legalName: "Spartan", displayName: "Spartan",
      baseCurrencyCode: "USD", fiscalYearStartMonth: 1, providerEnvironment: "sandbox",
      sourceSystem: "quickbooks", sourceCompanyRef: "realm_qbo"
    },
    source: {
      tenantId: "tenant_qbo", sourceId: "source_qbo", sourceSystem: "quickbooks",
      providerEnvironment: "sandbox", connectionRef: "connection:qbo", importBatchId: "batch_qbo",
      checkpointId: "checkpoint_qbo", latestSyncedAt: "2026-08-10T10:00:00.000Z", status: "active"
    },
    importBatch: {
      tenantId: "tenant_qbo", sourceId: "source_qbo", importBatchId: "batch_qbo", mode: "initial",
      status: "completed", startedAt: "2026-08-10T09:00:00.000Z",
      completedAt: "2026-08-10T10:00:00.000Z", sourceObjectCounts: {}
    },
    checkpoint: {
      tenantId: "tenant_qbo", sourceId: "source_qbo", checkpointId: "checkpoint_qbo",
      sourceObject: "quickbooks_full_sync", cursorKind: "full_scan", cursorValue: "full:realm_qbo",
      freshThrough: "2026-08-10T10:00:00.000Z", latestSourceUpdatedAt: "2026-08-10T10:00:00.000Z",
      status: "current"
    },
    accounts: [
      { accountId: "account_cash_qbo", tenantId: "tenant_qbo", sourceId: "source_qbo", sourceAccountId: "cash", name: "Cash", type: "Bank", classification: "asset", active: true },
      { accountId: "account_revenue_qbo", tenantId: "tenant_qbo", sourceId: "source_qbo", sourceAccountId: "revenue", name: "Revenue", type: "Income", classification: "income", active: true }
    ],
    parties: [
      { partyId: "customer_qbo", tenantId: "tenant_qbo", sourceId: "source_qbo", sourcePartyId: "customer_20", partyType: "customer", displayName: "Acme", active: true }
    ],
    items: [],
    dimensions: [],
    transactions: [
      { transactionId: "transaction_invoice_qbo", tenantId: "tenant_qbo", sourceId: "source_qbo", sourceTransactionId: "invoice_600", sourceTransactionType: "Invoice", transactionNumber: "INV-600", transactionDate: "2026-08-01", partyId: "customer_qbo", currencyCode: "USD", status: "posted" },
      { transactionId: "transaction_payment_qbo", tenantId: "tenant_qbo", sourceId: "source_qbo", sourceTransactionId: "payment_700", sourceTransactionType: "Payment", transactionNumber: "PMT-700", transactionDate: "2026-08-10", partyId: "customer_qbo", currencyCode: "USD", status: "posted" }
    ],
    transactionLines: [],
    postings: []
  };
}

function quickBooksSubledgerResources(
  paymentAmount: string,
  linked: boolean,
  sourceUpdatedAt: string
): HandrailQuickBooksSdkResourceSet {
  const envelope = {
    sourceSystem: "quickbooks" as const,
    tenantId: "tenant_qbo",
    sourceId: "source_qbo",
    providerEnvironment: "sandbox" as const,
    realmId: "realm_qbo",
    importBatchId: "batch_qbo",
    checkpointId: "checkpoint_qbo",
    sourceUpdatedAt
  };
  return {
    companyInfo: {
      ...envelope, resourceType: "CompanyInfo", resourceId: "realm_qbo",
      resource: { CompanyName: "Spartan", LegalName: "Spartan" }
    },
    accounts: [],
    journalEntries: [],
    operationalDocuments: [
      {
        ...envelope, resourceType: "LedgerTransaction", resourceId: "invoice_600",
        resource: {
          sourceTransactionId: "invoice_600", sourceTransactionType: "Invoice", transactionDate: "2026-08-01",
          transactionNumber: "INV-600", dueDate: "2026-08-31", totalAmount: "100.00", openAmount: "100.00",
          sourceUpdatedAt, currencyCode: "USD",
          partyRef: { sourceObjectId: "customer_20", displayName: "Acme", partyType: "customer" },
          lines: [{
            sourceLineId: "invoice-line-1", lineNumber: 1, description: "Consulting", sourceAmount: "100.00",
            sourceQuantity: "2.00", sourceUnitAmount: "50.00",
            accountRef: { sourceObjectId: "revenue", displayName: "Revenue" }, postings: []
          }]
        }
      },
      {
        ...envelope, resourceType: "LedgerTransaction", resourceId: "payment_700",
        resource: {
          sourceTransactionId: "payment_700", sourceTransactionType: "Payment", transactionDate: "2026-08-10",
          transactionNumber: "PMT-700", totalAmount: paymentAmount, unappliedAmount: linked ? "0.00" : paymentAmount,
          sourceUpdatedAt, currencyCode: "USD",
          partyRef: { sourceObjectId: "customer_20", displayName: "Acme", partyType: "customer" },
          lines: [{
            sourceLineId: "payment-line-1", lineNumber: 1, description: "Invoice payment", sourceAmount: paymentAmount,
            accountRef: { sourceObjectId: "cash", displayName: "Cash" },
            linkedTransactions: linked ? [{ sourceTransactionId: "invoice_600", sourceTransactionType: "Invoice" }] : [],
            postings: []
          }]
        }
      }
    ]
  };
}

const quickBooksDocumentFamilyDefinitions = [
  { sourceId: "invoice_all", sourceType: "Invoice", number: "INV-ALL", date: "2026-08-01", dueDate: "2026-08-31", amount: "100.00", unitAmount: "50.00", partyId: "customer_qbo", partySourceId: "customer_20", partyType: "customer", accountId: "revenue" },
  { sourceId: "payment_all", sourceType: "Payment", number: "PMT-ALL", date: "2026-08-02", amount: "20.00", unitAmount: "10.00", partyId: "customer_qbo", partySourceId: "customer_20", partyType: "customer", accountId: "cash", linkedSourceId: "invoice_all", linkedSourceType: "Invoice" },
  { sourceId: "credit_all", sourceType: "CreditMemo", number: "CM-ALL", date: "2026-08-03", amount: "10.00", unitAmount: "5.00", partyId: "customer_qbo", partySourceId: "customer_20", partyType: "customer", accountId: "revenue", linkedSourceId: "invoice_all", linkedSourceType: "Invoice" },
  { sourceId: "refund_all", sourceType: "RefundReceipt", number: "REF-ALL", date: "2026-08-04", amount: "5.00", unitAmount: "2.50", partyId: "customer_qbo", partySourceId: "customer_20", partyType: "customer", accountId: "cash" },
  { sourceId: "bill_all", sourceType: "Bill", number: "BILL-ALL", date: "2026-08-05", dueDate: "2026-08-25", amount: "80.00", unitAmount: "40.00", partyId: "vendor_qbo", partySourceId: "vendor_30", partyType: "vendor", accountId: "expense" },
  { sourceId: "bill_payment_all", sourceType: "BillPayment", number: "BP-ALL", date: "2026-08-06", amount: "20.00", unitAmount: "10.00", partyId: "vendor_qbo", partySourceId: "vendor_30", partyType: "vendor", accountId: "cash", linkedSourceId: "bill_all", linkedSourceType: "Bill" },
  { sourceId: "deposit_all", sourceType: "Deposit", number: "DEP-ALL", date: "2026-08-07", amount: "30.00", unitAmount: "15.00", accountId: "cash" },
  { sourceId: "transfer_all", sourceType: "Transfer", number: "TRF-ALL", date: "2026-08-08", amount: "25.00", unitAmount: "12.50", accountId: "cash" },
  { sourceId: "sales_receipt_all", sourceType: "SalesReceipt", number: "SR-ALL", date: "2026-08-09", amount: "40.00", unitAmount: "20.00", partyId: "customer_qbo", partySourceId: "customer_20", partyType: "customer", accountId: "revenue" },
  { sourceId: "purchase_all", sourceType: "Purchase", number: "PUR-ALL", date: "2026-08-10", amount: "50.00", unitAmount: "25.00", partyId: "vendor_qbo", partySourceId: "vendor_30", partyType: "vendor", accountId: "expense" },
  { sourceId: "vendor_credit_all", sourceType: "VendorCredit", number: "VC-ALL", date: "2026-08-11", amount: "10.00", unitAmount: "5.00", partyId: "vendor_qbo", partySourceId: "vendor_30", partyType: "vendor", accountId: "expense", linkedSourceId: "bill_all", linkedSourceType: "Bill" }
] as const;

async function seedQuickBooksAllDocumentScope(pool: Pool): Promise<void> {
  await seedQuickBooksImportScope(pool);
  await pool.query(`
insert into erp_financials.accounts (
  account_id, tenant_id, source_id, source_account_id, name, type, classification, active
) values ('account_expense_qbo', 'tenant_qbo', 'source_qbo', 'expense', 'Expense', 'Expense', 'expense', true);
insert into erp_financials.parties (
  party_id, tenant_id, source_id, source_party_id, party_type, display_name, active
) values ('vendor_qbo', 'tenant_qbo', 'source_qbo', 'vendor_30', 'vendor', 'Supply Co', true);
delete from erp_financials.transactions
where tenant_id = 'tenant_qbo' and source_id = 'source_qbo';
`);
  for (const definition of quickBooksDocumentFamilyDefinitions) {
    await pool.query(
      `insert into erp_financials.transactions (
        transaction_id, tenant_id, source_id, source_transaction_id, source_transaction_type,
        transaction_number, transaction_date, posted_at, updated_at, party_id, currency_code, status,
        source_payload_ref
      ) values ($1, 'tenant_qbo', 'source_qbo', $2, $3, $4, $5, $6, $6, $7, 'USD', 'posted', '{}'::jsonb)`,
      [
        `transaction_${definition.sourceId}`,
        definition.sourceId,
        definition.sourceType,
        definition.number,
        definition.date,
        `${definition.date}T12:00:00Z`,
        "partyId" in definition ? definition.partyId : null
      ]
    );
  }
}

function quickBooksAllDocumentFacts(): CanonicalAccountingFactSet {
  const base = quickBooksSubledgerFacts();
  return {
    ...base,
    accounts: [
      ...base.accounts,
      { accountId: "account_expense_qbo", tenantId: "tenant_qbo", sourceId: "source_qbo", sourceAccountId: "expense", name: "Expense", type: "Expense", classification: "expense", active: true }
    ],
    parties: [
      ...base.parties,
      { partyId: "vendor_qbo", tenantId: "tenant_qbo", sourceId: "source_qbo", sourcePartyId: "vendor_30", partyType: "vendor", displayName: "Supply Co", active: true }
    ],
    transactions: quickBooksDocumentFamilyDefinitions.map((definition) => ({
      transactionId: `transaction_${definition.sourceId}`,
      tenantId: "tenant_qbo",
      sourceId: "source_qbo",
      sourceTransactionId: definition.sourceId,
      sourceTransactionType: definition.sourceType,
      transactionNumber: definition.number,
      transactionDate: definition.date,
      ...("partyId" in definition ? { partyId: definition.partyId } : {}),
      currencyCode: "USD",
      status: "posted" as const
    }))
  };
}

function quickBooksAllDocumentResources(): HandrailQuickBooksSdkResourceSet {
  const base = quickBooksSubledgerResources("20.00", false, "2026-08-10T10:00:00.000Z");
  return {
    ...base,
    operationalDocuments: quickBooksDocumentFamilyDefinitions.map((definition, index) => ({
      sourceSystem: "quickbooks" as const,
      tenantId: "tenant_qbo",
      sourceId: "source_qbo",
      providerEnvironment: "sandbox" as const,
      realmId: "realm_qbo",
      importBatchId: "batch_qbo",
      checkpointId: "checkpoint_qbo",
      sourceUpdatedAt: "2026-08-10T10:00:00.000Z",
      resourceType: "LedgerTransaction" as const,
      resourceId: definition.sourceId,
      resource: {
        sourceTransactionId: definition.sourceId,
        sourceTransactionType: definition.sourceType,
        transactionDate: definition.date,
        transactionNumber: definition.number,
        ...("dueDate" in definition ? { dueDate: definition.dueDate } : {}),
        totalAmount: definition.amount,
        sourceUpdatedAt: "2026-08-10T10:00:00.000Z",
        currencyCode: "USD",
        ...("partySourceId" in definition ? {
          partyRef: {
            sourceObjectId: definition.partySourceId,
            displayName: definition.partyType === "vendor" ? "Supply Co" : "Acme",
            partyType: definition.partyType
          }
        } : {}),
        lines: [{
          sourceLineId: `${definition.sourceId}-line-1`,
          lineNumber: 1,
          description: `${definition.sourceType} detail`,
          sourceAmount: definition.amount,
          sourceQuantity: "2.00",
          sourceUnitAmount: definition.unitAmount,
          taxCode: index === 0 ? "TAX" : "NON",
          accountRef: { sourceObjectId: definition.accountId, displayName: definition.accountId },
          ...("linkedSourceId" in definition ? {
            linkedTransactions: [{
              sourceTransactionId: definition.linkedSourceId,
              sourceTransactionType: definition.linkedSourceType
            }]
          } : {}),
          postings: []
        }]
      }
    }))
  };
}

async function quickBooksDocumentState(pool: Pool): Promise<readonly Record<string, unknown>[]> {
  const result = await pool.query<Record<string, unknown>>(`
select metadata ->> 'sourceTransactionId' as source_id, original_amount::text, open_amount::text, status
from erp_financials.subledger_documents
where tenant_id = 'tenant_qbo' and source_id = 'source_qbo'
order by source_id
`);
  return result.rows;
}

async function seedAccountingScope(pool: Pool): Promise<void> {
  await pool.query(`
insert into erp_financials.accounting_companies values ('company_1', 'tenant_1', 'One', 'One', 'USD', 1, 'test', 'native_erp', 'one');
insert into erp_financials.accounting_sources (source_id, tenant_id, source_system, provider_environment, connection_ref, status)
values ('source_1', 'tenant_1', 'native_erp', 'test', 'source:1', 'active'),
       ('source_2', 'tenant_1', 'native_erp', 'test', 'source:2', 'active');
insert into erp_financials.company_sources values ('company_source_1', 'tenant_1', 'company_1', 'source_1', now());
insert into erp_financials.accounts (account_id, tenant_id, source_id, source_account_id, name, type, classification, active)
values ('account_cash', 'tenant_1', 'source_1', 'cash', 'Cash', 'asset', 'asset', true),
       ('account_ar', 'tenant_1', 'source_1', 'ar', 'Receivable', 'asset', 'asset', true),
       ('account_ap', 'tenant_1', 'source_1', 'ap', 'Payable', 'liability', 'liability', true),
       ('account_income', 'tenant_1', 'source_1', 'income', 'Service Revenue', 'income', 'income', true);
insert into erp_financials.parties (party_id, tenant_id, source_id, source_party_id, party_type, display_name, active)
values ('customer_1', 'tenant_1', 'source_1', 'customer:1', 'customer', 'Customer One', true),
       ('customer_2', 'tenant_1', 'source_1', 'customer:2', 'customer', 'Customer Two', true),
       ('vendor_1', 'tenant_1', 'source_1', 'vendor:1', 'vendor', 'Vendor One', true);
insert into erp_financials.import_batches (import_batch_id, tenant_id, source_id, mode, status, started_at, completed_at, source_object_counts)
values ('batch_1', 'tenant_1', 'source_1', 'delta', 'completed', now(), now(), '{}'::jsonb);
insert into erp_financials.transactions (
  transaction_id, tenant_id, source_id, source_transaction_id, source_transaction_type, transaction_date,
  posted_at, updated_at, currency_code, status, source_payload_ref
) values ('journal_1', 'tenant_1', 'source_1', 'journal:1', 'JournalEntry', '2026-08-01', now(), now(), 'USD', 'posted', '{}'::jsonb);
insert into erp_financials.transaction_lines (
  transaction_line_id, tenant_id, source_id, transaction_id, line_number, account_id, amount, dimension_refs
) values ('line_1', 'tenant_1', 'source_1', 'journal_1', 1, 'account_cash', 10, '[]'::jsonb);
`);
}

function sdkOperation() {
  return {
    actorRef: "user:accountant",
    approverRef: "user:controller",
    requestId: "request:sdk-integration",
    correlationId: "correlation:sdk-integration",
    reasonCode: "sdk_integration_test",
    occurredAt: "2026-08-12T11:59:00.000Z"
  } as const;
}

async function seedSubledgerDocuments(pool: Pool): Promise<void> {
  await pool.query(`
insert into erp_financials.transactions (
  transaction_id, tenant_id, source_id, source_transaction_id, source_transaction_type, transaction_date,
  posted_at, updated_at, party_id, currency_code, status, source_payload_ref
) values
  ('txn_invoice', 'tenant_1', 'source_1', 'invoice:1', 'Subledger:invoice', '2026-08-01', now(), now(), 'customer_1', 'USD', 'posted', '{}'::jsonb),
  ('txn_payment', 'tenant_1', 'source_1', 'payment:1', 'Subledger:customer_payment', '2026-08-05', now(), now(), 'customer_1', 'USD', 'posted', '{}'::jsonb),
  ('txn_payment_other', 'tenant_1', 'source_1', 'payment:other', 'Subledger:customer_payment', '2026-08-05', now(), now(), 'customer_2', 'USD', 'posted', '{}'::jsonb),
  ('txn_payment_eur', 'tenant_1', 'source_1', 'payment:eur', 'Subledger:customer_payment', '2026-08-05', now(), now(), 'customer_1', 'EUR', 'posted', '{}'::jsonb);
insert into erp_financials.financial_lifecycle_events values
  ('event_invoice', 'tenant_1', 'company_1', 'source_1', 'subledger_document', 'invoice_1', 'posted', 'user:1', null, 'request:invoice', 'correlation:1', 'test', null, now(), now(), 'event_invoice', repeat('a',64), '{}'::jsonb, null),
  ('event_payment', 'tenant_1', 'company_1', 'source_1', 'subledger_document', 'payment_1', 'posted', 'user:1', null, 'request:payment', 'correlation:1', 'test', null, now(), now(), 'event_payment', repeat('a',64), '{}'::jsonb, null),
  ('event_payment_other', 'tenant_1', 'company_1', 'source_1', 'subledger_document', 'payment_other_party', 'posted', 'user:1', null, 'request:payment-other', 'correlation:1', 'test', null, now(), now(), 'event_payment_other', repeat('a',64), '{}'::jsonb, null),
  ('event_payment_eur', 'tenant_1', 'company_1', 'source_1', 'subledger_document', 'payment_eur', 'posted', 'user:1', null, 'request:payment-eur', 'correlation:1', 'test', null, now(), now(), 'event_payment_eur', repeat('a',64), '{}'::jsonb, null),
  ('event_apply', 'tenant_1', 'company_1', 'source_1', 'subledger_application', 'application_1', 'applied', 'user:1', null, 'request:apply', 'correlation:1', 'test', null, now(), now(), 'event_apply', repeat('a',64), '{}'::jsonb, null);
insert into erp_financials.subledger_documents (
  subledger_document_id, tenant_id, company_id, source_id, document_type, transaction_id, party_id,
  document_date, currency_code, original_amount, open_amount, status, version, idempotency_key,
  lifecycle_event_id, metadata, created_at, updated_at
) values
  ('invoice_1', 'tenant_1', 'company_1', 'source_1', 'invoice', 'txn_invoice', 'customer_1', '2026-08-01', 'USD', 100, 100, 'open', 1, 'invoice_1', 'event_invoice', '{}'::jsonb, now(), now()),
  ('payment_1', 'tenant_1', 'company_1', 'source_1', 'customer_payment', 'txn_payment', 'customer_1', '2026-08-05', 'USD', 60, 60, 'open', 1, 'payment_1', 'event_payment', '{}'::jsonb, now(), now()),
  ('payment_other_party', 'tenant_1', 'company_1', 'source_1', 'customer_payment', 'txn_payment_other', 'customer_2', '2026-08-05', 'USD', 10, 10, 'open', 1, 'payment_other_party', 'event_payment_other', '{}'::jsonb, now(), now()),
  ('payment_eur', 'tenant_1', 'company_1', 'source_1', 'customer_payment', 'txn_payment_eur', 'customer_1', '2026-08-05', 'EUR', 10, 10, 'open', 1, 'payment_eur', 'event_payment_eur', '{}'::jsonb, now(), now());
`);
}

async function documentBalances(pool: Pool): Promise<readonly Record<string, unknown>[]> {
  const result = await pool.query<{
    readonly subledger_document_id: string;
    readonly open_amount: string;
    readonly status: string;
    readonly version: number;
  }>(
    "select subledger_document_id, open_amount::text, status, version from erp_financials.subledger_documents where subledger_document_id in ('invoice_1', 'payment_1') order by subledger_document_id"
  );
  return result.rows;
}
