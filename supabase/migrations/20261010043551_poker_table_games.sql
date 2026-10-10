-- Server-owned test poker hands. Hidden cards/decks are never readable by browser roles.
create table public.poker_test_hands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null check (game in ('holdem','omaha','stud','draw')),
  status text not null check (status in ('active','settled')),
  action_count integer not null check (action_count >= 0),
  stake numeric not null check (stake > 0 and stake <= 10000 and stake = round(stake,2)),
  committed numeric not null check (committed >= stake and committed = round(committed,2)),
  payout numeric not null default 0 check (payout >= 0 and payout = round(payout,2)),
  private_state jsonb not null check (jsonb_typeof(private_state) = 'object'),
  started_request_id uuid not null,
  last_request_id uuid not null,
  is_test boolean not null default true check (is_test),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create unique index poker_test_hands_one_active_per_game_idx
  on public.poker_test_hands(user_id,game) where status = 'active';
create index poker_test_hands_user_game_latest_idx
  on public.poker_test_hands(user_id,game,created_at desc);

-- Persist the exact committed state/balance for replaying a lost response once.
create table public.poker_test_actions (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  hand_id uuid not null references public.poker_test_hands(id) on delete cascade,
  game text not null check (game in ('holdem','omaha','stud','draw')),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  state_result jsonb not null check (jsonb_typeof(state_result) = 'object'),
  balance numeric not null check (balance >= 0),
  started_request_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id,request_id)
);
alter table public.poker_test_hands enable row level security;
alter table public.poker_test_actions enable row level security;
revoke all on public.poker_test_hands, public.poker_test_actions from public,anon,authenticated;
grant select,insert,update,delete on public.poker_test_hands, public.poker_test_actions to service_role;

-- The authenticated Edge Function computes all rules and outcomes. This RPC is
-- its only mutation boundary: owner-wallet lock, receipt lookup, version check,
-- debit, hand update, settlement and receipt are committed together.
create or replace function public.commit_poker_test_hand_atomic(
  p_user_id uuid,
  p_game text,
  p_request_id uuid,
  p_request_payload jsonb,
  p_hand_id uuid,
  p_expected_action_count integer,
  p_expected_balance numeric,
  p_state jsonb,
  p_debit numeric,
  p_payout numeric
)
returns table (
  hand_id uuid, private_state jsonb, balance numeric,
  started_request_id uuid, last_request_id uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_balance numeric;
  v_hand public.poker_test_hands%rowtype;
  v_receipt public.poker_test_actions%rowtype;
  v_count integer;
  v_status text;
  v_stake numeric;
  v_committed numeric;
  v_opponent_committed numeric;
  v_pot numeric;
begin
  if p_user_id is null or p_request_id is null then raise exception 'INVALID_REQUEST'; end if;
  if p_game is null or p_game not in ('holdem','omaha','stud','draw') then raise exception 'INVALID_GAME'; end if;
  if p_request_payload is null or jsonb_typeof(p_request_payload) <> 'object'
     or p_request_payload->>'game' is distinct from p_game then raise exception 'INVALID_REQUEST'; end if;

  -- All poker mutations acquire the wallet first, even when settling a hand.
  select w.balance into v_balance from public.wallets w where w.user_id = p_user_id for update;
  if v_balance is null then raise exception 'WALLET_NOT_FOUND'; end if;
  select a.* into v_receipt from public.poker_test_actions a
    where a.user_id = p_user_id and a.request_id = p_request_id;
  if found then
    if v_receipt.game is distinct from p_game or v_receipt.request_payload is distinct from p_request_payload then
      raise exception 'REQUEST_CONFLICT';
    end if;
    return query select v_receipt.hand_id,v_receipt.state_result,v_receipt.balance,
      v_receipt.started_request_id,v_receipt.request_id;
    return;
  end if;
  if p_expected_balance is null or p_expected_balance is distinct from v_balance then
    raise exception 'WALLET_CHANGED';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' or p_state->>'game' is distinct from p_game
     or p_state->>'status' is null or p_state->>'status' not in ('active','settled') then raise exception 'INVALID_STATE'; end if;
  v_count := (p_state->>'action_count')::integer;
  v_status := p_state->>'status';
  v_stake := (p_state->>'stakeCents')::numeric / 100;
  v_committed := (p_state->>'committedCents')::numeric / 100;
  v_opponent_committed := (p_state->>'opponentCommittedCents')::numeric / 100;
  v_pot := (p_state->>'potCents')::numeric / 100;
  if v_count is null or v_count < 0 or v_stake is null or v_stake <= 0 or v_stake > 10000
     or v_committed is null or v_committed < v_stake or v_opponent_committed is null or v_opponent_committed < 0
     or v_pot is null or v_pot <> v_committed + v_opponent_committed
     or v_stake <> round(v_stake,2) or v_committed <> round(v_committed,2)
     or v_opponent_committed <> round(v_opponent_committed,2)
     or p_debit is null or p_debit < 0 or p_debit <> round(p_debit,2)
     or p_payout is null or p_payout < 0 or p_payout > v_pot or p_payout <> round(p_payout,2)
     or (p_state->>'payoutCents')::numeric is distinct from p_payout * 100
     or (v_status = 'active' and p_payout <> 0) then raise exception 'INVALID_STATE'; end if;
  if v_balance < p_debit then raise exception 'INSUFFICIENT_BALANCE'; end if;

  if p_hand_id is null then
    if p_request_payload->>'action' is distinct from 'deal'
       or (p_request_payload->>'stake')::numeric is distinct from v_stake
       or p_expected_action_count is distinct from -1
       or v_count <> 0 or p_debit <> v_stake
       or v_committed <> v_stake then raise exception 'INVALID_STATE'; end if;
    if exists(select 1 from public.poker_test_hands h
      where h.user_id = p_user_id and h.game = p_game and h.status = 'active') then
      raise exception 'ACTIVE_HAND_EXISTS';
    end if;
    insert into public.poker_test_hands(user_id,game,status,action_count,stake,committed,payout,
      private_state,started_request_id,last_request_id,is_test,settled_at)
    values(p_user_id,p_game,v_status,v_count,v_stake,v_committed,p_payout,
      p_state,p_request_id,p_request_id,true,case when v_status = 'settled' then now() else null end) returning * into v_hand;
  else
    select h.* into v_hand from public.poker_test_hands h
      where h.id = p_hand_id and h.user_id = p_user_id and h.game = p_game and h.is_test for update;
    if not found then raise exception 'HAND_NOT_FOUND'; end if;
    if v_hand.status <> 'active' or v_hand.action_count is distinct from p_expected_action_count then
      raise exception 'HAND_CHANGED';
    end if;
    if p_request_payload->>'action' = 'deal'
       or p_request_payload->>'hand_id' is distinct from p_hand_id::text
       or (p_request_payload->>'action_count')::integer is distinct from p_expected_action_count
       or v_count <> p_expected_action_count + 1 or v_stake <> v_hand.stake
       or v_committed <> v_hand.committed + p_debit then raise exception 'INVALID_STATE'; end if;
    update public.poker_test_hands h set status = v_status, action_count = v_count,
      committed = v_committed, payout = p_payout, private_state = p_state,last_request_id = p_request_id,
      settled_at = case when v_status = 'settled' then now() else null end
      where h.id = p_hand_id returning * into v_hand;
  end if;

  if p_debit > 0 then
    update public.wallets w set balance = w.balance - p_debit,updated_at = now()
      where w.user_id = p_user_id returning w.balance into v_balance;
    insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note)
      values(p_user_id,'wager_debit',p_debit,v_balance,'GameDay test poker wager debit');
  end if;
  if p_payout > 0 then
    update public.wallets w set balance = w.balance + p_payout,updated_at = now()
      where w.user_id = p_user_id returning w.balance into v_balance;
    insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note)
      values(p_user_id,'wager_credit',p_payout,v_balance,'GameDay test poker payout');
  end if;
  insert into public.poker_test_actions(user_id,request_id,hand_id,game,request_payload,state_result,balance,started_request_id)
    values(p_user_id,p_request_id,v_hand.id,p_game,p_request_payload,p_state,v_balance,v_hand.started_request_id);
  return query select v_hand.id,p_state,v_balance,v_hand.started_request_id,p_request_id;
end;
$function$;
revoke all on function public.commit_poker_test_hand_atomic(uuid,text,uuid,jsonb,uuid,integer,numeric,jsonb,numeric,numeric)
  from public,anon,authenticated;
grant execute on function public.commit_poker_test_hand_atomic(uuid,text,uuid,jsonb,uuid,integer,numeric,jsonb,numeric,numeric)
  to service_role;
