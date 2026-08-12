create table "erp_financials"."company_sources" (
  "company_source_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "source_id" text not null,
  "created_at" timestamptz not null,
  constraint "company_sources_pkey" primary key ("company_source_id")
);

insert into "erp_financials"."company_sources" (
  "company_source_id", "tenant_id", "company_id", "source_id", "created_at"
)
select
  'company_source_' || md5(scope."tenant_id" || chr(0) || scope."company_id" || chr(0) || scope."source_id"),
  scope."tenant_id",
  scope."company_id",
  scope."source_id",
  clock_timestamp()
from (
  select "tenant_id", "company_id", "source_id" from "erp_financials"."report_snapshots"
  union
  select "tenant_id", "company_id", "source_id" from "erp_financials"."report_freshness"
  union
  select "tenant_id", "company_id", "source_id" from "erp_financials"."rollup_buckets"
) scope;

alter table "erp_financials"."transaction_lines" add column "source_id" text;
update "erp_financials"."transaction_lines" lines
set "source_id" = transactions."source_id"
from "erp_financials"."transactions" transactions
where transactions."tenant_id" = lines."tenant_id"
  and transactions."transaction_id" = lines."transaction_id";

alter table "erp_financials"."report_snapshot_lines" add column "company_id" text;
alter table "erp_financials"."report_snapshot_lines" add column "source_id" text;
update "erp_financials"."report_snapshot_lines" lines
set "company_id" = snapshots."company_id", "source_id" = snapshots."source_id"
from "erp_financials"."report_snapshots" snapshots
where snapshots."tenant_id" = lines."tenant_id"
  and snapshots."report_snapshot_id" = lines."report_snapshot_id";

alter table "erp_financials"."report_snapshot_totals" add column "company_id" text;
alter table "erp_financials"."report_snapshot_totals" add column "source_id" text;
update "erp_financials"."report_snapshot_totals" totals
set "company_id" = snapshots."company_id", "source_id" = snapshots."source_id"
from "erp_financials"."report_snapshots" snapshots
where snapshots."tenant_id" = totals."tenant_id"
  and snapshots."report_snapshot_id" = totals."report_snapshot_id";

do $integrity_backfill$
begin
  if exists (select 1 from "erp_financials"."transaction_lines" where "source_id" is null) then
    raise exception 'ERP Financials v9 cannot scope every transaction line to its parent transaction';
  end if;
  if exists (
    select 1 from "erp_financials"."report_snapshot_lines"
    where "company_id" is null or "source_id" is null
  ) then
    raise exception 'ERP Financials v9 cannot scope every report snapshot line to its parent snapshot';
  end if;
  if exists (
    select 1 from "erp_financials"."report_snapshot_totals"
    where "company_id" is null or "source_id" is null
  ) then
    raise exception 'ERP Financials v9 cannot scope every report snapshot total to its parent snapshot';
  end if;
end
$integrity_backfill$;

alter table "erp_financials"."transaction_lines" alter column "source_id" set not null;
alter table "erp_financials"."report_snapshot_lines" alter column "company_id" set not null;
alter table "erp_financials"."report_snapshot_lines" alter column "source_id" set not null;
alter table "erp_financials"."report_snapshot_totals" alter column "company_id" set not null;
alter table "erp_financials"."report_snapshot_totals" alter column "source_id" set not null;

drop index "erp_financials"."transactions_date_idx";
drop index "erp_financials"."transaction_lines_transaction_line_uidx";
drop index "erp_financials"."report_snapshot_lines_sort_uidx";
drop index "erp_financials"."report_snapshot_totals_total_key_uidx";

create unique index "accounting_companies_scope_uidx" on "erp_financials"."accounting_companies" ("tenant_id", "company_id");
create unique index "accounting_sources_scope_uidx" on "erp_financials"."accounting_sources" ("tenant_id", "source_id");
create unique index "company_sources_scope_uidx" on "erp_financials"."company_sources" ("tenant_id", "company_id", "source_id");
create unique index "accounts_scope_uidx" on "erp_financials"."accounts" ("tenant_id", "source_id", "account_id");
create unique index "parties_scope_uidx" on "erp_financials"."parties" ("tenant_id", "source_id", "party_id");
create unique index "items_scope_uidx" on "erp_financials"."items" ("tenant_id", "source_id", "item_id");
create unique index "accounting_dimensions_scope_uidx" on "erp_financials"."accounting_dimensions" ("tenant_id", "source_id", "dimension_id");
create index "transactions_date_idx" on "erp_financials"."transactions" ("tenant_id", "source_id", "transaction_date");
create unique index "transactions_scope_uidx" on "erp_financials"."transactions" ("tenant_id", "source_id", "transaction_id");
create unique index "transaction_lines_transaction_line_uidx" on "erp_financials"."transaction_lines" ("tenant_id", "source_id", "transaction_id", "line_number");
create unique index "transaction_lines_scope_uidx" on "erp_financials"."transaction_lines" ("tenant_id", "source_id", "transaction_line_id");
create unique index "transaction_match_candidates_scope_uidx" on "erp_financials"."transaction_match_candidates" ("tenant_id", "source_id", "match_candidate_id");
create unique index "sync_checkpoints_scope_uidx" on "erp_financials"."sync_checkpoints" ("tenant_id", "source_id", "checkpoint_id");
create unique index "report_snapshots_scope_uidx" on "erp_financials"."report_snapshots" ("tenant_id", "company_id", "source_id", "report_snapshot_id");
create unique index "report_snapshot_lines_sort_uidx" on "erp_financials"."report_snapshot_lines" ("tenant_id", "company_id", "source_id", "report_snapshot_id", "sort_order", "report_line_id");
create unique index "report_snapshot_lines_scope_uidx" on "erp_financials"."report_snapshot_lines" ("tenant_id", "company_id", "source_id", "report_line_id");
create unique index "report_snapshot_totals_total_key_uidx" on "erp_financials"."report_snapshot_totals" ("tenant_id", "company_id", "source_id", "report_snapshot_id", "total_key");

alter table "erp_financials"."company_sources"
  add constraint "company_sources_company_scope_fk" foreign key ("tenant_id", "company_id") references "erp_financials"."accounting_companies" ("tenant_id", "company_id") on update restrict on delete restrict,
  add constraint "company_sources_source_scope_fk" foreign key ("tenant_id", "source_id") references "erp_financials"."accounting_sources" ("tenant_id", "source_id") on update restrict on delete restrict;

alter table "erp_financials"."accounts"
  add constraint "accounts_source_scope_fk" foreign key ("tenant_id", "source_id") references "erp_financials"."accounting_sources" ("tenant_id", "source_id") on update restrict on delete restrict,
  add constraint "accounts_parent_scope_fk" foreign key ("tenant_id", "source_id", "parent_account_id") references "erp_financials"."accounts" ("tenant_id", "source_id", "account_id") on update restrict on delete restrict;

alter table "erp_financials"."parties"
  add constraint "parties_source_scope_fk" foreign key ("tenant_id", "source_id") references "erp_financials"."accounting_sources" ("tenant_id", "source_id") on update restrict on delete restrict;

alter table "erp_financials"."items"
  add constraint "items_source_scope_fk" foreign key ("tenant_id", "source_id") references "erp_financials"."accounting_sources" ("tenant_id", "source_id") on update restrict on delete restrict,
  add constraint "items_income_account_scope_fk" foreign key ("tenant_id", "source_id", "income_account_id") references "erp_financials"."accounts" ("tenant_id", "source_id", "account_id") on update restrict on delete restrict,
  add constraint "items_expense_account_scope_fk" foreign key ("tenant_id", "source_id", "expense_account_id") references "erp_financials"."accounts" ("tenant_id", "source_id", "account_id") on update restrict on delete restrict,
  add constraint "items_asset_account_scope_fk" foreign key ("tenant_id", "source_id", "asset_account_id") references "erp_financials"."accounts" ("tenant_id", "source_id", "account_id") on update restrict on delete restrict;

alter table "erp_financials"."accounting_dimensions"
  add constraint "accounting_dimensions_source_scope_fk" foreign key ("tenant_id", "source_id") references "erp_financials"."accounting_sources" ("tenant_id", "source_id") on update restrict on delete restrict,
  add constraint "accounting_dimensions_parent_scope_fk" foreign key ("tenant_id", "source_id", "parent_dimension_id") references "erp_financials"."accounting_dimensions" ("tenant_id", "source_id", "dimension_id") on update restrict on delete restrict;

alter table "erp_financials"."transactions"
  add constraint "transactions_source_scope_fk" foreign key ("tenant_id", "source_id") references "erp_financials"."accounting_sources" ("tenant_id", "source_id") on update restrict on delete restrict,
  add constraint "transactions_party_scope_fk" foreign key ("tenant_id", "source_id", "party_id") references "erp_financials"."parties" ("tenant_id", "source_id", "party_id") on update restrict on delete restrict;

alter table "erp_financials"."transaction_lines"
  add constraint "transaction_lines_transaction_scope_fk" foreign key ("tenant_id", "source_id", "transaction_id") references "erp_financials"."transactions" ("tenant_id", "source_id", "transaction_id") on update restrict on delete restrict,
  add constraint "transaction_lines_account_scope_fk" foreign key ("tenant_id", "source_id", "account_id") references "erp_financials"."accounts" ("tenant_id", "source_id", "account_id") on update restrict on delete restrict,
  add constraint "transaction_lines_party_scope_fk" foreign key ("tenant_id", "source_id", "party_id") references "erp_financials"."parties" ("tenant_id", "source_id", "party_id") on update restrict on delete restrict,
  add constraint "transaction_lines_item_scope_fk" foreign key ("tenant_id", "source_id", "item_id") references "erp_financials"."items" ("tenant_id", "source_id", "item_id") on update restrict on delete restrict;

alter table "erp_financials"."ledger_postings"
  add constraint "ledger_postings_single_sided_check" check (("debit_amount" > 0 and "credit_amount" = 0) or ("credit_amount" > 0 and "debit_amount" = 0)),
  add constraint "ledger_postings_net_amount_check" check ("net_amount" = "debit_amount" - "credit_amount"),
  add constraint "ledger_postings_transaction_scope_fk" foreign key ("tenant_id", "source_id", "transaction_id") references "erp_financials"."transactions" ("tenant_id", "source_id", "transaction_id") on update restrict on delete restrict,
  add constraint "ledger_postings_transaction_line_scope_fk" foreign key ("tenant_id", "source_id", "transaction_line_id") references "erp_financials"."transaction_lines" ("tenant_id", "source_id", "transaction_line_id") on update restrict on delete restrict,
  add constraint "ledger_postings_account_scope_fk" foreign key ("tenant_id", "source_id", "account_id") references "erp_financials"."accounts" ("tenant_id", "source_id", "account_id") on update restrict on delete restrict,
  add constraint "ledger_postings_party_scope_fk" foreign key ("tenant_id", "source_id", "party_id") references "erp_financials"."parties" ("tenant_id", "source_id", "party_id") on update restrict on delete restrict,
  add constraint "ledger_postings_item_scope_fk" foreign key ("tenant_id", "source_id", "item_id") references "erp_financials"."items" ("tenant_id", "source_id", "item_id") on update restrict on delete restrict;

alter table "erp_financials"."posting_rules"
  add constraint "posting_rules_source_scope_fk" foreign key ("tenant_id", "source_id") references "erp_financials"."accounting_sources" ("tenant_id", "source_id") on update restrict on delete restrict;

alter table "erp_financials"."transaction_match_candidates"
  add constraint "transaction_match_candidates_origin_scope_fk" foreign key ("tenant_id", "source_id", "origin_transaction_id") references "erp_financials"."transactions" ("tenant_id", "source_id", "transaction_id") on update restrict on delete restrict,
  add constraint "transaction_match_candidates_target_scope_fk" foreign key ("tenant_id", "source_id", "target_transaction_id") references "erp_financials"."transactions" ("tenant_id", "source_id", "transaction_id") on update restrict on delete restrict;

alter table "erp_financials"."transaction_match_decisions"
  add constraint "transaction_match_decisions_candidate_scope_fk" foreign key ("tenant_id", "source_id", "match_candidate_id") references "erp_financials"."transaction_match_candidates" ("tenant_id", "source_id", "match_candidate_id") on update restrict on delete restrict;

alter table "erp_financials"."payment_applications"
  add constraint "payment_applications_payment_scope_fk" foreign key ("tenant_id", "source_id", "payment_transaction_id") references "erp_financials"."transactions" ("tenant_id", "source_id", "transaction_id") on update restrict on delete restrict,
  add constraint "payment_applications_invoice_scope_fk" foreign key ("tenant_id", "source_id", "invoice_transaction_id") references "erp_financials"."transactions" ("tenant_id", "source_id", "transaction_id") on update restrict on delete restrict,
  add constraint "payment_applications_decision_scope_fk" foreign key ("tenant_id", "source_id", "match_decision_id") references "erp_financials"."transaction_match_decisions" ("tenant_id", "source_id", "match_decision_id") on update restrict on delete restrict;

alter table "erp_financials"."rollup_buckets"
  add constraint "rollup_buckets_company_source_scope_fk" foreign key ("tenant_id", "company_id", "source_id") references "erp_financials"."company_sources" ("tenant_id", "company_id", "source_id") on update restrict on delete restrict,
  add constraint "rollup_buckets_account_scope_fk" foreign key ("tenant_id", "source_id", "account_id") references "erp_financials"."accounts" ("tenant_id", "source_id", "account_id") on update restrict on delete restrict;

alter table "erp_financials"."import_batches"
  add constraint "import_batches_source_scope_fk" foreign key ("tenant_id", "source_id") references "erp_financials"."accounting_sources" ("tenant_id", "source_id") on update restrict on delete restrict;

alter table "erp_financials"."sync_checkpoints"
  add constraint "sync_checkpoints_source_scope_fk" foreign key ("tenant_id", "source_id") references "erp_financials"."accounting_sources" ("tenant_id", "source_id") on update restrict on delete restrict;

alter table "erp_financials"."report_freshness"
  add constraint "report_freshness_company_source_scope_fk" foreign key ("tenant_id", "company_id", "source_id") references "erp_financials"."company_sources" ("tenant_id", "company_id", "source_id") on update restrict on delete restrict;

alter table "erp_financials"."report_snapshots"
  add constraint "report_snapshots_company_source_scope_fk" foreign key ("tenant_id", "company_id", "source_id") references "erp_financials"."company_sources" ("tenant_id", "company_id", "source_id") on update restrict on delete restrict;

alter table "erp_financials"."report_snapshot_lines"
  add constraint "report_snapshot_lines_snapshot_scope_fk" foreign key ("tenant_id", "company_id", "source_id", "report_snapshot_id") references "erp_financials"."report_snapshots" ("tenant_id", "company_id", "source_id", "report_snapshot_id") on update restrict on delete restrict,
  add constraint "report_snapshot_lines_parent_scope_fk" foreign key ("tenant_id", "company_id", "source_id", "parent_report_line_id") references "erp_financials"."report_snapshot_lines" ("tenant_id", "company_id", "source_id", "report_line_id") on update restrict on delete restrict,
  add constraint "report_snapshot_lines_account_scope_fk" foreign key ("tenant_id", "source_id", "account_id") references "erp_financials"."accounts" ("tenant_id", "source_id", "account_id") on update restrict on delete restrict;

alter table "erp_financials"."report_snapshot_totals"
  add constraint "report_snapshot_totals_snapshot_scope_fk" foreign key ("tenant_id", "company_id", "source_id", "report_snapshot_id") references "erp_financials"."report_snapshots" ("tenant_id", "company_id", "source_id", "report_snapshot_id") on update restrict on delete restrict;

create function "erp_financials"."reject_posted_journal_mutation"()
returns trigger
language plpgsql
as $posted_journal_guard$
begin
  if old."status" = 'posted'
    and old."source_transaction_type" = 'JournalEntry'
    and (tg_op = 'DELETE' or new is distinct from old)
  then
    raise exception 'posted journal entries are immutable; create a linked reversal or replacement';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$posted_journal_guard$;

create trigger "transactions_posted_journal_immutable"
before update or delete on "erp_financials"."transactions"
for each row execute function "erp_financials"."reject_posted_journal_mutation"();

create function "erp_financials"."reject_posted_journal_child_mutation"()
returns trigger
language plpgsql
as $posted_journal_child_guard$
declare
  parent_is_posted_journal boolean;
begin
  select transactions."status" = 'posted' and transactions."source_transaction_type" = 'JournalEntry'
  into parent_is_posted_journal
  from "erp_financials"."transactions" transactions
  where transactions."tenant_id" = old."tenant_id"
    and transactions."source_id" = old."source_id"
    and transactions."transaction_id" = old."transaction_id";
  if coalesce(parent_is_posted_journal, false) and (tg_op = 'DELETE' or new is distinct from old) then
    raise exception 'posted journal entry facts are immutable; create a linked reversal or replacement';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$posted_journal_child_guard$;

create trigger "transaction_lines_posted_journal_immutable"
before update or delete on "erp_financials"."transaction_lines"
for each row execute function "erp_financials"."reject_posted_journal_child_mutation"();

create trigger "ledger_postings_posted_journal_immutable"
before update or delete on "erp_financials"."ledger_postings"
for each row execute function "erp_financials"."reject_posted_journal_child_mutation"();
