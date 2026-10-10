create table if not exists public.odds_response_cache (
  cache_key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.odds_response_cache enable row level security;
revoke all privileges on table public.odds_response_cache from anon, authenticated;
create index if not exists odds_response_cache_expires_idx on public.odds_response_cache(expires_at);
