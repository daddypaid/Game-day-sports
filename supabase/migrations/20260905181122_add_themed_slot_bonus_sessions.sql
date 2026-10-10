create table if not exists public.themed_slot_bonus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null check (game in ('midnight-monsters','galactic-rebellion')),
  bet_per_line numeric not null check (bet_per_line > 0),
  spins_remaining integer not null check (spins_remaining >= 0),
  total_spins integer not null check (total_spins > 0),
  total_payout numeric not null default 0 check (total_payout >= 0),
  status text not null default 'active' check (status in ('active','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists themed_slot_bonus_sessions_user_game_idx
  on public.themed_slot_bonus_sessions(user_id, game, status);

create table if not exists public.themed_slot_bonus_spins (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.themed_slot_bonus_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null,
  grid jsonb not null,
  payout numeric not null check (payout >= 0),
  feature text,
  created_at timestamptz not null default now()
);

create index if not exists themed_slot_bonus_spins_session_idx
  on public.themed_slot_bonus_spins(session_id, created_at);

alter table public.themed_slot_bonus_sessions enable row level security;
alter table public.themed_slot_bonus_spins enable row level security;

create policy "users_read_own_themed_bonus_sessions"
  on public.themed_slot_bonus_sessions for select
  using (auth.uid() = user_id);

create policy "users_read_own_themed_bonus_spins"
  on public.themed_slot_bonus_spins for select
  using (auth.uid() = user_id);

create or replace function public.settle_themed_bonus_spin_atomic(
  p_user_id uuid,
  p_session_id uuid,
  p_grid jsonb,
  p_payout numeric,
  p_feature text
)
returns table(balance numeric, spins_remaining integer, session_status text, total_payout numeric, bonus_spin_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session public.themed_slot_bonus_sessions%rowtype;
  v_balance numeric;
  v_spin_id uuid;
begin
  if p_payout is null or p_payout < 0 then
    raise exception 'Invalid bonus payout';
  end if;

  select * into v_session
  from public.themed_slot_bonus_sessions
  where id = p_session_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Bonus session not found';
  end if;

  if v_session.status <> 'active' or v_session.spins_remaining <= 0 then
    raise exception 'Bonus session is not active';
  end if;

  select w.balance into v_balance
  from public.wallets w
  where w.user_id = p_user_id
  for update;

  if v_balance is null then
    raise exception 'Wallet not found';
  end if;

  if p_payout > 0 then
    update public.wallets
      set balance = balance + p_payout,
          updated_at = now()
      where user_id = p_user_id
      returning balance into v_balance;

    insert into public.wallet_transactions(user_id, transaction_type, amount, balance_after, note)
    values (p_user_id, 'wager_credit', p_payout, v_balance, 'Themed slot free-spin payout');
  end if;

  update public.themed_slot_bonus_sessions
  set spins_remaining = spins_remaining - 1,
      total_payout = total_payout + p_payout,
      status = case when spins_remaining - 1 <= 0 then 'completed' else 'active' end,
      updated_at = now()
  where id = p_session_id
  returning spins_remaining, status, total_payout
    into v_session.spins_remaining, v_session.status, v_session.total_payout;

  insert into public.themed_slot_bonus_spins(session_id, user_id, game, grid, payout, feature)
  values (p_session_id, p_user_id, v_session.game, p_grid, p_payout, p_feature)
  returning id into v_spin_id;

  return query
  select v_balance, v_session.spins_remaining, v_session.status, v_session.total_payout, v_spin_id;
end;
$function$;

