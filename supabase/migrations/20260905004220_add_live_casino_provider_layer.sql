create table if not exists public.live_casino_games (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  provider_game_id text not null,
  name text not null,
  category text not null check (category in ('blackjack','roulette','baccarat','game_show','poker','other')),
  thumbnail_url text,
  enabled boolean not null default false,
  is_test boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_key, provider_game_id)
);

create table if not exists public.live_casino_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null references public.live_casino_games(id) on delete restrict,
  provider_key text not null,
  provider_session_id text,
  launch_url text,
  status text not null default 'requested' check (status in ('requested','launched','failed','closed')),
  is_test boolean not null default true,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

alter table public.live_casino_games enable row level security;
alter table public.live_casino_sessions enable row level security;

drop policy if exists "live casino games readable" on public.live_casino_games;
create policy "live casino games readable"
on public.live_casino_games for select
to authenticated
using (true);

drop policy if exists "users read own live casino sessions" on public.live_casino_sessions;
create policy "users read own live casino sessions"
on public.live_casino_sessions for select
to authenticated
using (auth.uid() = user_id);

insert into public.live_casino_games(provider_key,provider_game_id,name,category,enabled,is_test)
values
('pending','live-blackjack','Live Blackjack','blackjack',false,true),
('pending','live-roulette','Live Roulette','roulette',false,true),
('pending','live-baccarat','Live Baccarat','baccarat',false,true),
('pending','live-game-show','Live Game Show','game_show',false,true)
on conflict (provider_key,provider_game_id) do nothing;
