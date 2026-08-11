create schema if not exists "erp_financials";

create table if not exists "erp_financials"."accounting_companies" (
  "company_id" text not null,
  "tenant_id" text not null,
  "legal_name" text not null,
  "display_name" text not null,
  "base_currency_code" text not null,
  "fiscal_year_start_month" integer not null,
  "provider_environment" text not null,
  "source_system" text not null,
  "source_company_ref" text not null,
  constraint "accounting_companies_pkey" primary key ("company_id"),
  constraint "accounting_companies_fiscal_year_start_month_check" check (fiscal_year_start_month between 1 and 12)
);

create unique index if not exists "accounting_companies_source_identity_uidx" on "erp_financials"."accounting_companies" ("tenant_id", "source_system", "provider_environment", "source_company_ref");

create table if not exists "erp_financials"."accounting_sources" (
  "source_id" text not null,
  "tenant_id" text not null,
  "source_system" text not null,
  "provider_environment" text not null,
  "connection_ref" text not null,
  "import_batch_id" text,
  "checkpoint_id" text,
  "latest_synced_at" timestamptz,
  "status" text not null,
  constraint "accounting_sources_pkey" primary key ("source_id")
);

create unique index if not exists "accounting_sources_connection_uidx" on "erp_financials"."accounting_sources" ("tenant_id", "source_system", "provider_environment", "connection_ref");

create table if not exists "erp_financials"."accounts" (
  "account_id" text not null,
  "tenant_id" text not null,
  "source_id" text not null,
  "source_account_id" text not null,
  "account_number" text,
  "name" text not null,
  "type" text not null,
  "subtype" text,
  "classification" text not null,
  "parent_account_id" text,
  "currency_code" text,
  "active" boolean not null,
  constraint "accounts_pkey" primary key ("account_id")
);

create unique index if not exists "accounts_source_account_uidx" on "erp_financials"."accounts" ("tenant_id", "source_id", "source_account_id");

create index if not exists "accounts_classification_idx" on "erp_financials"."accounts" ("tenant_id", "classification");

create index if not exists "accounts_parent_account_idx" on "erp_financials"."accounts" ("tenant_id", "source_id", "parent_account_id");

create table if not exists "erp_financials"."parties" (
  "party_id" text not null,
  "tenant_id" text not null,
  "source_id" text not null,
  "source_party_id" text not null,
  "party_type" text not null,
  "display_name" text not null,
  "active" boolean not null,
  constraint "parties_pkey" primary key ("party_id")
);

create unique index if not exists "parties_source_party_uidx" on "erp_financials"."parties" ("tenant_id", "source_id", "source_party_id");

create table if not exists "erp_financials"."items" (
  "item_id" text not null,
  "tenant_id" text not null,
  "source_id" text not null,
  "source_item_id" text not null,
  "item_type" text not null,
  "name" text not null,
  "income_account_id" text,
  "expense_account_id" text,
  "asset_account_id" text,
  "active" boolean not null,
  constraint "items_pkey" primary key ("item_id")
);

create unique index if not exists "items_source_item_uidx" on "erp_financials"."items" ("tenant_id", "source_id", "source_item_id");

create table if not exists "erp_financials"."accounting_dimensions" (
  "dimension_id" text not null,
  "tenant_id" text not null,
  "source_id" text not null,
  "dimension_kind" text not null,
  "source_dimension_id" text not null,
  "name" text not null,
  "parent_dimension_id" text,
  "active" boolean not null,
  constraint "accounting_dimensions_pkey" primary key ("dimension_id")
);

create unique index if not exists "accounting_dimensions_source_dimension_uidx" on "erp_financials"."accounting_dimensions" ("tenant_id", "source_id", "dimension_kind", "source_dimension_id");

create table if not exists "erp_financials"."transactions" (
  "transaction_id" text not null,
  "tenant_id" text not null,
  "source_id" text not null,
  "source_transaction_id" text not null,
  "source_transaction_type" text not null,
  "transaction_number" text,
  "transaction_date" date not null,
  "posted_at" timestamptz,
  "updated_at" timestamptz,
  "party_id" text,
  "currency_code" text not null,
  "exchange_rate" numeric,
  "status" text not null,
  "memo" text,
  "source_payload_ref" jsonb,
  constraint "transactions_pkey" primary key ("transaction_id"),
  constraint "transactions_source_payload_ref_bounded_json_check" check (octet_length(coalesce("source_payload_ref"::text, '')) <= 4096)
);

create unique index if not exists "transactions_source_transaction_uidx" on "erp_financials"."transactions" ("tenant_id", "source_id", "source_transaction_type", "source_transaction_id");

create index if not exists "transactions_date_idx" on "erp_financials"."transactions" ("tenant_id", "transaction_date");

create table if not exists "erp_financials"."transaction_lines" (
  "transaction_line_id" text not null,
  "tenant_id" text not null,
  "transaction_id" text not null,
  "line_number" integer not null,
  "account_id" text,
  "party_id" text,
  "item_id" text,
  "amount" numeric not null,
  "quantity" numeric,
  "unit_amount" numeric,
  "description" text,
  "dimension_refs" jsonb,
  constraint "transaction_lines_pkey" primary key ("transaction_line_id"),
  constraint "transaction_lines_line_number_check" check (line_number >= 0),
  constraint "transaction_lines_dimension_refs_bounded_json_check" check (octet_length(coalesce("dimension_refs"::text, '')) <= 4096)
);

create unique index if not exists "transaction_lines_transaction_line_uidx" on "erp_financials"."transaction_lines" ("tenant_id", "transaction_id", "line_number");

create table if not exists "erp_financials"."ledger_postings" (
  "posting_id" text not null,
  "tenant_id" text not null,
  "source_id" text not null,
  "source_posting_id" text not null,
  "transaction_id" text not null,
  "transaction_line_id" text,
  "account_id" text not null,
  "party_id" text,
  "item_id" text,
  "posting_date" date not null,
  "accounting_basis" text not null,
  "debit_amount" numeric not null,
  "credit_amount" numeric not null,
  "net_amount" numeric not null,
  "currency_code" text not null,
  "dimension_hash" text not null,
  "dimension_refs" jsonb,
  "source_payload_ref" jsonb,
  "import_batch_id" text not null,
  "checkpoint_id" text,
  constraint "ledger_postings_pkey" primary key ("posting_id"),
  constraint "ledger_postings_nonnegative_debit_check" check (debit_amount >= 0),
  constraint "ledger_postings_nonnegative_credit_check" check (credit_amount >= 0),
  constraint "ledger_postings_dimension_hash_check" check (length(dimension_hash) = 64),
  constraint "ledger_postings_dimension_refs_bounded_json_check" check (octet_length(coalesce("dimension_refs"::text, '')) <= 4096),
  constraint "ledger_postings_source_payload_ref_bounded_json_check" check (octet_length(coalesce("source_payload_ref"::text, '')) <= 4096)
);

create unique index if not exists "ledger_postings_source_posting_uidx" on "erp_financials"."ledger_postings" ("tenant_id", "source_id", "accounting_basis", "source_posting_id");

create index if not exists "ledger_postings_report_idx" on "erp_financials"."ledger_postings" ("tenant_id", "posting_date", "accounting_basis", "account_id", "currency_code");

create index if not exists "ledger_postings_import_batch_idx" on "erp_financials"."ledger_postings" ("tenant_id", "import_batch_id");

create table if not exists "erp_financials"."posting_rules" (
  "posting_rule_id" text not null,
  "tenant_id" text not null,
  "source_id" text not null,
  "rule_code" text not null,
  "name" text not null,
  "description" text,
  "priority" integer not null,
  "status" text not null,
  "condition_mode" text not null,
  "conditions" jsonb not null,
  "actions" jsonb not null,
  "effective_from" date,
  "effective_through" date,
  "created_at" timestamptz not null,
  "updated_at" timestamptz not null,
  constraint "posting_rules_pkey" primary key ("posting_rule_id"),
  constraint "posting_rules_priority_check" check (priority >= 0),
  constraint "posting_rules_effective_period_check" check (effective_from is null or effective_through is null or effective_from <= effective_through),
  constraint "posting_rules_status_check" check (status in ('draft', 'active', 'inactive', 'archived')),
  constraint "posting_rules_condition_mode_check" check (condition_mode in ('all', 'any')),
  constraint "posting_rules_json_shape_check" check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) > 0 and jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) > 0),
  constraint "posting_rules_updated_at_check" check (updated_at >= created_at),
  constraint "posting_rules_conditions_bounded_json_check" check (octet_length(coalesce("conditions"::text, '')) <= 4096),
  constraint "posting_rules_actions_bounded_json_check" check (octet_length(coalesce("actions"::text, '')) <= 4096)
);

create unique index if not exists "posting_rules_code_uidx" on "erp_financials"."posting_rules" ("tenant_id", "source_id", "rule_code");

create index if not exists "posting_rules_active_priority_idx" on "erp_financials"."posting_rules" ("tenant_id", "source_id", "status", "priority", "rule_code");

create table if not exists "erp_financials"."transaction_match_candidates" (
  "match_candidate_id" text not null,
  "tenant_id" text not null,
  "source_id" text not null,
  "match_kind" text not null,
  "origin_transaction_id" text not null,
  "target_transaction_id" text not null,
  "matcher_version" text not null,
  "score" numeric not null,
  "suggested_application_amount" numeric not null,
  "currency_code" text not null,
  "status" text not null,
  "evidence" jsonb not null,
  "created_at" timestamptz not null,
  "expires_at" timestamptz,
  constraint "transaction_match_candidates_pkey" primary key ("match_candidate_id"),
  constraint "transaction_match_candidates_score_check" check (score >= 0 and score <= 1),
  constraint "transaction_match_candidates_amount_check" check (suggested_application_amount > 0),
  constraint "transaction_match_candidates_expiry_check" check (expires_at is null or expires_at > created_at),
  constraint "transaction_match_candidates_kind_check" check (match_kind in ('customer_payment_to_invoice', 'vendor_payment_to_bill')),
  constraint "transaction_match_candidates_status_check" check (status in ('suggested', 'accepted', 'rejected', 'expired', 'superseded')),
  constraint "transaction_match_candidates_distinct_transactions_check" check (origin_transaction_id <> target_transaction_id),
  constraint "transaction_match_candidates_evidence_shape_check" check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0),
  constraint "transaction_match_candidates_evidence_bounded_json_check" check (octet_length(coalesce("evidence"::text, '')) <= 4096)
);

create unique index if not exists "transaction_match_candidates_identity_uidx" on "erp_financials"."transaction_match_candidates" ("tenant_id", "source_id", "match_kind", "origin_transaction_id", "target_transaction_id", "matcher_version");

create index if not exists "transaction_match_candidates_origin_status_idx" on "erp_financials"."transaction_match_candidates" ("tenant_id", "source_id", "origin_transaction_id", "status", "score");

create table if not exists "erp_financials"."transaction_match_decisions" (
  "match_decision_id" text not null,
  "tenant_id" text not null,
  "source_id" text not null,
  "match_candidate_id" text not null,
  "decision" text not null,
  "method" text not null,
  "decided_at" timestamptz not null,
  "decided_by_ref" text,
  "reason" text,
  "evidence" jsonb,
  constraint "transaction_match_decisions_pkey" primary key ("match_decision_id"),
  constraint "transaction_match_decisions_value_check" check (decision in ('accepted', 'rejected', 'superseded')),
  constraint "transaction_match_decisions_method_check" check (method in ('automatic', 'manual')),
  constraint "transaction_match_decisions_manual_actor_check" check (method <> 'manual' or (decided_by_ref is not null and btrim(decided_by_ref) <> '')),
  constraint "transaction_match_decisions_evidence_bounded_json_check" check (octet_length(coalesce("evidence"::text, '')) <= 4096)
);

create unique index if not exists "transaction_match_decisions_identity_uidx" on "erp_financials"."transaction_match_decisions" ("tenant_id", "source_id", "match_decision_id");

create index if not exists "transaction_match_decisions_candidate_idx" on "erp_financials"."transaction_match_decisions" ("tenant_id", "source_id", "match_candidate_id", "decided_at");

create table if not exists "erp_financials"."payment_applications" (
  "payment_application_id" text not null,
  "tenant_id" text not null,
  "source_id" text not null,
  "payment_transaction_id" text not null,
  "invoice_transaction_id" text not null,
  "match_decision_id" text,
  "applied_amount" numeric not null,
  "currency_code" text not null,
  "application_date" date not null,
  "status" text not null,
  "created_at" timestamptz not null,
  "updated_at" timestamptz not null,
  constraint "payment_applications_pkey" primary key ("payment_application_id"),
  constraint "payment_applications_amount_check" check (applied_amount > 0),
  constraint "payment_applications_status_check" check (status in ('proposed', 'posted', 'voided')),
  constraint "payment_applications_distinct_transactions_check" check (payment_transaction_id <> invoice_transaction_id),
  constraint "payment_applications_updated_at_check" check (updated_at >= created_at)
);

create unique index if not exists "payment_applications_identity_uidx" on "erp_financials"."payment_applications" ("tenant_id", "source_id", "payment_transaction_id", "invoice_transaction_id");

create index if not exists "payment_applications_invoice_status_idx" on "erp_financials"."payment_applications" ("tenant_id", "source_id", "invoice_transaction_id", "status", "application_date");

create table if not exists "erp_financials"."rollup_buckets" (
  "rollup_bucket_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "source_id" text not null,
  "account_id" text not null,
  "accounting_basis" text not null,
  "bucket_grain" text not null,
  "bucket_start" date not null,
  "bucket_end" date not null,
  "currency_code" text not null,
  "dimension_hash" text not null,
  "party_id" text not null,
  "party_type" text not null,
  "item_id" text not null,
  "debit_amount" numeric not null,
  "credit_amount" numeric not null,
  "net_amount" numeric not null,
  "posting_count" integer not null,
  "source_posting_max_updated_at" timestamptz,
  "import_batch_id" text,
  "generated_at" timestamptz not null,
  constraint "rollup_buckets_pkey" primary key ("rollup_bucket_id"),
  constraint "rollup_buckets_period_check" check (bucket_start <= bucket_end),
  constraint "rollup_buckets_nonnegative_debit_check" check (debit_amount >= 0),
  constraint "rollup_buckets_nonnegative_credit_check" check (credit_amount >= 0),
  constraint "rollup_buckets_dimension_hash_check" check (length(dimension_hash) = 64),
  constraint "rollup_buckets_posting_count_check" check (posting_count >= 0)
);

create unique index if not exists "rollup_buckets_identity_uidx" on "erp_financials"."rollup_buckets" ("tenant_id", "company_id", "source_id", "accounting_basis", "bucket_grain", "bucket_start", "bucket_end", "account_id", "currency_code", "dimension_hash", "party_id", "party_type", "item_id");

create index if not exists "rollup_buckets_report_idx" on "erp_financials"."rollup_buckets" ("tenant_id", "company_id", "source_id", "accounting_basis", "bucket_grain", "currency_code", "bucket_start", "bucket_end", "account_id", "dimension_hash", "party_type", "party_id", "item_id");

create table if not exists "erp_financials"."import_batches" (
  "import_batch_id" text not null,
  "tenant_id" text not null,
  "source_id" text not null,
  "mode" text not null,
  "status" text not null,
  "started_at" timestamptz not null,
  "completed_at" timestamptz,
  "source_object_counts" jsonb,
  "warning_summary" jsonb,
  "error_summary" jsonb,
  constraint "import_batches_pkey" primary key ("import_batch_id"),
  constraint "import_batches_source_object_counts_bounded_json_check" check (octet_length(coalesce("source_object_counts"::text, '')) <= 4096),
  constraint "import_batches_warning_summary_bounded_json_check" check (octet_length(coalesce("warning_summary"::text, '')) <= 4096),
  constraint "import_batches_error_summary_bounded_json_check" check (octet_length(coalesce("error_summary"::text, '')) <= 4096)
);

create unique index if not exists "import_batches_source_batch_uidx" on "erp_financials"."import_batches" ("tenant_id", "source_id", "import_batch_id");

create index if not exists "import_batches_source_started_idx" on "erp_financials"."import_batches" ("tenant_id", "source_id", "started_at");

create table if not exists "erp_financials"."sync_checkpoints" (
  "checkpoint_id" text not null,
  "tenant_id" text not null,
  "source_id" text not null,
  "source_object" text not null,
  "cursor_kind" text not null,
  "cursor_value" text not null,
  "fresh_through" timestamptz,
  "latest_source_updated_at" timestamptz,
  "status" text not null,
  constraint "sync_checkpoints_pkey" primary key ("checkpoint_id")
);

create unique index if not exists "sync_checkpoints_source_object_uidx" on "erp_financials"."sync_checkpoints" ("tenant_id", "source_id", "source_object", "cursor_kind");

create table if not exists "erp_financials"."report_freshness" (
  "freshness_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "source_id" text not null,
  "report_name" text not null,
  "accounting_basis" text not null,
  "period_start" date not null,
  "period_end" date not null,
  "currency_code" text not null,
  "status" text not null,
  "fresh_through" timestamptz,
  "stale_reason" text,
  "import_batch_id" text,
  "checkpoint_id" text,
  "updated_at" timestamptz not null,
  constraint "report_freshness_pkey" primary key ("freshness_id"),
  constraint "report_freshness_period_check" check (period_start <= period_end)
);

create unique index if not exists "report_freshness_identity_uidx" on "erp_financials"."report_freshness" ("tenant_id", "company_id", "source_id", "report_name", "accounting_basis", "period_start", "period_end", "currency_code");

create index if not exists "report_freshness_status_idx" on "erp_financials"."report_freshness" ("tenant_id", "company_id", "status", "updated_at");

create table if not exists "erp_financials"."report_snapshots" (
  "report_snapshot_id" text not null,
  "tenant_id" text not null,
  "report_name" text not null,
  "snapshot_source" text not null,
  "accounting_basis" text not null,
  "period_start" date not null,
  "period_end" date not null,
  "as_of_date" date not null,
  "currency_code" text not null,
  "generated_at" timestamptz not null,
  "freshness" jsonb,
  "reconciliation_status" text not null,
  "reconciliation_difference" numeric not null,
  constraint "report_snapshots_pkey" primary key ("report_snapshot_id"),
  constraint "report_snapshots_period_check" check (period_start <= period_end),
  constraint "report_snapshots_freshness_bounded_json_check" check (octet_length(coalesce("freshness"::text, '')) <= 4096)
);

create unique index if not exists "report_snapshots_request_uidx" on "erp_financials"."report_snapshots" ("tenant_id", "report_name", "snapshot_source", "accounting_basis", "period_start", "period_end", "as_of_date", "currency_code");

create table if not exists "erp_financials"."report_snapshot_lines" (
  "report_line_id" text not null,
  "tenant_id" text not null,
  "report_snapshot_id" text not null,
  "parent_report_line_id" text,
  "section" text not null,
  "label" text not null,
  "account_id" text,
  "amount" numeric not null,
  "sort_order" integer not null,
  "drilldown_ref" jsonb,
  constraint "report_snapshot_lines_pkey" primary key ("report_line_id"),
  constraint "report_snapshot_lines_drilldown_ref_bounded_json_check" check (octet_length(coalesce("drilldown_ref"::text, '')) <= 4096)
);

create unique index if not exists "report_snapshot_lines_sort_uidx" on "erp_financials"."report_snapshot_lines" ("tenant_id", "report_snapshot_id", "sort_order", "report_line_id");

create table if not exists "erp_financials"."report_snapshot_totals" (
  "report_total_id" text not null,
  "tenant_id" text not null,
  "report_snapshot_id" text not null,
  "total_key" text not null,
  "label" text not null,
  "amount" numeric not null,
  "drilldown_ref" jsonb,
  constraint "report_snapshot_totals_pkey" primary key ("report_total_id"),
  constraint "report_snapshot_totals_drilldown_ref_bounded_json_check" check (octet_length(coalesce("drilldown_ref"::text, '')) <= 4096)
);

create unique index if not exists "report_snapshot_totals_total_key_uidx" on "erp_financials"."report_snapshot_totals" ("tenant_id", "report_snapshot_id", "total_key");
