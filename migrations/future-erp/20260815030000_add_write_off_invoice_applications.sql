alter table "erp_financials"."subledger_applications"
  drop constraint "subledger_applications_type_check",
  add constraint "subledger_applications_type_check" check (
    "application_type" in (
      'customer_payment_to_invoice',
      'bill_payment_to_bill',
      'credit_to_invoice',
      'write_off_to_invoice'
    )
  );

create function "erp_financials"."validate_write_off_to_invoice_application"()
returns trigger
language plpgsql
as $write_off_to_invoice_validate$
declare
  source_document_type text;
  target_document_type text;
begin
  if new."application_type" <> 'write_off_to_invoice' then
    return new;
  end if;

  select "document_type" into source_document_type
  from "erp_financials"."subledger_documents"
  where "tenant_id" = new."tenant_id"
    and "company_id" = new."company_id"
    and "source_id" = new."source_id"
    and "subledger_document_id" = new."source_document_id"
  for key share;

  select "document_type" into target_document_type
  from "erp_financials"."subledger_documents"
  where "tenant_id" = new."tenant_id"
    and "company_id" = new."company_id"
    and "source_id" = new."source_id"
    and "subledger_document_id" = new."target_document_id"
  for key share;

  if source_document_type is distinct from 'write_off'
    or target_document_type is distinct from 'invoice'
  then
    raise exception 'write-off application requires a write-off source and invoice target';
  end if;
  return new;
end
$write_off_to_invoice_validate$;

create trigger "subledger_applications_write_off_validate"
before insert or update on "erp_financials"."subledger_applications"
for each row execute function "erp_financials"."validate_write_off_to_invoice_application"();
