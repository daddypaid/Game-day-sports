create table if not exists public.ultimate_texas_holdem_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ante numeric not null check (ante > 0),
  blind numeric not null check (blind > 0),
  play_bet numeric not null default 0 check (play_bet >= 0),
  player_hand jsonb not null,
  dealer_hand jsonb not null,
  deck_remaining jsonb not null,
  community jsonb not null default '[]'::jsonb,
  stage text not null check (stage in ('preflop','flop','river','settled')),
  status text not null default 'active' check (status in ('active','settled')),
  decision text,
  player_rank text,
  dealer_rank text,
  dealer_qualifies boolean,
  result text,
  payout numeric not null default 0 check (payout >= 0),
  is_test boolean not null default true,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create unique index if not exists ultimate_texas_holdem_one_active_per_user
on public.ultimate_texas_holdem_rounds(user_id)
where status='active';

alter table public.ultimate_texas_holdem_rounds enable row level security;
revoke all on public.ultimate_texas_holdem_rounds from anon, authenticated;

create or replace function public.deal_ultimate_texas_holdem_test_atomic(
  p_user_id uuid,
  p_ante numeric,
  p_player_hand jsonb,
  p_dealer_hand jsonb,
  p_deck_remaining jsonb
) returns table(round_id uuid, balance numeric)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_balance numeric;
  v_round uuid;
  v_cost numeric;
begin
  if p_ante is null or p_ante<=0 or p_ante>1000 then raise exception 'Invalid ante'; end if;
  if jsonb_array_length(p_player_hand)<>2 or jsonb_array_length(p_dealer_hand)<>2 then raise exception 'Invalid hole cards'; end if;
  if jsonb_array_length(p_deck_remaining)<>48 then raise exception 'Invalid remaining deck'; end if;
  if exists(select 1 from public.ultimate_texas_holdem_rounds where user_id=p_user_id and status='active') then raise exception 'ACTIVE_ROUND_EXISTS'; end if;
  v_cost := p_ante * 2;
  select w.balance into v_balance from public.wallets w where w.user_id=p_user_id for update;
  if v_balance is null then raise exception 'Wallet not found'; end if;
  if v_balance<v_cost then raise exception 'Insufficient test balance'; end if;
  update public.wallets w set balance=w.balance-v_cost,updated_at=now() where w.user_id=p_user_id returning w.balance into v_balance;
  insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note)
  values(p_user_id,'wager_debit',v_cost,v_balance,'Test Ultimate Texas Holdem Ante + Blind');
  insert into public.ultimate_texas_holdem_rounds(user_id,ante,blind,player_hand,dealer_hand,deck_remaining,community,stage,status,is_test)
  values(p_user_id,p_ante,p_ante,p_player_hand,p_dealer_hand,p_deck_remaining,'[]'::jsonb,'preflop','active',true)
  returning id into v_round;
  return query select v_round,v_balance;
end;
$$;

create or replace function public.advance_ultimate_texas_holdem_test_atomic(
  p_user_id uuid,
  p_round_id uuid,
  p_expected_stage text,
  p_new_stage text,
  p_community jsonb,
  p_play_multiplier integer default 0
) returns table(round_id uuid, balance numeric, play_bet numeric)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_balance numeric;
  v_ante numeric;
  v_play numeric;
begin
  if p_expected_stage not in ('preflop','flop','river') or p_new_stage not in ('flop','river','settled') then raise exception 'Invalid stage'; end if;
  if p_play_multiplier not in (0,1,2,4) then raise exception 'Invalid Play multiplier'; end if;
  select ante,play_bet into v_ante,v_play
  from public.ultimate_texas_holdem_rounds
  where id=p_round_id and user_id=p_user_id and status='active' and stage=p_expected_stage
  for update;
  if v_ante is null then raise exception 'Active round/stage not found'; end if;
  if v_play>0 and p_play_multiplier>0 then raise exception 'Play bet already placed'; end if;
  if p_play_multiplier>0 then
    v_play := v_ante*p_play_multiplier;
    select w.balance into v_balance from public.wallets w where w.user_id=p_user_id for update;
    if v_balance is null then raise exception 'Wallet not found'; end if;
    if v_balance<v_play then raise exception 'Insufficient test balance for Play bet'; end if;
    update public.wallets w set balance=w.balance-v_play,updated_at=now() where w.user_id=p_user_id returning w.balance into v_balance;
    insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note)
    values(p_user_id,'wager_debit',v_play,v_balance,'Test Ultimate Texas Holdem Play bet');
  else
    select w.balance into v_balance from public.wallets w where w.user_id=p_user_id;
  end if;
  update public.ultimate_texas_holdem_rounds
  set community=p_community,stage=p_new_stage,play_bet=case when p_play_multiplier>0 then v_play else play_bet end
  where id=p_round_id and user_id=p_user_id;
  return query select p_round_id,v_balance,case when p_play_multiplier>0 then v_play else v_play end;
end;
$$;

create or replace function public.settle_ultimate_texas_holdem_test_atomic(
  p_user_id uuid,
  p_round_id uuid,
  p_decision text,
  p_community jsonb,
  p_payout numeric,
  p_result text,
  p_player_rank text,
  p_dealer_rank text,
  p_dealer_qualifies boolean
) returns table(round_id uuid, payout numeric, balance numeric)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_balance numeric;
  v_id uuid;
begin
  if p_decision not in ('play','fold') then raise exception 'Invalid decision'; end if;
  if p_payout is null or p_payout<0 then raise exception 'Invalid payout'; end if;
  select id into v_id from public.ultimate_texas_holdem_rounds
  where id=p_round_id and user_id=p_user_id and status='active'
  for update;
  if v_id is null then raise exception 'Active round not found'; end if;
  select w.balance into v_balance from public.wallets w where w.user_id=p_user_id for update;
  if v_balance is null then raise exception 'Wallet not found'; end if;
  if p_payout>0 then
    update public.wallets w set balance=w.balance+p_payout,updated_at=now() where w.user_id=p_user_id returning w.balance into v_balance;
    insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note)
    values(p_user_id,'wager_credit',p_payout,v_balance,'Test Ultimate Texas Holdem payout');
  end if;
  update public.ultimate_texas_holdem_rounds
  set community=p_community,stage='settled',status='settled',decision=p_decision,payout=p_payout,result=p_result,
      player_rank=p_player_rank,dealer_rank=p_dealer_rank,dealer_qualifies=p_dealer_qualifies,settled_at=now()
  where id=p_round_id and user_id=p_user_id;
  return query select p_round_id,p_payout,v_balance;
end;
$$;

revoke all on function public.deal_ultimate_texas_holdem_test_atomic(uuid,numeric,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.advance_ultimate_texas_holdem_test_atomic(uuid,uuid,text,text,jsonb,integer) from public, anon, authenticated;
revoke all on function public.settle_ultimate_texas_holdem_test_atomic(uuid,uuid,text,jsonb,numeric,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.deal_ultimate_texas_holdem_test_atomic(uuid,numeric,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.advance_ultimate_texas_holdem_test_atomic(uuid,uuid,text,text,jsonb,integer) to service_role;
grant execute on function public.settle_ultimate_texas_holdem_test_atomic(uuid,uuid,text,jsonb,numeric,text,text,text,boolean) to service_role;
