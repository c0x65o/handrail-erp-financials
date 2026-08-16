import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  POSTGRES_CANONICAL_SCHEMA_MANIFEST,
  createErpFinancials,
  createErpFinancialsSdk,
  migratePostgresSchema,
  validatePostgresMigrationHistory,
  validatePostgresSchema
} from "../src/index.js";

import type {
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
    expect(history).toMatchObject({ compatible: true, currentVersion: 17, issues: [] });
    await expect(
      pool.query("update erp_financials.schema_migrations set name = 'tampered' where to_version = 17")
    ).rejects.toThrow("schema migration history is append-only");
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
    return { rows: result.rows as readonly Row[], rowCount: result.rowCount };
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
