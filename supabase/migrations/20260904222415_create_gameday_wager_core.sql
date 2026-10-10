create extension if not exists pgcrypto;

create type public.wager_type as enum ('single','parlay');
create type public.wager_status as enum ('pending','accepted','won','lost','void','cancelled');
create type public.transaction_type as enum ('deposit','withdrawal','wager_debit','wager_credit','refund','adjustment');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance numeric(14,2) not null default 0 check (balance >= 0),
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wagers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wager_type public.wager_type not null,
  stake numeric(14,2) not null check (stake > 0),
  potential_return numeric(14,2) not null check (potential_return >= 0),
  status public.wager_status not null default 'pending',
  placed_at timestamptz not null default now(),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wager_selections (
  id uuid primary key default gen_random_uuid(),
  wager_id uuid not null references public.wagers(id) on delete cascade,
  event_id text not null,
  event_name text not null,
  sport_key text,
  market_key text not null,
  market_title text,
  selection_name text not null,
  description text,
  point numeric,
  american_odds integer not null,
  created_at timestamptz not null default now()
);

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wager_id uuid references public.wagers(id) on delete set null,
  transaction_type public.transaction_type not null,
  amount numeric(14,2) not null check (amount > 0),
  balance_after numeric(14,2),
  note text,
  created_at timestamptz not null default now()
);

create index wagers_user_id_idx on public.wagers(user_id);
create index wagers_status_idx on public.wagers(status);
create index wager_selections_wager_id_idx on public.wager_selections(wager_id);
create index wallet_transactions_user_id_idx on public.wallet_transactions(user_id);
create index wallet_transactions_wager_id_idx on public.wallet_transactions(wager_id);

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.wagers enable row level security;
alter table public.wager_selections enable row level security;
alter table public.wallet_transactions enable row level security;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "wallets_select_own" on public.wallets for select using (auth.uid() = user_id);

create policy "wagers_select_own" on public.wagers for select using (auth.uid() = user_id);
create policy "wager_selections_select_own" on public.wager_selections for select using (
  exists (
    select 1 from public.wagers w
    where w.id = wager_selections.wager_id
      and w.user_id = auth.uid()
  )
);
create policy "wallet_transactions_select_own" on public.wallet_transactions for select using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email));

  insert into public.wallets (user_id)
  values (new.id);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

create trigger wallets_set_updated_at before update on public.wallets
for each row execute function public.set_updated_at();

create trigger wagers_set_updated_at before update on public.wagers
for each row execute function public.set_updated_at();
