create table "erp_financials"."reporting_books" (
  "book_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "name" text not null,
  "base_currency_code" text not null,
  "accounting_basis" text not null,
  "status" text not null,
  "created_at" timestamptz not null,
  "updated_at" timestamptz not null,
  constraint "reporting_books_pkey" primary key ("tenant_id", "company_id", "book_id"),
  constraint "reporting_books_basis_check" check ("accounting_basis" in ('accrual', 'cash', 'modified_cash')),
  constraint "reporting_books_status_check" check ("status" in ('active', 'archived')),
  constraint "reporting_books_timestamp_check" check ("updated_at" >= "created_at")
);

create unique index "reporting_books_scope_uidx"
  on "erp_financials"."reporting_books" ("tenant_id", "company_id", "book_id");
create unique index "reporting_books_name_uidx"
  on "erp_financials"."reporting_books" ("tenant_id", "company_id", "name");
create unique index "reporting_books_currency_scope_uidx"
  on "erp_financials"."reporting_books" ("tenant_id", "company_id", "book_id", "base_currency_code");

alter table "erp_financials"."reporting_books"
  add constraint "reporting_books_company_scope_fk"
  foreign key ("tenant_id", "company_id")
  references "erp_financials"."accounting_companies" ("tenant_id", "company_id")
  on update restrict on delete restrict;

create function "erp_financials"."guard_reporting_book_identity"()
returns trigger
language plpgsql
as $reporting_book_guard$
begin
  if new."tenant_id" is distinct from old."tenant_id"
    or new."company_id" is distinct from old."company_id"
    or new."book_id" is distinct from old."book_id"
    or new."base_currency_code" is distinct from old."base_currency_code"
    or new."accounting_basis" is distinct from old."accounting_basis"
    or new."created_at" is distinct from old."created_at"
  then
    raise exception 'reporting-book identity, base currency, and accounting basis are immutable';
  end if;
  return new;
end
$reporting_book_guard$;

create trigger "reporting_books_identity_immutable"
before update on "erp_financials"."reporting_books"
for each row execute function "erp_financials"."guard_reporting_book_identity"();

create table "erp_financials"."reporting_book_sources" (
  "book_source_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "book_id" text not null,
  "source_id" text not null,
  "source_role" text not null,
  "effective_from" date,
  "effective_through" date,
  "created_at" timestamptz not null,
  constraint "reporting_book_sources_pkey" primary key ("book_source_id"),
  constraint "reporting_book_sources_role_check" check ("source_role" in ('historical', 'active', 'adjustment')),
  constraint "reporting_book_sources_window_check" check (
    "effective_from" is null or "effective_through" is null or "effective_from" <= "effective_through"
  )
);

create unique index "reporting_book_sources_identity_uidx"
  on "erp_financials"."reporting_book_sources" ("tenant_id", "company_id", "book_id", "source_id");
create index "reporting_book_sources_window_idx"
  on "erp_financials"."reporting_book_sources" ("tenant_id", "company_id", "book_id", "effective_from", "effective_through");

alter table "erp_financials"."reporting_book_sources"
  add constraint "reporting_book_sources_book_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id")
  references "erp_financials"."reporting_books" ("tenant_id", "company_id", "book_id")
  on update restrict on delete restrict,
  add constraint "reporting_book_sources_company_source_scope_fk"
  foreign key ("tenant_id", "company_id", "source_id")
  references "erp_financials"."company_sources" ("tenant_id", "company_id", "source_id")
  on update restrict on delete restrict;

create function "erp_financials"."reject_overlapping_primary_book_source"()
returns trigger
language plpgsql
as $reporting_book_source_overlap$
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'reporting-book-sources:' || new."tenant_id" || ':' || new."company_id" || ':' || new."book_id",
    0
  ));
  if new."source_role" <> 'adjustment' and exists (
    select 1
    from "erp_financials"."reporting_book_sources" existing
    where existing."tenant_id" = new."tenant_id"
      and existing."company_id" = new."company_id"
      and existing."book_id" = new."book_id"
      and existing."book_source_id" <> new."book_source_id"
      and existing."source_role" <> 'adjustment'
      and daterange(
        coalesce(existing."effective_from", '-infinity'::date),
        coalesce(existing."effective_through", 'infinity'::date),
        '[]'
      ) && daterange(
        coalesce(new."effective_from", '-infinity'::date),
        coalesce(new."effective_through", 'infinity'::date),
        '[]'
      )
  ) then
    raise exception 'historical and active reporting-book source windows cannot overlap; adjustment sources may overlap';
  end if;
  return new;
end
$reporting_book_source_overlap$;

create trigger "reporting_book_sources_no_primary_overlap"
before insert or update of "tenant_id", "company_id", "book_id", "source_role", "effective_from", "effective_through"
on "erp_financials"."reporting_book_sources"
for each row execute function "erp_financials"."reject_overlapping_primary_book_source"();

create function "erp_financials"."guard_reporting_book_source_mutation"()
returns trigger
language plpgsql
as $reporting_book_source_guard$
begin
  if new."tenant_id" is distinct from old."tenant_id"
    or new."company_id" is distinct from old."company_id"
    or new."book_id" is distinct from old."book_id"
    or new."source_id" is distinct from old."source_id"
    or new."book_source_id" is distinct from old."book_source_id"
    or new."created_at" is distinct from old."created_at"
  then
    raise exception 'reporting-book source identity is immutable';
  end if;
  return new;
end
$reporting_book_source_guard$;

create trigger "reporting_book_sources_identity_immutable"
before update on "erp_financials"."reporting_book_sources"
for each row execute function "erp_financials"."guard_reporting_book_source_mutation"();

create table "erp_financials"."reporting_book_accounts" (
  "book_account_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "book_id" text not null,
  "book_account_key" text not null,
  "account_number" text,
  "name" text not null,
  "classification" text not null,
  "account_type" text,
  "account_subtype" text,
  "parent_book_account_key" text,
  "currency_code" text,
  "active" boolean not null,
  "created_at" timestamptz not null,
  "updated_at" timestamptz not null,
  constraint "reporting_book_accounts_pkey" primary key ("book_account_id"),
  constraint "reporting_book_accounts_classification_check" check (
    "classification" in ('asset', 'liability', 'equity', 'income', 'cost_of_goods_sold', 'expense', 'other_income', 'other_expense')
  ),
  constraint "reporting_book_accounts_no_self_parent_check" check (
    "parent_book_account_key" is null or "parent_book_account_key" <> "book_account_key"
  ),
  constraint "reporting_book_accounts_timestamp_check" check ("updated_at" >= "created_at")
);

create unique index "reporting_book_accounts_key_uidx"
  on "erp_financials"."reporting_book_accounts" ("tenant_id", "company_id", "book_id", "book_account_key");
create unique index "reporting_book_accounts_scope_uidx"
  on "erp_financials"."reporting_book_accounts" ("tenant_id", "company_id", "book_id", "book_account_id");
create index "reporting_book_accounts_parent_idx"
  on "erp_financials"."reporting_book_accounts" ("tenant_id", "company_id", "book_id", "parent_book_account_key");

alter table "erp_financials"."reporting_book_accounts"
  add constraint "reporting_book_accounts_book_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id")
  references "erp_financials"."reporting_books" ("tenant_id", "company_id", "book_id")
  on update restrict on delete restrict,
  add constraint "reporting_book_accounts_book_currency_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id", "currency_code")
  references "erp_financials"."reporting_books" ("tenant_id", "company_id", "book_id", "base_currency_code")
  on update restrict on delete restrict;

create function "erp_financials"."validate_reporting_book_account_hierarchy"()
returns trigger
language plpgsql
as $reporting_book_account_hierarchy$
declare
  parent_classification text;
  cycle_found boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'reporting-book-accounts:' || new."tenant_id" || ':' || new."company_id" || ':' || new."book_id",
    0
  ));
  if new."parent_book_account_key" is not null then
    select parent."classification" into parent_classification
    from "erp_financials"."reporting_book_accounts" parent
    where parent."tenant_id" = new."tenant_id" and parent."company_id" = new."company_id"
      and parent."book_id" = new."book_id" and parent."book_account_key" = new."parent_book_account_key"
    for key share;
    if parent_classification is null or parent_classification <> new."classification" then
      raise exception 'reporting-book account parent must exist in the book and share its classification';
    end if;
    with recursive ancestors as (
      select account."book_account_key", account."parent_book_account_key"
      from "erp_financials"."reporting_book_accounts" account
      where account."tenant_id" = new."tenant_id" and account."company_id" = new."company_id"
        and account."book_id" = new."book_id" and account."book_account_key" = new."parent_book_account_key"
      union all
      select parent."book_account_key", parent."parent_book_account_key"
      from "erp_financials"."reporting_book_accounts" parent
      join ancestors child on child."parent_book_account_key" = parent."book_account_key"
      where parent."tenant_id" = new."tenant_id" and parent."company_id" = new."company_id" and parent."book_id" = new."book_id"
    )
    select exists (select 1 from ancestors where "book_account_key" = new."book_account_key") into cycle_found;
    if cycle_found then
      raise exception 'reporting-book account hierarchy cannot contain a cycle';
    end if;
  end if;
  if exists (
    select 1 from "erp_financials"."reporting_book_accounts" child
    where child."tenant_id" = new."tenant_id" and child."company_id" = new."company_id"
      and child."book_id" = new."book_id" and child."parent_book_account_key" = new."book_account_key"
      and child."classification" <> new."classification"
  ) then
    raise exception 'reporting-book account and children must share a classification';
  end if;
  if exists (
    select 1
    from "erp_financials"."reporting_book_account_mappings" mapping
    join "erp_financials"."accounts" source_account
      on source_account."tenant_id" = mapping."tenant_id" and source_account."source_id" = mapping."source_id"
     and source_account."account_id" = mapping."account_id"
    where mapping."tenant_id" = new."tenant_id" and mapping."company_id" = new."company_id"
      and mapping."book_id" = new."book_id" and mapping."book_account_key" = new."book_account_key"
      and source_account."classification" <> new."classification"
  ) then
    raise exception 'reporting-book account classification must match every mapped source account';
  end if;
  return new;
end
$reporting_book_account_hierarchy$;

create trigger "reporting_book_accounts_validate_hierarchy"
before insert or update of "tenant_id", "company_id", "book_id", "book_account_key", "classification", "parent_book_account_key"
on "erp_financials"."reporting_book_accounts"
for each row execute function "erp_financials"."validate_reporting_book_account_hierarchy"();

create table "erp_financials"."reporting_book_account_mappings" (
  "book_account_mapping_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "book_id" text not null,
  "source_id" text not null,
  "account_id" text not null,
  "book_account_key" text not null,
  "created_at" timestamptz not null,
  "updated_at" timestamptz not null,
  constraint "reporting_book_account_mappings_pkey" primary key ("book_account_mapping_id"),
  constraint "reporting_book_account_mappings_timestamp_check" check ("updated_at" >= "created_at")
);

create unique index "reporting_book_account_mappings_source_uidx"
  on "erp_financials"."reporting_book_account_mappings"
  ("tenant_id", "company_id", "book_id", "source_id", "account_id");
create index "reporting_book_account_mappings_book_key_idx"
  on "erp_financials"."reporting_book_account_mappings"
  ("tenant_id", "company_id", "book_id", "book_account_key");

alter table "erp_financials"."reporting_book_account_mappings"
  add constraint "reporting_book_account_mappings_book_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id")
  references "erp_financials"."reporting_books" ("tenant_id", "company_id", "book_id")
  on update restrict on delete restrict,
  add constraint "reporting_book_account_mappings_book_source_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id", "source_id")
  references "erp_financials"."reporting_book_sources" ("tenant_id", "company_id", "book_id", "source_id")
  on update restrict on delete restrict,
  add constraint "reporting_book_account_mappings_account_scope_fk"
  foreign key ("tenant_id", "source_id", "account_id")
  references "erp_financials"."accounts" ("tenant_id", "source_id", "account_id")
  on update restrict on delete restrict,
  add constraint "reporting_book_account_mappings_book_account_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id", "book_account_key")
  references "erp_financials"."reporting_book_accounts" ("tenant_id", "company_id", "book_id", "book_account_key")
  on update restrict on delete restrict;

create function "erp_financials"."validate_reporting_book_account_mapping"()
returns trigger
language plpgsql
as $reporting_book_account_mapping$
declare
  source_classification text;
  book_classification text;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'reporting-book-accounts:' || new."tenant_id" || ':' || new."company_id" || ':' || new."book_id",
    0
  ));
  select account."classification" into source_classification
  from "erp_financials"."accounts" account
  where account."tenant_id" = new."tenant_id" and account."source_id" = new."source_id" and account."account_id" = new."account_id"
  for key share;
  select account."classification" into book_classification
  from "erp_financials"."reporting_book_accounts" account
  where account."tenant_id" = new."tenant_id" and account."company_id" = new."company_id"
    and account."book_id" = new."book_id" and account."book_account_key" = new."book_account_key"
  for key share;
  if source_classification is null or book_classification is null or source_classification <> book_classification then
    raise exception 'source and reporting-book account mappings must have equal classifications';
  end if;
  if tg_op = 'UPDATE' and (
    new."tenant_id" is distinct from old."tenant_id"
    or new."company_id" is distinct from old."company_id"
    or new."book_id" is distinct from old."book_id"
    or new."source_id" is distinct from old."source_id"
    or new."account_id" is distinct from old."account_id"
    or new."book_account_mapping_id" is distinct from old."book_account_mapping_id"
    or new."created_at" is distinct from old."created_at"
  ) then
    raise exception 'reporting-book source-account mapping identity is immutable';
  end if;
  return new;
end
$reporting_book_account_mapping$;

create trigger "reporting_book_account_mappings_validate"
before insert or update on "erp_financials"."reporting_book_account_mappings"
for each row execute function "erp_financials"."validate_reporting_book_account_mapping"();

create table "erp_financials"."financial_outbox" (
  "outbox_event_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "book_id" text,
  "source_id" text not null,
  "event_type" text not null,
  "aggregate_type" text not null,
  "aggregate_id" text not null,
  "idempotency_key" text not null,
  "payload" jsonb not null,
  "status" text not null,
  "attempt_count" integer not null,
  "available_at" timestamptz not null,
  "lease_expires_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz not null,
  "published_at" timestamptz,
  constraint "financial_outbox_pkey" primary key ("outbox_event_id"),
  constraint "financial_outbox_status_check" check ("status" in ('pending', 'processing', 'published', 'failed')),
  constraint "financial_outbox_attempt_check" check ("attempt_count" >= 0),
  constraint "financial_outbox_payload_bounded_json_check" check (octet_length(coalesce("payload"::text, '')) <= 4096),
  constraint "financial_outbox_published_check" check (
    ("status" = 'published' and "published_at" is not null) or ("status" <> 'published' and "published_at" is null)
  )
);

create unique index "financial_outbox_idempotency_uidx"
  on "erp_financials"."financial_outbox" ("tenant_id", "company_id", "source_id", "idempotency_key");
create index "financial_outbox_delivery_idx"
  on "erp_financials"."financial_outbox" ("status", "available_at", "lease_expires_at", "created_at");

alter table "erp_financials"."financial_outbox"
  add constraint "financial_outbox_company_source_scope_fk"
  foreign key ("tenant_id", "company_id", "source_id")
  references "erp_financials"."company_sources" ("tenant_id", "company_id", "source_id")
  on update restrict on delete restrict,
  add constraint "financial_outbox_book_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id")
  references "erp_financials"."reporting_books" ("tenant_id", "company_id", "book_id")
  on update restrict on delete restrict,
  add constraint "financial_outbox_book_source_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id", "source_id")
  references "erp_financials"."reporting_book_sources" ("tenant_id", "company_id", "book_id", "source_id")
  on update restrict on delete restrict;

create function "erp_financials"."guard_financial_outbox_mutation"()
returns trigger
language plpgsql
as $financial_outbox_guard$
begin
  if tg_op = 'DELETE' then
    raise exception 'financial outbox events cannot be deleted';
  end if;
  if new."tenant_id" is distinct from old."tenant_id"
    or new."company_id" is distinct from old."company_id"
    or new."book_id" is distinct from old."book_id"
    or new."source_id" is distinct from old."source_id"
    or new."outbox_event_id" is distinct from old."outbox_event_id"
    or new."event_type" is distinct from old."event_type"
    or new."aggregate_type" is distinct from old."aggregate_type"
    or new."aggregate_id" is distinct from old."aggregate_id"
    or new."idempotency_key" is distinct from old."idempotency_key"
    or new."payload" is distinct from old."payload"
    or new."created_at" is distinct from old."created_at"
    or (old."status" = 'published' and new."status" <> 'published')
  then
    raise exception 'financial outbox event identity and payload are immutable';
  end if;
  return new;
end
$financial_outbox_guard$;

create trigger "financial_outbox_guard"
before update or delete on "erp_financials"."financial_outbox"
for each row execute function "erp_financials"."guard_financial_outbox_mutation"();

create unique index "transaction_match_decisions_candidate_identity_uidx"
  on "erp_financials"."transaction_match_decisions"
  ("tenant_id", "source_id", "match_candidate_id", "match_decision_id");
create unique index "transaction_match_decisions_terminal_uidx"
  on "erp_financials"."transaction_match_decisions" ("tenant_id", "source_id", "match_candidate_id")
  where "decision" in ('accepted', 'rejected');

alter table "erp_financials"."subledger_applications"
  add column "match_candidate_id" text,
  add column "match_decision_id" text,
  add column "match_method" text,
  add column "match_score" numeric,
  add column "match_evidence" jsonb,
  add constraint "subledger_applications_match_method_check"
    check ("match_method" is null or "match_method" in ('automatic', 'manual')),
  add constraint "subledger_applications_match_score_check"
    check ("match_score" is null or ("match_score" >= 0 and "match_score" <= 1)),
  add constraint "subledger_applications_match_shape_check"
    check (
      num_nonnulls("match_candidate_id", "match_decision_id", "match_method", "match_score") in (0, 4)
      and ("match_candidate_id" is not null or "match_evidence" is null)
    ),
  add constraint "subledger_applications_match_evidence_bounded_json_check"
    check (octet_length(coalesce("match_evidence"::text, '')) <= 4096),
  add constraint "subledger_applications_match_candidate_scope_fk"
    foreign key ("tenant_id", "source_id", "match_candidate_id")
    references "erp_financials"."transaction_match_candidates" ("tenant_id", "source_id", "match_candidate_id")
    on update restrict on delete restrict,
  add constraint "subledger_applications_match_candidate_decision_scope_fk"
    foreign key ("tenant_id", "source_id", "match_candidate_id", "match_decision_id")
    references "erp_financials"."transaction_match_decisions" ("tenant_id", "source_id", "match_candidate_id", "match_decision_id")
    on update restrict on delete restrict;

create function "erp_financials"."guard_subledger_application_match_evidence"()
returns trigger
language plpgsql
as $subledger_application_match_guard$
begin
  if new."match_candidate_id" is distinct from old."match_candidate_id"
    or new."match_decision_id" is distinct from old."match_decision_id"
    or new."match_method" is distinct from old."match_method"
    or new."match_score" is distinct from old."match_score"
    or new."match_evidence" is distinct from old."match_evidence"
  then
    raise exception 'subledger application match evidence is immutable';
  end if;
  return new;
end
$subledger_application_match_guard$;

create trigger "subledger_applications_match_evidence_immutable"
before update on "erp_financials"."subledger_applications"
for each row execute function "erp_financials"."guard_subledger_application_match_evidence"();

create function "erp_financials"."reject_sdk_immutable_mutation"()
returns trigger
language plpgsql
as $sdk_immutable_guard$
begin
  raise exception '% is append-only and cannot be updated or deleted', tg_table_name;
end
$sdk_immutable_guard$;

create trigger "transaction_match_decisions_immutable"
before update or delete on "erp_financials"."transaction_match_decisions"
for each row execute function "erp_financials"."reject_sdk_immutable_mutation"();

create table "erp_financials"."invoice_drafts" (
  "invoice_draft_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "book_id" text not null,
  "source_id" text not null,
  "customer_id" text not null,
  "receivable_account_id" text not null,
  "document_number" text,
  "document_date" date not null,
  "due_date" date not null,
  "currency_code" text not null,
  "memo" text,
  "status" text not null,
  "version" integer not null,
  "idempotency_key" text not null,
  "issue_idempotency_key" text,
  "issued_document_id" text,
  "metadata" jsonb not null,
  "created_at" timestamptz not null,
  "updated_at" timestamptz not null,
  constraint "invoice_drafts_pkey" primary key ("invoice_draft_id"),
  constraint "invoice_drafts_status_check" check ("status" in ('draft', 'issued', 'voided')),
  constraint "invoice_drafts_version_check" check ("version" >= 1),
  constraint "invoice_drafts_due_date_check" check ("due_date" >= "document_date"),
  constraint "invoice_drafts_issued_check" check (
    ("status" = 'issued' and "issued_document_id" is not null and "issue_idempotency_key" is not null) or
    ("status" <> 'issued' and "issued_document_id" is null and "issue_idempotency_key" is null)
  ),
  constraint "invoice_drafts_metadata_bounded_json_check" check (octet_length(coalesce("metadata"::text, '')) <= 4096),
  constraint "invoice_drafts_metadata_shape_check" check (jsonb_typeof("metadata") = 'object'),
  constraint "invoice_drafts_timestamp_check" check ("updated_at" >= "created_at")
);

create unique index "invoice_drafts_idempotency_uidx"
  on "erp_financials"."invoice_drafts" ("tenant_id", "company_id", "book_id", "idempotency_key");
create unique index "invoice_drafts_scope_uidx"
  on "erp_financials"."invoice_drafts" ("tenant_id", "company_id", "book_id", "invoice_draft_id");
create index "invoice_drafts_list_idx"
  on "erp_financials"."invoice_drafts" ("tenant_id", "company_id", "book_id", "status", "document_date", "invoice_draft_id");

alter table "erp_financials"."invoice_drafts"
  add constraint "invoice_drafts_book_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id")
  references "erp_financials"."reporting_books" ("tenant_id", "company_id", "book_id")
  on update restrict on delete restrict,
  add constraint "invoice_drafts_book_source_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id", "source_id")
  references "erp_financials"."reporting_book_sources" ("tenant_id", "company_id", "book_id", "source_id")
  on update restrict on delete restrict,
  add constraint "invoice_drafts_customer_scope_fk"
  foreign key ("tenant_id", "source_id", "customer_id")
  references "erp_financials"."parties" ("tenant_id", "source_id", "party_id")
  on update restrict on delete restrict,
  add constraint "invoice_drafts_receivable_account_scope_fk"
  foreign key ("tenant_id", "source_id", "receivable_account_id")
  references "erp_financials"."accounts" ("tenant_id", "source_id", "account_id")
  on update restrict on delete restrict,
  add constraint "invoice_drafts_issued_document_scope_fk"
  foreign key ("tenant_id", "company_id", "source_id", "issued_document_id")
  references "erp_financials"."subledger_documents" ("tenant_id", "company_id", "source_id", "subledger_document_id")
  on update restrict on delete restrict;

create function "erp_financials"."guard_invoice_draft_mutation"()
returns trigger
language plpgsql
as $invoice_draft_guard$
begin
  if tg_op = 'INSERT' then
    if new."status" <> 'draft' or new."version" <> 1 or new."issued_document_id" is not null or new."issue_idempotency_key" is not null then
      raise exception 'new invoice drafts must begin in draft status at version 1';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'invoice drafts cannot be deleted';
  end if;
  if old."status" <> 'draft' then
    raise exception 'issued and voided invoice drafts are terminal';
  end if;
  if new."status" not in ('draft', 'issued', 'voided') or new."version" <> old."version" + 1
    or new."tenant_id" is distinct from old."tenant_id"
    or new."company_id" is distinct from old."company_id"
    or new."book_id" is distinct from old."book_id"
    or new."source_id" is distinct from old."source_id"
    or new."invoice_draft_id" is distinct from old."invoice_draft_id"
    or new."idempotency_key" is distinct from old."idempotency_key"
    or new."created_at" is distinct from old."created_at"
    or new."updated_at" < old."updated_at"
  then
    raise exception 'invoice draft mutation violates its versioned lifecycle';
  end if;
  return new;
end
$invoice_draft_guard$;

create trigger "invoice_drafts_guard"
before insert or update or delete on "erp_financials"."invoice_drafts"
for each row execute function "erp_financials"."guard_invoice_draft_mutation"();

create table "erp_financials"."invoice_draft_lines" (
  "invoice_draft_line_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "book_id" text not null,
  "source_id" text not null,
  "invoice_draft_id" text not null,
  "line_number" integer not null,
  "account_id" text not null,
  "item_id" text,
  "description" text,
  "quantity" numeric not null,
  "unit_amount" numeric not null,
  "discount_amount" numeric not null,
  "tax_code" text,
  "tax_amount" numeric not null,
  "service_period_start" date,
  "service_period_end" date,
  "dimension_refs" jsonb not null,
  "line_amount" numeric not null,
  constraint "invoice_draft_lines_pkey" primary key ("invoice_draft_line_id"),
  constraint "invoice_draft_lines_number_check" check ("line_number" > 0),
  constraint "invoice_draft_lines_amount_check" check (
    "quantity" > 0 and "unit_amount" >= 0 and "discount_amount" >= 0 and "tax_amount" >= 0 and "line_amount" > 0
  ),
  constraint "invoice_draft_lines_scale_check" check (
    scale("quantity") <= 4 and scale("unit_amount") <= 2 and scale("discount_amount") <= 2
      and scale("tax_amount") <= 2 and scale("line_amount") <= 2
  ),
  constraint "invoice_draft_lines_arithmetic_check" check (
    "discount_amount" <= round("quantity" * "unit_amount", 2)
      and "line_amount" = round("quantity" * "unit_amount", 2) - "discount_amount" + "tax_amount"
  ),
  constraint "invoice_draft_lines_service_period_check" check (
    "service_period_start" is null or "service_period_end" is null or "service_period_start" <= "service_period_end"
  ),
  constraint "invoice_draft_lines_dimension_refs_bounded_json_check" check (octet_length(coalesce("dimension_refs"::text, '')) <= 4096),
  constraint "invoice_draft_lines_dimension_refs_shape_check" check (jsonb_typeof("dimension_refs") = 'array')
);

create unique index "invoice_draft_lines_order_uidx"
  on "erp_financials"."invoice_draft_lines" ("tenant_id", "company_id", "book_id", "invoice_draft_id", "line_number");

create unique index "invoice_drafts_source_scope_uidx"
  on "erp_financials"."invoice_drafts" ("tenant_id", "company_id", "book_id", "source_id", "invoice_draft_id");

alter table "erp_financials"."invoice_draft_lines"
  add constraint "invoice_draft_lines_draft_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id", "source_id", "invoice_draft_id")
  references "erp_financials"."invoice_drafts" ("tenant_id", "company_id", "book_id", "source_id", "invoice_draft_id")
  on update restrict on delete restrict,
  add constraint "invoice_draft_lines_account_scope_fk"
  foreign key ("tenant_id", "source_id", "account_id")
  references "erp_financials"."accounts" ("tenant_id", "source_id", "account_id")
  on update restrict on delete restrict,
  add constraint "invoice_draft_lines_item_scope_fk"
  foreign key ("tenant_id", "source_id", "item_id")
  references "erp_financials"."items" ("tenant_id", "source_id", "item_id")
  on update restrict on delete restrict;

create function "erp_financials"."guard_invoice_draft_line_mutation"()
returns trigger
language plpgsql
as $invoice_draft_line_guard$
declare
  parent_status text;
begin
  if tg_op = 'DELETE' then
    select draft."status" into parent_status
    from "erp_financials"."invoice_drafts" draft
    where draft."tenant_id" = old."tenant_id" and draft."company_id" = old."company_id"
      and draft."book_id" = old."book_id" and draft."source_id" = old."source_id"
      and draft."invoice_draft_id" = old."invoice_draft_id"
    for key share;
  else
    select draft."status" into parent_status
    from "erp_financials"."invoice_drafts" draft
    where draft."tenant_id" = new."tenant_id" and draft."company_id" = new."company_id"
      and draft."book_id" = new."book_id" and draft."source_id" = new."source_id"
      and draft."invoice_draft_id" = new."invoice_draft_id"
    for key share;
  end if;
  if parent_status is null or parent_status <> 'draft' then
    raise exception 'invoice draft lines can only change while their parent is draft';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$invoice_draft_line_guard$;

create trigger "invoice_draft_lines_guard"
before insert or update or delete on "erp_financials"."invoice_draft_lines"
for each row execute function "erp_financials"."guard_invoice_draft_line_mutation"();

create table "erp_financials"."subledger_document_lines" (
  "subledger_document_line_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "source_id" text not null,
  "subledger_document_id" text not null,
  "line_number" integer not null,
  "account_id" text not null,
  "item_id" text,
  "description" text,
  "quantity" numeric not null,
  "unit_amount" numeric not null,
  "discount_amount" numeric not null,
  "tax_code" text,
  "tax_amount" numeric not null,
  "service_period_start" date,
  "service_period_end" date,
  "dimension_refs" jsonb not null,
  "line_amount" numeric not null,
  constraint "subledger_document_lines_pkey" primary key ("subledger_document_line_id"),
  constraint "subledger_document_lines_number_check" check ("line_number" > 0),
  constraint "subledger_document_lines_amount_check" check (
    "quantity" > 0 and "unit_amount" >= 0 and "discount_amount" >= 0 and "tax_amount" >= 0 and "line_amount" > 0
  ),
  constraint "subledger_document_lines_scale_check" check (
    scale("quantity") <= 4 and scale("unit_amount") <= 2 and scale("discount_amount") <= 2
      and scale("tax_amount") <= 2 and scale("line_amount") <= 2
  ),
  constraint "subledger_document_lines_arithmetic_check" check (
    "discount_amount" <= round("quantity" * "unit_amount", 2)
      and "line_amount" = round("quantity" * "unit_amount", 2) - "discount_amount" + "tax_amount"
  ),
  constraint "subledger_document_lines_dimension_refs_bounded_json_check" check (octet_length(coalesce("dimension_refs"::text, '')) <= 4096),
  constraint "subledger_document_lines_dimension_refs_shape_check" check (jsonb_typeof("dimension_refs") = 'array')
);

create unique index "subledger_document_lines_order_uidx"
  on "erp_financials"."subledger_document_lines"
  ("tenant_id", "company_id", "source_id", "subledger_document_id", "line_number");

alter table "erp_financials"."subledger_document_lines"
  add constraint "subledger_document_lines_document_scope_fk"
  foreign key ("tenant_id", "company_id", "source_id", "subledger_document_id")
  references "erp_financials"."subledger_documents" ("tenant_id", "company_id", "source_id", "subledger_document_id")
  on update restrict on delete restrict,
  add constraint "subledger_document_lines_account_scope_fk"
  foreign key ("tenant_id", "source_id", "account_id")
  references "erp_financials"."accounts" ("tenant_id", "source_id", "account_id")
  on update restrict on delete restrict,
  add constraint "subledger_document_lines_item_scope_fk"
  foreign key ("tenant_id", "source_id", "item_id")
  references "erp_financials"."items" ("tenant_id", "source_id", "item_id")
  on update restrict on delete restrict;

create trigger "subledger_document_lines_immutable"
before update or delete on "erp_financials"."subledger_document_lines"
for each row execute function "erp_financials"."reject_sdk_immutable_mutation"();

create table "erp_financials"."subledger_document_delivery_events" (
  "delivery_event_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "source_id" text not null,
  "subledger_document_id" text not null,
  "delivery_status" text not null,
  "channel" text not null,
  "recipient_ref" text,
  "lifecycle_event_id" text not null,
  "occurred_at" timestamptz not null,
  constraint "subledger_document_delivery_events_pkey" primary key ("delivery_event_id"),
  constraint "subledger_document_delivery_events_status_check" check ("delivery_status" in ('sent', 'delivered', 'failed'))
);

create unique index "subledger_document_delivery_events_scope_uidx"
  on "erp_financials"."subledger_document_delivery_events"
  ("tenant_id", "company_id", "source_id", "delivery_event_id");
create index "subledger_document_delivery_events_document_idx"
  on "erp_financials"."subledger_document_delivery_events"
  ("tenant_id", "company_id", "source_id", "subledger_document_id", "occurred_at");

alter table "erp_financials"."subledger_document_delivery_events"
  add constraint "subledger_document_delivery_events_document_scope_fk"
  foreign key ("tenant_id", "company_id", "source_id", "subledger_document_id")
  references "erp_financials"."subledger_documents" ("tenant_id", "company_id", "source_id", "subledger_document_id")
  on update restrict on delete restrict,
  add constraint "subledger_document_delivery_events_event_scope_fk"
  foreign key ("tenant_id", "company_id", "source_id", "lifecycle_event_id")
  references "erp_financials"."financial_lifecycle_events" ("tenant_id", "company_id", "source_id", "event_id")
  on update restrict on delete restrict;

create trigger "subledger_document_delivery_events_immutable"
before update or delete on "erp_financials"."subledger_document_delivery_events"
for each row execute function "erp_financials"."reject_sdk_immutable_mutation"();

create table "erp_financials"."invoice_voids" (
  "invoice_void_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "book_id" text not null,
  "source_id" text not null,
  "invoice_document_id" text not null,
  "credit_document_id" text not null,
  "application_id" text not null,
  "idempotency_key" text not null,
  "lifecycle_event_id" text not null,
  "created_at" timestamptz not null,
  constraint "invoice_voids_pkey" primary key ("invoice_void_id")
);

create unique index "invoice_voids_invoice_uidx"
  on "erp_financials"."invoice_voids" ("tenant_id", "company_id", "book_id", "invoice_document_id");
create unique index "invoice_voids_idempotency_uidx"
  on "erp_financials"."invoice_voids" ("tenant_id", "company_id", "book_id", "idempotency_key");

alter table "erp_financials"."invoice_voids"
  add constraint "invoice_voids_book_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id")
  references "erp_financials"."reporting_books" ("tenant_id", "company_id", "book_id")
  on update restrict on delete restrict,
  add constraint "invoice_voids_book_source_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id", "source_id")
  references "erp_financials"."reporting_book_sources" ("tenant_id", "company_id", "book_id", "source_id")
  on update restrict on delete restrict,
  add constraint "invoice_voids_invoice_scope_fk"
  foreign key ("tenant_id", "company_id", "source_id", "invoice_document_id")
  references "erp_financials"."subledger_documents" ("tenant_id", "company_id", "source_id", "subledger_document_id")
  on update restrict on delete restrict,
  add constraint "invoice_voids_credit_scope_fk"
  foreign key ("tenant_id", "company_id", "source_id", "credit_document_id")
  references "erp_financials"."subledger_documents" ("tenant_id", "company_id", "source_id", "subledger_document_id")
  on update restrict on delete restrict,
  add constraint "invoice_voids_application_scope_fk"
  foreign key ("tenant_id", "company_id", "source_id", "application_id")
  references "erp_financials"."subledger_applications" ("tenant_id", "company_id", "source_id", "subledger_application_id")
  on update restrict on delete restrict,
  add constraint "invoice_voids_event_scope_fk"
  foreign key ("tenant_id", "company_id", "source_id", "lifecycle_event_id")
  references "erp_financials"."financial_lifecycle_events" ("tenant_id", "company_id", "source_id", "event_id")
  on update restrict on delete restrict;

create trigger "invoice_voids_immutable"
before update or delete on "erp_financials"."invoice_voids"
for each row execute function "erp_financials"."reject_sdk_immutable_mutation"();

create table "erp_financials"."bank_statement_lines" (
  "bank_statement_line_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "book_id" text not null,
  "source_id" text not null,
  "bank_account_id" text not null,
  "external_line_id" text not null,
  "posted_date" date not null,
  "amount" numeric not null,
  "currency_code" text not null,
  "description" text,
  "reference" text,
  "status" text not null,
  "version" integer not null,
  "source_payload_ref" jsonb,
  "created_at" timestamptz not null,
  "updated_at" timestamptz not null,
  constraint "bank_statement_lines_pkey" primary key ("bank_statement_line_id"),
  constraint "bank_statement_lines_amount_check" check ("amount" <> 0 and scale("amount") <= 2),
  constraint "bank_statement_lines_status_check" check ("status" in ('unmatched', 'matched', 'ignored')),
  constraint "bank_statement_lines_version_check" check ("version" >= 1),
  constraint "bank_statement_lines_source_payload_ref_bounded_json_check" check (octet_length(coalesce("source_payload_ref"::text, '')) <= 4096),
  constraint "bank_statement_lines_source_payload_ref_shape_check" check (
    "source_payload_ref" is null or jsonb_typeof("source_payload_ref") = 'object'
  ),
  constraint "bank_statement_lines_timestamp_check" check ("updated_at" >= "created_at")
);

create unique index "bank_statement_lines_external_uidx"
  on "erp_financials"."bank_statement_lines" ("tenant_id", "company_id", "book_id", "external_line_id");
create unique index "bank_statement_lines_scope_uidx"
  on "erp_financials"."bank_statement_lines" ("tenant_id", "company_id", "book_id", "bank_statement_line_id");
create unique index "bank_statement_lines_source_scope_uidx"
  on "erp_financials"."bank_statement_lines"
  ("tenant_id", "company_id", "book_id", "source_id", "bank_statement_line_id");
create index "bank_statement_lines_review_idx"
  on "erp_financials"."bank_statement_lines" ("tenant_id", "company_id", "book_id", "status", "posted_date");

alter table "erp_financials"."bank_statement_lines"
  add constraint "bank_statement_lines_book_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id")
  references "erp_financials"."reporting_books" ("tenant_id", "company_id", "book_id")
  on update restrict on delete restrict,
  add constraint "bank_statement_lines_book_source_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id", "source_id")
  references "erp_financials"."reporting_book_sources" ("tenant_id", "company_id", "book_id", "source_id")
  on update restrict on delete restrict,
  add constraint "bank_statement_lines_bank_account_scope_fk"
  foreign key ("tenant_id", "source_id", "bank_account_id")
  references "erp_financials"."accounts" ("tenant_id", "source_id", "account_id")
  on update restrict on delete restrict;

create table "erp_financials"."bank_reconciliation_matches" (
  "bank_reconciliation_match_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "book_id" text not null,
  "source_id" text not null,
  "bank_statement_line_id" text not null,
  "transaction_id" text not null,
  "matched_amount" numeric not null,
  "method" text not null,
  "status" text not null,
  "version" integer not null,
  "idempotency_key" text not null,
  "lifecycle_event_id" text not null,
  "created_at" timestamptz not null,
  "updated_at" timestamptz not null,
  constraint "bank_reconciliation_matches_pkey" primary key ("bank_reconciliation_match_id"),
  constraint "bank_reconciliation_matches_amount_check" check ("matched_amount" > 0),
  constraint "bank_reconciliation_matches_method_check" check ("method" in ('automatic', 'manual')),
  constraint "bank_reconciliation_matches_status_check" check ("status" in ('matched', 'unmatched', 'voided')),
  constraint "bank_reconciliation_matches_version_check" check ("version" >= 1),
  constraint "bank_reconciliation_matches_timestamp_check" check ("updated_at" >= "created_at")
);

create unique index "bank_reconciliation_matches_idempotency_uidx"
  on "erp_financials"."bank_reconciliation_matches" ("tenant_id", "company_id", "book_id", "idempotency_key");
create unique index "bank_reconciliation_matches_active_line_uidx"
  on "erp_financials"."bank_reconciliation_matches" ("tenant_id", "company_id", "book_id", "bank_statement_line_id")
  where "status" = 'matched';
create unique index "bank_reconciliation_matches_active_transaction_uidx"
  on "erp_financials"."bank_reconciliation_matches" ("tenant_id", "source_id", "transaction_id")
  where "status" = 'matched';
create index "bank_reconciliation_matches_transaction_idx"
  on "erp_financials"."bank_reconciliation_matches" ("tenant_id", "source_id", "transaction_id", "status");

alter table "erp_financials"."bank_reconciliation_matches"
  add constraint "bank_reconciliation_matches_book_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id")
  references "erp_financials"."reporting_books" ("tenant_id", "company_id", "book_id")
  on update restrict on delete restrict,
  add constraint "bank_reconciliation_matches_book_source_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id", "source_id")
  references "erp_financials"."reporting_book_sources" ("tenant_id", "company_id", "book_id", "source_id")
  on update restrict on delete restrict,
  add constraint "bank_reconciliation_matches_line_scope_fk"
  foreign key ("tenant_id", "company_id", "book_id", "source_id", "bank_statement_line_id")
  references "erp_financials"."bank_statement_lines" ("tenant_id", "company_id", "book_id", "source_id", "bank_statement_line_id")
  on update restrict on delete restrict,
  add constraint "bank_reconciliation_matches_transaction_scope_fk"
  foreign key ("tenant_id", "source_id", "transaction_id")
  references "erp_financials"."transactions" ("tenant_id", "source_id", "transaction_id")
  on update restrict on delete restrict,
  add constraint "bank_reconciliation_matches_event_scope_fk"
  foreign key ("tenant_id", "company_id", "source_id", "lifecycle_event_id")
  references "erp_financials"."financial_lifecycle_events" ("tenant_id", "company_id", "source_id", "event_id")
  on update restrict on delete restrict;

create function "erp_financials"."guard_bank_statement_line_mutation"()
returns trigger
language plpgsql
as $bank_line_guard$
begin
  if tg_op = 'INSERT' then
    if new."status" <> 'unmatched' or new."version" <> 1 then
      raise exception 'new bank statement lines must begin unmatched at version 1';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'bank statement lines cannot be deleted';
  end if;
  if not (
      (old."status" = 'unmatched' and new."status" in ('matched', 'ignored'))
      or (old."status" = 'matched' and new."status" = 'unmatched')
    )
    or new."version" <> old."version" + 1
    or new."tenant_id" is distinct from old."tenant_id"
    or new."company_id" is distinct from old."company_id"
    or new."book_id" is distinct from old."book_id"
    or new."source_id" is distinct from old."source_id"
    or new."bank_statement_line_id" is distinct from old."bank_statement_line_id"
    or new."bank_account_id" is distinct from old."bank_account_id"
    or new."external_line_id" is distinct from old."external_line_id"
    or new."posted_date" is distinct from old."posted_date"
    or new."amount" is distinct from old."amount"
    or new."currency_code" is distinct from old."currency_code"
    or new."description" is distinct from old."description"
    or new."reference" is distinct from old."reference"
    or new."source_payload_ref" is distinct from old."source_payload_ref"
    or new."created_at" is distinct from old."created_at"
    or new."updated_at" < old."updated_at"
  then
    raise exception 'bank statement line mutation violates its versioned lifecycle';
  end if;
  return new;
end
$bank_line_guard$;

create trigger "bank_statement_lines_guard"
before insert or update or delete on "erp_financials"."bank_statement_lines"
for each row execute function "erp_financials"."guard_bank_statement_line_mutation"();

create function "erp_financials"."guard_bank_reconciliation_match_mutation"()
returns trigger
language plpgsql
as $bank_match_guard$
begin
  if tg_op = 'INSERT' then
    if new."status" <> 'matched' or new."version" <> 1 then
      raise exception 'new bank reconciliation matches must begin matched at version 1';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'bank reconciliation matches cannot be deleted';
  end if;
  if old."status" <> 'matched' or new."status" not in ('unmatched', 'voided')
    or new."version" <> old."version" + 1
    or new."tenant_id" is distinct from old."tenant_id"
    or new."company_id" is distinct from old."company_id"
    or new."book_id" is distinct from old."book_id"
    or new."source_id" is distinct from old."source_id"
    or new."bank_reconciliation_match_id" is distinct from old."bank_reconciliation_match_id"
    or new."bank_statement_line_id" is distinct from old."bank_statement_line_id"
    or new."transaction_id" is distinct from old."transaction_id"
    or new."matched_amount" is distinct from old."matched_amount"
    or new."method" is distinct from old."method"
    or new."idempotency_key" is distinct from old."idempotency_key"
    or new."created_at" is distinct from old."created_at"
    or new."updated_at" < old."updated_at"
  then
    raise exception 'bank reconciliation match mutation violates its versioned lifecycle';
  end if;
  return new;
end
$bank_match_guard$;

create trigger "bank_reconciliation_matches_guard"
before insert or update or delete on "erp_financials"."bank_reconciliation_matches"
for each row execute function "erp_financials"."guard_bank_reconciliation_match_mutation"();
