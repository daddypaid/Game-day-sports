-- Isolated rehearsal adapter only. This is not a replacement for Supabase Auth.
-- No production users, sessions, credentials, cron jobs or provider settings.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists(select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
grant usage on schema public,auth,extensions to postgres,anon,authenticated,service_role;
grant execute on all functions in schema auth to anon,authenticated,service_role;
-- Supabase public-schema defaults, before application migrations revoke access.
alter default privileges for role postgres in schema public grant all on tables to postgres,anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant all on sequences to postgres,anon,authenticated,service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public grant execute on functions to postgres,anon,authenticated,service_role;
alter default privileges for role supabase_admin in schema public grant all on tables to postgres,anon,authenticated,service_role;
alter default privileges for role supabase_admin in schema public grant all on sequences to postgres,anon,authenticated,service_role;
alter default privileges for role supabase_admin in schema public grant execute on functions to postgres,anon,authenticated,service_role;
