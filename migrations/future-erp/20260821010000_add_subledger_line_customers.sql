alter table "erp_financials"."subledger_document_lines"
  add column "customer_party_id" text;

alter table "erp_financials"."subledger_document_lines"
  add constraint "subledger_document_lines_customer_party_scope_fk"
  foreign key ("tenant_id", "source_id", "customer_party_id")
  references "erp_financials"."parties" ("tenant_id", "source_id", "party_id")
  on update restrict on delete restrict;
