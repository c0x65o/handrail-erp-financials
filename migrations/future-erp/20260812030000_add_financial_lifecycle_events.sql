create table "erp_financials"."financial_lifecycle_events" (
  "event_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "source_id" text not null,
  "aggregate_type" text not null,
  "aggregate_id" text not null,
  "event_type" text not null,
  "actor_ref" text not null,
  "approver_ref" text,
  "request_id" text not null,
  "correlation_id" text not null,
  "reason_code" text not null,
  "reason_detail" text,
  "occurred_at" timestamptz not null,
  "recorded_at" timestamptz not null,
  "idempotency_key" text not null,
  "payload_checksum" text not null,
  "payload" jsonb not null,
  "prior_event_id" text,
  constraint "financial_lifecycle_events_pkey" primary key ("event_id"),
  constraint "financial_lifecycle_events_required_refs_check" check (btrim("actor_ref") <> '' and btrim("request_id") <> '' and btrim("correlation_id") <> '' and btrim("reason_code") <> ''),
  constraint "financial_lifecycle_events_checksum_check" check (length("payload_checksum") = 64),
  constraint "financial_lifecycle_events_timestamp_check" check ("occurred_at" <= "recorded_at"),
  constraint "financial_lifecycle_events_payload_bounded_json_check" check (octet_length(coalesce("payload"::text, '')) <= 8192)
);

create unique index "financial_lifecycle_events_idempotency_uidx" on "erp_financials"."financial_lifecycle_events" ("tenant_id", "company_id", "source_id", "idempotency_key");
create unique index "financial_lifecycle_events_scope_uidx" on "erp_financials"."financial_lifecycle_events" ("tenant_id", "company_id", "source_id", "event_id");
create index "financial_lifecycle_events_aggregate_idx" on "erp_financials"."financial_lifecycle_events" ("tenant_id", "company_id", "source_id", "aggregate_type", "aggregate_id", "occurred_at");
create index "financial_lifecycle_events_correlation_idx" on "erp_financials"."financial_lifecycle_events" ("tenant_id", "correlation_id", "occurred_at");

alter table "erp_financials"."financial_lifecycle_events"
  add constraint "financial_lifecycle_events_company_source_scope_fk" foreign key ("tenant_id", "company_id", "source_id") references "erp_financials"."company_sources" ("tenant_id", "company_id", "source_id") on update restrict on delete restrict,
  add constraint "financial_lifecycle_events_prior_scope_fk" foreign key ("tenant_id", "company_id", "source_id", "prior_event_id") references "erp_financials"."financial_lifecycle_events" ("tenant_id", "company_id", "source_id", "event_id") on update restrict on delete restrict;

create function "erp_financials"."reject_financial_lifecycle_event_mutation"()
returns trigger
language plpgsql
as $immutable_lifecycle_event$
begin
  raise exception 'financial lifecycle events are append-only';
  return old;
end
$immutable_lifecycle_event$;

create trigger "financial_lifecycle_events_immutable"
before update or delete on "erp_financials"."financial_lifecycle_events"
for each row execute function "erp_financials"."reject_financial_lifecycle_event_mutation"();
