alter table "erp_financials"."subledger_documents"
  drop constraint if exists "subledger_documents_type_check";

alter table "erp_financials"."subledger_documents"
  add constraint "subledger_documents_type_check" check (
    "document_type" in (
      'invoice', 'customer_payment', 'credit_memo', 'refund', 'vendor_bill',
      'bill_payment', 'write_off', 'deposit', 'transfer', 'sales_receipt',
      'purchase', 'vendor_credit'
    )
  );

-- A provider-imported document points at the same canonical journal as reports;
-- it must not manufacture a second "Subledger:*" transaction merely to satisfy
-- the native command path's discriminator.
create or replace function "erp_financials"."validate_subledger_document_insert"()
returns trigger
language plpgsql
as $subledger_document_insert_validate$
declare
  journal "erp_financials"."transactions"%rowtype;
  expected_provider_type text;
begin
  select * into journal
  from "erp_financials"."transactions"
  where "tenant_id" = new."tenant_id" and "source_id" = new."source_id" and "transaction_id" = new."transaction_id"
  for key share;
  if journal."transaction_id" is null then
    raise exception 'subledger document journal does not exist in the requested scope';
  end if;
  expected_provider_type := case new."document_type"
    when 'invoice' then 'Invoice'
    when 'customer_payment' then 'Payment'
    when 'credit_memo' then 'CreditMemo'
    when 'refund' then 'RefundReceipt'
    when 'vendor_bill' then 'Bill'
    when 'bill_payment' then 'BillPayment'
    when 'deposit' then 'Deposit'
    when 'transfer' then 'Transfer'
    when 'sales_receipt' then 'SalesReceipt'
    when 'purchase' then 'Purchase'
    when 'vendor_credit' then 'VendorCredit'
    else null
  end;
  if journal."status" <> 'posted'
    or (journal."source_transaction_type" <> 'Subledger:' || new."document_type"
      and journal."source_transaction_type" is distinct from expected_provider_type)
    or journal."currency_code" <> new."currency_code"
    or journal."party_id" is distinct from new."party_id"
  then
    raise exception 'subledger document must match its posted journal type, currency, and party';
  end if;
  return new;
end;
$subledger_document_insert_validate$;

alter table "erp_financials"."subledger_applications"
  drop constraint if exists "subledger_applications_type_check";

alter table "erp_financials"."subledger_applications"
  add constraint "subledger_applications_type_check" check (
    "application_type" in (
      'customer_payment_to_invoice', 'bill_payment_to_bill', 'credit_to_invoice',
      'vendor_credit_to_bill', 'write_off_to_invoice'
    )
  );

create or replace function "erp_financials"."validate_subledger_application"()
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
        if coalesce(current_setting('erp_financials.quickbooks_projection_refresh', true), 'off') <> 'on' then
          raise exception 'subledger application idempotency key is already associated with different content';
        end if;
      end if;
      -- ON CONFLICT performs the guarded revision and validates balances in
      -- this function's UPDATE branch. Returning here prevents the proposed
      -- INSERT tuple from being checked against balances that still include
      -- the prior application amount.
      return new;
    end if;
  elsif coalesce(current_setting('erp_financials.quickbooks_projection_refresh', true), 'off') = 'on'
    and new."status" = 'applied'
  then
    if new."version" <> old."version" + 1 or new."updated_at" < old."updated_at" then
      raise exception 'QuickBooks application refresh must increment version and timestamp';
    end if;
    if new."tenant_id" is distinct from old."tenant_id"
      or new."company_id" is distinct from old."company_id"
      or new."source_id" is distinct from old."source_id"
      or new."application_type" is distinct from old."application_type"
      or new."source_document_id" is distinct from old."source_document_id"
      or new."target_document_id" is distinct from old."target_document_id"
      or new."currency_code" is distinct from old."currency_code"
      or new."idempotency_key" is distinct from old."idempotency_key"
      or new."applied_event_id" is distinct from old."applied_event_id"
    then
      raise exception 'QuickBooks application refresh cannot change canonical identity';
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
    or (new."application_type" = 'vendor_credit_to_bill' and (source_document."document_type" <> 'vendor_credit' or target_document."document_type" <> 'vendor_bill'))
    or (new."application_type" = 'write_off_to_invoice' and (source_document."document_type" <> 'write_off' or target_document."document_type" <> 'invoice'))
  then
    raise exception 'subledger application document types do not match application_type';
  end if;
  if new."applied_amount" > source_document."open_amount" + (case when tg_op = 'UPDATE' and old."status" = 'applied' then old."applied_amount" else 0 end)
    or new."applied_amount" > target_document."open_amount" + (case when tg_op = 'UPDATE' and old."status" = 'applied' then old."applied_amount" else 0 end)
  then
    raise exception 'subledger application amount exceeds an available document balance';
  end if;
  return new;
end;
$subledger_application_validate$;

create or replace function "erp_financials"."guard_subledger_document_mutation"()
returns trigger
language plpgsql
as $subledger_document_guard$
begin
  if tg_op = 'DELETE' then
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

drop trigger if exists "subledger_document_lines_immutable" on "erp_financials"."subledger_document_lines";
create trigger "subledger_document_lines_immutable"
before update or delete on "erp_financials"."subledger_document_lines"
for each row execute function "erp_financials"."guard_quickbooks_document_line_mutation"();

-- Provider facts are an idempotent projection. A controlled refresh may
-- replace or retire their journal children, while Spartan-native posted
-- journals remain append-only and require reversals.
create or replace function "erp_financials"."reject_posted_journal_child_mutation"()
returns trigger
language plpgsql
as $posted_journal_child_guard$
declare
  parent_is_posted_journal boolean;
  provider_source_system text;
begin
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
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$posted_journal_child_guard$;

create or replace function "erp_financials"."enforce_reporting_source_window"()
returns trigger
language plpgsql
as $reporting_source_window_guard$
begin
  if exists (
    select 1 from "erp_financials"."reporting_book_sources" source
    where source."tenant_id" = new."tenant_id" and source."source_id" = new."source_id"
  ) and not exists (
    select 1 from "erp_financials"."reporting_book_sources" source
    where source."tenant_id" = new."tenant_id" and source."source_id" = new."source_id"
      and (source."effective_from" is null or source."effective_from" <= new."posting_date")
      and (source."effective_through" is null or source."effective_through" >= new."posting_date")
  ) then
    raise exception 'posting date % is outside every reporting-book window for source %', new."posting_date", new."source_id";
  end if;
  return new;
end;
$reporting_source_window_guard$;

drop trigger if exists "ledger_postings_source_window_guard" on "erp_financials"."ledger_postings";
create trigger "ledger_postings_source_window_guard"
before insert or update on "erp_financials"."ledger_postings"
for each row execute function "erp_financials"."enforce_reporting_source_window"();

create or replace function "erp_financials"."apply_subledger_application_balances"()
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
  elsif coalesce(current_setting('erp_financials.quickbooks_projection_refresh', true), 'off') = 'on'
    and new."status" = 'applied'
  then
    balance_delta := case when old."status" = 'applied'
      then old."applied_amount" - new."applied_amount"
      else -new."applied_amount"
    end;
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
end;
$subledger_application_balances$;
