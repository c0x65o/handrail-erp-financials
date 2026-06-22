import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  POSTGRES_CANONICAL_SCHEMA_MANIFEST,
  buildStandardReportPresentationFromReadModel,
  buildProfitAndLossReport,
  createPostgresStorageAdapter,
  createCompactDrilldownRef,
  installPostgresSchema,
  validatePostgresSchema
} from "../src/index.js";

import type {
  IsoDate,
  PostgresQueryClient,
  PostgresQueryResult,
  PostgresSchemaManifest,
  StandardReportPresentation,
  StandardReportDisplayColumnsBy,
  StandardReportPresentationReadModelRequest
} from "../src/index.js";

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
    expect(result.schemaVersion).toBe(5);
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
        partyId: "party_customer_acme",
        partyType: "customer",
        itemId: "item_consulting",
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
    expect(client.calls.some((call) => call.sql.includes('"party_id"') && call.sql.includes('"party_type"') && call.sql.includes('"item_id"'))).toBe(true);
    expect(client.calls.some((call) => call.params.includes("party_customer_acme") && call.params.includes("customer") && call.params.includes("item_consulting"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes('"report_freshness"'))).toBe(true);
  });

  it("loads rollup buckets with tenant/source/date/currency scope and optional grouping filters", async () => {
    const client = new RecordingClient();
    const adapter = createPostgresStorageAdapter(client);

    await adapter.loadRollupBuckets({
      tenantId: "tenant_1",
      companyId: "company_1",
      sourceId: "source_qbo",
      accountingBasis: "accrual",
      bucketGrain: "month",
      bucketStart: "2026-01-01",
      bucketEnd: "2026-03-31",
      currencyCode: "USD",
      accountIds: ["acct_sales", "acct_cogs"],
      dimensionHash: "0".repeat(64),
      partyTypes: ["customer", "vendor"],
      partyId: "party_acme",
      itemIds: ["item_consulting", "item_subscription"]
    });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.sql).toContain('from "erp_financials"."rollup_buckets"');
    expect(client.calls[0]?.sql).toContain('"tenant_id" = $1');
    expect(client.calls[0]?.sql).toContain('"company_id" = $2');
    expect(client.calls[0]?.sql).toContain('"source_id" = $3');
    expect(client.calls[0]?.sql).toContain('"accounting_basis" = $4');
    expect(client.calls[0]?.sql).toContain('"bucket_grain" = $5');
    expect(client.calls[0]?.sql).toContain('"bucket_start" >= $6::date');
    expect(client.calls[0]?.sql).toContain('"bucket_end" <= $7::date');
    expect(client.calls[0]?.sql).toContain('"currency_code" = $8');
    expect(client.calls[0]?.sql).toContain('"account_id" = any($9::text[])');
    expect(client.calls[0]?.sql).toContain('"dimension_hash" = any($10::text[])');
    expect(client.calls[0]?.sql).toContain('"party_type" = any($11::text[])');
    expect(client.calls[0]?.sql).toContain('"party_id" = any($12::text[])');
    expect(client.calls[0]?.sql).toContain('"item_id" = any($13::text[])');
    expect(client.calls[0]?.sql).toContain(
      'order by "bucket_start", "account_id", "dimension_hash", "party_type", "party_id", "item_id"'
    );
    expect(client.calls[0]?.sql).not.toMatch(/Intuit|OAuth|access[_-]?token|refresh[_-]?token|client[_-]?secret/i);
    expect(client.calls[0]?.sql).not.toMatch(/quickbooks_.*archive|provider_.*archive|raw_.*payload/i);
    expect(client.calls[0]?.params).toEqual([
      "tenant_1",
      "company_1",
      "source_qbo",
      "accrual",
      "month",
      "2026-01-01",
      "2026-03-31",
      "USD",
      ["acct_sales", "acct_cogs"],
      ["0".repeat(64)],
      ["customer", "vendor"],
      ["party_acme"],
      ["item_consulting", "item_subscription"]
    ]);
  });

  it("serves a two-year monthly P&L presentation from snapshots without loading raw ledger postings", async () => {
    const request = {
      tenantId: "tenant_1",
      companyId: "company_1",
      sourceId: "source_qbo",
      reportName: "profit_and_loss",
      accountingMethod: "accrual",
      periodStart: "2026-01-01",
      periodEnd: "2027-12-31",
      asOfDate: "2027-12-31",
      currencyCode: "USD",
      displayColumnsBy: "months"
    } satisfies StandardReportPresentationReadModelRequest;
    const client = new SnapshotPresentationClient(monthlyProfitAndLossSnapshots(request));
    const adapter = createPostgresStorageAdapter(client);

    const presentation = await buildStandardReportPresentationFromReadModel(adapter, request);

    expect(Object.hasOwn(request, "reportInput")).toBe(false);
    expect(presentation.columns).toHaveLength(24);
    expect(presentation.columns[0]).toMatchObject({
      columnId: "actual:months:month:2026-01-01:2026-01-31",
      label: "01/2026",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31"
    });
    expect(presentation.columns[23]).toMatchObject({
      columnId: "actual:months:month:2027-12-01:2027-12-31",
      label: "12/2027",
      periodStart: "2027-12-01",
      periodEnd: "2027-12-31"
    });
    expect(rowCell(presentation, "total:net_income", "actual:months:month:2026-01-01:2026-01-31")?.amount).toBe("100.00");
    expect(rowCell(presentation, "total:net_income", "actual:months:month:2027-12-01:2027-12-31")?.amount).toBe("2400.00");
    expect(presentation.primaryReport.metadata.generatedFrom).toBe("rollup_buckets");
    expect(presentation.primaryReport.totals.find((total) => total.totalKey === "net_income")?.amount).toBe("30000.00");
    expect(client.calls.some((call) => call.sql.includes('"ledger_postings"'))).toBe(false);
    expect(client.calls.some((call) => call.sql.includes('from "erp_financials"."accounts"'))).toBe(false);
    expect(client.calls.every((call) => call.sql.includes('"report_snapshots"') || call.sql.includes('"report_snapshot_'))).toBe(true);
  });

  it.each([
    ["customer", "party_customer_acme", "Acme Co", '"party_type" = $10', "customer"],
    ["vendor", "party_vendor_northwind", "Northwind Supplies", '"party_type" = $10', "vendor"],
    ["employee", "party_employee_jane", "Jane Employee", '"party_type" = $10', "employee"],
    ["product_service", "item_consulting", "Consulting", '"item_id" <> \'\'', undefined]
  ] as const)(
    "serves %s P&L display columns from grouped rollup buckets without loading raw ledger postings",
    async (displayColumnsBy, groupKey, groupLabel, expectedSql, expectedPartyTypeParam) => {
      const request = {
        tenantId: "tenant_1",
        companyId: "company_1",
        sourceId: "source_qbo",
        reportName: "profit_and_loss",
        accountingMethod: "accrual",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        asOfDate: "2026-01-31",
        currencyCode: "USD",
        displayColumnsBy
      } satisfies StandardReportPresentationReadModelRequest;
      const client = new RollupPresentationClient([
        rollupPresentationRow(groupKey, groupLabel, "acct_sales", "4000", "Sales", "income", "0.00", "200.00", "-200.00"),
        rollupPresentationRow(groupKey, groupLabel, "acct_expense", "6000", "Expense", "expense", "50.00", "0.00", "50.00")
      ]);
      const adapter = createPostgresStorageAdapter(client);

      const presentation = await buildStandardReportPresentationFromReadModel(adapter, request);

      expect(presentation.columns).toHaveLength(1);
      expect(presentation.columns[0]).toMatchObject({
        columnId: `actual:${displayColumnsBy}:${groupKey}`,
        label: groupLabel,
        displayColumnsBy: displayColumnsBy as StandardReportDisplayColumnsBy
      });
      expect(rowCell(presentation, "line:account:acct_sales", `actual:${displayColumnsBy}:${groupKey}`)?.amount).toBe("200.00");
      expect(rowCell(presentation, "line:account:acct_expense", `actual:${displayColumnsBy}:${groupKey}`)?.amount).toBe("50.00");
      expect(rowCell(presentation, "total:net_income", `actual:${displayColumnsBy}:${groupKey}`)?.amount).toBe("150.00");
      expect(presentation.primaryReport.metadata.generatedFrom).toBe("rollup_buckets");

      const rollupCall = client.calls.find((call) => call.sql.includes('from "erp_financials"."rollup_buckets"'));
      expect(rollupCall?.sql).toContain('join "erp_financials"."accounts"');
      expect(rollupCall?.sql).toContain(expectedSql);
      expect(rollupCall?.sql).toContain('rb."tenant_id" = $1');
      expect(rollupCall?.sql).toContain('rb."company_id" = $2');
      expect(rollupCall?.sql).toContain('rb."source_id" = $3');
      expect(rollupCall?.sql).toContain('rb."accounting_basis" = $4');
      expect(rollupCall?.sql).toContain('rb."bucket_grain" = $5');
      expect(rollupCall?.sql).toContain('rb."bucket_start" >= $6::date');
      expect(rollupCall?.sql).toContain('rb."bucket_end" <= $7::date');
      expect(rollupCall?.sql).toContain('rb."currency_code" = $8');
      expect(rollupCall?.sql).toContain('a."classification" = any($9::text[])');
      expect(rollupCall?.params.slice(0, 9)).toEqual([
        "tenant_1",
        "company_1",
        "source_qbo",
        "accrual",
        "month",
        "2026-01-01",
        "2026-01-31",
        "USD",
        ["income", "cost_of_goods_sold", "expense", "other_income", "other_expense"]
      ]);
      if (expectedPartyTypeParam === undefined) {
        expect(rollupCall?.params).toHaveLength(9);
      } else {
        expect(rollupCall?.params[9]).toBe(expectedPartyTypeParam);
      }
      expect(client.calls.some((call) => call.sql.includes('"ledger_postings"'))).toBe(false);
    }
  );
});

class RollupPresentationClient implements PostgresQueryClient {
  readonly calls: QueryCall[] = [];

  constructor(private readonly aggregateRows: readonly Record<string, unknown>[]) {}

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ sql, params });

    if (sql.includes('"ledger_postings"')) {
      throw new Error("raw ledger postings must not be queried for standard presentation");
    }

    if (sql.includes('from "erp_financials"."rollup_buckets"')) {
      return Promise.resolve({
        rows: this.aggregateRows as readonly Row[],
        rowCount: this.aggregateRows.length
      });
    }

    if (sql.includes('from "erp_financials"."report_snapshots"')) {
      return Promise.resolve({
        rows: [],
        rowCount: 0
      });
    }

    return Promise.resolve({
      rows: [],
      rowCount: null
    });
  }
}

function rollupPresentationRow(
  groupKey: string,
  groupLabel: string,
  accountId: string,
  accountNumber: string,
  accountName: string,
  accountClassification: string,
  debitAmount: string,
  creditAmount: string,
  netAmount: string
): Record<string, unknown> {
  return {
    group_key: groupKey,
    group_label: groupLabel,
    account_id: accountId,
    account_number: accountNumber,
    account_name: accountName,
    account_classification: accountClassification,
    debit_amount: debitAmount,
    credit_amount: creditAmount,
    net_amount: netAmount,
    posting_count: 1,
    generated_at: "2026-02-01T00:00:00.000Z",
    source_posting_max_updated_at: null,
    import_batch_id: null
  };
}

type SnapshotBundle = {
  readonly snapshot: Record<string, unknown>;
  readonly lines: readonly Record<string, unknown>[];
  readonly totals: readonly Record<string, unknown>[];
};

class SnapshotPresentationClient implements PostgresQueryClient {
  readonly calls: QueryCall[] = [];
  private readonly snapshotsByKey: ReadonlyMap<string, SnapshotBundle>;

  constructor(snapshots: readonly SnapshotBundle[]) {
    this.snapshotsByKey = new Map(snapshots.map((snapshot) => [snapshotKeyFromRow(snapshot.snapshot), snapshot]));
  }

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ sql, params });

    if (sql.includes('"ledger_postings"')) {
      throw new Error("raw ledger postings must not be queried for standard presentation");
    }

    if (sql.includes('from "erp_financials"."report_snapshots"')) {
      const snapshot = this.snapshotsByKey.get(snapshotKeyFromParams(params));
      return Promise.resolve({
        rows: snapshot === undefined ? [] : [snapshot.snapshot as Row],
        rowCount: snapshot === undefined ? 0 : 1
      });
    }

    if (sql.includes('from "erp_financials"."report_snapshot_lines"')) {
      const snapshot = this.snapshotById(stringParam(params[1]));
      return Promise.resolve({
        rows: (snapshot?.lines ?? []) as readonly Row[],
        rowCount: snapshot?.lines.length ?? 0
      });
    }

    if (sql.includes('from "erp_financials"."report_snapshot_totals"')) {
      const snapshot = this.snapshotById(stringParam(params[1]));
      return Promise.resolve({
        rows: (snapshot?.totals ?? []) as readonly Row[],
        rowCount: snapshot?.totals.length ?? 0
      });
    }

    return Promise.resolve({
      rows: [],
      rowCount: null
    });
  }

  private snapshotById(reportSnapshotId: string): SnapshotBundle | undefined {
    return [...this.snapshotsByKey.values()].find((snapshot) => snapshot.snapshot.report_snapshot_id === reportSnapshotId);
  }
}

function monthlyProfitAndLossSnapshots(request: StandardReportPresentationReadModelRequest): readonly SnapshotBundle[] {
  const snapshots: SnapshotBundle[] = [];
  let cursor = parseIsoDate(request.periodStart);
  const end = parseIsoDate(request.periodEnd);
  let monthNumber = 1;

  while (cursor.getTime() <= end.getTime()) {
    const periodStart = formatIsoDate(cursor);
    const periodEnd = formatIsoDate(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)));
    snapshots.push(profitAndLossSnapshot(request, periodStart, periodEnd, monthNumber));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    monthNumber += 1;
  }

  return snapshots;
}

function profitAndLossSnapshot(
  request: StandardReportPresentationReadModelRequest,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  monthNumber: number
): SnapshotBundle {
  const reportSnapshotId = `snapshot:${request.tenantId}:profit_and_loss:${periodStart}:${periodEnd}`;
  const income = money(monthNumber * 200);
  const expense = money(monthNumber * 100);
  const netIncome = money(monthNumber * 100);
  const generatedAt = `${periodEnd}T12:00:00.000Z`;

  return {
    snapshot: {
      report_snapshot_id: reportSnapshotId,
      tenant_id: request.tenantId,
      report_name: request.reportName,
      snapshot_source: "rollup",
      accounting_basis: request.accountingMethod,
      period_start: periodStart,
      period_end: periodEnd,
      as_of_date: periodEnd,
      currency_code: request.currencyCode,
      generated_at: generatedAt,
      freshness: { status: "fresh", sourceId: request.sourceId },
      reconciliation_status: "not_reconciled",
      reconciliation_difference: "0.00"
    },
    lines: [
      {
        report_line_id: "profit_and_loss:line:001:acct_sales",
        tenant_id: request.tenantId,
        report_snapshot_id: reportSnapshotId,
        parent_report_line_id: null,
        section: "income",
        label: "4000 Sales",
        account_id: "acct_sales",
        amount: income,
        sort_order: 10,
        drilldown_ref: drilldownRef(request, periodStart, periodEnd, "acct_sales", "profit_and_loss:acct_sales")
      },
      {
        report_line_id: "profit_and_loss:line:002:acct_expense",
        tenant_id: request.tenantId,
        report_snapshot_id: reportSnapshotId,
        parent_report_line_id: null,
        section: "expense",
        label: "6000 Expense",
        account_id: "acct_expense",
        amount: expense,
        sort_order: 20,
        drilldown_ref: drilldownRef(request, periodStart, periodEnd, "acct_expense", "profit_and_loss:acct_expense")
      }
    ],
    totals: [
      totalRow(request, reportSnapshotId, periodStart, periodEnd, "total_income", "Total Income", income),
      totalRow(request, reportSnapshotId, periodStart, periodEnd, "total_expenses", "Total Expenses", expense),
      totalRow(request, reportSnapshotId, periodStart, periodEnd, "net_income", "Net Income", netIncome)
    ]
  };
}

function totalRow(
  request: StandardReportPresentationReadModelRequest,
  reportSnapshotId: string,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  totalKey: string,
  label: string,
  amount: string
): Record<string, unknown> {
  return {
    report_total_id: `profit_and_loss:total:${totalKey}`,
    tenant_id: request.tenantId,
    report_snapshot_id: reportSnapshotId,
    total_key: totalKey,
    label,
    amount,
    drilldown_ref: drilldownRef(request, periodStart, periodEnd, undefined, `profit_and_loss:${totalKey}`)
  };
}

function drilldownRef(
  request: StandardReportPresentationReadModelRequest,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  accountId: string | undefined,
  token: string
): ReturnType<typeof createCompactDrilldownRef> {
  const accountingBasis = request.accountingMethod ?? "accrual";

  return createCompactDrilldownRef({
    token,
    postingIds: [],
    ...(accountId === undefined ? {} : { accountIds: [accountId] }),
    query: {
      kind: "ledger_postings",
      tenantId: request.tenantId,
      sourceId: request.sourceId,
      accountingBasis,
      periodStart,
      periodEnd,
      ...(accountId === undefined ? {} : { accountIds: [accountId] })
    }
  });
}

function snapshotKeyFromParams(params: readonly unknown[]): string {
  return [
    params[0],
    params[1],
    params[2],
    params[3],
    params[4],
    params[5] ?? params[4],
    params[6]
  ].join("|");
}

function stringParam(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function snapshotKeyFromRow(row: Record<string, unknown>): string {
  return [
    row.tenant_id,
    row.report_name,
    row.accounting_basis,
    row.period_start,
    row.period_end,
    row.as_of_date,
    row.currency_code
  ].join("|");
}

function rowCell(
  presentation: StandardReportPresentation,
  rowId: string,
  columnId: string
): { readonly amount?: string; readonly percent?: string } | undefined {
  return presentation.rows.find((row) => row.rowId === rowId)?.cells.find((cell) => cell.columnId === columnId);
}

function parseIsoDate(value: IsoDate): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`Invalid ISO date: ${value}`);
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

function money(amount: number): string {
  return `${amount.toString()}.00`;
}

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
