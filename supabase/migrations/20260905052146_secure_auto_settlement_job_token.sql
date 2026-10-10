create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.internal_job_secrets (
  name text primary key,
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.internal_job_secrets enable row level security;
alter table public.internal_job_secrets force row level security;
revoke all on public.internal_job_secrets from public, anon, authenticated;
grant select on public.internal_job_secrets to service_role;

insert into public.internal_job_secrets(name, secret)
values ('auto-settle-test-wagers', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;
