create table if not exists "erp_financials"."schema_migrations" (
  "migration_id" text not null,
  "from_version" integer not null,
  "to_version" integer not null,
  "name" text not null,
  "checksum" text not null,
  "manifest_version" text not null,
  "execution_ms" integer not null,
  "applied_by_ref" text not null,
  "applied_at" timestamptz not null default clock_timestamp(),
  constraint "schema_migrations_pkey" primary key ("migration_id"),
  constraint "schema_migrations_version_check" check (from_version >= 0 and from_version < to_version),
  constraint "schema_migrations_checksum_check" check (length(checksum) = 64),
  constraint "schema_migrations_execution_ms_check" check (execution_ms >= 0)
);

create unique index if not exists "schema_migrations_to_version_uidx"
  on "erp_financials"."schema_migrations" ("to_version");

create or replace function "erp_financials"."reject_schema_migration_mutation"()
returns trigger
language plpgsql
as $immutable_schema_migration$
begin
  raise exception 'schema migration history is append-only';
  return old;
end
$immutable_schema_migration$;

drop trigger if exists "schema_migrations_immutable" on "erp_financials"."schema_migrations";
create trigger "schema_migrations_immutable"
before update or delete on "erp_financials"."schema_migrations"
for each row execute function "erp_financials"."reject_schema_migration_mutation"();
