create or replace function "erp_financials"."guard_bank_statement_line_mutation"()
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
    if "erp_financials"."source_import_reset_scope_allowed"(
      old."tenant_id", old."company_id", old."source_id"
    ) then
      return old;
    end if;
    raise exception 'bank statement lines cannot be deleted';
  end if;
  if not (
      (old."status" = 'unmatched' and new."status" in ('matched', 'ignored'))
      or (old."status" = 'matched' and new."status" = 'unmatched')
      or (old."status" = 'ignored' and new."status" = 'unmatched')
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
end;
$bank_line_guard$;
