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
  readonly kind?: "check" | "foreign_key";
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
  readonly manifestVersion: "2026-08-12.scoped-integrity-v1";
  readonly schemaVersion: 9;
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

const foreignKey = (
  name: string,
  columns: readonly string[],
  referencedTable: string,
  referencedColumns: readonly string[]
): PostgresConstraintManifest => ({
  name,
  kind: "foreign_key",
  sql: `foreign key (${columns.map(quoteIdentifier).join(", ")}) references ${quoteIdentifier(
    "erp_financials"
  )}.${quoteIdentifier(referencedTable)} (${referencedColumns.map(quoteIdentifier).join(", ")}) on update restrict on delete restrict`
});

const table = (
  name: string,
  description: string,
  columns: readonly PostgresColumnManifest[],
  constraints: readonly PostgresConstraintManifest[],
  indexes: readonly PostgresIndexManifest[],
  sourceScoped = true,
  tenantScoped = true
): PostgresTableManifest => ({
  name,
  description,
  columns,
  constraints,
  indexes,
  policies: {
    tenantScoped,
    sourceScoped,
    noRawCredentials: true,
    boundedJson: columns.some((column) => column.type === "jsonb")
  }
});

export const POSTGRES_CANONICAL_SCHEMA_MANIFEST: PostgresSchemaManifest = {
  manifestVersion: "2026-08-12.scoped-integrity-v1",
  schemaVersion: 9,
  dialect: "postgres",
  namespace: "erp_financials",
  tables: [
    table(
      "schema_migrations",
      "Ordered, checksum-verified package schema migration history.",
      [
        id("migration_id"),
        integer("from_version"),
        integer("to_version"),
        text("name"),
        text("checksum"),
        text("manifest_version"),
        integer("execution_ms"),
        text("applied_by_ref"),
        {
          ...timestamp("applied_at"),
          defaultSql: "clock_timestamp()"
        }
      ],
      [
        {
          name: "schema_migrations_version_check",
          sql: "from_version >= 0 and from_version < to_version"
        },
        {
          name: "schema_migrations_checksum_check",
          sql: "length(checksum) = 64"
        },
        {
          name: "schema_migrations_execution_ms_check",
          sql: "execution_ms >= 0"
        }
      ],
      [
        {
          name: "schema_migrations_to_version_uidx",
          columns: ["to_version"],
          unique: true
        }
      ],
      false,
      false
    ),
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
        },
        {
          name: "accounting_companies_scope_uidx",
          columns: ["tenant_id", "company_id"],
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
        },
        {
          name: "accounting_sources_scope_uidx",
          columns: ["tenant_id", "source_id"],
          unique: true
        }
      ],
      false
    ),
    table(
      "company_sources",
      "Explicit allowed company/source bindings used to prevent cross-company financial writes.",
      [
        id("company_source_id"),
        text("tenant_id"),
        text("company_id"),
        text("source_id"),
        timestamp("created_at")
      ],
      [
        foreignKey(
          "company_sources_company_scope_fk",
          ["tenant_id", "company_id"],
          "accounting_companies",
          ["tenant_id", "company_id"]
        ),
        foreignKey(
          "company_sources_source_scope_fk",
          ["tenant_id", "source_id"],
          "accounting_sources",
          ["tenant_id", "source_id"]
        )
      ],
      [
        {
          name: "company_sources_scope_uidx",
          columns: ["tenant_id", "company_id", "source_id"],
          unique: true
        }
      ]
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
      [
        foreignKey(
          "accounts_source_scope_fk",
          ["tenant_id", "source_id"],
          "accounting_sources",
          ["tenant_id", "source_id"]
        ),
        foreignKey(
          "accounts_parent_scope_fk",
          ["tenant_id", "source_id", "parent_account_id"],
          "accounts",
          ["tenant_id", "source_id", "account_id"]
        )
      ],
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
        },
        {
          name: "accounts_scope_uidx",
          columns: ["tenant_id", "source_id", "account_id"],
          unique: true
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
      [
        foreignKey(
          "parties_source_scope_fk",
          ["tenant_id", "source_id"],
          "accounting_sources",
          ["tenant_id", "source_id"]
        )
      ],
      [
        {
          name: "parties_source_party_uidx",
          columns: ["tenant_id", "source_id", "source_party_id"],
          unique: true
        },
        {
          name: "parties_scope_uidx",
          columns: ["tenant_id", "source_id", "party_id"],
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
      [
        foreignKey(
          "items_source_scope_fk",
          ["tenant_id", "source_id"],
          "accounting_sources",
          ["tenant_id", "source_id"]
        ),
        foreignKey(
          "items_income_account_scope_fk",
          ["tenant_id", "source_id", "income_account_id"],
          "accounts",
          ["tenant_id", "source_id", "account_id"]
        ),
        foreignKey(
          "items_expense_account_scope_fk",
          ["tenant_id", "source_id", "expense_account_id"],
          "accounts",
          ["tenant_id", "source_id", "account_id"]
        ),
        foreignKey(
          "items_asset_account_scope_fk",
          ["tenant_id", "source_id", "asset_account_id"],
          "accounts",
          ["tenant_id", "source_id", "account_id"]
        )
      ],
      [
        {
          name: "items_source_item_uidx",
          columns: ["tenant_id", "source_id", "source_item_id"],
          unique: true
        },
        {
          name: "items_scope_uidx",
          columns: ["tenant_id", "source_id", "item_id"],
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
      [
        foreignKey(
          "accounting_dimensions_source_scope_fk",
          ["tenant_id", "source_id"],
          "accounting_sources",
          ["tenant_id", "source_id"]
        ),
        foreignKey(
          "accounting_dimensions_parent_scope_fk",
          ["tenant_id", "source_id", "parent_dimension_id"],
          "accounting_dimensions",
          ["tenant_id", "source_id", "dimension_id"]
        )
      ],
      [
        {
          name: "accounting_dimensions_source_dimension_uidx",
          columns: ["tenant_id", "source_id", "dimension_kind", "source_dimension_id"],
          unique: true
        },
        {
          name: "accounting_dimensions_scope_uidx",
          columns: ["tenant_id", "source_id", "dimension_id"],
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
      [
        foreignKey(
          "transactions_source_scope_fk",
          ["tenant_id", "source_id"],
          "accounting_sources",
          ["tenant_id", "source_id"]
        ),
        foreignKey(
          "transactions_party_scope_fk",
          ["tenant_id", "source_id", "party_id"],
          "parties",
          ["tenant_id", "source_id", "party_id"]
        )
      ],
      [
        {
          name: "transactions_source_transaction_uidx",
          columns: ["tenant_id", "source_id", "source_transaction_type", "source_transaction_id"],
          unique: true
        },
        {
          name: "transactions_date_idx",
          columns: ["tenant_id", "source_id", "transaction_date"]
        },
        {
          name: "transactions_scope_uidx",
          columns: ["tenant_id", "source_id", "transaction_id"],
          unique: true
        }
      ]
    ),
    table(
      "transaction_lines",
      "Line-level detail before double-entry posting expansion.",
      [
        id("transaction_line_id"),
        text("tenant_id"),
        text("source_id"),
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
        },
        foreignKey(
          "transaction_lines_transaction_scope_fk",
          ["tenant_id", "source_id", "transaction_id"],
          "transactions",
          ["tenant_id", "source_id", "transaction_id"]
        ),
        foreignKey(
          "transaction_lines_account_scope_fk",
          ["tenant_id", "source_id", "account_id"],
          "accounts",
          ["tenant_id", "source_id", "account_id"]
        ),
        foreignKey(
          "transaction_lines_party_scope_fk",
          ["tenant_id", "source_id", "party_id"],
          "parties",
          ["tenant_id", "source_id", "party_id"]
        ),
        foreignKey(
          "transaction_lines_item_scope_fk",
          ["tenant_id", "source_id", "item_id"],
          "items",
          ["tenant_id", "source_id", "item_id"]
        )
      ],
      [
        {
          name: "transaction_lines_transaction_line_uidx",
          columns: ["tenant_id", "source_id", "transaction_id", "line_number"],
          unique: true
        },
        {
          name: "transaction_lines_scope_uidx",
          columns: ["tenant_id", "source_id", "transaction_line_id"],
          unique: true
        }
      ]
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
        },
        {
          name: "ledger_postings_single_sided_check",
          sql: "(debit_amount > 0 and credit_amount = 0) or (credit_amount > 0 and debit_amount = 0)"
        },
        {
          name: "ledger_postings_net_amount_check",
          sql: "net_amount = debit_amount - credit_amount"
        },
        foreignKey(
          "ledger_postings_transaction_scope_fk",
          ["tenant_id", "source_id", "transaction_id"],
          "transactions",
          ["tenant_id", "source_id", "transaction_id"]
        ),
        foreignKey(
          "ledger_postings_transaction_line_scope_fk",
          ["tenant_id", "source_id", "transaction_line_id"],
          "transaction_lines",
          ["tenant_id", "source_id", "transaction_line_id"]
        ),
        foreignKey(
          "ledger_postings_account_scope_fk",
          ["tenant_id", "source_id", "account_id"],
          "accounts",
          ["tenant_id", "source_id", "account_id"]
        ),
        foreignKey(
          "ledger_postings_party_scope_fk",
          ["tenant_id", "source_id", "party_id"],
          "parties",
          ["tenant_id", "source_id", "party_id"]
        ),
        foreignKey(
          "ledger_postings_item_scope_fk",
          ["tenant_id", "source_id", "item_id"],
          "items",
          ["tenant_id", "source_id", "item_id"]
        )
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
      "posting_rules",
      "Provider-neutral transaction conditions and deterministic posting actions.",
      [
        id("posting_rule_id"),
        text("tenant_id"),
        text("source_id"),
        text("rule_code"),
        text("name"),
        text("description", true),
        integer("priority"),
        text("status"),
        text("condition_mode"),
        jsonb("conditions", 4096, false),
        jsonb("actions", 4096, false),
        date("effective_from", true),
        date("effective_through", true),
        timestamp("created_at"),
        timestamp("updated_at")
      ],
      [
        {
          name: "posting_rules_priority_check",
          sql: "priority >= 0"
        },
        {
          name: "posting_rules_effective_period_check",
          sql: "effective_from is null or effective_through is null or effective_from <= effective_through"
        },
        {
          name: "posting_rules_status_check",
          sql: "status in ('draft', 'active', 'inactive', 'archived')"
        },
        {
          name: "posting_rules_condition_mode_check",
          sql: "condition_mode in ('all', 'any')"
        },
        {
          name: "posting_rules_json_shape_check",
          sql: "jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) > 0 and jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) > 0"
        },
        {
          name: "posting_rules_updated_at_check",
          sql: "updated_at >= created_at"
        },
        foreignKey(
          "posting_rules_source_scope_fk",
          ["tenant_id", "source_id"],
          "accounting_sources",
          ["tenant_id", "source_id"]
        )
      ],
      [
        {
          name: "posting_rules_code_uidx",
          columns: ["tenant_id", "source_id", "rule_code"],
          unique: true
        },
        {
          name: "posting_rules_active_priority_idx",
          columns: ["tenant_id", "source_id", "status", "priority", "rule_code"]
        }
      ]
    ),
    table(
      "transaction_match_candidates",
      "Versioned candidate links between payments and receivable or payable transactions.",
      [
        id("match_candidate_id"),
        text("tenant_id"),
        text("source_id"),
        text("match_kind"),
        text("origin_transaction_id"),
        text("target_transaction_id"),
        text("matcher_version"),
        numeric("score"),
        numeric("suggested_application_amount"),
        text("currency_code"),
        text("status"),
        jsonb("evidence", 4096, false),
        timestamp("created_at"),
        timestamp("expires_at", true)
      ],
      [
        {
          name: "transaction_match_candidates_score_check",
          sql: "score >= 0 and score <= 1"
        },
        {
          name: "transaction_match_candidates_amount_check",
          sql: "suggested_application_amount > 0"
        },
        {
          name: "transaction_match_candidates_expiry_check",
          sql: "expires_at is null or expires_at > created_at"
        },
        {
          name: "transaction_match_candidates_kind_check",
          sql: "match_kind in ('customer_payment_to_invoice', 'vendor_payment_to_bill')"
        },
        {
          name: "transaction_match_candidates_status_check",
          sql: "status in ('suggested', 'accepted', 'rejected', 'expired', 'superseded')"
        },
        {
          name: "transaction_match_candidates_distinct_transactions_check",
          sql: "origin_transaction_id <> target_transaction_id"
        },
        {
          name: "transaction_match_candidates_evidence_shape_check",
          sql: "jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0"
        },
        foreignKey(
          "transaction_match_candidates_origin_scope_fk",
          ["tenant_id", "source_id", "origin_transaction_id"],
          "transactions",
          ["tenant_id", "source_id", "transaction_id"]
        ),
        foreignKey(
          "transaction_match_candidates_target_scope_fk",
          ["tenant_id", "source_id", "target_transaction_id"],
          "transactions",
          ["tenant_id", "source_id", "transaction_id"]
        )
      ],
      [
        {
          name: "transaction_match_candidates_identity_uidx",
          columns: [
            "tenant_id",
            "source_id",
            "match_kind",
            "origin_transaction_id",
            "target_transaction_id",
            "matcher_version"
          ],
          unique: true
        },
        {
          name: "transaction_match_candidates_origin_status_idx",
          columns: ["tenant_id", "source_id", "origin_transaction_id", "status", "score"]
        },
        {
          name: "transaction_match_candidates_scope_uidx",
          columns: ["tenant_id", "source_id", "match_candidate_id"],
          unique: true
        }
      ]
    ),
    table(
      "transaction_match_decisions",
      "Append-only audit decisions for proposed transaction matches.",
      [
        id("match_decision_id"),
        text("tenant_id"),
        text("source_id"),
        text("match_candidate_id"),
        text("decision"),
        text("method"),
        timestamp("decided_at"),
        text("decided_by_ref", true),
        text("reason", true),
        jsonb("evidence")
      ],
      [
        {
          name: "transaction_match_decisions_value_check",
          sql: "decision in ('accepted', 'rejected', 'superseded')"
        },
        {
          name: "transaction_match_decisions_method_check",
          sql: "method in ('automatic', 'manual')"
        },
        {
          name: "transaction_match_decisions_manual_actor_check",
          sql: "method <> 'manual' or (decided_by_ref is not null and btrim(decided_by_ref) <> '')"
        },
        foreignKey(
          "transaction_match_decisions_candidate_scope_fk",
          ["tenant_id", "source_id", "match_candidate_id"],
          "transaction_match_candidates",
          ["tenant_id", "source_id", "match_candidate_id"]
        )
      ],
      [
        {
          name: "transaction_match_decisions_identity_uidx",
          columns: ["tenant_id", "source_id", "match_decision_id"],
          unique: true
        },
        {
          name: "transaction_match_decisions_candidate_idx",
          columns: ["tenant_id", "source_id", "match_candidate_id", "decided_at"]
        }
      ]
    ),
    table(
      "payment_applications",
      "Auditable allocations of customer payments to invoices.",
      [
        id("payment_application_id"),
        text("tenant_id"),
        text("source_id"),
        text("payment_transaction_id"),
        text("invoice_transaction_id"),
        text("match_decision_id", true),
        numeric("applied_amount"),
        text("currency_code"),
        date("application_date"),
        text("status"),
        timestamp("created_at"),
        timestamp("updated_at")
      ],
      [
        {
          name: "payment_applications_amount_check",
          sql: "applied_amount > 0"
        },
        {
          name: "payment_applications_status_check",
          sql: "status in ('proposed', 'posted', 'voided')"
        },
        {
          name: "payment_applications_distinct_transactions_check",
          sql: "payment_transaction_id <> invoice_transaction_id"
        },
        {
          name: "payment_applications_updated_at_check",
          sql: "updated_at >= created_at"
        },
        foreignKey(
          "payment_applications_payment_scope_fk",
          ["tenant_id", "source_id", "payment_transaction_id"],
          "transactions",
          ["tenant_id", "source_id", "transaction_id"]
        ),
        foreignKey(
          "payment_applications_invoice_scope_fk",
          ["tenant_id", "source_id", "invoice_transaction_id"],
          "transactions",
          ["tenant_id", "source_id", "transaction_id"]
        ),
        foreignKey(
          "payment_applications_decision_scope_fk",
          ["tenant_id", "source_id", "match_decision_id"],
          "transaction_match_decisions",
          ["tenant_id", "source_id", "match_decision_id"]
        )
      ],
      [
        {
          name: "payment_applications_identity_uidx",
          columns: ["tenant_id", "source_id", "payment_transaction_id", "invoice_transaction_id"],
          unique: true
        },
        {
          name: "payment_applications_invoice_status_idx",
          columns: ["tenant_id", "source_id", "invoice_transaction_id", "status", "application_date"]
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
        },
        foreignKey(
          "rollup_buckets_company_source_scope_fk",
          ["tenant_id", "company_id", "source_id"],
          "company_sources",
          ["tenant_id", "company_id", "source_id"]
        ),
        foreignKey(
          "rollup_buckets_account_scope_fk",
          ["tenant_id", "source_id", "account_id"],
          "accounts",
          ["tenant_id", "source_id", "account_id"]
        )
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
      [
        foreignKey(
          "import_batches_source_scope_fk",
          ["tenant_id", "source_id"],
          "accounting_sources",
          ["tenant_id", "source_id"]
        )
      ],
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
      [
        foreignKey(
          "sync_checkpoints_source_scope_fk",
          ["tenant_id", "source_id"],
          "accounting_sources",
          ["tenant_id", "source_id"]
        )
      ],
      [
        {
          name: "sync_checkpoints_source_object_uidx",
          columns: ["tenant_id", "source_id", "source_object", "cursor_kind"],
          unique: true
        },
        {
          name: "sync_checkpoints_scope_uidx",
          columns: ["tenant_id", "source_id", "checkpoint_id"],
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
        },
        foreignKey(
          "report_freshness_company_source_scope_fk",
          ["tenant_id", "company_id", "source_id"],
          "company_sources",
          ["tenant_id", "company_id", "source_id"]
        )
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
        text("company_id"),
        text("source_id"),
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
        },
        foreignKey(
          "report_snapshots_company_source_scope_fk",
          ["tenant_id", "company_id", "source_id"],
          "company_sources",
          ["tenant_id", "company_id", "source_id"]
        )
      ],
      [
        {
          name: "report_snapshots_request_uidx",
          columns: [
            "tenant_id",
            "company_id",
            "source_id",
            "report_name",
            "snapshot_source",
            "accounting_basis",
            "period_start",
            "period_end",
            "as_of_date",
            "currency_code"
          ],
          unique: true
        },
        {
          name: "report_snapshots_scope_uidx",
          columns: ["tenant_id", "company_id", "source_id", "report_snapshot_id"],
          unique: true
        }
      ]
    ),
    table(
      "report_snapshot_lines",
      "Persisted statement rows with drilldown evidence.",
      [
        id("report_line_id"),
        text("tenant_id"),
        text("company_id"),
        text("source_id"),
        text("report_snapshot_id"),
        text("parent_report_line_id", true),
        text("section"),
        text("label"),
        text("account_id", true),
        numeric("amount"),
        integer("sort_order"),
        jsonb("drilldown_ref")
      ],
      [
        foreignKey(
          "report_snapshot_lines_snapshot_scope_fk",
          ["tenant_id", "company_id", "source_id", "report_snapshot_id"],
          "report_snapshots",
          ["tenant_id", "company_id", "source_id", "report_snapshot_id"]
        ),
        foreignKey(
          "report_snapshot_lines_parent_scope_fk",
          ["tenant_id", "company_id", "source_id", "parent_report_line_id"],
          "report_snapshot_lines",
          ["tenant_id", "company_id", "source_id", "report_line_id"]
        ),
        foreignKey(
          "report_snapshot_lines_account_scope_fk",
          ["tenant_id", "source_id", "account_id"],
          "accounts",
          ["tenant_id", "source_id", "account_id"]
        )
      ],
      [
        {
          name: "report_snapshot_lines_sort_uidx",
          columns: ["tenant_id", "company_id", "source_id", "report_snapshot_id", "sort_order", "report_line_id"],
          unique: true
        },
        {
          name: "report_snapshot_lines_scope_uidx",
          columns: ["tenant_id", "company_id", "source_id", "report_line_id"],
          unique: true
        }
      ]
    ),
    table(
      "report_snapshot_totals",
      "Named report totals with drilldown evidence.",
      [
        id("report_total_id"),
        text("tenant_id"),
        text("company_id"),
        text("source_id"),
        text("report_snapshot_id"),
        text("total_key"),
        text("label"),
        numeric("amount"),
        jsonb("drilldown_ref")
      ],
      [
        foreignKey(
          "report_snapshot_totals_snapshot_scope_fk",
          ["tenant_id", "company_id", "source_id", "report_snapshot_id"],
          "report_snapshots",
          ["tenant_id", "company_id", "source_id", "report_snapshot_id"]
        )
      ],
      [
        {
          name: "report_snapshot_totals_total_key_uidx",
          columns: ["tenant_id", "company_id", "source_id", "report_snapshot_id", "total_key"],
          unique: true
        }
      ]
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
      (constraint) =>
        `constraint ${quoteIdentifier(constraint.name)} ${constraint.kind === "foreign_key" ? constraint.sql : `check (${constraint.sql})`}`
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
