create table if not exists public.video_poker_hands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null default 'jacks_or_better',
  stake numeric not null check (stake > 0),
  initial_hand jsonb not null,
  final_hand jsonb,
  deck_remaining jsonb not null,
  status text not null default 'active' check (status in ('active','settled')),
  result text,
  multiplier numeric not null default 0 check (multiplier >= 0),
  payout numeric not null default 0 check (payout >= 0),
  is_test boolean not null default true,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create unique index if not exists video_poker_one_active_per_user
  on public.video_poker_hands(user_id)
  where status = 'active';

alter table public.video_poker_hands enable row level security;
revoke all on public.video_poker_hands from anon, authenticated;
grant select, insert, update on public.video_poker_hands to service_role;

create or replace function public.deal_video_poker_test_atomic(
  p_user_id uuid,
  p_stake numeric,
  p_initial_hand jsonb,
  p_deck_remaining jsonb,
  p_game text default 'jacks_or_better'
)
returns table(hand_id uuid, balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_hand_id uuid;
begin
  if p_stake is null or p_stake <= 0 or p_stake > 1000 then
    raise exception 'Invalid stake';
  end if;
  if p_game <> 'jacks_or_better' then
    raise exception 'Unsupported video poker game';
  end if;
  if jsonb_array_length(p_initial_hand) <> 5 then
    raise exception 'Invalid initial hand';
  end if;

  if exists(select 1 from public.video_poker_hands where user_id=p_user_id and status='active') then
    raise exception 'ACTIVE_HAND_EXISTS';
  end if;

  select w.balance into v_balance
  from public.wallets w
  where w.user_id=p_user_id
  for update;

  if v_balance is null then raise exception 'Wallet not found'; end if;
  if v_balance < p_stake then raise exception 'Insufficient test balance'; end if;

  update public.wallets w
  set balance=w.balance-p_stake, updated_at=now()
  where w.user_id=p_user_id
  returning w.balance into v_balance;

  insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note)
  values(p_user_id,'wager_debit',p_stake,v_balance,'Test video poker deal debit');

  insert into public.video_poker_hands(user_id,game,stake,initial_hand,deck_remaining,status,is_test)
  values(p_user_id,p_game,p_stake,p_initial_hand,p_deck_remaining,'active',true)
  returning id into v_hand_id;

  return query select v_hand_id,v_balance;
end;
$$;

create or replace function public.settle_video_poker_test_atomic(
  p_user_id uuid,
  p_hand_id uuid,
  p_final_hand jsonb,
  p_result text,
  p_multiplier numeric,
  p_payout numeric
)
returns table(hand_id uuid, payout numeric, balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_stake numeric;
begin
  if jsonb_array_length(p_final_hand) <> 5 then raise exception 'Invalid final hand'; end if;
  if p_multiplier is null or p_multiplier < 0 then raise exception 'Invalid multiplier'; end if;
  if p_payout is null or p_payout < 0 then raise exception 'Invalid payout'; end if;

  select stake into v_stake
  from public.video_poker_hands
  where id=p_hand_id and user_id=p_user_id and status='active'
  for update;

  if v_stake is null then raise exception 'Active hand not found'; end if;
  if round((v_stake*p_multiplier)::numeric,2) <> round(p_payout::numeric,2) then
    raise exception 'Payout mismatch';
  end if;

  select w.balance into v_balance from public.wallets w where w.user_id=p_user_id for update;
  if v_balance is null then raise exception 'Wallet not found'; end if;

  if p_payout > 0 then
    update public.wallets w
    set balance=w.balance+p_payout, updated_at=now()
    where w.user_id=p_user_id
    returning w.balance into v_balance;

    insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note)
    values(p_user_id,'wager_credit',p_payout,v_balance,'Test video poker payout');
  end if;

  update public.video_poker_hands
  set final_hand=p_final_hand,
      result=p_result,
      multiplier=p_multiplier,
      payout=p_payout,
      status='settled',
      settled_at=now()
  where id=p_hand_id and user_id=p_user_id;

  return query select p_hand_id,p_payout,v_balance;
end;
$$;

revoke all on function public.deal_video_poker_test_atomic(uuid,numeric,jsonb,jsonb,text) from public, anon, authenticated;
revoke all on function public.settle_video_poker_test_atomic(uuid,uuid,jsonb,text,numeric,numeric) from public, anon, authenticated;
grant execute on function public.deal_video_poker_test_atomic(uuid,numeric,jsonb,jsonb,text) to postgres, service_role;
grant execute on function public.settle_video_poker_test_atomic(uuid,uuid,jsonb,text,numeric,numeric) to postgres, service_role;
