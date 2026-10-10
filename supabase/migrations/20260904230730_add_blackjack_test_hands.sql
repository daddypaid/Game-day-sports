do $$ begin
  create type public.blackjack_hand_status as enum ('active','player_blackjack','player_bust','dealer_bust','won','lost','push');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.blackjack_hands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stake numeric(14,2) not null check (stake > 0),
  status public.blackjack_hand_status not null default 'active',
  player_cards jsonb not null default '[]'::jsonb,
  dealer_cards jsonb not null default '[]'::jsonb,
  player_total integer,
  dealer_total integer,
  payout numeric(14,2) not null default 0,
  is_test boolean not null default true,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index if not exists blackjack_hands_user_id_idx on public.blackjack_hands(user_id);
create index if not exists blackjack_hands_status_idx on public.blackjack_hands(status);

alter table public.blackjack_hands enable row level security;

drop policy if exists blackjack_hands_select_own on public.blackjack_hands;
create policy blackjack_hands_select_own on public.blackjack_hands
for select using (auth.uid() = user_id);

create or replace function public.start_blackjack_test_hand_atomic(
  p_user_id uuid,
  p_stake numeric,
  p_player_cards jsonb,
  p_dealer_cards jsonb,
  p_player_total integer,
  p_dealer_total integer,
  p_status public.blackjack_hand_status,
  p_payout numeric
)
returns table (
  hand_id uuid,
  hand_status public.blackjack_hand_status,
  balance numeric,
  payout numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_hand_id uuid;
begin
  if p_stake <= 0 then
    raise exception 'Invalid stake';
  end if;

  select w.balance into v_balance
  from public.wallets w
  where w.user_id = p_user_id
  for update;

  if v_balance is null then
    raise exception 'Wallet not found';
  end if;

  if v_balance < p_stake then
    raise exception 'Insufficient test balance';
  end if;

  update public.wallets as w
  set balance = w.balance - p_stake,
      updated_at = now()
  where w.user_id = p_user_id
  returning w.balance into v_balance;

  insert into public.blackjack_hands (
    user_id, stake, status, player_cards, dealer_cards,
    player_total, dealer_total, payout, is_test,
    settled_at
  ) values (
    p_user_id, p_stake, p_status, p_player_cards, p_dealer_cards,
    p_player_total, p_dealer_total, coalesce(p_payout,0), true,
    case when p_status = 'active' then null else now() end
  ) returning id into v_hand_id;

  insert into public.wallet_transactions (
    user_id, wager_id, transaction_type, amount, balance_after, note
  ) values (
    p_user_id, null, 'wager_debit', p_stake, v_balance, 'Blackjack test wager debit'
  );

  if p_status <> 'active' and coalesce(p_payout,0) > 0 then
    update public.wallets as w
    set balance = w.balance + p_payout,
        updated_at = now()
    where w.user_id = p_user_id
    returning w.balance into v_balance;

    insert into public.wallet_transactions (
      user_id, wager_id, transaction_type, amount, balance_after, note
    ) values (
      p_user_id, null, 'wager_credit', p_payout, v_balance, 'Blackjack test payout'
    );
  end if;

  return query
  select v_hand_id, p_status, v_balance, coalesce(p_payout,0);
end;
$$;

create or replace function public.finish_blackjack_test_hand_atomic(
  p_user_id uuid,
  p_hand_id uuid,
  p_status public.blackjack_hand_status,
  p_player_cards jsonb,
  p_dealer_cards jsonb,
  p_player_total integer,
  p_dealer_total integer,
  p_payout numeric
)
returns table (
  hand_id uuid,
  hand_status public.blackjack_hand_status,
  balance numeric,
  payout numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_stake numeric;
  v_current_status public.blackjack_hand_status;
begin
  select h.stake, h.status
  into v_stake, v_current_status
  from public.blackjack_hands h
  where h.id = p_hand_id and h.user_id = p_user_id and h.is_test = true
  for update;

  if v_stake is null then
    raise exception 'Blackjack hand not found';
  end if;

  if v_current_status <> 'active' then
    raise exception 'Blackjack hand already settled';
  end if;

  update public.blackjack_hands h
  set status = p_status,
      player_cards = p_player_cards,
      dealer_cards = p_dealer_cards,
      player_total = p_player_total,
      dealer_total = p_dealer_total,
      payout = coalesce(p_payout,0),
      settled_at = now()
  where h.id = p_hand_id;

  select w.balance into v_balance
  from public.wallets w
  where w.user_id = p_user_id
  for update;

  if coalesce(p_payout,0) > 0 then
    update public.wallets as w
    set balance = w.balance + p_payout,
        updated_at = now()
    where w.user_id = p_user_id
    returning w.balance into v_balance;

    insert into public.wallet_transactions (
      user_id, wager_id, transaction_type, amount, balance_after, note
    ) values (
      p_user_id, null, 'wager_credit', p_payout, v_balance, 'Blackjack test payout'
    );
  end if;

  return query
  select p_hand_id, p_status, v_balance, coalesce(p_payout,0);
end;
$$;

revoke all on function public.start_blackjack_test_hand_atomic(uuid,numeric,jsonb,jsonb,integer,integer,public.blackjack_hand_status,numeric) from public, anon, authenticated;
revoke all on function public.finish_blackjack_test_hand_atomic(uuid,uuid,public.blackjack_hand_status,jsonb,jsonb,integer,integer,numeric) from public, anon, authenticated;
grant execute on function public.start_blackjack_test_hand_atomic(uuid,numeric,jsonb,jsonb,integer,integer,public.blackjack_hand_status,numeric) to service_role;
grant execute on function public.finish_blackjack_test_hand_atomic(uuid,uuid,public.blackjack_hand_status,jsonb,jsonb,integer,integer,numeric) to service_role;
