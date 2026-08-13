create table "erp_financials"."accounting_book_controls" (
  "book_control_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "source_id" text not null,
  "posting_lock_date" date,
  "version" integer not null,
  "last_event_id" text not null,
  "created_at" timestamptz not null,
  "updated_at" timestamptz not null,
  constraint "accounting_book_controls_pkey" primary key ("book_control_id"),
  constraint "accounting_book_controls_version_check" check ("version" >= 1),
  constraint "accounting_book_controls_timestamp_check" check ("updated_at" >= "created_at")
);

create unique index "accounting_book_controls_scope_uidx" on "erp_financials"."accounting_book_controls" ("tenant_id", "company_id", "source_id");

alter table "erp_financials"."accounting_book_controls"
  add constraint "accounting_book_controls_company_source_scope_fk" foreign key ("tenant_id", "company_id", "source_id") references "erp_financials"."company_sources" ("tenant_id", "company_id", "source_id") on update restrict on delete restrict,
  add constraint "accounting_book_controls_event_scope_fk" foreign key ("tenant_id", "company_id", "source_id", "last_event_id") references "erp_financials"."financial_lifecycle_events" ("tenant_id", "company_id", "source_id", "event_id") on update restrict on delete restrict;

create table "erp_financials"."fiscal_periods" (
  "fiscal_period_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "source_id" text not null,
  "fiscal_year" integer not null,
  "period_number" integer not null,
  "period_start" date not null,
  "period_end" date not null,
  "status" text not null,
  "version" integer not null,
  "close_event_id" text,
  "reopen_event_id" text,
  "created_at" timestamptz not null,
  "updated_at" timestamptz not null,
  constraint "fiscal_periods_pkey" primary key ("fiscal_period_id"),
  constraint "fiscal_periods_period_check" check ("period_start" <= "period_end"),
  constraint "fiscal_periods_number_check" check ("period_number" between 1 and 366),
  constraint "fiscal_periods_status_check" check ("status" in ('open', 'closing', 'closed')),
  constraint "fiscal_periods_version_check" check ("version" >= 1),
  constraint "fiscal_periods_timestamp_check" check ("updated_at" >= "created_at"),
  constraint "fiscal_periods_closed_event_check" check ("status" <> 'closed' or "close_event_id" is not null)
);

create unique index "fiscal_periods_identity_uidx" on "erp_financials"."fiscal_periods" ("tenant_id", "company_id", "source_id", "fiscal_year", "period_number");
create unique index "fiscal_periods_scope_uidx" on "erp_financials"."fiscal_periods" ("tenant_id", "company_id", "source_id", "fiscal_period_id");
create index "fiscal_periods_date_idx" on "erp_financials"."fiscal_periods" ("tenant_id", "company_id", "source_id", "period_start", "period_end", "status");

alter table "erp_financials"."fiscal_periods"
  add constraint "fiscal_periods_company_source_scope_fk" foreign key ("tenant_id", "company_id", "source_id") references "erp_financials"."company_sources" ("tenant_id", "company_id", "source_id") on update restrict on delete restrict,
  add constraint "fiscal_periods_close_event_scope_fk" foreign key ("tenant_id", "company_id", "source_id", "close_event_id") references "erp_financials"."financial_lifecycle_events" ("tenant_id", "company_id", "source_id", "event_id") on update restrict on delete restrict,
  add constraint "fiscal_periods_reopen_event_scope_fk" foreign key ("tenant_id", "company_id", "source_id", "reopen_event_id") references "erp_financials"."financial_lifecycle_events" ("tenant_id", "company_id", "source_id", "event_id") on update restrict on delete restrict;

create function "erp_financials"."reject_overlapping_fiscal_period"()
returns trigger
language plpgsql
as $fiscal_period_overlap$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('erp_financials:fiscal-period:' || new."tenant_id" || ':' || new."company_id" || ':' || new."source_id", 0)
  );
  if exists (
    select 1
    from "erp_financials"."fiscal_periods" existing
    where existing."tenant_id" = new."tenant_id"
      and existing."company_id" = new."company_id"
      and existing."source_id" = new."source_id"
      and existing."fiscal_period_id" <> new."fiscal_period_id"
      and daterange(existing."period_start", existing."period_end", '[]') && daterange(new."period_start", new."period_end", '[]')
  ) then
    raise exception 'fiscal periods may not overlap within a company/source scope';
  end if;
  return new;
end
$fiscal_period_overlap$;

create trigger "fiscal_periods_no_overlap"
before insert or update of "tenant_id", "company_id", "source_id", "period_start", "period_end"
on "erp_financials"."fiscal_periods"
for each row execute function "erp_financials"."reject_overlapping_fiscal_period"();
