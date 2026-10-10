-- A deal intent remains identifiable after timeouts, reloads and settlement.
-- Only authenticated Edge Functions using service_role may read/write receipts.
create table if not exists public.card_game_deal_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null check (game in ('blackjack','baccarat')),
  request_id uuid not null,
  stake numeric not null check (stake > 0 and stake <= 10000),
  bet_type text,
  target_id uuid,
  rejection text,
  created_at timestamptz not null default now(),
  primary key (user_id, game, request_id),
  check ((target_id is not null and rejection is null) or
         (target_id is null and rejection is not null and rejection = 'Insufficient test balance')),
  check ((game = 'blackjack' and bet_type is null) or
         (game = 'baccarat' and bet_type is not null and bet_type in ('player','banker','tie')))
);
alter table public.card_game_deal_requests enable row level security;
revoke all on public.card_game_deal_requests from public, anon, authenticated;
grant all on public.card_game_deal_requests to service_role;

create or replace function public.start_blackjack_test_hand_idempotent(
  p_user_id uuid, p_request_id uuid, p_stake numeric,
  p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb,
  p_player_total integer, p_dealer_total integer,
  p_status public.blackjack_hand_status, p_payout numeric
)
returns table(hand_id uuid, balance numeric, replayed boolean, error text)
language plpgsql security definer set search_path = public
as $function$
declare
  v_balance numeric;
  v_target uuid;
  v_receipt public.card_game_deal_requests%rowtype;
begin
  if p_request_id is null then raise exception 'Deal request ID is required'; end if;
  if p_stake is null or p_stake <= 0 or p_stake > 10000 or trunc(p_stake) <> p_stake then
    raise exception 'Invalid stake';
  end if;
  -- Serializes both first acceptance and replay for this wallet, including
  -- concurrent same-ID requests that independently shuffled different cards.
  select w.balance into v_balance from public.wallets w
  where w.user_id = p_user_id for update;
  if v_balance is null then raise exception 'Wallet not found'; end if;
  select r.* into v_receipt from public.card_game_deal_requests r
  where r.user_id = p_user_id and r.game = 'blackjack' and r.request_id = p_request_id;
  if found then
    if v_receipt.stake <> p_stake then raise exception 'Deal request conflicts with its original wager'; end if;
    return query select v_receipt.target_id, v_balance, true, v_receipt.rejection;
    return;
  end if;
  -- Another tab may already have an active hand. Reuse it without debiting.
  select h.id into v_target from public.blackjack_hands h
  where h.user_id = p_user_id and h.is_test = true and h.status = 'active'
  order by h.created_at desc limit 1;
  if v_target is null then
    if v_balance < p_stake then
      -- Persist rejection rather than raising/rolling it back. A delayed copy
      -- cannot accept this discarded intent after a later refill.
      insert into public.card_game_deal_requests(user_id,game,request_id,stake,rejection)
      values(p_user_id,'blackjack',p_request_id,p_stake,'Insufficient test balance');
      return query select null::uuid, v_balance, false, 'Insufficient test balance'::text;
      return;
    end if;
    select s.hand_id, s.balance into v_target, v_balance
    from public.start_blackjack_test_hand_v2(p_user_id,p_stake,p_player_cards,
      p_dealer_cards,p_shoe,p_player_total,p_dealer_total,p_status,p_payout) s;
  end if;
  insert into public.card_game_deal_requests(user_id,game,request_id,stake,target_id)
  values(p_user_id,'blackjack',p_request_id,p_stake,v_target);
  return query select v_target, v_balance, false, null::text;
end;
$function$;

create or replace function public.place_baccarat_test_round_idempotent(
  p_user_id uuid, p_request_id uuid, p_stake numeric, p_bet_type text,
  p_player_cards jsonb, p_banker_cards jsonb, p_player_total integer,
  p_banker_total integer, p_result text, p_payout numeric
)
returns table(round_id uuid, balance numeric, replayed boolean, error text)
language plpgsql security definer set search_path = public
as $function$
declare
  v_balance numeric;
  v_target uuid;
  v_receipt public.card_game_deal_requests%rowtype;
begin
  if p_request_id is null then raise exception 'Deal request ID is required'; end if;
  if p_stake is null or p_stake <= 0 or p_stake > 10000 or trunc(p_stake) <> p_stake then
    raise exception 'Invalid stake';
  end if;
  if p_bet_type is null or p_bet_type not in ('player','banker','tie') then raise exception 'Invalid baccarat bet'; end if;
  select w.balance into v_balance from public.wallets w
  where w.user_id = p_user_id for update;
  if v_balance is null then raise exception 'Wallet not found'; end if;
  select r.* into v_receipt from public.card_game_deal_requests r
  where r.user_id = p_user_id and r.game = 'baccarat' and r.request_id = p_request_id;
  if found then
    if v_receipt.stake <> p_stake or v_receipt.bet_type <> p_bet_type then
      raise exception 'Deal request conflicts with its original wager';
    end if;
    return query select v_receipt.target_id, v_balance, true, v_receipt.rejection;
    return;
  end if;
  if v_balance < p_stake then
    insert into public.card_game_deal_requests(user_id,game,request_id,stake,bet_type,rejection)
    values(p_user_id,'baccarat',p_request_id,p_stake,p_bet_type,'Insufficient test balance');
    return query select null::uuid, v_balance, false, 'Insufficient test balance'::text;
    return;
  end if;
  select s.round_id, s.balance into v_target, v_balance
  from public.place_baccarat_test_round_atomic(p_user_id,p_stake,p_bet_type,
    p_player_cards,p_banker_cards,p_player_total,p_banker_total,p_result,p_payout) s;
  insert into public.card_game_deal_requests(user_id,game,request_id,stake,bet_type,target_id)
  values(p_user_id,'baccarat',p_request_id,p_stake,p_bet_type,v_target);
  return query select v_target, v_balance, false, null::text;
end;
$function$;

revoke all on function public.start_blackjack_test_hand_idempotent(uuid,uuid,numeric,jsonb,jsonb,jsonb,integer,integer,public.blackjack_hand_status,numeric) from public, anon, authenticated;
grant execute on function public.start_blackjack_test_hand_idempotent(uuid,uuid,numeric,jsonb,jsonb,jsonb,integer,integer,public.blackjack_hand_status,numeric) to service_role;
revoke all on function public.place_baccarat_test_round_idempotent(uuid,uuid,numeric,text,jsonb,jsonb,integer,integer,text,numeric) from public, anon, authenticated;
grant execute on function public.place_baccarat_test_round_idempotent(uuid,uuid,numeric,text,jsonb,jsonb,integer,integer,text,numeric) to service_role;
