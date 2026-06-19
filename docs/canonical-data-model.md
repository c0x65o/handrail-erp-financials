# Canonical Data Model

The canonical model is provider-neutral. QuickBooks data, native ERP data, and
future accounting sources should all land in the same conceptual tables before
reports are built.

Names below are target concepts, not final table names.

## Scope Tables

### accounting_companies

Represents the reporting entity for a tenant.

Core fields:

- `tenant_id`
- `company_id`
- `legal_name`
- `display_name`
- `base_currency_code`
- `fiscal_year_start_month`
- `provider_environment`
- `source_system`
- `source_company_ref`

### accounting_sources

Tracks where facts came from.

Core fields:

- `source_id`
- `tenant_id`
- `source_system`
- `provider_environment`
- `connection_ref`
- `import_batch_id`
- `checkpoint_id`
- `latest_synced_at`
- `status`

## Dimension Tables

### accounts

Chart of accounts.

Core fields:

- `account_id`
- `tenant_id`
- `source_account_id`
- `account_number`
- `name`
- `type`
- `subtype`
- `classification`
- `parent_account_id`
- `currency_code`
- `active`

Expected classifications include:

- asset
- liability
- equity
- income
- cost_of_goods_sold
- expense
- other_income
- other_expense

### parties

Customers, vendors, employees, and other transaction parties.

Core fields:

- `party_id`
- `tenant_id`
- `source_party_id`
- `party_type`
- `display_name`
- `active`

### items

Products, services, inventory items, and billable items.

Core fields:

- `item_id`
- `tenant_id`
- `source_item_id`
- `item_type`
- `name`
- `income_account_id`
- `expense_account_id`
- `asset_account_id`
- `active`

### accounting_dimensions

Provider-neutral dimensions such as class, location, department, project, job,
cost center, or custom segment.

Core fields:

- `dimension_id`
- `tenant_id`
- `dimension_kind`
- `source_dimension_id`
- `name`
- `parent_dimension_id`
- `active`

## Transaction Tables

### transactions

Header-level financial events.

Core fields:

- `transaction_id`
- `tenant_id`
- `source_transaction_id`
- `source_transaction_type`
- `transaction_number`
- `transaction_date`
- `posted_at`
- `updated_at`
- `party_id`
- `currency_code`
- `exchange_rate`
- `status`
- `memo`
- `source_payload_ref`

### transaction_lines

Line-level transaction detail before double-entry posting expansion.

Core fields:

- `transaction_line_id`
- `tenant_id`
- `transaction_id`
- `line_number`
- `account_id`
- `party_id`
- `item_id`
- `amount`
- `quantity`
- `unit_amount`
- `description`
- `dimension_refs`

### ledger_postings

The durable reporting fact. Financial statements should calculate from postings
or from rollups derived from postings.

Core fields:

- `posting_id`
- `tenant_id`
- `transaction_id`
- `transaction_line_id`
- `account_id`
- `party_id`
- `item_id`
- `posting_date`
- `accounting_basis`
- `debit_amount`
- `credit_amount`
- `net_amount`
- `currency_code`
- `dimension_hash`
- `dimension_refs`
- `source_payload_ref`
- `import_batch_id`
- `checkpoint_id`

Important rules:

- Debits and credits should be nonnegative.
- `net_amount` should be deterministic for the report basis.
- Source identity must support idempotent upsert.
- Posting rows should retain enough refs for drilldown without storing raw
  provider payloads.

## Import and Freshness Tables

### import_batches

Append-only record of source import work.

Core fields:

- `import_batch_id`
- `tenant_id`
- `source_id`
- `mode`
- `status`
- `started_at`
- `completed_at`
- `source_object_counts`
- `warning_summary`
- `error_summary`

### sync_checkpoints

Cursor state for delta sync and late-arrival recovery.

Core fields:

- `checkpoint_id`
- `tenant_id`
- `source_id`
- `source_object`
- `cursor_kind`
- `cursor_value`
- `fresh_through`
- `latest_source_updated_at`
- `status`

## Report Tables

### report_snapshots

Durable report outputs for expensive statements or reconciliation points.

Core fields:

- `report_snapshot_id`
- `tenant_id`
- `report_name`
- `snapshot_source`
- `accounting_basis`
- `period_start`
- `period_end`
- `as_of_date`
- `currency_code`
- `generated_at`
- `freshness`
- `reconciliation_status`
- `reconciliation_difference`

### report_snapshot_lines

Persisted statement rows.

Core fields:

- `report_line_id`
- `tenant_id`
- `report_snapshot_id`
- `parent_report_line_id`
- `section`
- `label`
- `account_id`
- `amount`
- `sort_order`
- `drilldown_ref`

### report_snapshot_totals

Named totals such as net income, total assets, total expenses, or cash at end of
period.

Core fields:

- `report_total_id`
- `tenant_id`
- `report_snapshot_id`
- `total_key`
- `label`
- `amount`
- `drilldown_ref`

## Constraints

The package should enforce:

- tenant-scoped source identity
- idempotent imports
- nonnegative debit and credit amounts
- bounded JSON fields
- no raw credentials
- no unbounded provider payload storage in app tables
- deterministic dimension hashes
- report snapshot provenance
- freshness/cursor provenance for each generated report
