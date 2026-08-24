-- The reset bypass is transaction-local, exact-scope, and unavailable for
-- native ERP sources. Normal append-only and lifecycle protections are
-- unchanged outside resetSourceImportState's verified transaction.
create function "erp_financials"."source_import_reset_scope_allowed"(
  row_tenant_id text,
  row_company_id text,
  row_source_id text
)
returns boolean
language sql
stable
as $source_import_reset_scope$
  select
    nullif(current_setting('erp_financials.source_import_reset_tenant_id', true), '') = row_tenant_id
    and nullif(current_setting('erp_financials.source_import_reset_source_id', true), '') = row_source_id
    and (
      row_company_id is null
      or nullif(current_setting('erp_financials.source_import_reset_company_id', true), '') = row_company_id
    )
    and exists (
      select 1
      from "erp_financials"."accounting_sources" source
      where source."tenant_id" = row_tenant_id
        and source."source_id" = row_source_id
        and source."source_system" <> 'native_erp'
        and source."provider_environment" <> 'native'
    )
    and 1 = (
      select count(*)
      from "erp_financials"."company_sources" binding
      where binding."tenant_id" = row_tenant_id and binding."source_id" = row_source_id
    )
    and exists (
      select 1
      from "erp_financials"."company_sources" binding
      where binding."tenant_id" = row_tenant_id
        and binding."company_id" = nullif(current_setting('erp_financials.source_import_reset_company_id', true), '')
        and binding."source_id" = row_source_id
    );
$source_import_reset_scope$;

create or replace function "erp_financials"."reject_posted_journal_mutation"()
returns trigger
language plpgsql
as $posted_journal_guard$
begin
  if tg_op = 'DELETE' and "erp_financials"."source_import_reset_scope_allowed"(
    old."tenant_id", null, old."source_id"
  ) then
    return old;
  end if;
  if old."status" = 'posted'
    and (
      old."source_transaction_type" in ('JournalEntry', 'JournalEntryAdjustment')
      or old."source_transaction_type" like 'Subledger:%'
    )
    and (tg_op = 'DELETE' or new is distinct from old)
  then
    raise exception 'posted journal entries are immutable; create a linked reversal or replacement';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$posted_journal_guard$;

create or replace function "erp_financials"."reject_posted_journal_child_mutation"()
returns trigger
language plpgsql
as $posted_journal_child_guard$
declare
  parent_is_posted_journal boolean;
  provider_source_system text;
begin
  if tg_op = 'DELETE' and "erp_financials"."source_import_reset_scope_allowed"(
    old."tenant_id", null, old."source_id"
  ) then
    return old;
  end if;
  select transactions."status" = 'posted'
    and (
      transactions."source_transaction_type" in ('JournalEntry', 'JournalEntryAdjustment')
      or transactions."source_transaction_type" like 'Subledger:%'
    )
  into parent_is_posted_journal
  from "erp_financials"."transactions" transactions
  where transactions."tenant_id" = old."tenant_id"
    and transactions."source_id" = old."source_id"
    and transactions."transaction_id" = old."transaction_id";

  if coalesce(parent_is_posted_journal, false)
    and coalesce(current_setting('erp_financials.quickbooks_projection_refresh', true), 'off') = 'on'
  then
    select source."source_system" into provider_source_system
    from "erp_financials"."accounting_sources" source
    where source."tenant_id" = old."tenant_id" and source."source_id" = old."source_id";
    if provider_source_system = 'quickbooks' then
      return case when tg_op = 'DELETE' then old else new end;
    end if;
  end if;
  if coalesce(parent_is_posted_journal, false) and (tg_op = 'DELETE' or new is distinct from old) then
    raise exception 'posted journal entry facts are immutable; create a linked reversal or replacement';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$posted_journal_child_guard$;

create or replace function "erp_financials"."reject_financial_lifecycle_event_mutation"()
returns trigger
language plpgsql
as $immutable_lifecycle_event$
begin
  if tg_op = 'DELETE' and "erp_financials"."source_import_reset_scope_allowed"(
    old."tenant_id", old."company_id", old."source_id"
  ) then
    return old;
  end if;
  raise exception 'financial lifecycle events are append-only';
end;
$immutable_lifecycle_event$;

create or replace function "erp_financials"."reject_journal_entry_link_mutation"()
returns trigger
language plpgsql
as $immutable_journal_link$
begin
  if tg_op = 'DELETE' and "erp_financials"."source_import_reset_scope_allowed"(
    old."tenant_id", old."company_id", old."source_id"
  ) then
    return old;
  end if;
  raise exception 'journal entry lifecycle links are append-only';
end;
$immutable_journal_link$;

create or replace function "erp_financials"."guard_subledger_document_mutation"()
returns trigger
language plpgsql
as $subledger_document_guard$
begin
  if tg_op = 'DELETE' then
    if "erp_financials"."source_import_reset_scope_allowed"(
      old."tenant_id", old."company_id", old."source_id"
    ) then
      return old;
    end if;
    raise exception 'subledger documents cannot be deleted';
  end if;
  if coalesce(current_setting('erp_financials.quickbooks_projection_refresh', true), 'off') = 'on'
    and old."metadata" ->> 'provider' = 'quickbooks'
    and new."metadata" ->> 'provider' = 'quickbooks'
  then
    if new."tenant_id" is distinct from old."tenant_id"
      or new."company_id" is distinct from old."company_id"
      or new."source_id" is distinct from old."source_id"
      or new."subledger_document_id" is distinct from old."subledger_document_id"
      or new."document_type" is distinct from old."document_type"
      or new."idempotency_key" is distinct from old."idempotency_key"
      or new."lifecycle_event_id" is distinct from old."lifecycle_event_id"
    then
      raise exception 'QuickBooks document refresh cannot change canonical identity';
    end if;
    return new;
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
end;
$subledger_document_guard$;

create or replace function "erp_financials"."guard_quickbooks_document_line_mutation"()
returns trigger
language plpgsql
as $quickbooks_document_line_guard$
declare
  provider text;
begin
  if tg_op = 'DELETE' and "erp_financials"."source_import_reset_scope_allowed"(
    old."tenant_id", old."company_id", old."source_id"
  ) then
    return old;
  end if;
  select document."metadata" ->> 'provider' into provider
  from "erp_financials"."subledger_documents" document
  where document."tenant_id" = old."tenant_id" and document."company_id" = old."company_id"
    and document."source_id" = old."source_id" and document."subledger_document_id" = old."subledger_document_id";
  if coalesce(current_setting('erp_financials.quickbooks_projection_refresh', true), 'off') = 'on'
    and provider = 'quickbooks'
  then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'SDK canonical records are immutable';
end;
$quickbooks_document_line_guard$;

create or replace function "erp_financials"."reject_subledger_application_delete"()
returns trigger
language plpgsql
as $subledger_application_delete$
begin
  if "erp_financials"."source_import_reset_scope_allowed"(
    old."tenant_id", old."company_id", old."source_id"
  ) then
    return old;
  end if;
  raise exception 'subledger applications cannot be deleted; unapply or void them';
end;
$subledger_application_delete$;

create or replace function "erp_financials"."guard_bill_payment_disbursement_mutation"()
returns trigger
language plpgsql
as $bill_payment_disbursement_guard$
begin
  if tg_op = 'DELETE' then
    if "erp_financials"."source_import_reset_scope_allowed"(
      old."tenant_id", old."company_id", old."source_id"
    ) then
      return old;
    end if;
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
end;
$bill_payment_disbursement_guard$;

create or replace function "erp_financials"."reject_sdk_immutable_mutation"()
returns trigger
language plpgsql
as $sdk_immutable_guard$
declare
  old_row jsonb := to_jsonb(old);
begin
  if tg_op = 'DELETE' and "erp_financials"."source_import_reset_scope_allowed"(
    old_row ->> 'tenant_id', old_row ->> 'company_id', old_row ->> 'source_id'
  ) then
    return old;
  end if;
  raise exception '% is append-only and cannot be updated or deleted', tg_table_name;
end;
$sdk_immutable_guard$;

create or replace function "erp_financials"."guard_financial_outbox_mutation"()
returns trigger
language plpgsql
as $financial_outbox_guard$
begin
  if tg_op = 'DELETE' then
    if "erp_financials"."source_import_reset_scope_allowed"(
      old."tenant_id", old."company_id", old."source_id"
    ) then
      return old;
    end if;
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
end;
$financial_outbox_guard$;

create or replace function "erp_financials"."guard_invoice_draft_mutation"()
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
    if "erp_financials"."source_import_reset_scope_allowed"(
      old."tenant_id", old."company_id", old."source_id"
    ) then
      return old;
    end if;
    raise exception 'invoice drafts cannot be deleted';
  end if;
  if old."status" <> 'draft' then raise exception 'issued and voided invoice drafts are terminal'; end if;
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
end;
$invoice_draft_guard$;

create or replace function "erp_financials"."guard_invoice_draft_line_mutation"()
returns trigger
language plpgsql
as $invoice_draft_line_guard$
declare
  parent_status text;
begin
  if tg_op = 'DELETE' and "erp_financials"."source_import_reset_scope_allowed"(
    old."tenant_id", old."company_id", old."source_id"
  ) then
    return old;
  end if;
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
end;
$invoice_draft_line_guard$;

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
  if not ((old."status" = 'unmatched' and new."status" in ('matched', 'ignored')) or (old."status" = 'matched' and new."status" = 'unmatched'))
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

create or replace function "erp_financials"."guard_bank_reconciliation_match_mutation"()
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
    if "erp_financials"."source_import_reset_scope_allowed"(
      old."tenant_id", old."company_id", old."source_id"
    ) then
      return old;
    end if;
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
end;
$bank_match_guard$;
