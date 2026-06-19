import type {
  Account,
  AccountingBasis,
  AccountingCompany,
  AccountingDimension,
  AccountingSource,
  AccountingTransaction,
  DecimalString,
  ImportBatch,
  IsoCurrencyCode,
  IsoDate,
  IsoDateTime,
  Item,
  JsonValue,
  LedgerPosting,
  Party,
  ReportFreshness,
  ReportFreshnessStatus,
  ReportSnapshot,
  ReportSnapshotLine,
  ReportSnapshotTotal,
  SourceId,
  SyncCheckpoint,
  TenantId,
  TransactionLine
} from "./canonical-model.js";
import { assertLedgerPostingAmounts, assertNoCredentialKeys, assertSafeSourcePayloadRef } from "./canonical-model.js";
import type { BuiltReport } from "./report-builders.js";
import { type StatementFixtureSet } from "./fixtures.js";
import {
  POSTGRES_CANONICAL_SCHEMA_MANIFEST,
  assertManifestHasNoCredentialColumns,
  renderPostgresSchemaSql
} from "./schema-manifest.js";
import type { PostgresSchemaManifest, PostgresTableManifest } from "./schema-manifest.js";

export type PostgresQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  readonly rows: readonly Row[];
  readonly rowCount?: number | null;
};

export type PostgresQueryClient = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>>;
};

export type InstallPostgresSchemaOptions = {
  readonly dryRun?: boolean;
};

export type InstallPostgresSchemaResult = {
  readonly manifestVersion: PostgresSchemaManifest["manifestVersion"];
  readonly schemaVersion: PostgresSchemaManifest["schemaVersion"];
  readonly statements: readonly string[];
  readonly executed: boolean;
};

export type PostgresSchemaValidationIssueKind =
  | "missing_schema"
  | "missing_table"
  | "missing_column"
  | "missing_index"
  | "missing_constraint"
  | "credential_column"
  | "missing_fixture_support";

export type PostgresSchemaValidationIssue = {
  readonly kind: PostgresSchemaValidationIssueKind;
  readonly table?: string;
  readonly objectName: string;
  readonly message: string;
};

export type PostgresSchemaValidationResult = {
  readonly manifestVersion: PostgresSchemaManifest["manifestVersion"];
  readonly schemaVersion: PostgresSchemaManifest["schemaVersion"];
  readonly compatible: boolean;
  readonly fixtureSupport: boolean;
  readonly issues: readonly PostgresSchemaValidationIssue[];
};

export type RollupBucketGrain = "day" | "month" | "fiscal_period";

export type RollupBucket = {
  readonly rollupBucketId: string;
  readonly tenantId: TenantId;
  readonly companyId: string;
  readonly sourceId: SourceId;
  readonly accountId: string;
  readonly accountingBasis: AccountingBasis;
  readonly bucketGrain: RollupBucketGrain;
  readonly bucketStart: IsoDate;
  readonly bucketEnd: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly dimensionHash: string;
  readonly debitAmount: DecimalString;
  readonly creditAmount: DecimalString;
  readonly netAmount: DecimalString;
  readonly postingCount: number;
  readonly sourcePostingMaxUpdatedAt?: IsoDateTime;
  readonly importBatchId?: string;
  readonly generatedAt: IsoDateTime;
};

export type RollupReprocessWindow = {
  readonly tenantId: TenantId;
  readonly companyId: string;
  readonly sourceId: SourceId;
  readonly accountingBasis: AccountingBasis;
  readonly bucketGrain: RollupBucketGrain;
  readonly bucketStart: IsoDate;
  readonly bucketEnd: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
};

export type ReplaceRollupBucketsForWindowsInput = {
  readonly windows: readonly RollupReprocessWindow[];
  readonly buckets: readonly RollupBucket[];
};

export type ReplaceRollupBucketsForWindowsResult = {
  readonly deleted: number;
  readonly upserted: number;
};

export type ReportFreshnessRow = {
  readonly freshnessId: string;
  readonly tenantId: TenantId;
  readonly companyId: string;
  readonly sourceId: SourceId;
  readonly reportName: string;
  readonly accountingBasis: AccountingBasis;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
  readonly status: ReportFreshnessStatus;
  readonly freshThrough?: IsoDateTime;
  readonly staleReason?: string;
  readonly importBatchId?: string;
  readonly checkpointId?: string;
  readonly updatedAt: IsoDateTime;
};

export type FixtureLoadResult = {
  readonly companies: number;
  readonly sources: number;
  readonly importBatches: number;
  readonly checkpoints: number;
  readonly accounts: number;
  readonly parties: number;
  readonly items: number;
  readonly dimensions: number;
  readonly transactions: number;
  readonly transactionLines: number;
  readonly postings: number;
};

export type PostgresStorageAdapter = {
  readonly manifest: PostgresSchemaManifest;
  installSchema(options?: InstallPostgresSchemaOptions): Promise<InstallPostgresSchemaResult>;
  validateSchema(): Promise<PostgresSchemaValidationResult>;
  upsertAccountingCompany(company: AccountingCompany): Promise<number>;
  upsertAccountingSource(source: AccountingSource): Promise<number>;
  upsertImportBatch(importBatch: ImportBatch): Promise<number>;
  upsertSyncCheckpoint(checkpoint: SyncCheckpoint): Promise<number>;
  upsertAccounts(accounts: readonly Account[]): Promise<number>;
  upsertParties(parties: readonly Party[]): Promise<number>;
  upsertItems(items: readonly Item[]): Promise<number>;
  upsertDimensions(dimensions: readonly AccountingDimension[]): Promise<number>;
  upsertTransactions(transactions: readonly AccountingTransaction[]): Promise<number>;
  upsertTransactionLines(lines: readonly TransactionLine[]): Promise<number>;
  upsertLedgerPostings(postings: readonly LedgerPosting[]): Promise<number>;
  loadStatementFixture(fixture: StatementFixtureSet): Promise<FixtureLoadResult>;
  writeReportSnapshot(report: BuiltReport): Promise<number>;
  writeRollupBuckets(buckets: readonly RollupBucket[]): Promise<number>;
  replaceRollupBucketsForWindows(input: ReplaceRollupBucketsForWindowsInput): Promise<ReplaceRollupBucketsForWindowsResult>;
  writeFreshnessRows(rows: readonly ReportFreshnessRow[]): Promise<number>;
  markReportSnapshotsStale(input: MarkReportSnapshotsStaleInput): Promise<number>;
  markReportSnapshotsStaleForPostingChanges(input: MarkReportSnapshotsStaleForPostingChangesInput): Promise<number>;
};

export type MarkReportSnapshotsStaleInput = {
  readonly tenantId: TenantId;
  readonly reportSnapshotIds: readonly string[];
  readonly staleReason: string;
};

export type MarkReportSnapshotsStaleForPostingChangesInput = {
  readonly tenantId: TenantId;
  readonly affectedStart: IsoDate;
  readonly affectedEnd: IsoDate;
  readonly staleReason: string;
  readonly reportNames?: readonly string[];
  readonly accountingBasis?: AccountingBasis;
  readonly currencyCode?: IsoCurrencyCode;
};

type Row = Readonly<Record<string, unknown>>;

type CatalogRow = {
  readonly object_type: "schema" | "table" | "column" | "index" | "constraint";
  readonly table_name: string | null;
  readonly object_name: string;
};

const FIXTURE_SUPPORT_TABLES = [
  "accounting_companies",
  "accounting_sources",
  "import_batches",
  "sync_checkpoints",
  "accounts",
  "parties",
  "items",
  "accounting_dimensions",
  "transactions",
  "transaction_lines",
  "ledger_postings"
] as const;

export function createPostgresStorageAdapter(
  client: PostgresQueryClient,
  manifest: PostgresSchemaManifest = POSTGRES_CANONICAL_SCHEMA_MANIFEST
): PostgresStorageAdapter {
  assertManifestHasNoCredentialColumns(manifest);

  return {
    manifest,
    async installSchema(options = {}) {
      return installPostgresSchema(client, manifest, options);
    },
    async validateSchema() {
      return validatePostgresSchema(client, manifest);
    },
    async upsertAccountingCompany(company) {
      return upsertRows(client, manifest, "accounting_companies", [companyRow(company)], [
        "tenant_id",
        "source_system",
        "provider_environment",
        "source_company_ref"
      ]);
    },
    async upsertAccountingSource(source) {
      return upsertRows(client, manifest, "accounting_sources", [sourceRow(source)], [
        "tenant_id",
        "source_system",
        "provider_environment",
        "connection_ref"
      ]);
    },
    async upsertImportBatch(importBatch) {
      return upsertRows(client, manifest, "import_batches", [importBatchRow(importBatch)], ["import_batch_id"]);
    },
    async upsertSyncCheckpoint(checkpoint) {
      return upsertRows(client, manifest, "sync_checkpoints", [syncCheckpointRow(checkpoint)], [
        "tenant_id",
        "source_id",
        "source_object",
        "cursor_kind"
      ]);
    },
    async upsertAccounts(accounts) {
      return upsertRows(client, manifest, "accounts", accounts.map(accountRow), [
        "tenant_id",
        "source_id",
        "source_account_id"
      ]);
    },
    async upsertParties(parties) {
      return upsertRows(client, manifest, "parties", parties.map(partyRow), ["tenant_id", "source_id", "source_party_id"]);
    },
    async upsertItems(items) {
      return upsertRows(client, manifest, "items", items.map(itemRow), ["tenant_id", "source_id", "source_item_id"]);
    },
    async upsertDimensions(dimensions) {
      return upsertRows(client, manifest, "accounting_dimensions", dimensions.map(dimensionRow), [
        "tenant_id",
        "source_id",
        "dimension_kind",
        "source_dimension_id"
      ]);
    },
    async upsertTransactions(transactions) {
      for (const transaction of transactions) {
        if (transaction.sourcePayloadRef !== undefined) {
          assertSafeSourcePayloadRef(transaction.sourcePayloadRef);
        }
      }
      return upsertRows(client, manifest, "transactions", transactions.map(transactionRow), [
        "tenant_id",
        "source_id",
        "source_transaction_type",
        "source_transaction_id"
      ]);
    },
    async upsertTransactionLines(lines) {
      return upsertRows(client, manifest, "transaction_lines", lines.map(transactionLineRow), [
        "tenant_id",
        "transaction_id",
        "line_number"
      ]);
    },
    async upsertLedgerPostings(postings) {
      for (const posting of postings) {
        assertLedgerPostingAmounts(posting);
        if (posting.sourcePayloadRef !== undefined) {
          assertSafeSourcePayloadRef(posting.sourcePayloadRef);
        }
      }
      return upsertRows(client, manifest, "ledger_postings", postings.map(ledgerPostingRow), [
        "tenant_id",
        "source_id",
        "accounting_basis",
        "source_posting_id"
      ]);
    },
    async loadStatementFixture(fixture) {
      return loadStatementFixture(client, manifest, fixture);
    },
    async writeReportSnapshot(report) {
      return writeReportSnapshot(client, manifest, report);
    },
    async writeRollupBuckets(buckets) {
      for (const bucket of buckets) {
        assertLedgerPostingAmounts(bucket);
      }
      return upsertRows(client, manifest, "rollup_buckets", buckets.map(rollupBucketRow), [
        "tenant_id",
        "company_id",
        "source_id",
        "accounting_basis",
        "bucket_grain",
        "bucket_start",
        "bucket_end",
        "account_id",
        "currency_code",
        "dimension_hash"
      ]);
    },
    async replaceRollupBucketsForWindows(input) {
      return replaceRollupBucketsForWindows(client, manifest, input);
    },
    async writeFreshnessRows(rows) {
      return upsertRows(client, manifest, "report_freshness", rows.map(reportFreshnessRow), [
        "tenant_id",
        "company_id",
        "source_id",
        "report_name",
        "accounting_basis",
        "period_start",
        "period_end",
        "currency_code"
      ]);
    },
    async markReportSnapshotsStale(input) {
      return markReportSnapshotsStale(client, manifest, input);
    },
    async markReportSnapshotsStaleForPostingChanges(input) {
      return markReportSnapshotsStaleForPostingChanges(client, manifest, input);
    }
  };
}

export async function installPostgresSchema(
  client: PostgresQueryClient,
  manifest: PostgresSchemaManifest = POSTGRES_CANONICAL_SCHEMA_MANIFEST,
  options: InstallPostgresSchemaOptions = {}
): Promise<InstallPostgresSchemaResult> {
  assertManifestHasNoCredentialColumns(manifest);
  const statements = splitSqlStatements(renderPostgresSchemaSql(manifest));

  if (options.dryRun !== true) {
    for (const statement of statements) {
      await client.query(statement);
    }
  }

  return {
    manifestVersion: manifest.manifestVersion,
    schemaVersion: manifest.schemaVersion,
    statements,
    executed: options.dryRun !== true
  };
}

export async function validatePostgresSchema(
  client: PostgresQueryClient,
  manifest: PostgresSchemaManifest = POSTGRES_CANONICAL_SCHEMA_MANIFEST
): Promise<PostgresSchemaValidationResult> {
  assertManifestHasNoCredentialColumns(manifest);
  const catalogRows = await readCatalogRows(client, manifest.namespace);
  const available = new Set(catalogRows.map(catalogKey));
  const issues: PostgresSchemaValidationIssue[] = [];

  if (!available.has(`schema::${manifest.namespace}`)) {
    issues.push({
      kind: "missing_schema",
      objectName: manifest.namespace,
      message: `missing schema ${manifest.namespace}`
    });
  }

  for (const table of manifest.tables) {
    if (!available.has(`table::${table.name}`)) {
      issues.push({
        kind: "missing_table",
        table: table.name,
        objectName: table.name,
        message: `missing table ${manifest.namespace}.${table.name}`
      });
    }

    for (const column of table.columns) {
      if (!available.has(`column::${table.name}.${column.name}`)) {
        issues.push({
          kind: "missing_column",
          table: table.name,
          objectName: column.name,
          message: `missing column ${manifest.namespace}.${table.name}.${column.name}`
        });
      }
      if (/token|secret|password|credential|private_key/i.test(column.name)) {
        issues.push({
          kind: "credential_column",
          table: table.name,
          objectName: column.name,
          message: `credential-like column is not allowed: ${table.name}.${column.name}`
        });
      }
    }

    for (const index of table.indexes) {
      if (!available.has(`index::${index.name}`)) {
        issues.push({
          kind: "missing_index",
          table: table.name,
          objectName: index.name,
          message: `missing index ${manifest.namespace}.${index.name}`
        });
      }
    }

    for (const constraintName of expectedConstraintNames(table)) {
      if (!available.has(`constraint::${table.name}.${constraintName}`)) {
        issues.push({
          kind: "missing_constraint",
          table: table.name,
          objectName: constraintName,
          message: `missing constraint ${manifest.namespace}.${table.name}.${constraintName}`
        });
      }
    }
  }

  for (const tableName of FIXTURE_SUPPORT_TABLES) {
    if (!available.has(`table::${tableName}`)) {
      issues.push({
        kind: "missing_fixture_support",
        table: tableName,
        objectName: tableName,
        message: `fixture loader requires ${manifest.namespace}.${tableName}`
      });
    }
  }

  const fixtureSupport = !issues.some((issue) => issue.kind === "missing_fixture_support");

  return {
    manifestVersion: manifest.manifestVersion,
    schemaVersion: manifest.schemaVersion,
    compatible: issues.length === 0,
    fixtureSupport,
    issues
  };
}

async function loadStatementFixture(
  client: PostgresQueryClient,
  manifest: PostgresSchemaManifest,
  fixture: StatementFixtureSet
): Promise<FixtureLoadResult> {
  const adapter = createPostgresStorageAdapter(client, manifest);

  return {
    companies: await adapter.upsertAccountingCompany(fixture.company),
    sources: await adapter.upsertAccountingSource(fixture.source),
    importBatches: await adapter.upsertImportBatch(fixture.importBatch),
    checkpoints: await adapter.upsertSyncCheckpoint(fixture.checkpoint),
    accounts: await adapter.upsertAccounts(fixture.accounts),
    parties: await adapter.upsertParties(fixture.parties),
    items: await adapter.upsertItems(fixture.items),
    dimensions: await adapter.upsertDimensions(fixture.dimensions),
    transactions: await adapter.upsertTransactions(fixture.transactions),
    transactionLines: await adapter.upsertTransactionLines(fixture.transactionLines),
    postings: await adapter.upsertLedgerPostings(fixture.postings)
  };
}

async function writeReportSnapshot(
  client: PostgresQueryClient,
  manifest: PostgresSchemaManifest,
  report: BuiltReport
): Promise<number> {
  const snapshotCount = await upsertRows(client, manifest, "report_snapshots", [reportSnapshotRow(report.snapshot)], [
    "tenant_id",
    "report_name",
    "snapshot_source",
    "accounting_basis",
    "period_start",
    "period_end",
    "as_of_date",
    "currency_code"
  ]);
  await pruneMissingSnapshotChildren(
    client,
    manifest,
    "report_snapshot_lines",
    report.snapshot.tenantId,
    report.snapshot.reportSnapshotId,
    "report_line_id",
    report.lines.map((line) => line.reportLineId)
  );
  await pruneMissingSnapshotChildren(
    client,
    manifest,
    "report_snapshot_totals",
    report.snapshot.tenantId,
    report.snapshot.reportSnapshotId,
    "report_total_id",
    report.totals.map((total) => total.reportTotalId)
  );
  const lineCount = await upsertRows(client, manifest, "report_snapshot_lines", report.lines.map(reportSnapshotLineRow), [
    "report_line_id"
  ]);
  const totalCount = await upsertRows(
    client,
    manifest,
    "report_snapshot_totals",
    report.totals.map(reportSnapshotTotalRow),
    ["report_total_id"]
  );

  return snapshotCount + lineCount + totalCount;
}

async function markReportSnapshotsStale(
  client: PostgresQueryClient,
  manifest: PostgresSchemaManifest,
  input: MarkReportSnapshotsStaleInput
): Promise<number> {
  if (input.reportSnapshotIds.length === 0) {
    return 0;
  }

  const result = await client.query(
    `update ${qualifiedTable(manifest, "report_snapshots")}
set "freshness" = jsonb_set(coalesce("freshness", '{}'::jsonb), '{status}', '"stale"', true) || jsonb_build_object('staleReason', $3::text)
where "tenant_id" = $1 and "report_snapshot_id" = any($2::text[])`,
    [input.tenantId, input.reportSnapshotIds, input.staleReason]
  );

  return result.rowCount ?? 0;
}

async function markReportSnapshotsStaleForPostingChanges(
  client: PostgresQueryClient,
  manifest: PostgresSchemaManifest,
  input: MarkReportSnapshotsStaleForPostingChangesInput
): Promise<number> {
  const parameters: unknown[] = [input.tenantId, input.affectedStart, input.affectedEnd, input.staleReason];
  const filters = [
    `"tenant_id" = $1`,
    `(("period_start" <= $3::date and "period_end" >= $2::date) or "as_of_date" >= $2::date)`
  ];

  if (input.reportNames !== undefined && input.reportNames.length > 0) {
    parameters.push(input.reportNames);
    filters.push(`"report_name" = any($${String(parameters.length)}::text[])`);
  }
  if (input.accountingBasis !== undefined) {
    parameters.push(input.accountingBasis);
    filters.push(`"accounting_basis" = $${String(parameters.length)}`);
  }
  if (input.currencyCode !== undefined) {
    parameters.push(input.currencyCode);
    filters.push(`"currency_code" = $${String(parameters.length)}`);
  }

  const result = await client.query(
    `update ${qualifiedTable(manifest, "report_snapshots")}
set "freshness" = jsonb_set(coalesce("freshness", '{}'::jsonb), '{status}', '"stale"', true) || jsonb_build_object('staleReason', $4::text)
where ${filters.join(" and ")}`,
    parameters
  );

  return result.rowCount ?? 0;
}

async function replaceRollupBucketsForWindows(
  client: PostgresQueryClient,
  manifest: PostgresSchemaManifest,
  input: ReplaceRollupBucketsForWindowsInput
): Promise<ReplaceRollupBucketsForWindowsResult> {
  for (const bucket of input.buckets) {
    assertLedgerPostingAmounts(bucket);
  }

  const deleted = await deleteRollupBucketsForWindows(client, manifest, input.windows);
  const upserted = await upsertRows(client, manifest, "rollup_buckets", input.buckets.map(rollupBucketRow), [
    "tenant_id",
    "company_id",
    "source_id",
    "accounting_basis",
    "bucket_grain",
    "bucket_start",
    "bucket_end",
    "account_id",
    "currency_code",
    "dimension_hash"
  ]);

  return { deleted, upserted };
}

async function deleteRollupBucketsForWindows(
  client: PostgresQueryClient,
  manifest: PostgresSchemaManifest,
  windows: readonly RollupReprocessWindow[]
): Promise<number> {
  if (windows.length === 0) {
    return 0;
  }

  const parameters: unknown[] = [];
  const predicates = windows
    .map((window) => {
      const startIndex = parameters.length + 1;
      parameters.push(
        window.tenantId,
        window.companyId,
        window.sourceId,
        window.accountingBasis,
        window.bucketGrain,
        window.bucketStart,
        window.bucketEnd,
        window.currencyCode
      );
      return `("tenant_id" = $${String(startIndex)} and "company_id" = $${String(startIndex + 1)} and "source_id" = $${String(
        startIndex + 2
      )} and "accounting_basis" = $${String(startIndex + 3)} and "bucket_grain" = $${String(
        startIndex + 4
      )} and "bucket_start" = $${String(startIndex + 5)}::date and "bucket_end" = $${String(
        startIndex + 6
      )}::date and "currency_code" = $${String(startIndex + 7)})`;
    })
    .join(" or ");
  const result = await client.query(`delete from ${qualifiedTable(manifest, "rollup_buckets")} where ${predicates}`, parameters);

  return result.rowCount ?? 0;
}

async function pruneMissingSnapshotChildren(
  client: PostgresQueryClient,
  manifest: PostgresSchemaManifest,
  tableName: string,
  tenantId: TenantId,
  reportSnapshotId: string,
  idColumn: string,
  retainedIds: readonly string[]
): Promise<void> {
  await client.query(
    `delete from ${qualifiedTable(manifest, tableName)}
where "tenant_id" = $1 and "report_snapshot_id" = $2 and not ("${idColumn}" = any($3::text[]))`,
    [tenantId, reportSnapshotId, retainedIds]
  );
}

async function upsertRows(
  client: PostgresQueryClient,
  manifest: PostgresSchemaManifest,
  tableName: string,
  rows: readonly Row[],
  conflictColumns: readonly string[]
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  const table = tableManifest(manifest, tableName);
  const columns = table.columns.map((column) => column.name);
  const parameters: unknown[] = [];
  const valuesSql = rows
    .map((row) => {
      validateCredentialFreeRow(tableName, row);
      return `(${columns
        .map((column) => {
          parameters.push(row[column] ?? null);
          return `$${String(parameters.length)}`;
        })
        .join(", ")})`;
    })
    .join(",\n  ");
  const nonConflictColumns = columns.filter((column) => !conflictColumns.includes(column));
  const updateSql =
    nonConflictColumns.length === 0
      ? "do nothing"
      : `do update set ${nonConflictColumns
          .map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
          .join(", ")}`;
  const sql = `insert into ${qualifiedTable(manifest, tableName)} (${columns.map(quoteIdentifier).join(", ")})
values
  ${valuesSql}
on conflict (${conflictColumns.map(quoteIdentifier).join(", ")}) ${updateSql}`;
  const result = await client.query(sql, parameters);

  return result.rowCount ?? rows.length;
}

async function readCatalogRows(client: PostgresQueryClient, namespace: string): Promise<readonly CatalogRow[]> {
  const result = await client.query<CatalogRow>(
    `select 'schema'::text as object_type, null::text as table_name, schema_name as object_name
from information_schema.schemata
where schema_name = $1
union all
select 'table'::text as object_type, table_name, table_name as object_name
from information_schema.tables
where table_schema = $1 and table_type = 'BASE TABLE'
union all
select 'column'::text as object_type, table_name, column_name as object_name
from information_schema.columns
where table_schema = $1
union all
select 'index'::text as object_type, null::text as table_name, indexname as object_name
from pg_indexes
where schemaname = $1
union all
select 'constraint'::text as object_type, conrelid::regclass::text as table_name, conname as object_name
from pg_constraint
where connamespace = $1::regnamespace`,
    [namespace]
  );

  return result.rows;
}

function catalogKey(row: CatalogRow): string {
  if (row.object_type === "column") {
    return `column::${String(row.table_name)}.${row.object_name}`;
  }

  if (row.object_type === "constraint") {
    return `constraint::${unqualifiedTableName(String(row.table_name))}.${row.object_name}`;
  }

  return `${row.object_type}::${row.object_name}`;
}

function expectedConstraintNames(table: PostgresTableManifest): readonly string[] {
  return [
    `${table.name}_pkey`,
    ...table.constraints.map((constraint) => constraint.name),
    ...table.columns
      .filter((column) => column.type === "jsonb" && column.maxBytes !== undefined)
      .map((column) => `${table.name}_${column.name}_bounded_json_check`)
  ];
}

function companyRow(company: AccountingCompany): Row {
  return {
    company_id: company.companyId,
    tenant_id: company.tenantId,
    legal_name: company.legalName,
    display_name: company.displayName,
    base_currency_code: company.baseCurrencyCode,
    fiscal_year_start_month: company.fiscalYearStartMonth,
    provider_environment: company.providerEnvironment,
    source_system: company.sourceSystem,
    source_company_ref: company.sourceCompanyRef
  };
}

function sourceRow(source: AccountingSource): Row {
  return {
    source_id: source.sourceId,
    tenant_id: source.tenantId,
    source_system: source.sourceSystem,
    provider_environment: source.providerEnvironment,
    connection_ref: source.connectionRef,
    import_batch_id: source.importBatchId,
    checkpoint_id: source.checkpointId,
    latest_synced_at: source.latestSyncedAt,
    status: source.status
  };
}

function accountRow(account: Account): Row {
  return {
    account_id: account.accountId,
    tenant_id: account.tenantId,
    source_id: account.sourceId,
    source_account_id: account.sourceAccountId,
    account_number: account.accountNumber,
    name: account.name,
    type: account.type,
    subtype: account.subtype,
    classification: account.classification,
    parent_account_id: account.parentAccountId,
    currency_code: account.currencyCode,
    active: account.active
  };
}

function partyRow(party: Party): Row {
  return {
    party_id: party.partyId,
    tenant_id: party.tenantId,
    source_id: party.sourceId,
    source_party_id: party.sourcePartyId,
    party_type: party.partyType,
    display_name: party.displayName,
    active: party.active
  };
}

function itemRow(item: Item): Row {
  return {
    item_id: item.itemId,
    tenant_id: item.tenantId,
    source_id: item.sourceId,
    source_item_id: item.sourceItemId,
    item_type: item.itemType,
    name: item.name,
    income_account_id: item.incomeAccountId,
    expense_account_id: item.expenseAccountId,
    asset_account_id: item.assetAccountId,
    active: item.active
  };
}

function dimensionRow(dimension: AccountingDimension): Row {
  return {
    dimension_id: dimension.dimensionId,
    tenant_id: dimension.tenantId,
    source_id: dimension.sourceId,
    dimension_kind: dimension.dimensionKind,
    source_dimension_id: dimension.sourceDimensionId,
    name: dimension.name,
    parent_dimension_id: dimension.parentDimensionId,
    active: dimension.active
  };
}

function transactionRow(transaction: AccountingTransaction): Row {
  return {
    transaction_id: transaction.transactionId,
    tenant_id: transaction.tenantId,
    source_id: transaction.sourceId,
    source_transaction_id: transaction.sourceTransactionId,
    source_transaction_type: transaction.sourceTransactionType,
    transaction_number: transaction.transactionNumber,
    transaction_date: transaction.transactionDate,
    posted_at: transaction.postedAt,
    updated_at: transaction.updatedAt,
    party_id: transaction.partyId,
    currency_code: transaction.currencyCode,
    exchange_rate: transaction.exchangeRate,
    status: transaction.status,
    memo: transaction.memo,
    source_payload_ref: transaction.sourcePayloadRef
  };
}

function transactionLineRow(line: TransactionLine): Row {
  return {
    transaction_line_id: line.transactionLineId,
    tenant_id: line.tenantId,
    transaction_id: line.transactionId,
    line_number: line.lineNumber,
    account_id: line.accountId,
    party_id: line.partyId,
    item_id: line.itemId,
    amount: line.amount,
    quantity: line.quantity,
    unit_amount: line.unitAmount,
    description: line.description,
    dimension_refs: line.dimensionRefs
  };
}

function ledgerPostingRow(posting: LedgerPosting): Row {
  return {
    posting_id: posting.postingId,
    tenant_id: posting.tenantId,
    source_id: posting.sourceId,
    source_posting_id: posting.sourcePostingId,
    transaction_id: posting.transactionId,
    transaction_line_id: posting.transactionLineId,
    account_id: posting.accountId,
    party_id: posting.partyId,
    item_id: posting.itemId,
    posting_date: posting.postingDate,
    accounting_basis: posting.accountingBasis,
    debit_amount: posting.debitAmount,
    credit_amount: posting.creditAmount,
    net_amount: posting.netAmount,
    currency_code: posting.currencyCode,
    dimension_hash: posting.dimensionHash,
    dimension_refs: posting.dimensionRefs,
    source_payload_ref: posting.sourcePayloadRef,
    import_batch_id: posting.importBatchId,
    checkpoint_id: posting.checkpointId
  };
}

function importBatchRow(importBatch: ImportBatch): Row {
  return {
    import_batch_id: importBatch.importBatchId,
    tenant_id: importBatch.tenantId,
    source_id: importBatch.sourceId,
    mode: importBatch.mode,
    status: importBatch.status,
    started_at: importBatch.startedAt,
    completed_at: importBatch.completedAt,
    source_object_counts: importBatch.sourceObjectCounts,
    warning_summary: importBatch.warningSummary,
    error_summary: importBatch.errorSummary
  };
}

function syncCheckpointRow(checkpoint: SyncCheckpoint): Row {
  return {
    checkpoint_id: checkpoint.checkpointId,
    tenant_id: checkpoint.tenantId,
    source_id: checkpoint.sourceId,
    source_object: checkpoint.sourceObject,
    cursor_kind: checkpoint.cursorKind,
    cursor_value: checkpoint.cursorValue,
    fresh_through: checkpoint.freshThrough,
    latest_source_updated_at: checkpoint.latestSourceUpdatedAt,
    status: checkpoint.status
  };
}

function reportSnapshotRow(snapshot: ReportSnapshot): Row {
  return {
    report_snapshot_id: snapshot.reportSnapshotId,
    tenant_id: snapshot.tenantId,
    report_name: snapshot.reportName,
    snapshot_source: snapshot.snapshotSource,
    accounting_basis: snapshot.accountingBasis,
    period_start: snapshot.periodStart,
    period_end: snapshot.periodEnd,
    as_of_date: snapshot.asOfDate,
    currency_code: snapshot.currencyCode,
    generated_at: snapshot.generatedAt,
    freshness: snapshot.freshness,
    reconciliation_status: snapshot.reconciliationStatus,
    reconciliation_difference: snapshot.reconciliationDifference
  };
}

function reportSnapshotLineRow(line: ReportSnapshotLine): Row {
  return {
    report_line_id: line.reportLineId,
    tenant_id: line.tenantId,
    report_snapshot_id: line.reportSnapshotId,
    parent_report_line_id: line.parentReportLineId,
    section: line.section,
    label: line.label,
    account_id: line.accountId,
    amount: line.amount,
    sort_order: line.sortOrder,
    drilldown_ref: line.drilldownRef
  };
}

function reportSnapshotTotalRow(total: ReportSnapshotTotal): Row {
  return {
    report_total_id: total.reportTotalId,
    tenant_id: total.tenantId,
    report_snapshot_id: total.reportSnapshotId,
    total_key: total.totalKey,
    label: total.label,
    amount: total.amount,
    drilldown_ref: total.drilldownRef
  };
}

function rollupBucketRow(bucket: RollupBucket): Row {
  return {
    rollup_bucket_id: bucket.rollupBucketId,
    tenant_id: bucket.tenantId,
    company_id: bucket.companyId,
    source_id: bucket.sourceId,
    account_id: bucket.accountId,
    accounting_basis: bucket.accountingBasis,
    bucket_grain: bucket.bucketGrain,
    bucket_start: bucket.bucketStart,
    bucket_end: bucket.bucketEnd,
    currency_code: bucket.currencyCode,
    dimension_hash: bucket.dimensionHash,
    debit_amount: bucket.debitAmount,
    credit_amount: bucket.creditAmount,
    net_amount: bucket.netAmount,
    posting_count: bucket.postingCount,
    source_posting_max_updated_at: bucket.sourcePostingMaxUpdatedAt,
    import_batch_id: bucket.importBatchId,
    generated_at: bucket.generatedAt
  };
}

function reportFreshnessRow(row: ReportFreshnessRow): Row {
  const freshness: ReportFreshness = {
    status: row.status,
    sourceId: row.sourceId,
    ...(row.importBatchId === undefined ? {} : { importBatchId: row.importBatchId }),
    ...(row.checkpointId === undefined ? {} : { checkpointId: row.checkpointId }),
    ...(row.freshThrough === undefined ? {} : { freshThrough: row.freshThrough }),
    ...(row.staleReason === undefined ? {} : { staleReason: row.staleReason })
  };
  assertNoCredentialKeys(freshness);

  return {
    freshness_id: row.freshnessId,
    tenant_id: row.tenantId,
    company_id: row.companyId,
    source_id: row.sourceId,
    report_name: row.reportName,
    accounting_basis: row.accountingBasis,
    period_start: row.periodStart,
    period_end: row.periodEnd,
    currency_code: row.currencyCode,
    status: row.status,
    fresh_through: row.freshThrough,
    stale_reason: row.staleReason,
    import_batch_id: row.importBatchId,
    checkpoint_id: row.checkpointId,
    updated_at: row.updatedAt
  };
}

function validateCredentialFreeRow(tableName: string, row: Row): void {
  for (const [key, value] of Object.entries(row)) {
    if (/token|secret|password|credential|private_key/i.test(key)) {
      throw new Error(`credential-like field is not allowed: ${tableName}.${key}`);
    }
    if (isJsonLike(value) && key !== "drilldown_ref") {
      assertNoCredentialKeys(value, `$${tableName}.${key}`);
    }
  }
}

function isJsonLike(value: unknown): value is JsonValue {
  return Array.isArray(value) || (value !== null && typeof value === "object");
}

function splitSqlStatements(sql: string): readonly string[] {
  return sql
    .split(/;\s*\n/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .map((statement) => `${statement};`);
}

function tableManifest(manifest: PostgresSchemaManifest, tableName: string): PostgresTableManifest {
  const table = manifest.tables.find((entry) => entry.name === tableName);
  if (table === undefined) {
    throw new Error(`unknown Postgres manifest table: ${tableName}`);
  }

  return table;
}

function qualifiedTable(manifest: PostgresSchemaManifest, tableName: string): string {
  return `${quoteIdentifier(manifest.namespace)}.${quoteIdentifier(tableName)}`;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function unqualifiedTableName(tableName: string): string {
  const [, unqualified = tableName] = tableName.split(".");
  return unqualified.replaceAll('"', "");
}
