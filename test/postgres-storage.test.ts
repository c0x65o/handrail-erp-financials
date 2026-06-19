import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  POSTGRES_CANONICAL_SCHEMA_MANIFEST,
  buildProfitAndLossReport,
  createPostgresStorageAdapter,
  installPostgresSchema,
  validatePostgresSchema
} from "../src/index.js";

import type { PostgresQueryClient, PostgresQueryResult, PostgresSchemaManifest } from "../src/index.js";

type QueryCall = {
  readonly sql: string;
  readonly params: readonly unknown[];
};

type CatalogRow = {
  readonly object_type: "schema" | "table" | "column" | "index" | "constraint";
  readonly table_name: string | null;
  readonly object_name: string;
};

describe("Postgres storage adapter", () => {
  it("exposes install dry-run statements without mutating the database", async () => {
    const client = new RecordingClient();
    const result = await installPostgresSchema(client, POSTGRES_CANONICAL_SCHEMA_MANIFEST, { dryRun: true });

    expect(result.executed).toBe(false);
    expect(result.manifestVersion).toBe("2026-06-19.storage-v1");
    expect(result.schemaVersion).toBe(2);
    expect(result.statements[0]).toBe('create schema if not exists "erp_financials";');
    expect(result.statements.some((statement) => statement.includes('"rollup_buckets"'))).toBe(true);
    expect(result.statements.some((statement) => statement.includes('"report_freshness"'))).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("validates tables, indexes, constraints, and fixture support from catalog reads", async () => {
    const validClient = new RecordingClient(catalogRowsForManifest(POSTGRES_CANONICAL_SCHEMA_MANIFEST));
    const validResult = await validatePostgresSchema(validClient);

    expect(validResult.compatible).toBe(true);
    expect(validResult.fixtureSupport).toBe(true);
    expect(validResult.issues).toEqual([]);
    expect(validClient.calls).toHaveLength(1);
    expect(validClient.calls[0]?.sql).toContain("information_schema.schemata");

    const missingClient = new RecordingClient([
      {
        object_type: "schema",
        table_name: null,
        object_name: "erp_financials"
      }
    ]);
    const missingResult = await validatePostgresSchema(missingClient);

    expect(missingResult.compatible).toBe(false);
    expect(missingResult.fixtureSupport).toBe(false);
    expect(missingResult.issues.map((issue) => issue.kind)).toEqual(
      expect.arrayContaining(["missing_table", "missing_index", "missing_constraint", "missing_fixture_support"])
    );
    expect(missingResult.issues.some((issue) => issue.objectName === "ledger_postings")).toBe(true);
  });

  it("generates tenant/source idempotent upserts for reprocessed ledger postings", async () => {
    const client = new RecordingClient();
    const adapter = createPostgresStorageAdapter(client);
    const firstPosting = ERP_FINANCIALS_STATEMENT_FIXTURE.postings[0];

    if (firstPosting === undefined) {
      throw new Error("fixture must include a posting");
    }

    await adapter.upsertLedgerPostings([firstPosting]);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.sql).toContain('insert into "erp_financials"."ledger_postings"');
    expect(client.calls[0]?.sql).toContain(
      'on conflict ("tenant_id", "source_id", "accounting_basis", "source_posting_id") do update'
    );
    expect(client.calls[0]?.params).toEqual(
      expect.arrayContaining([
        firstPosting.tenantId,
        firstPosting.sourceId,
        firstPosting.accountingBasis,
        firstPosting.sourcePostingId
      ])
    );

    await adapter.upsertLedgerPostings([
      {
        ...firstPosting,
        debitAmount: "50001.00",
        netAmount: "50001.00"
      }
    ]);

    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]?.sql).toBe(client.calls[0]?.sql);
    expect(client.calls[1]?.params).toEqual(expect.arrayContaining(["50001.00"]));
  });

  it("rejects credential-like provider payload refs before writing", async () => {
    const client = new RecordingClient();
    const adapter = createPostgresStorageAdapter(client);
    const firstPosting = ERP_FINANCIALS_STATEMENT_FIXTURE.postings[0];

    if (firstPosting === undefined) {
      throw new Error("fixture must include a posting");
    }

    await expect(
      adapter.upsertLedgerPostings([
        {
          ...firstPosting,
          sourcePayloadRef: {
            sourceObjectType: "Invoice",
            sourceObjectId: "123",
            preview: {
              access_token: "not allowed"
            }
          }
        }
      ])
    ).rejects.toThrow("credential-like field is not allowed");
    expect(client.calls).toHaveLength(0);
  });

  it("loads canonical fixtures and writes report, rollup, and freshness rows through explicit hooks", async () => {
    const client = new RecordingClient();
    const adapter = createPostgresStorageAdapter(client);
    const fixture = ERP_FINANCIALS_STATEMENT_FIXTURE;

    await expect(adapter.loadStatementFixture(fixture)).resolves.toEqual({
      companies: 1,
      sources: 1,
      importBatches: 1,
      checkpoints: 1,
      accounts: fixture.accounts.length,
      parties: fixture.parties.length,
      items: fixture.items.length,
      dimensions: fixture.dimensions.length,
      transactions: fixture.transactions.length,
      transactionLines: fixture.transactionLines.length,
      postings: fixture.postings.length
    });

    const report = buildProfitAndLossReport({
      ...fixture.reportRequest,
      accounts: fixture.accounts,
      postings: fixture.postings
    });

    await adapter.writeReportSnapshot(report);
    await adapter.writeRollupBuckets([
      {
        rollupBucketId: "rollup_fixture_sales_jan",
        tenantId: fixture.company.tenantId,
        companyId: fixture.company.companyId,
        sourceId: fixture.source.sourceId,
        accountId: "acct_sales",
        accountingBasis: "accrual",
        bucketGrain: "month",
        bucketStart: "2026-01-01",
        bucketEnd: "2026-01-31",
        currencyCode: "USD",
        dimensionHash: fixture.postings[2]?.dimensionHash ?? fixture.postings[0]?.dimensionHash ?? "",
        debitAmount: "0.00",
        creditAmount: "20000.00",
        netAmount: "-20000.00",
        postingCount: 2,
        importBatchId: fixture.importBatch.importBatchId,
        generatedAt: "2026-02-01T00:00:00.000Z"
      }
    ]);
    await adapter.writeFreshnessRows([
      {
        freshnessId: "freshness_profit_and_loss_fixture",
        tenantId: fixture.company.tenantId,
        companyId: fixture.company.companyId,
        sourceId: fixture.source.sourceId,
        reportName: "profit_and_loss",
        accountingBasis: "accrual",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        currencyCode: "USD",
        status: "fresh",
        freshThrough: "2026-02-01T00:00:00.000Z",
        importBatchId: fixture.importBatch.importBatchId,
        checkpointId: fixture.checkpoint.checkpointId,
        updatedAt: "2026-02-01T00:00:00.000Z"
      }
    ]);

    expect(client.calls.some((call) => call.sql.includes('"report_snapshots"'))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes('"rollup_buckets"'))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes('"report_freshness"'))).toBe(true);
  });
});

class RecordingClient implements PostgresQueryClient {
  readonly calls: QueryCall[] = [];

  constructor(private readonly catalogRows: readonly CatalogRow[] = []) {}

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ sql, params });

    if (sql.includes("information_schema.schemata")) {
      return Promise.resolve({
        rows: this.catalogRows as unknown as readonly Row[],
        rowCount: this.catalogRows.length
      });
    }

    return Promise.resolve({
      rows: [],
      rowCount: null
    });
  }
}

function catalogRowsForManifest(manifest: PostgresSchemaManifest): readonly CatalogRow[] {
  return [
    {
      object_type: "schema",
      table_name: null,
      object_name: manifest.namespace
    },
    ...manifest.tables.flatMap((table) => [
      {
        object_type: "table" as const,
        table_name: table.name,
        object_name: table.name
      },
      ...table.columns.map((column) => ({
        object_type: "column" as const,
        table_name: table.name,
        object_name: column.name
      })),
      ...table.indexes.map((index) => ({
        object_type: "index" as const,
        table_name: table.name,
        object_name: index.name
      })),
      ...[
        `${table.name}_pkey`,
        ...table.constraints.map((constraint) => constraint.name),
        ...table.columns
          .filter((column) => column.type === "jsonb" && column.maxBytes !== undefined)
          .map((column) => `${table.name}_${column.name}_bounded_json_check`)
      ].map((constraintName) => ({
        object_type: "constraint" as const,
        table_name: table.name,
        object_name: constraintName
      }))
    ])
  ];
}
