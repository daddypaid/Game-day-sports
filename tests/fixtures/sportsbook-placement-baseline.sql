create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key);
create type public.wager_type as enum('single','parlay');
create type public.wager_status as enum('pending','accepted','won','lost','cancelled');
create table public.wallets(user_id uuid primary key,balance numeric(14,2),updated_at timestamptz);
create table public.wagers(id uuid primary key default gen_random_uuid(),user_id uuid,
  wager_type public.wager_type,stake numeric,potential_return numeric,status public.wager_status,
  placed_at timestamptz default now(),is_test boolean,placement_fingerprint text,placement_bucket bigint);
create table public.wager_selections(id uuid primary key default gen_random_uuid(),wager_id uuid,event_id text,
  event_name text,sport_key text,market_key text,market_title text,selection_name text,
  description text,point numeric,american_odds integer,quoted_at timestamptz);
create table public.wallet_transactions(id uuid primary key default gen_random_uuid(),user_id uuid,wager_id uuid,
  transaction_type text,amount numeric,balance_after numeric,note text);
-- Signature of the old placement path, whose execute grant must be retired.
create function public.place_test_wager_atomic(uuid,public.wager_type,numeric,numeric,jsonb)
returns void language sql as 'select';
grant execute on function public.place_test_wager_atomic(uuid,public.wager_type,numeric,numeric,jsonb) to service_role;
