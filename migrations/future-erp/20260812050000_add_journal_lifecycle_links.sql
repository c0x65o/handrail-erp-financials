create table "erp_financials"."journal_entry_links" (
  "journal_entry_link_id" text not null,
  "tenant_id" text not null,
  "company_id" text not null,
  "source_id" text not null,
  "original_transaction_id" text not null,
  "related_transaction_id" text not null,
  "link_type" text not null,
  "lifecycle_event_id" text not null,
  "created_at" timestamptz not null,
  constraint "journal_entry_links_pkey" primary key ("journal_entry_link_id"),
  constraint "journal_entry_links_type_check" check ("link_type" in ('reversal', 'void', 'correction', 'replacement')),
  constraint "journal_entry_links_distinct_check" check ("original_transaction_id" <> "related_transaction_id")
);

create unique index "journal_entry_links_identity_uidx" on "erp_financials"."journal_entry_links" ("tenant_id", "company_id", "source_id", "original_transaction_id", "related_transaction_id", "link_type");
create index "journal_entry_links_original_idx" on "erp_financials"."journal_entry_links" ("tenant_id", "company_id", "source_id", "original_transaction_id", "created_at");
create unique index "journal_entry_links_terminal_reversal_uidx" on "erp_financials"."journal_entry_links" ("tenant_id", "company_id", "source_id", "original_transaction_id") where "link_type" = any (array['reversal'::text, 'void'::text]);
create unique index "journal_entry_links_terminal_replacement_uidx" on "erp_financials"."journal_entry_links" ("tenant_id", "company_id", "source_id", "original_transaction_id") where "link_type" = any (array['correction'::text, 'replacement'::text]);

alter table "erp_financials"."journal_entry_links"
  add constraint "journal_entry_links_company_source_scope_fk" foreign key ("tenant_id", "company_id", "source_id") references "erp_financials"."company_sources" ("tenant_id", "company_id", "source_id") on update restrict on delete restrict,
  add constraint "journal_entry_links_original_scope_fk" foreign key ("tenant_id", "source_id", "original_transaction_id") references "erp_financials"."transactions" ("tenant_id", "source_id", "transaction_id") on update restrict on delete restrict,
  add constraint "journal_entry_links_related_scope_fk" foreign key ("tenant_id", "source_id", "related_transaction_id") references "erp_financials"."transactions" ("tenant_id", "source_id", "transaction_id") on update restrict on delete restrict,
  add constraint "journal_entry_links_event_scope_fk" foreign key ("tenant_id", "company_id", "source_id", "lifecycle_event_id") references "erp_financials"."financial_lifecycle_events" ("tenant_id", "company_id", "source_id", "event_id") on update restrict on delete restrict;

create function "erp_financials"."reject_journal_entry_link_mutation"()
returns trigger
language plpgsql
as $immutable_journal_link$
begin
  raise exception 'journal entry lifecycle links are append-only';
  return old;
end
$immutable_journal_link$;

create trigger "journal_entry_links_immutable"
before update or delete on "erp_financials"."journal_entry_links"
for each row execute function "erp_financials"."reject_journal_entry_link_mutation"();
