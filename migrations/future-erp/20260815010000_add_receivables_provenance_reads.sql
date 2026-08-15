alter table "erp_financials"."invoice_draft_lines"
  add column "unit_cost" numeric,
  add constraint "invoice_draft_lines_unit_cost_check"
    check ("unit_cost" is null or ("unit_cost" >= 0 and scale("unit_cost") <= 6));

alter table "erp_financials"."subledger_document_lines"
  add column "unit_cost" numeric,
  add constraint "subledger_document_lines_unit_cost_check"
    check ("unit_cost" is null or ("unit_cost" >= 0 and scale("unit_cost") <= 6));
