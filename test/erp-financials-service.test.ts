import { describe, expect, it } from "vitest";

import {
  ErpFinancialsIdempotencyConflictError,
  ErpFinancialsValidationError,
  createErpFinancials,
  createPostgresTransactionRunner
} from "../src/index.js";

import type {
  ErpFinancialsTransactionRunner,
  ErpFinancialsPostgresTransactionClient,
  PostJournalEntryInput,
  PostgresQueryClient,
  PostgresQueryResult
} from "../src/index.js";

type QueryCall = {
  readonly sql: string;
  readonly params: readonly unknown[];
};

type StoredJournal = {
  readonly transaction_id: string;
  readonly status: string;
  readonly source_payload_ref: unknown;
};

describe("reusable ERP Financials service", () => {
  it("adapts a standard Postgres pool with commit, rollback, and connection release", async () => {
    const successfulClient = new PoolTransactionClient();
    const successfulRunner = createPostgresTransactionRunner({
      connect: () => Promise.resolve(successfulClient)
    });

    await expect(
      successfulRunner.transaction(async (client) => {
        await client.query("select 'work'");
        return "done";
      })
    ).resolves.toBe("done");
    expect(successfulClient.sql).toEqual(["begin", "select 'work'", "commit"]);
    expect(successfulClient.releaseCalls).toBe(1);

    const failedClient = new PoolTransactionClient();
    const failedRunner = createPostgresTransactionRunner({
      connect: () => Promise.resolve(failedClient)
    });

    await expect(
      failedRunner.transaction(() => Promise.reject(new Error("operation failed")))
    ).rejects.toThrow("operation failed");
    expect(failedClient.sql).toEqual(["begin", "rollback"]);
    expect(failedClient.releaseCalls).toBe(1);
  });

  it("upserts an arbitrary-depth account tree and invalidates hierarchy-dependent snapshots atomically", async () => {
    const database = new ServiceTestDatabase();
    const financials = service(database);

    const result = await financials.accounts.upsertTree({
      parent: {
        accountId: "acct_service_revenue",
        accountNumber: "4000",
        name: "Service Revenue",
        classification: "income"
      },
      children: [
        {
          accountId: "acct_setup_fee",
          accountNumber: "4010",
          name: "Setup Fee",
          classification: "income"
        },
        {
          accountId: "acct_access_fee",
          accountNumber: "4020",
          name: "Access Fee",
          classification: "income",
          children: [
            {
              accountId: "acct_premium_access",
              accountNumber: "4021",
              name: "Premium Access",
              classification: "income"
            }
          ]
        }
      ]
    });

    expect(database.transactionCalls).toBe(1);
    expect(database.commits).toBe(1);
    expect(database.rollbacks).toBe(0);
    expect(result.accountsWritten).toBe(4);
    expect(result.snapshotsMarkedStale).toBe(2);
    expect(result.accounts.map((account) => [account.accountId, account.parentAccountId])).toEqual([
      ["acct_service_revenue", undefined],
      ["acct_setup_fee", "acct_service_revenue"],
      ["acct_access_fee", "acct_service_revenue"],
      ["acct_premium_access", "acct_access_fee"]
    ]);

    const accountInsert = requiredCall(database.client.calls, 'insert into "erp_financials"."accounts"');
    const accountRows = insertedRows(accountInsert);
    expect(accountRows).toHaveLength(4);
    expect(accountRows[3]).toMatchObject({
      account_id: "acct_premium_access",
      parent_account_id: "acct_access_fee",
      source_account_id: "acct_premium_access",
      tenant_id: "tenant_service",
      source_id: "source_service"
    });
    expect(database.client.calls.at(-1)?.sql).toContain('update "erp_financials"."report_snapshots" rs');
  });

  it("derives scoped canonical ids from reusable account keys across tree and journal calls", async () => {
    const database = new ServiceTestDatabase();
    const financials = service(database);
    const tree = await financials.accounts.upsertTree({
      parent: {
        accountKey: "service-revenue",
        name: "Service Revenue",
        classification: "income"
      },
      children: [
        { accountKey: "setup-fee", name: "Setup Fee", classification: "income" },
        { accountKey: "access-fee", name: "Access Fee", classification: "income" }
      ]
    });
    const accountIdsBySourceId = Object.fromEntries(
      tree.accounts.map((account) => [account.sourceAccountId, account.accountId])
    );

    expect(accountIdsBySourceId["service-revenue"]).toMatch(/^account_[a-f0-9]{16}$/);
    expect(accountIdsBySourceId["setup-fee"]).toMatch(/^account_[a-f0-9]{16}$/);
    expect(accountIdsBySourceId["access-fee"]).toMatch(/^account_[a-f0-9]{16}$/);
    expect(tree.accounts[1]?.parentAccountId).toBe(accountIdsBySourceId["service-revenue"]);

    const otherTenantTree = await createErpFinancials({
      database: new ServiceTestDatabase(),
      tenantId: "tenant_other",
      companyId: "company_other",
      sourceId: "source_service",
      currencyCode: "USD"
    }).accounts.upsertTree({
      parent: {
        accountKey: "service-revenue",
        name: "Service Revenue",
        classification: "income"
      }
    });
    expect(otherTenantTree.accounts[0]?.accountId).not.toBe(accountIdsBySourceId["service-revenue"]);

    await financials.journalEntries.post({
      idempotencyKey: "account-key-reclassification",
      date: "2026-08-12",
      lines: [
        { accountKey: "service-revenue", debit: "100.00" },
        { accountKey: "setup-fee", credit: "30.00" },
        { accountKey: "access-fee", credit: "70.00" }
      ]
    });

    const postingInsert = database.client.calls
      .filter((call) => call.sql.includes('insert into "erp_financials"."ledger_postings"'))
      .at(-1);
    if (postingInsert === undefined) {
      throw new Error("Expected journal ledger posting insert");
    }
    expect(insertedRows(postingInsert).map((row) => row.account_id)).toEqual([
      accountIdsBySourceId["service-revenue"],
      accountIdsBySourceId["setup-fee"],
      accountIdsBySourceId["access-fee"]
    ]);
  });

  it("posts a balanced journal with stable ids and treats an identical retry as a no-op", async () => {
    const database = new ServiceTestDatabase([
      accountRow("acct_service_revenue", true),
      accountRow("acct_setup_fee", true),
      accountRow("acct_access_fee", true)
    ]);
    const financials = service(database);
    const input = reclassificationEntry();

    const first = await financials.journalEntries.post(input);

    expect(first.status).toBe("posted");
    expect(first.transactionId).toMatch(/^transaction_[a-f0-9]{16}$/);
    expect(first.transactionLineIds).toHaveLength(3);
    expect(first.postingIds).toHaveLength(3);
    expect(first.writeCounts).toEqual({
      importBatches: 1,
      transactions: 1,
      transactionLines: 3,
      postings: 3
    });
    expect(first.snapshotsMarkedStale).toBe(2);
    expect(database.transactionCalls).toBe(1);
    expect(database.commits).toBe(1);

    const postingInsert = requiredCall(database.client.calls, 'insert into "erp_financials"."ledger_postings"');
    expect(insertedRows(postingInsert).map((row) => ({
      accountId: row.account_id,
      debit: row.debit_amount,
      credit: row.credit_amount,
      net: row.net_amount
    }))).toEqual([
      { accountId: "acct_service_revenue", debit: "100.00", credit: "0.00", net: "100.00" },
      { accountId: "acct_setup_fee", debit: "0.00", credit: "30.00", net: "-30.00" },
      { accountId: "acct_access_fee", debit: "0.00", credit: "70.00", net: "-70.00" }
    ]);
    const staleUpdate = requiredCall(database.client.calls, 'update "erp_financials"."report_snapshots"');
    expect(staleUpdate.sql).toContain('rs."company_id" = $5');
    expect(staleUpdate.sql).toContain('rs."source_id" = $6');
    expect(staleUpdate.sql).not.toContain('"report_freshness"');
    expect(staleUpdate.params).toEqual([
      "tenant_service",
      "2026-08-12",
      "2026-08-12",
      "journal_entry_posted",
      "company_service",
      "source_service",
      "accrual",
      "USD"
    ]);

    const callCountBeforeRetry = database.client.calls.length;
    const retry = await financials.journalEntries.post(input);
    const retryCalls = database.client.calls.slice(callCountBeforeRetry);

    expect(retry).toEqual({
      ...first,
      status: "already_posted",
      snapshotsMarkedStale: 0,
      writeCounts: {
        importBatches: 0,
        transactions: 0,
        transactionLines: 0,
        postings: 0
      }
    });
    expect(retryCalls.some((call) => call.sql.startsWith("insert into"))).toBe(false);
    expect(database.transactionCalls).toBe(2);
    expect(database.commits).toBe(2);
  });

  it("rejects an idempotency key reused with different journal content", async () => {
    const database = new ServiceTestDatabase([
      accountRow("acct_service_revenue", true),
      accountRow("acct_setup_fee", true),
      accountRow("acct_access_fee", true)
    ]);
    const financials = service(database);

    await financials.journalEntries.post(reclassificationEntry());
    const callsBeforeConflict = database.client.calls.length;

    await expect(
      financials.journalEntries.post({
        ...reclassificationEntry(),
        lines: [
          { accountId: "acct_service_revenue", debit: "100.00" },
          { accountId: "acct_setup_fee", credit: "40.00" },
          { accountId: "acct_access_fee", credit: "60.00" }
        ]
      })
    ).rejects.toBeInstanceOf(ErpFinancialsIdempotencyConflictError);

    expect(database.client.calls.slice(callsBeforeConflict).some((call) => call.sql.startsWith("insert into"))).toBe(false);
    expect(database.rollbacks).toBe(1);
  });

  it("rejects unbalanced journals before opening a database transaction", async () => {
    const database = new ServiceTestDatabase();
    const financials = service(database);

    await expect(
      financials.journalEntries.post({
        idempotencyKey: "unbalanced-entry",
        date: "2026-08-12",
        lines: [
          { accountId: "acct_service_revenue", debit: "100.00" },
          { accountId: "acct_setup_fee", credit: "99.99" }
        ]
      })
    ).rejects.toThrow("unbalanced: debits 100.00, credits 99.99");

    expect(database.transactionCalls).toBe(0);
  });

  it("rejects inactive or missing posting accounts and rolls back without ledger writes", async () => {
    const database = new ServiceTestDatabase([
      accountRow("acct_service_revenue", true),
      accountRow("acct_setup_fee", false)
    ]);
    const financials = service(database);

    await expect(
      financials.journalEntries.post({
        idempotencyKey: "inactive-entry",
        date: "2026-08-12",
        lines: [
          { accountId: "acct_service_revenue", debit: "100.00" },
          { accountId: "acct_setup_fee", credit: "100.00" }
        ]
      })
    ).rejects.toThrow("inactive accounts: acct_setup_fee");

    expect(database.rollbacks).toBe(1);
    expect(database.client.calls.some((call) => call.sql.includes('insert into "erp_financials"."ledger_postings"'))).toBe(false);
  });

  it("keeps all journal writes and invalidation inside the caller-provided transaction", async () => {
    const database = new ServiceTestDatabase([
      accountRow("acct_service_revenue", true),
      accountRow("acct_setup_fee", true),
      accountRow("acct_access_fee", true)
    ]);
    database.client.failInsertTable = "ledger_postings";
    const financials = service(database);

    await expect(financials.journalEntries.post(reclassificationEntry())).rejects.toThrow("simulated ledger write failure");

    expect(database.transactionCalls).toBe(1);
    expect(database.commits).toBe(0);
    expect(database.rollbacks).toBe(1);
    expect(database.client.calls.some((call) => call.sql.includes('update "erp_financials"."report_snapshots"'))).toBe(false);
  });

  it("rejects duplicate account identities before writing a hierarchy", async () => {
    const database = new ServiceTestDatabase();
    const financials = service(database);

    await expect(
      financials.accounts.upsertTree({
        parent: {
          accountId: "acct_service_revenue",
          name: "Service Revenue",
          classification: "income"
        },
        children: [
          {
            accountId: "acct_service_revenue",
            name: "Duplicate",
            classification: "income"
          }
        ]
      })
    ).rejects.toBeInstanceOf(ErpFinancialsValidationError);

    expect(database.transactionCalls).toBe(0);
  });
});

function service(database: ErpFinancialsTransactionRunner) {
  return createErpFinancials({
    database,
    tenantId: "tenant_service",
    companyId: "company_service",
    sourceId: "source_service",
    currencyCode: "USD",
    accountingBasis: "accrual",
    now: () => "2026-08-12T15:00:00.000Z"
  });
}

function reclassificationEntry(): PostJournalEntryInput {
  return {
    idempotencyKey: "service-revenue-reclass-2026-08",
    date: "2026-08-12",
    memo: "Break out service revenue",
    lines: [
      { accountId: "acct_service_revenue", debit: "100.00" },
      { accountId: "acct_setup_fee", credit: "30.00" },
      { accountId: "acct_access_fee", credit: "70.00" }
    ]
  };
}

function accountRow(accountId: string, active: boolean): Record<string, unknown> {
  return {
    account_id: accountId,
    tenant_id: "tenant_service",
    source_id: "source_service",
    source_account_id: accountId,
    account_number: null,
    name: accountId,
    type: "income",
    subtype: null,
    classification: "income",
    parent_account_id: accountId === "acct_service_revenue" ? null : "acct_service_revenue",
    currency_code: "USD",
    active
  };
}

class ServiceTestDatabase implements ErpFinancialsTransactionRunner {
  readonly client: ServiceTestClient;
  transactionCalls = 0;
  commits = 0;
  rollbacks = 0;

  constructor(accounts: readonly Record<string, unknown>[] = []) {
    this.client = new ServiceTestClient(accounts);
  }

  async transaction<Result>(operation: (client: PostgresQueryClient) => Promise<Result>): Promise<Result> {
    this.transactionCalls += 1;
    try {
      const result = await operation(this.client);
      this.commits += 1;
      return result;
    } catch (error) {
      this.rollbacks += 1;
      throw error;
    }
  }
}

class ServiceTestClient implements PostgresQueryClient {
  readonly calls: QueryCall[] = [];
  readonly accounts: Record<string, unknown>[];
  storedJournal?: StoredJournal;
  failInsertTable?: string;

  constructor(accounts: readonly Record<string, unknown>[]) {
    this.accounts = [...accounts];
  }

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ sql, params });

    if (sql.includes('from "erp_financials"."company_sources"')) {
      return Promise.resolve({ rows: [{ company_source_id: "company_source_service" }] as unknown as readonly Row[] });
    }

    if (sql.includes('from "erp_financials"."accounts"')) {
      const requestedIds = params[2];
      const rows = Array.isArray(requestedIds)
        ? this.accounts.filter((account) => requestedIds.includes(account.account_id))
        : this.accounts;
      return Promise.resolve({ rows: rows as readonly Row[] });
    }

    if (sql.includes('from "erp_financials"."transactions"') && sql.includes("for update")) {
      const rows = this.storedJournal === undefined ? [] : [this.storedJournal];
      return Promise.resolve({ rows: rows as unknown as readonly Row[] });
    }

    if (this.failInsertTable !== undefined && sql.includes(`insert into "erp_financials"."${this.failInsertTable}"`)) {
      return Promise.reject(new Error("simulated ledger write failure"));
    }

    if (sql.includes('insert into "erp_financials"."transactions"')) {
      const row = insertedRows({ sql, params })[0];
      if (row !== undefined) {
        this.storedJournal = {
          transaction_id: String(row.transaction_id),
          status: String(row.status),
          source_payload_ref: row.source_payload_ref
        };
      }
    }

    if (sql.includes('insert into "erp_financials"."accounts"')) {
      this.accounts.push(...insertedRows({ sql, params }));
    }

    if (sql.includes('update "erp_financials"."report_snapshots"')) {
      return Promise.resolve({ rows: [], rowCount: 2 });
    }

    return Promise.resolve({ rows: [] });
  }
}

class PoolTransactionClient implements ErpFinancialsPostgresTransactionClient {
  readonly sql: string[] = [];
  releaseCalls = 0;

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string
  ): Promise<PostgresQueryResult<Row>> {
    this.sql.push(sql);
    return Promise.resolve({ rows: [] });
  }

  release(): void {
    this.releaseCalls += 1;
  }
}

function requiredCall(calls: readonly QueryCall[], sqlFragment: string): QueryCall {
  const call = calls.find((candidate) => candidate.sql.includes(sqlFragment));
  if (call === undefined) {
    throw new Error(`Missing SQL call containing ${sqlFragment}`);
  }
  return call;
}

function insertedRows(call: QueryCall): readonly Record<string, unknown>[] {
  const columnMatch = /^insert into [^(]+\(([^)]+)\)/.exec(call.sql);
  if (columnMatch?.[1] === undefined) {
    throw new Error("Expected insert SQL with a column list");
  }
  const columns = columnMatch[1].split(",").map((column) => column.trim().replaceAll('"', ""));
  const rows: Record<string, unknown>[] = [];

  for (let offset = 0; offset < call.params.length; offset += columns.length) {
    rows.push(Object.fromEntries(columns.map((column, index) => [column, call.params[offset + index]])));
  }
  return rows;
}
