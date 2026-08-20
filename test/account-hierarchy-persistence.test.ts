import { describe, expect, it } from "vitest";

import {
  AccountHierarchyValidationError,
  POSTGRES_CANONICAL_SCHEMA_MANIFEST,
  createPostgresStorageAdapter
} from "../src/index.js";
import type { Account, PostgresQueryClient, PostgresQueryResult } from "../src/index.js";

describe("canonical account hierarchy persistence", () => {
  it("accepts a multi-level SaaS hierarchy on full import and clean re-import", async () => {
    const client = new AccountPersistenceClient([]);
    const storage = createPostgresStorageAdapter(client, POSTGRES_CANONICAL_SCHEMA_MANIFEST);
    const accounts = [
      account("saas", undefined, "Software as a Service", false),
      account("security", "saas", "Security", false),
      account("edr", "security", "EDR", true),
      account("office", "saas", "Microsoft Office Subscriptions Income", true)
    ];

    await expect(storage.upsertAccounts(accounts)).resolves.toBe(4);
    await expect(storage.upsertAccounts(accounts)).resolves.toBe(4);
    expect(client.accountUpserts).toBe(2);
  });

  it("validates incremental changes against the prospective stored graph", async () => {
    const existing = [
      account("saas", undefined, "Software as a Service", false),
      account("security", "saas", "Security", false)
    ];
    const storage = createPostgresStorageAdapter(
      new AccountPersistenceClient(existing),
      POSTGRES_CANONICAL_SCHEMA_MANIFEST
    );

    await expect(storage.upsertAccounts([account("edr", "security", "EDR", true)])).resolves.toBe(1);
  });

  it.each([
    {
      code: "account_parent_orphan",
      existing: [] as Account[],
      changed: account("edr", "missing", "EDR", true)
    },
    {
      code: "account_parent_cycle",
      existing: [account("saas", undefined, "SaaS", false), account("edr", "saas", "EDR", true)],
      changed: account("saas", "edr", "SaaS", false)
    },
    {
      code: "account_parent_cycle",
      existing: [] as Account[],
      changed: account("edr", "edr", "EDR", true)
    },
    {
      code: "account_parent_cross_scope",
      existing: [] as Account[],
      crossScope: [{
        ...account("foreign_parent", undefined, "Foreign Parent", true),
        tenantId: "tenant_2",
        sourceId: "quickbooks_2"
      }],
      changed: account("edr", "foreign_parent", "EDR", true)
    }
  ])("rejects $code before writing accounts", async ({ code, existing, changed, crossScope = [] }) => {
    const client = new AccountPersistenceClient(existing, crossScope);
    const storage = createPostgresStorageAdapter(client, POSTGRES_CANONICAL_SCHEMA_MANIFEST);

    let caught: unknown;
    try {
      await storage.upsertAccounts([changed]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AccountHierarchyValidationError);
    expect((caught as AccountHierarchyValidationError).diagnostics).toEqual([
      expect.objectContaining({ code })
    ]);
    expect(client.accountUpserts).toBe(0);
  });
});

class AccountPersistenceClient implements PostgresQueryClient {
  accountUpserts = 0;

  constructor(
    private readonly existing: readonly Account[],
    private readonly crossScope: readonly Account[] = []
  ) {}

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string
  ): Promise<PostgresQueryResult<Row>> {
    if (sql.includes('where "account_id" = any($1::text[])')) {
      return Promise.resolve({ rows: this.crossScope.map(accountRow) as Row[], rowCount: this.crossScope.length });
    }
    if (sql.startsWith('select "account_id"')) {
      return Promise.resolve({ rows: this.existing.map(accountRow) as Row[], rowCount: this.existing.length });
    }
    if (sql.startsWith('insert into "erp_financials"."accounts"')) {
      this.accountUpserts += 1;
      const rowCount = (sql.match(/^\s*\(/gmu) ?? []).length;
      return Promise.resolve({ rows: [], rowCount: rowCount || 1 });
    }
    throw new Error(`Unexpected account persistence query: ${sql}`);
  }
}

function account(
  accountId: string,
  parentAccountId: string | undefined,
  name: string,
  active: boolean
): Account {
  return {
    accountId,
    tenantId: "tenant_1",
    sourceId: "quickbooks_1",
    sourceAccountId: accountId,
    name,
    type: "Income",
    classification: "income",
    ...(parentAccountId === undefined ? {} : { parentAccountId }),
    currencyCode: "USD",
    active
  };
}

function accountRow(value: Account): Record<string, unknown> {
  return {
    account_id: value.accountId,
    tenant_id: value.tenantId,
    source_id: value.sourceId,
    source_account_id: value.sourceAccountId,
    account_number: value.accountNumber ?? null,
    name: value.name,
    type: value.type,
    subtype: value.subtype ?? null,
    classification: value.classification,
    parent_account_id: value.parentAccountId ?? null,
    currency_code: value.currencyCode ?? null,
    active: value.active
  };
}
