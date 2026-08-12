-- Upgrade schema v6 report snapshots to the v7 tenant/company/source identity.
-- The migration refuses to guess when legacy freshness evidence does not map a
-- snapshot to exactly one company/source pair.

alter table "erp_financials"."report_snapshots"
  add column if not exists "company_id" text,
  add column if not exists "source_id" text;

with "snapshot_scope_candidates" as (
  select
    rs."report_snapshot_id",
    min(rf."company_id") as "company_id",
    min(rf."source_id") as "source_id"
  from "erp_financials"."report_snapshots" rs
  join "erp_financials"."report_freshness" rf
    on rf."tenant_id" = rs."tenant_id"
    and rf."report_name" = rs."report_name"
    and rf."accounting_basis" = rs."accounting_basis"
    and rf."period_start" = rs."period_start"
    and rf."period_end" = rs."period_end"
    and rf."currency_code" = rs."currency_code"
    and (
      rs."freshness"->>'sourceId' is null
      or rf."source_id" = rs."freshness"->>'sourceId'
    )
  group by rs."report_snapshot_id"
  having count(distinct (rf."company_id", rf."source_id")) = 1
)
update "erp_financials"."report_snapshots" rs
set
  "company_id" = candidates."company_id",
  "source_id" = candidates."source_id"
from "snapshot_scope_candidates" candidates
where candidates."report_snapshot_id" = rs."report_snapshot_id"
  and (rs."company_id" is null or rs."source_id" is null);

do $$
begin
  if exists (
    select 1
    from "erp_financials"."report_snapshots"
    where "company_id" is null or "source_id" is null
  ) then
    raise exception using
      errcode = '23502',
      message = 'Cannot upgrade report snapshots: each legacy snapshot must map to exactly one company/source through report_freshness';
  end if;
end
$$;

alter table "erp_financials"."report_snapshots"
  alter column "company_id" set not null,
  alter column "source_id" set not null;

-- Bring legacy primary and child identities onto the same scoped identity used
-- by v7 builders. Updating children first avoids leaving orphan rows when a
-- later snapshot upsert matches the request-level unique index.
with "snapshot_ids" as (
  select
    rs."report_snapshot_id" as "old_snapshot_id",
    concat_ws(
      ':',
      'snapshot',
      rs."tenant_id",
      rs."company_id",
      rs."source_id",
      rs."report_name",
      rs."snapshot_source",
      rs."accounting_basis",
      rs."period_start"::text,
      rs."period_end"::text,
      rs."as_of_date"::text,
      rs."currency_code"
    ) as "new_snapshot_id"
  from "erp_financials"."report_snapshots" rs
)
update "erp_financials"."report_snapshot_lines" lines
set
  "report_line_id" = ids."new_snapshot_id" || ':legacy-line:' || length(lines."report_line_id")::text || ':' || lines."report_line_id",
  "report_snapshot_id" = ids."new_snapshot_id",
  "parent_report_line_id" = case
    when lines."parent_report_line_id" is null then null
    else ids."new_snapshot_id" || ':legacy-line:' || length(lines."parent_report_line_id")::text || ':' || lines."parent_report_line_id"
  end
from "snapshot_ids" ids
where lines."report_snapshot_id" = ids."old_snapshot_id"
  and ids."old_snapshot_id" <> ids."new_snapshot_id";

with "snapshot_ids" as (
  select
    rs."report_snapshot_id" as "old_snapshot_id",
    concat_ws(
      ':',
      'snapshot',
      rs."tenant_id",
      rs."company_id",
      rs."source_id",
      rs."report_name",
      rs."snapshot_source",
      rs."accounting_basis",
      rs."period_start"::text,
      rs."period_end"::text,
      rs."as_of_date"::text,
      rs."currency_code"
    ) as "new_snapshot_id"
  from "erp_financials"."report_snapshots" rs
)
update "erp_financials"."report_snapshot_totals" totals
set
  "report_total_id" = ids."new_snapshot_id" || ':legacy-total:' || length(totals."report_total_id")::text || ':' || totals."report_total_id",
  "report_snapshot_id" = ids."new_snapshot_id"
from "snapshot_ids" ids
where totals."report_snapshot_id" = ids."old_snapshot_id"
  and ids."old_snapshot_id" <> ids."new_snapshot_id";

update "erp_financials"."report_snapshots" rs
set "report_snapshot_id" = concat_ws(
  ':',
  'snapshot',
  rs."tenant_id",
  rs."company_id",
  rs."source_id",
  rs."report_name",
  rs."snapshot_source",
  rs."accounting_basis",
  rs."period_start"::text,
  rs."period_end"::text,
  rs."as_of_date"::text,
  rs."currency_code"
)
where rs."report_snapshot_id" <> concat_ws(
  ':',
  'snapshot',
  rs."tenant_id",
  rs."company_id",
  rs."source_id",
  rs."report_name",
  rs."snapshot_source",
  rs."accounting_basis",
  rs."period_start"::text,
  rs."period_end"::text,
  rs."as_of_date"::text,
  rs."currency_code"
);

drop index if exists "erp_financials"."report_snapshots_request_uidx";

create unique index "report_snapshots_request_uidx"
  on "erp_financials"."report_snapshots" (
    "tenant_id",
    "company_id",
    "source_id",
    "report_name",
    "snapshot_source",
    "accounting_basis",
    "period_start",
    "period_end",
    "as_of_date",
    "currency_code"
  );
