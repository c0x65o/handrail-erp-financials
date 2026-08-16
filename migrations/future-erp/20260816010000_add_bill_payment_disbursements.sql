select set_config('erp_financials.application_balance_update', 'on', true);
with payment_accounts as (
  select document."tenant_id", document."company_id", document."source_id", document."subledger_document_id",
    max(posting."account_id") filter (where posting."debit_amount" > 0) as "payable_account_id",
    max(posting."account_id") filter (where posting."credit_amount" > 0) as "funding_account_id"
  from "erp_financials"."subledger_documents" document
  join "erp_financials"."ledger_postings" posting
    on posting."tenant_id" = document."tenant_id" and posting."source_id" = document."source_id"
   and posting."transaction_id" = document."transaction_id"
  where document."document_type" = 'bill_payment'
  group by document."tenant_id", document."company_id", document."source_id", document."subledger_document_id"
)
update "erp_financials"."subledger_documents" document
set "metadata" = document."metadata" || jsonb_build_object(
  'billPaymentProvenance',
  coalesce(document."metadata" -> 'billPaymentProvenance', '{}'::jsonb) || jsonb_build_object(
    'fundingAccountId', evidence."funding_account_id",
    'payableAccountId', evidence."payable_account_id"
  )
)
from payment_accounts evidence
where document."tenant_id" = evidence."tenant_id" and document."company_id" = evidence."company_id"
  and document."source_id" = evidence."source_id"
  and document."subledger_document_id" = evidence."subledger_document_id"
  and evidence."funding_account_id" is not null and evidence."payable_account_id" is not null
  and (
    document."metadata" #>> '{billPaymentProvenance,fundingAccountId}' is null
    or document."metadata" #>> '{billPaymentProvenance,payableAccountId}' is null
  );
select set_config('erp_financials.application_balance_update', 'off', true);

create table "erp_financials"."bill_payment_disbursements" (
  "bill_payment_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "source_id" text not null,
  "subledger_document_id" text,
  "vendor_id" text not null,
  "payment_date" date not null,
  "document_number" text,
  "memo" text,
  "currency_code" text not null,
  "amount" numeric(20, 2) not null,
  "payment_method" text not null,
  "payment_reference" text,
  "funding_account_id" text not null,
  "payable_account_id" text not null,
  "allocations" jsonb not null,
  "status" text not null,
  "version" integer not null,
  "idempotency_key" text not null,
  "payload_checksum" text not null,
  "scheduled_event_id" text not null,
  "cleared_event_id" text,
  "voided_event_id" text,
  "created_at" timestamptz not null,
  "updated_at" timestamptz not null,
  constraint "bill_payment_disbursements_pkey" primary key ("bill_payment_id"),
  constraint "bill_payment_disbursements_method_check" check ("payment_method" in ('ach', 'card', 'check')),
  constraint "bill_payment_disbursements_amount_check" check ("amount" > 0),
  constraint "bill_payment_disbursements_allocations_check" check (
    jsonb_typeof("allocations") = 'array'
    and jsonb_array_length("allocations") > 0
  ),
  constraint "bill_payment_disbursements_allocations_bounded_json_check" check (
    octet_length(coalesce("allocations"::text, '')) <= 8192
  ),
  constraint "bill_payment_disbursements_status_check" check ("status" in ('scheduled', 'cleared', 'voided')),
  constraint "bill_payment_disbursements_version_check" check ("version" >= 1),
  constraint "bill_payment_disbursements_checksum_check" check (length("payload_checksum") = 64),
  constraint "bill_payment_disbursements_timestamp_check" check ("updated_at" >= "created_at"),
  constraint "bill_payment_disbursements_state_shape_check" check (
    ("status" = 'scheduled' and "subledger_document_id" is null and "cleared_event_id" is null and "voided_event_id" is null)
    or ("status" = 'cleared' and "subledger_document_id" is not null and "cleared_event_id" is not null and "voided_event_id" is null)
    or ("status" = 'voided' and "voided_event_id" is not null)
  )
);

create unique index "bill_payment_disbursements_scope_uidx"
  on "erp_financials"."bill_payment_disbursements"
  ("tenant_id", "company_id", "source_id", "bill_payment_id");
create unique index "bill_payment_disbursements_idempotency_uidx"
  on "erp_financials"."bill_payment_disbursements"
  ("tenant_id", "company_id", "source_id", "idempotency_key");
create index "bill_payment_disbursements_register_idx"
  on "erp_financials"."bill_payment_disbursements"
  ("tenant_id", "company_id", "source_id", "status", "payment_date" desc, "bill_payment_id" desc);
create index "bill_payment_disbursements_vendor_idx"
  on "erp_financials"."bill_payment_disbursements"
  ("tenant_id", "company_id", "source_id", "vendor_id", "payment_date" desc);

alter table "erp_financials"."bill_payment_disbursements"
  add constraint "bill_payment_disbursements_company_source_scope_fk"
  foreign key ("tenant_id", "company_id", "source_id")
  references "erp_financials"."company_sources" ("tenant_id", "company_id", "source_id")
  on update restrict on delete restrict,
  add constraint "bill_payment_disbursements_document_scope_fk"
  foreign key ("tenant_id", "company_id", "source_id", "subledger_document_id")
  references "erp_financials"."subledger_documents" ("tenant_id", "company_id", "source_id", "subledger_document_id")
  on update restrict on delete restrict,
  add constraint "bill_payment_disbursements_vendor_scope_fk"
  foreign key ("tenant_id", "source_id", "vendor_id")
  references "erp_financials"."parties" ("tenant_id", "source_id", "party_id")
  on update restrict on delete restrict,
  add constraint "bill_payment_disbursements_funding_account_scope_fk"
  foreign key ("tenant_id", "source_id", "funding_account_id")
  references "erp_financials"."accounts" ("tenant_id", "source_id", "account_id")
  on update restrict on delete restrict,
  add constraint "bill_payment_disbursements_payable_account_scope_fk"
  foreign key ("tenant_id", "source_id", "payable_account_id")
  references "erp_financials"."accounts" ("tenant_id", "source_id", "account_id")
  on update restrict on delete restrict,
  add constraint "bill_payment_disbursements_scheduled_event_scope_fk"
  foreign key ("tenant_id", "company_id", "source_id", "scheduled_event_id")
  references "erp_financials"."financial_lifecycle_events" ("tenant_id", "company_id", "source_id", "event_id")
  on update restrict on delete restrict,
  add constraint "bill_payment_disbursements_cleared_event_scope_fk"
  foreign key ("tenant_id", "company_id", "source_id", "cleared_event_id")
  references "erp_financials"."financial_lifecycle_events" ("tenant_id", "company_id", "source_id", "event_id")
  on update restrict on delete restrict,
  add constraint "bill_payment_disbursements_voided_event_scope_fk"
  foreign key ("tenant_id", "company_id", "source_id", "voided_event_id")
  references "erp_financials"."financial_lifecycle_events" ("tenant_id", "company_id", "source_id", "event_id")
  on update restrict on delete restrict;

create function "erp_financials"."guard_bill_payment_disbursement_mutation"()
returns trigger
language plpgsql
as $bill_payment_disbursement_guard$
begin
  if tg_op = 'DELETE' then
    raise exception 'bill payment disbursements cannot be deleted';
  end if;
  if new."tenant_id" is distinct from old."tenant_id"
    or new."company_id" is distinct from old."company_id"
    or new."source_id" is distinct from old."source_id"
    or new."bill_payment_id" is distinct from old."bill_payment_id"
    or new."vendor_id" is distinct from old."vendor_id"
    or new."payment_date" is distinct from old."payment_date"
    or new."document_number" is distinct from old."document_number"
    or new."memo" is distinct from old."memo"
    or new."currency_code" is distinct from old."currency_code"
    or new."amount" is distinct from old."amount"
    or new."payment_method" is distinct from old."payment_method"
    or new."payment_reference" is distinct from old."payment_reference"
    or new."funding_account_id" is distinct from old."funding_account_id"
    or new."payable_account_id" is distinct from old."payable_account_id"
    or new."allocations" is distinct from old."allocations"
    or new."idempotency_key" is distinct from old."idempotency_key"
    or new."payload_checksum" is distinct from old."payload_checksum"
    or new."scheduled_event_id" is distinct from old."scheduled_event_id"
    or new."created_at" is distinct from old."created_at"
    or (old."subledger_document_id" is not null and new."subledger_document_id" is distinct from old."subledger_document_id")
    or (old."cleared_event_id" is not null and new."cleared_event_id" is distinct from old."cleared_event_id")
    or (old."voided_event_id" is not null and new."voided_event_id" is distinct from old."voided_event_id")
  then
    raise exception 'bill payment instruction and provenance are immutable';
  end if;
  if new."version" <> old."version" + 1 or new."updated_at" < old."updated_at" then
    raise exception 'bill payment lifecycle transitions must increment version and timestamp';
  end if;
  if not (
    (old."status" = 'scheduled' and new."status" in ('cleared', 'voided'))
    or (old."status" = 'cleared' and new."status" = 'voided')
  ) then
    raise exception 'invalid bill payment lifecycle transition';
  end if;
  return new;
end
$bill_payment_disbursement_guard$;

create trigger "bill_payment_disbursements_guard"
before update or delete on "erp_financials"."bill_payment_disbursements"
for each row execute function "erp_financials"."guard_bill_payment_disbursement_mutation"();
