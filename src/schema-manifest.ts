export type PostgresColumnType =
  | "boolean"
  | "date"
  | "integer"
  | "jsonb"
  | "numeric"
  | "text"
  | "timestamptz";

export type PostgresColumnManifest = {
  readonly name: string;
  readonly type: PostgresColumnType;
  readonly nullable?: boolean;
  readonly primaryKey?: boolean;
  readonly defaultSql?: string;
  readonly maxBytes?: number;
};

export type PostgresConstraintManifest = {
  readonly name: string;
  readonly sql: string;
};

export type PostgresIndexManifest = {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique?: boolean;
};

export type PostgresTableManifest = {
  readonly name: string;
  readonly description: string;
  readonly columns: readonly PostgresColumnManifest[];
  readonly constraints: readonly PostgresConstraintManifest[];
  readonly indexes: readonly PostgresIndexManifest[];
  readonly policies: {
    readonly tenantScoped: boolean;
    readonly sourceScoped: boolean;
    readonly noRawCredentials: boolean;
    readonly boundedJson: boolean;
  };
};

export type PostgresSchemaManifest = {
  readonly manifestVersion: "2026-06-19.storage-v1";
  readonly schemaVersion: 5;
  readonly dialect: "postgres";
  readonly namespace: "erp_financials";
  readonly tables: readonly PostgresTableManifest[];
};

const jsonb = (name: string, maxBytes = 4096, nullable = true): PostgresColumnManifest => ({
  name,
  type: "jsonb",
  nullable,
  maxBytes
});

const text = (name: string, nullable = false): PostgresColumnManifest => ({
  name,
  type: "text",
  nullable
});

const id = (name: string): PostgresColumnManifest => ({
  name,
  type: "text",
  primaryKey: true
});

const timestamp = (name: string, nullable = false): PostgresColumnManifest => ({
  name,
  type: "timestamptz",
  nullable
});

const date = (name: string, nullable = false): PostgresColumnManifest => ({
  name,
  type: "date",
  nullable
});

const integer = (name: string): PostgresColumnManifest => ({
  name,
  type: "integer"
});

const numeric = (name: string, nullable = false): PostgresColumnManifest => ({
  name,
  type: "numeric",
  nullable
});

const bool = (name: string): PostgresColumnManifest => ({
  name,
  type: "boolean"
});

const table = (
  name: string,
  description: string,
  columns: readonly PostgresColumnManifest[],
  constraints: readonly PostgresConstraintManifest[],
  indexes: readonly PostgresIndexManifest[],
  sourceScoped = true
): PostgresTableManifest => ({
  name,
  description,
  columns,
  constraints,
  indexes,
  policies: {
    tenantScoped: true,
    sourceScoped,
    noRawCredentials: true,
    boundedJson: columns.some((column) => column.type === "jsonb")
  }
});

export const POSTGRES_CANONICAL_SCHEMA_MANIFEST: PostgresSchemaManifest = {
  manifestVersion: "2026-06-19.storage-v1",
  schemaVersion: 5,
  dialect: "postgres",
  namespace: "erp_financials",
  tables: [
    table(
      "accounting_companies",
      "Tenant reporting entities.",
      [
        id("company_id"),
        text("tenant_id"),
        text("legal_name"),
        text("display_name"),
        text("base_currency_code"),
        integer("fiscal_year_start_month"),
        text("provider_environment"),
        text("source_system"),
        text("source_company_ref")
      ],
      [
        {
          name: "accounting_companies_fiscal_year_start_month_check",
          sql: "fiscal_year_start_month between 1 and 12"
        }
      ],
      [
        {
          name: "accounting_companies_source_identity_uidx",
          columns: ["tenant_id", "source_system", "provider_environment", "source_company_ref"],
          unique: true
        }
      ],
      false
    ),
    table(
      "accounting_sources",
      "Safe source connection references and sync status.",
      [
        id("source_id"),
        text("tenant_id"),
        text("source_system"),
        text("provider_environment"),
        text("connection_ref"),
        text("import_batch_id", true),
        text("checkpoint_id", true),
        timestamp("latest_synced_at", true),
        text("status")
      ],
      [],
      [
        {
          name: "accounting_sources_connection_uidx",
          columns: ["tenant_id", "source_system", "provider_environment", "connection_ref"],
          unique: true
        }
      ],
      false
    ),
    table(
      "accounts",
      "Provider-neutral chart of accounts.",
      [
        id("account_id"),
        text("tenant_id"),
        text("source_id"),
        text("source_account_id"),
        text("account_number", true),
        text("name"),
        text("type"),
        text("subtype", true),
        text("classification"),
        text("parent_account_id", true),
        text("currency_code", true),
        bool("active")
      ],
      [],
      [
        {
          name: "accounts_source_account_uidx",
          columns: ["tenant_id", "source_id", "source_account_id"],
          unique: true
        },
        {
          name: "accounts_classification_idx",
          columns: ["tenant_id", "classification"]
        },
        {
          name: "accounts_parent_account_idx",
          columns: ["tenant_id", "source_id", "parent_account_id"]
        }
      ]
    ),
    table(
      "parties",
      "Customers, vendors, employees, and other parties.",
      [
        id("party_id"),
        text("tenant_id"),
        text("source_id"),
        text("source_party_id"),
        text("party_type"),
        text("display_name"),
        bool("active")
      ],
      [],
      [
        {
          name: "parties_source_party_uidx",
          columns: ["tenant_id", "source_id", "source_party_id"],
          unique: true
        }
      ]
    ),
    table(
      "items",
      "Products, services, inventory items, and billable items.",
      [
        id("item_id"),
        text("tenant_id"),
        text("source_id"),
        text("source_item_id"),
        text("item_type"),
        text("name"),
        text("income_account_id", true),
        text("expense_account_id", true),
        text("asset_account_id", true),
        bool("active")
      ],
      [],
      [
        {
          name: "items_source_item_uidx",
          columns: ["tenant_id", "source_id", "source_item_id"],
          unique: true
        }
      ]
    ),
    table(
      "accounting_dimensions",
      "Provider-neutral reporting dimensions.",
      [
        id("dimension_id"),
        text("tenant_id"),
        text("source_id"),
        text("dimension_kind"),
        text("source_dimension_id"),
        text("name"),
        text("parent_dimension_id", true),
        bool("active")
      ],
      [],
      [
        {
          name: "accounting_dimensions_source_dimension_uidx",
          columns: ["tenant_id", "source_id", "dimension_kind", "source_dimension_id"],
          unique: true
        }
      ]
    ),
    table(
      "transactions",
      "Header-level financial events.",
      [
        id("transaction_id"),
        text("tenant_id"),
        text("source_id"),
        text("source_transaction_id"),
        text("source_transaction_type"),
        text("transaction_number", true),
        date("transaction_date"),
        timestamp("posted_at", true),
        timestamp("updated_at", true),
        text("party_id", true),
        text("currency_code"),
        numeric("exchange_rate", true),
        text("status"),
        text("memo", true),
        jsonb("source_payload_ref")
      ],
      [],
      [
        {
          name: "transactions_source_transaction_uidx",
          columns: ["tenant_id", "source_id", "source_transaction_type", "source_transaction_id"],
          unique: true
        },
        {
          name: "transactions_date_idx",
          columns: ["tenant_id", "transaction_date"]
        }
      ]
    ),
    table(
      "transaction_lines",
      "Line-level detail before double-entry posting expansion.",
      [
        id("transaction_line_id"),
        text("tenant_id"),
        text("transaction_id"),
        integer("line_number"),
        text("account_id", true),
        text("party_id", true),
        text("item_id", true),
        numeric("amount"),
        numeric("quantity", true),
        numeric("unit_amount", true),
        text("description", true),
        jsonb("dimension_refs")
      ],
      [
        {
          name: "transaction_lines_line_number_check",
          sql: "line_number >= 0"
        }
      ],
      [
        {
          name: "transaction_lines_transaction_line_uidx",
          columns: ["tenant_id", "transaction_id", "line_number"],
          unique: true
        }
      ],
      false
    ),
    table(
      "ledger_postings",
      "Durable reporting facts used by statements and rollups.",
      [
        id("posting_id"),
        text("tenant_id"),
        text("source_id"),
        text("source_posting_id"),
        text("transaction_id"),
        text("transaction_line_id", true),
        text("account_id"),
        text("party_id", true),
        text("item_id", true),
        date("posting_date"),
        text("accounting_basis"),
        numeric("debit_amount"),
        numeric("credit_amount"),
        numeric("net_amount"),
        text("currency_code"),
        text("dimension_hash"),
        jsonb("dimension_refs"),
        jsonb("source_payload_ref"),
        text("import_batch_id"),
        text("checkpoint_id", true)
      ],
      [
        {
          name: "ledger_postings_nonnegative_debit_check",
          sql: "debit_amount >= 0"
        },
        {
          name: "ledger_postings_nonnegative_credit_check",
          sql: "credit_amount >= 0"
        },
        {
          name: "ledger_postings_dimension_hash_check",
          sql: "length(dimension_hash) = 64"
        }
      ],
      [
        {
          name: "ledger_postings_source_posting_uidx",
          columns: ["tenant_id", "source_id", "accounting_basis", "source_posting_id"],
          unique: true
        },
        {
          name: "ledger_postings_report_idx",
          columns: ["tenant_id", "posting_date", "accounting_basis", "account_id", "currency_code"]
        },
        {
          name: "ledger_postings_import_batch_idx",
          columns: ["tenant_id", "import_batch_id"]
        }
      ]
    ),
    table(
      "rollup_buckets",
      "Durable aggregate buckets for normal report reads and late-arrival reprocessing.",
      [
        id("rollup_bucket_id"),
        text("tenant_id"),
        text("company_id"),
        text("source_id"),
        text("account_id"),
        text("accounting_basis"),
        text("bucket_grain"),
        date("bucket_start"),
        date("bucket_end"),
        text("currency_code"),
        text("dimension_hash"),
        text("party_id"),
        text("party_type"),
        text("item_id"),
        numeric("debit_amount"),
        numeric("credit_amount"),
        numeric("net_amount"),
        integer("posting_count"),
        timestamp("source_posting_max_updated_at", true),
        text("import_batch_id", true),
        timestamp("generated_at")
      ],
      [
        {
          name: "rollup_buckets_period_check",
          sql: "bucket_start <= bucket_end"
        },
        {
          name: "rollup_buckets_nonnegative_debit_check",
          sql: "debit_amount >= 0"
        },
        {
          name: "rollup_buckets_nonnegative_credit_check",
          sql: "credit_amount >= 0"
        },
        {
          name: "rollup_buckets_dimension_hash_check",
          sql: "length(dimension_hash) = 64"
        },
        {
          name: "rollup_buckets_posting_count_check",
          sql: "posting_count >= 0"
        }
      ],
      [
        {
          name: "rollup_buckets_identity_uidx",
          columns: [
            "tenant_id",
            "company_id",
            "source_id",
            "accounting_basis",
            "bucket_grain",
            "bucket_start",
            "bucket_end",
            "account_id",
            "currency_code",
            "dimension_hash",
            "party_id",
            "party_type",
            "item_id"
          ],
          unique: true
        },
        {
          name: "rollup_buckets_report_idx",
          columns: [
            "tenant_id",
            "company_id",
            "source_id",
            "accounting_basis",
            "bucket_grain",
            "currency_code",
            "bucket_start",
            "bucket_end",
            "account_id",
            "dimension_hash",
            "party_type",
            "party_id",
            "item_id"
          ]
        }
      ]
    ),
    table(
      "import_batches",
      "Append-only source import work records.",
      [
        id("import_batch_id"),
        text("tenant_id"),
        text("source_id"),
        text("mode"),
        text("status"),
        timestamp("started_at"),
        timestamp("completed_at", true),
        jsonb("source_object_counts"),
        jsonb("warning_summary"),
        jsonb("error_summary")
      ],
      [],
      [
        {
          name: "import_batches_source_batch_uidx",
          columns: ["tenant_id", "source_id", "import_batch_id"],
          unique: true
        },
        {
          name: "import_batches_source_started_idx",
          columns: ["tenant_id", "source_id", "started_at"]
        }
      ]
    ),
    table(
      "sync_checkpoints",
      "Cursor state for delta sync and late-arrival recovery.",
      [
        id("checkpoint_id"),
        text("tenant_id"),
        text("source_id"),
        text("source_object"),
        text("cursor_kind"),
        text("cursor_value"),
        timestamp("fresh_through", true),
        timestamp("latest_source_updated_at", true),
        text("status")
      ],
      [],
      [
        {
          name: "sync_checkpoints_source_object_uidx",
          columns: ["tenant_id", "source_id", "source_object", "cursor_kind"],
          unique: true
        }
      ]
    ),
    table(
      "report_freshness",
      "Dashboard-readable source/report freshness and stale snapshot state.",
      [
        id("freshness_id"),
        text("tenant_id"),
        text("company_id"),
        text("source_id"),
        text("report_name"),
        text("accounting_basis"),
        date("period_start"),
        date("period_end"),
        text("currency_code"),
        text("status"),
        timestamp("fresh_through", true),
        text("stale_reason", true),
        text("import_batch_id", true),
        text("checkpoint_id", true),
        timestamp("updated_at")
      ],
      [
        {
          name: "report_freshness_period_check",
          sql: "period_start <= period_end"
        }
      ],
      [
        {
          name: "report_freshness_identity_uidx",
          columns: [
            "tenant_id",
            "company_id",
            "source_id",
            "report_name",
            "accounting_basis",
            "period_start",
            "period_end",
            "currency_code"
          ],
          unique: true
        },
        {
          name: "report_freshness_status_idx",
          columns: ["tenant_id", "company_id", "status", "updated_at"]
        }
      ],
      false
    ),
    table(
      "report_snapshots",
      "Durable report outputs and provenance.",
      [
        id("report_snapshot_id"),
        text("tenant_id"),
        text("report_name"),
        text("snapshot_source"),
        text("accounting_basis"),
        date("period_start"),
        date("period_end"),
        date("as_of_date"),
        text("currency_code"),
        timestamp("generated_at"),
        jsonb("freshness"),
        text("reconciliation_status"),
        numeric("reconciliation_difference")
      ],
      [
        {
          name: "report_snapshots_period_check",
          sql: "period_start <= period_end"
        }
      ],
      [
        {
          name: "report_snapshots_request_uidx",
          columns: [
            "tenant_id",
            "report_name",
            "snapshot_source",
            "accounting_basis",
            "period_start",
            "period_end",
            "as_of_date",
            "currency_code"
          ],
          unique: true
        }
      ],
      false
    ),
    table(
      "report_snapshot_lines",
      "Persisted statement rows with drilldown evidence.",
      [
        id("report_line_id"),
        text("tenant_id"),
        text("report_snapshot_id"),
        text("parent_report_line_id", true),
        text("section"),
        text("label"),
        text("account_id", true),
        numeric("amount"),
        integer("sort_order"),
        jsonb("drilldown_ref")
      ],
      [],
      [
        {
          name: "report_snapshot_lines_sort_uidx",
          columns: ["tenant_id", "report_snapshot_id", "sort_order", "report_line_id"],
          unique: true
        }
      ],
      false
    ),
    table(
      "report_snapshot_totals",
      "Named report totals with drilldown evidence.",
      [
        id("report_total_id"),
        text("tenant_id"),
        text("report_snapshot_id"),
        text("total_key"),
        text("label"),
        numeric("amount"),
        jsonb("drilldown_ref")
      ],
      [],
      [
        {
          name: "report_snapshot_totals_total_key_uidx",
          columns: ["tenant_id", "report_snapshot_id", "total_key"],
          unique: true
        }
      ],
      false
    )
  ]
} as const;

export const DISALLOWED_CREDENTIAL_COLUMN_PATTERNS: readonly RegExp[] = [
  /token/i,
  /secret/i,
  /password/i,
  /credential/i,
  /private[-_]?key/i,
  /raw[-_]?provider[-_]?payload/i,
  /raw[-_]?payload/i,
  /provider[-_]?payload[-_]?archive/i,
  /payload[-_]?archive/i,
  /raw[-_]?archive/i
];

export function renderPostgresSchemaSql(
  manifest: PostgresSchemaManifest = POSTGRES_CANONICAL_SCHEMA_MANIFEST
): string {
  const statements = [
    `create schema if not exists ${quoteIdentifier(manifest.namespace)};`,
    ...manifest.tables.flatMap((tableManifest) => renderTableSql(manifest.namespace, tableManifest))
  ];

  return `${statements.join("\n\n")}\n`;
}

export function assertManifestHasNoCredentialColumns(
  manifest: PostgresSchemaManifest = POSTGRES_CANONICAL_SCHEMA_MANIFEST
): void {
  for (const tableManifest of manifest.tables) {
    for (const column of tableManifest.columns) {
      if (DISALLOWED_CREDENTIAL_COLUMN_PATTERNS.some((pattern) => pattern.test(column.name))) {
        throw new Error(`credential-like column is not allowed: ${tableManifest.name}.${column.name}`);
      }
    }
  }
}

function renderTableSql(namespace: string, tableManifest: PostgresTableManifest): readonly string[] {
  const qualifiedTableName = `${quoteIdentifier(namespace)}.${quoteIdentifier(tableManifest.name)}`;
  const columnDefinitions = tableManifest.columns.map((column) => renderColumnSql(column));
  const primaryKeyColumns = tableManifest.columns
    .filter((column) => column.primaryKey === true)
    .map((column) => column.name);
  const primaryKeyDefinition =
    primaryKeyColumns.length > 0
      ? [`constraint ${quoteIdentifier(`${tableManifest.name}_pkey`)} primary key (${primaryKeyColumns.map(quoteIdentifier).join(", ")})`]
      : [];
  const checkDefinitions = [
    ...tableManifest.constraints.map(
      (constraint) => `constraint ${quoteIdentifier(constraint.name)} check (${constraint.sql})`
    ),
    ...tableManifest.columns
      .filter((column) => column.type === "jsonb" && column.maxBytes !== undefined)
      .map(
        (column) =>
          `constraint ${quoteIdentifier(`${tableManifest.name}_${column.name}_bounded_json_check`)} check (octet_length(coalesce(${quoteIdentifier(
            column.name
          )}::text, '')) <= ${String(column.maxBytes)})`
      )
  ];
  const createTableSql = `create table if not exists ${qualifiedTableName} (\n  ${[
    ...columnDefinitions,
    ...primaryKeyDefinition,
    ...checkDefinitions
  ].join(",\n  ")}\n);`;

  return [
    createTableSql,
    ...tableManifest.indexes.map((index) => {
      const uniqueSql = index.unique === true ? "unique " : "";
      return `create ${uniqueSql}index if not exists ${quoteIdentifier(index.name)} on ${qualifiedTableName} (${index.columns
        .map(quoteIdentifier)
        .join(", ")});`;
    })
  ];
}

function renderColumnSql(column: PostgresColumnManifest): string {
  const nullSql = column.primaryKey === true || column.nullable !== true ? " not null" : "";
  const defaultSql = column.defaultSql === undefined ? "" : ` default ${column.defaultSql}`;
  return `${quoteIdentifier(column.name)} ${column.type}${defaultSql}${nullSql}`;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
