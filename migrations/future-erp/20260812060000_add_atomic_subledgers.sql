create table "erp_financials"."subledger_documents" (
  "subledger_document_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "source_id" text not null,
  "document_type" text not null,
  "transaction_id" text not null,
  "party_id" text,
  "document_number" text,
  "document_date" date not null,
  "due_date" date,
  "currency_code" text not null,
  "original_amount" numeric not null,
  "open_amount" numeric not null,
  "status" text not null,
  "version" integer not null,
  "idempotency_key" text not null,
  "lifecycle_event_id" text not null,
  "metadata" jsonb not null,
  "created_at" timestamptz not null,
  "updated_at" timestamptz not null,
  constraint "subledger_documents_pkey" primary key ("subledger_document_id"),
  constraint "subledger_documents_type_check" check ("document_type" in ('invoice', 'customer_payment', 'credit_memo', 'refund', 'vendor_bill', 'bill_payment', 'write_off', 'deposit', 'transfer')),
  constraint "subledger_documents_amount_check" check ("original_amount" > 0 and "open_amount" >= 0 and "open_amount" <= "original_amount"),
  constraint "subledger_documents_status_check" check (("status" = 'open' and "open_amount" = "original_amount") or ("status" = 'partially_applied' and "open_amount" > 0 and "open_amount" < "original_amount") or ("status" in ('settled', 'voided') and "open_amount" = 0)),
  constraint "subledger_documents_version_check" check ("version" >= 1),
  constraint "subledger_documents_due_date_check" check ("due_date" is null or "due_date" >= "document_date"),
  constraint "subledger_documents_timestamp_check" check ("updated_at" >= "created_at"),
  constraint "subledger_documents_metadata_bounded_json_check" check (octet_length(coalesce("metadata"::text, '')) <= 4096)
);

create unique index "subledger_documents_idempotency_uidx" on "erp_financials"."subledger_documents" ("tenant_id", "company_id", "source_id", "idempotency_key");
create unique index "subledger_documents_scope_uidx" on "erp_financials"."subledger_documents" ("tenant_id", "company_id", "source_id", "subledger_document_id");
create index "subledger_documents_open_idx" on "erp_financials"."subledger_documents" ("tenant_id", "company_id", "source_id", "document_type", "status", "due_date", "document_date");
create index "subledger_documents_party_idx" on "erp_financials"."subledger_documents" ("tenant_id", "company_id", "source_id", "party_id", "document_type", "status");

alter table "erp_financials"."subledger_documents"
  add constraint "subledger_documents_company_source_scope_fk" foreign key ("tenant_id", "company_id", "source_id") references "erp_financials"."company_sources" ("tenant_id", "company_id", "source_id") on update restrict on delete restrict,
  add constraint "subledger_documents_transaction_scope_fk" foreign key ("tenant_id", "source_id", "transaction_id") references "erp_financials"."transactions" ("tenant_id", "source_id", "transaction_id") on update restrict on delete restrict,
  add constraint "subledger_documents_party_scope_fk" foreign key ("tenant_id", "source_id", "party_id") references "erp_financials"."parties" ("tenant_id", "source_id", "party_id") on update restrict on delete restrict,
  add constraint "subledger_documents_event_scope_fk" foreign key ("tenant_id", "company_id", "source_id", "lifecycle_event_id") references "erp_financials"."financial_lifecycle_events" ("tenant_id", "company_id", "source_id", "event_id") on update restrict on delete restrict;

create table "erp_financials"."subledger_applications" (
  "subledger_application_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "source_id" text not null,
  "application_type" text not null,
  "source_document_id" text not null,
  "target_document_id" text not null,
  "applied_amount" numeric not null,
  "currency_code" text not null,
  "application_date" date not null,
  "status" text not null,
  "version" integer not null,
  "idempotency_key" text not null,
  "applied_event_id" text not null,
  "ended_event_id" text,
  "created_at" timestamptz not null,
  "updated_at" timestamptz not null,
  constraint "subledger_applications_pkey" primary key ("subledger_application_id"),
  constraint "subledger_applications_type_check" check ("application_type" in ('customer_payment_to_invoice', 'bill_payment_to_bill', 'credit_to_invoice')),
  constraint "subledger_applications_amount_check" check ("applied_amount" > 0),
  constraint "subledger_applications_status_check" check ("status" in ('applied', 'unapplied', 'voided')),
  constraint "subledger_applications_version_check" check ("version" >= 1),
  constraint "subledger_applications_distinct_check" check ("source_document_id" <> "target_document_id"),
  constraint "subledger_applications_terminal_event_check" check (("status" = 'applied' and "ended_event_id" is null) or ("status" in ('unapplied', 'voided') and "ended_event_id" is not null)),
  constraint "subledger_applications_timestamp_check" check ("updated_at" >= "created_at")
);

create unique index "subledger_applications_idempotency_uidx" on "erp_financials"."subledger_applications" ("tenant_id", "company_id", "source_id", "idempotency_key");
create unique index "subledger_applications_scope_uidx" on "erp_financials"."subledger_applications" ("tenant_id", "company_id", "source_id", "subledger_application_id");
create index "subledger_applications_source_status_idx" on "erp_financials"."subledger_applications" ("tenant_id", "company_id", "source_id", "source_document_id", "status", "application_date");
create index "subledger_applications_target_status_idx" on "erp_financials"."subledger_applications" ("tenant_id", "company_id", "source_id", "target_document_id", "status", "application_date");

alter table "erp_financials"."subledger_applications"
  add constraint "subledger_applications_source_document_scope_fk" foreign key ("tenant_id", "company_id", "source_id", "source_document_id") references "erp_financials"."subledger_documents" ("tenant_id", "company_id", "source_id", "subledger_document_id") on update restrict on delete restrict,
  add constraint "subledger_applications_target_document_scope_fk" foreign key ("tenant_id", "company_id", "source_id", "target_document_id") references "erp_financials"."subledger_documents" ("tenant_id", "company_id", "source_id", "subledger_document_id") on update restrict on delete restrict,
  add constraint "subledger_applications_applied_event_scope_fk" foreign key ("tenant_id", "company_id", "source_id", "applied_event_id") references "erp_financials"."financial_lifecycle_events" ("tenant_id", "company_id", "source_id", "event_id") on update restrict on delete restrict,
  add constraint "subledger_applications_ended_event_scope_fk" foreign key ("tenant_id", "company_id", "source_id", "ended_event_id") references "erp_financials"."financial_lifecycle_events" ("tenant_id", "company_id", "source_id", "event_id") on update restrict on delete restrict;

create function "erp_financials"."validate_subledger_document_insert"()
returns trigger
language plpgsql
as $subledger_document_insert_validate$
declare
  journal "erp_financials"."transactions"%rowtype;
begin
  select * into journal
  from "erp_financials"."transactions"
  where "tenant_id" = new."tenant_id" and "source_id" = new."source_id" and "transaction_id" = new."transaction_id"
  for key share;
  if journal."transaction_id" is null then
    raise exception 'subledger document journal does not exist in the requested scope';
  end if;
  if journal."status" <> 'posted'
    or journal."source_transaction_type" <> 'Subledger:' || new."document_type"
    or journal."currency_code" <> new."currency_code"
    or journal."party_id" is distinct from new."party_id"
  then
    raise exception 'subledger document must match its posted journal type, currency, and party';
  end if;
  return new;
end
$subledger_document_insert_validate$;

create trigger "subledger_documents_validate_insert"
before insert on "erp_financials"."subledger_documents"
for each row execute function "erp_financials"."validate_subledger_document_insert"();

create function "erp_financials"."guard_subledger_document_mutation"()
returns trigger
language plpgsql
as $subledger_document_guard$
begin
  if tg_op = 'DELETE' then
    raise exception 'subledger documents cannot be deleted';
  end if;
  if coalesce(current_setting('erp_financials.application_balance_update', true), 'off') <> 'on' then
    raise exception 'posted subledger documents are immutable; use an application, unapplication, or compensating document';
  end if;
  if new."tenant_id" is distinct from old."tenant_id"
    or new."company_id" is distinct from old."company_id"
    or new."source_id" is distinct from old."source_id"
    or new."document_type" is distinct from old."document_type"
    or new."transaction_id" is distinct from old."transaction_id"
    or new."party_id" is distinct from old."party_id"
    or new."document_date" is distinct from old."document_date"
    or new."due_date" is distinct from old."due_date"
    or new."currency_code" is distinct from old."currency_code"
    or new."original_amount" is distinct from old."original_amount"
    or new."idempotency_key" is distinct from old."idempotency_key"
    or new."lifecycle_event_id" is distinct from old."lifecycle_event_id"
  then
    raise exception 'posted subledger document identity and accounting facts are immutable';
  end if;
  return new;
end
$subledger_document_guard$;

create trigger "subledger_documents_guard"
before update or delete on "erp_financials"."subledger_documents"
for each row execute function "erp_financials"."guard_subledger_document_mutation"();

create function "erp_financials"."validate_subledger_application"()
returns trigger
language plpgsql
as $subledger_application_validate$
declare
  source_document "erp_financials"."subledger_documents"%rowtype;
  target_document "erp_financials"."subledger_documents"%rowtype;
  existing_application "erp_financials"."subledger_applications"%rowtype;
begin
  if tg_op = 'INSERT' then
    if new."status" <> 'applied' or new."version" <> 1 or new."ended_event_id" is not null then
      raise exception 'new subledger applications must begin applied at version 1 without an ended event';
    end if;
    select * into existing_application
    from "erp_financials"."subledger_applications"
    where "tenant_id" = new."tenant_id" and "company_id" = new."company_id" and "source_id" = new."source_id"
      and "idempotency_key" = new."idempotency_key";
    if found then
      if existing_application."application_type" <> new."application_type"
        or existing_application."source_document_id" <> new."source_document_id"
        or existing_application."target_document_id" <> new."target_document_id"
        or existing_application."applied_amount" <> new."applied_amount"
        or existing_application."currency_code" <> new."currency_code"
      then
        raise exception 'subledger application idempotency key is already associated with different content';
      end if;
      return new;
    end if;
  else
    if old."status" <> 'applied' or new."status" not in ('unapplied', 'voided') then
      raise exception 'subledger applications may only transition from applied to unapplied or voided';
    end if;
    if new."version" <> old."version" + 1 or new."updated_at" < old."updated_at" then
      raise exception 'subledger application terminal transitions must increment version and timestamp';
    end if;
    if new."tenant_id" is distinct from old."tenant_id"
      or new."company_id" is distinct from old."company_id"
      or new."source_id" is distinct from old."source_id"
      or new."application_type" is distinct from old."application_type"
      or new."source_document_id" is distinct from old."source_document_id"
      or new."target_document_id" is distinct from old."target_document_id"
      or new."applied_amount" is distinct from old."applied_amount"
      or new."currency_code" is distinct from old."currency_code"
      or new."application_date" is distinct from old."application_date"
      or new."idempotency_key" is distinct from old."idempotency_key"
      or new."applied_event_id" is distinct from old."applied_event_id"
    then
      raise exception 'subledger application accounting facts are immutable';
    end if;
    return new;
  end if;

  perform 1
  from "erp_financials"."subledger_documents"
  where "tenant_id" = new."tenant_id" and "company_id" = new."company_id" and "source_id" = new."source_id"
    and "subledger_document_id" in (new."source_document_id", new."target_document_id")
  order by "subledger_document_id"
  for update;

  select * into source_document from "erp_financials"."subledger_documents"
  where "tenant_id" = new."tenant_id" and "company_id" = new."company_id" and "source_id" = new."source_id"
    and "subledger_document_id" = new."source_document_id";
  select * into target_document from "erp_financials"."subledger_documents"
  where "tenant_id" = new."tenant_id" and "company_id" = new."company_id" and "source_id" = new."source_id"
    and "subledger_document_id" = new."target_document_id";

  if source_document."subledger_document_id" is null or target_document."subledger_document_id" is null then
    raise exception 'subledger application documents do not exist in the requested scope';
  end if;
  if source_document."party_id" is null or target_document."party_id" is null
    or source_document."party_id" <> target_document."party_id"
  then
    raise exception 'subledger application documents must have the same non-null party';
  end if;
  if source_document."currency_code" <> target_document."currency_code"
    or new."currency_code" <> source_document."currency_code"
  then
    raise exception 'subledger application currency must match both documents';
  end if;
  if (new."application_type" = 'customer_payment_to_invoice' and (source_document."document_type" <> 'customer_payment' or target_document."document_type" <> 'invoice'))
    or (new."application_type" = 'bill_payment_to_bill' and (source_document."document_type" <> 'bill_payment' or target_document."document_type" <> 'vendor_bill'))
    or (new."application_type" = 'credit_to_invoice' and (source_document."document_type" <> 'credit_memo' or target_document."document_type" <> 'invoice'))
  then
    raise exception 'subledger application document types do not match application_type';
  end if;
  if new."applied_amount" > source_document."open_amount" or new."applied_amount" > target_document."open_amount" then
    raise exception 'subledger application amount exceeds an available document balance';
  end if;
  return new;
end
$subledger_application_validate$;

create trigger "subledger_applications_validate"
before insert or update on "erp_financials"."subledger_applications"
for each row execute function "erp_financials"."validate_subledger_application"();

create function "erp_financials"."apply_subledger_application_balances"()
returns trigger
language plpgsql
as $subledger_application_balances$
declare
  balance_delta numeric;
begin
  if tg_op = 'INSERT' then
    balance_delta := -new."applied_amount";
  elsif old."status" = 'applied' and new."status" in ('unapplied', 'voided') then
    balance_delta := new."applied_amount";
  else
    return new;
  end if;
  perform set_config('erp_financials.application_balance_update', 'on', true);
  update "erp_financials"."subledger_documents"
  set "open_amount" = "open_amount" + balance_delta,
      "status" = case
        when "open_amount" + balance_delta = 0 then 'settled'
        when "open_amount" + balance_delta = "original_amount" then 'open'
        else 'partially_applied'
      end,
      "version" = "version" + 1,
      "updated_at" = new."updated_at"
  where "tenant_id" = new."tenant_id" and "company_id" = new."company_id" and "source_id" = new."source_id"
    and "subledger_document_id" in (new."source_document_id", new."target_document_id");
  perform set_config('erp_financials.application_balance_update', 'off', true);
  return new;
end
$subledger_application_balances$;

create trigger "subledger_applications_update_balances"
after insert or update of "status" on "erp_financials"."subledger_applications"
for each row execute function "erp_financials"."apply_subledger_application_balances"();

create function "erp_financials"."reject_subledger_application_delete"()
returns trigger
language plpgsql
as $subledger_application_delete$
begin
  raise exception 'subledger applications cannot be deleted; unapply or void them';
  return old;
end
$subledger_application_delete$;

create trigger "subledger_applications_no_delete"
before delete on "erp_financials"."subledger_applications"
for each row execute function "erp_financials"."reject_subledger_application_delete"();
