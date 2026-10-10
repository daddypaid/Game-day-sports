-- Insurance is a separate half-stake wager decided before the dealer peek.
-- Existing hands keep their already-peeked state; only new Ace-upcard deals offer it.
alter table public.blackjack_hands
  add column if not exists original_stake numeric(14,2),
  add column if not exists insurance_status text not null default 'not_offered'
    check (insurance_status in ('not_offered','pending','accepted','declined')),
  add column if not exists insurance_stake numeric(14,2) not null default 0 check (insurance_stake >= 0),
  add column if not exists insurance_payout numeric(14,2) not null default 0 check (insurance_payout >= 0);

create or replace function public.initialize_blackjack_insurance()
returns trigger language plpgsql security invoker set search_path = ''
as $function$
begin
  new.original_stake := new.stake;
  new.insurance_status := case when pg_catalog.current_setting('gameday.blackjack_insurance',true) = 'on' and new.status = 'active' and new.dealer_cards->0->>'rank' = 'A' then 'pending' else 'not_offered' end;
  new.insurance_stake := 0;
  new.insurance_payout := 0;
  return new;
end;
$function$;
revoke all on function public.initialize_blackjack_insurance() from public, anon, authenticated;
drop trigger if exists initialize_blackjack_insurance on public.blackjack_hands;
create trigger initialize_blackjack_insurance before insert on public.blackjack_hands
for each row execute function public.initialize_blackjack_insurance();

-- Cached controllers have no insurance controls. Only updated durable clients
-- call this wrapper; legacy deals retain their existing completed-peek behavior.
create or replace function public.start_blackjack_test_hand_insured(
  p_user_id uuid, p_request_id uuid, p_stake numeric,
  p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb,
  p_player_total integer, p_dealer_total integer,
  p_status public.blackjack_hand_status, p_payout numeric
)
returns table(hand_id uuid, balance numeric, replayed boolean, error text)
language plpgsql security invoker set search_path = ''
as $function$
begin
  perform pg_catalog.set_config('gameday.blackjack_insurance','on',true);
  return query select s.hand_id,s.balance,s.replayed,s.error
  from public.start_blackjack_test_hand_idempotent(p_user_id,p_request_id,p_stake,
    p_player_cards,p_dealer_cards,p_shoe,p_player_total,p_dealer_total,p_status,p_payout) s;
  perform pg_catalog.set_config('gameday.blackjack_insurance','off',true);
end;
$function$;
revoke all on function public.start_blackjack_test_hand_insured(uuid,uuid,numeric,jsonb,jsonb,jsonb,integer,integer,public.blackjack_hand_status,numeric) from public, anon, authenticated;
grant execute on function public.start_blackjack_test_hand_insured(uuid,uuid,numeric,jsonb,jsonb,jsonb,integer,integer,public.blackjack_hand_status,numeric) to service_role;

create or replace function public.decide_blackjack_test_insurance(
  p_user_id uuid, p_hand_id uuid, p_expected_action_count integer, p_accept boolean
)
returns table(hand_id uuid, balance numeric, replayed boolean)
language plpgsql security invoker set search_path = ''
as $function$
declare
  v_hand public.blackjack_hands%rowtype;
  v_balance numeric;
  v_insurance numeric := 0;
  v_insurance_payout numeric := 0;
  v_main_payout numeric := 0;
  v_status public.blackjack_hand_status := 'active';
  v_dealer_blackjack boolean;
  v_player_blackjack boolean;
  v_choice text := case when p_accept then 'accepted' else 'declined' end;
begin
  if p_accept is null then raise exception 'Choose insurance or decline'; end if;
  -- Same lock order as deal/advance: wallet first, then hand.
  select w.balance into v_balance from public.wallets w where w.user_id = p_user_id for update;
  if v_balance is null then raise exception 'Wallet not found'; end if;
  select h.* into v_hand from public.blackjack_hands h
  where h.id = p_hand_id and h.user_id = p_user_id and h.is_test = true for update;
  if not found then raise exception 'Blackjack hand not found'; end if;
  if v_hand.insurance_status in ('accepted','declined') then
    if v_hand.insurance_status <> v_choice then raise exception 'Insurance decision already saved'; end if;
    return query select p_hand_id, v_balance, true;
    return;
  end if;
  if v_hand.status <> 'active' or v_hand.insurance_status <> 'pending' or
     v_hand.dealer_cards->0->>'rank' <> 'A' or jsonb_array_length(v_hand.dealer_cards) <> 2 then
    raise exception 'Insurance is not available for this hand';
  end if;
  if p_expected_action_count is null or v_hand.action_count <> p_expected_action_count then
    raise exception 'Blackjack hand changed; refresh and try again';
  end if;
  if p_accept then
    v_insurance := round(coalesce(v_hand.original_stake,v_hand.stake) / 2, 2);
    if v_balance < v_insurance then raise exception 'Insufficient test balance for insurance'; end if;
    update public.wallets w set balance = w.balance - v_insurance, updated_at = now()
    where w.user_id = p_user_id returning w.balance into v_balance;
    insert into public.wallet_transactions(user_id,wager_id,transaction_type,amount,balance_after,note)
    values(p_user_id,null,'wager_debit',v_insurance,v_balance,'Blackjack test insurance wager debit');
  end if;
  -- Read the persisted hidden hole card inside this atomic decision.
  v_dealer_blackjack := v_hand.dealer_cards->1->>'rank' in ('10','J','Q','K');
  v_player_blackjack := jsonb_array_length(v_hand.player_cards) = 2 and v_hand.player_total = 21;
  if v_dealer_blackjack then
    v_status := case when v_player_blackjack then 'push'::public.blackjack_hand_status else 'lost'::public.blackjack_hand_status end;
    v_main_payout := case when v_player_blackjack then v_hand.stake else 0 end;
    if p_accept then v_insurance_payout := v_insurance * 3; end if;
  elsif v_player_blackjack then
    v_status := 'player_blackjack';
    v_main_payout := round(v_hand.stake * 2.5, 2);
  end if;
  update public.blackjack_hands h set insurance_status = v_choice,
    insurance_stake = v_insurance, insurance_payout = v_insurance_payout,
    status = v_status, payout = v_main_payout, action_count = h.action_count + 1,
    settled_at = case when v_status = 'active' then null else now() end
  where h.id = p_hand_id;
  if v_insurance_payout > 0 then
    update public.wallets w set balance = w.balance + v_insurance_payout, updated_at = now()
    where w.user_id = p_user_id returning w.balance into v_balance;
    insert into public.wallet_transactions(user_id,wager_id,transaction_type,amount,balance_after,note)
    values(p_user_id,null,'wager_credit',v_insurance_payout,v_balance,'Blackjack test insurance payout (2:1 plus wager returned)');
  end if;
  if v_main_payout > 0 then
    update public.wallets w set balance = w.balance + v_main_payout, updated_at = now()
    where w.user_id = p_user_id returning w.balance into v_balance;
    insert into public.wallet_transactions(user_id,wager_id,transaction_type,amount,balance_after,note)
    values(p_user_id,null,'wager_credit',v_main_payout,v_balance,'Blackjack test payout');
  end if;
  return query select p_hand_id, v_balance, false;
end;
$function$;
revoke all on function public.decide_blackjack_test_insurance(uuid,uuid,integer,boolean) from public, anon, authenticated;
grant execute on function public.decide_blackjack_test_insurance(uuid,uuid,integer,boolean) to service_role;

create or replace function public.advance_blackjack_test_hand_v3(
  p_user_id uuid,
  p_hand_id uuid,
  p_expected_action_count integer,
  p_status public.blackjack_hand_status,
  p_stake numeric,
  p_player_cards jsonb,
  p_player_hands jsonb,
  p_active_hand_index integer,
  p_dealer_cards jsonb,
  p_shoe jsonb,
  p_player_total integer,
  p_dealer_total integer,
  p_payout numeric,
  p_additional_debit numeric
)
returns table(
  hand_id uuid,
  hand_status public.blackjack_hand_status,
  balance numeric,
  payout numeric,
  action_count integer
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_balance numeric;
  v_stake numeric;
  v_count integer;
  v_status public.blackjack_hand_status;
  v_insurance_status text;
  v_debit numeric := coalesce(p_additional_debit, 0);
begin
  select w.balance into v_balance
  from public.wallets w where w.user_id = p_user_id for update;
  if v_balance is null then raise exception 'Wallet not found'; end if;

  select h.stake, h.action_count, h.status, h.insurance_status
  into v_stake, v_count, v_status, v_insurance_status
  from public.blackjack_hands h
  where h.id = p_hand_id and h.user_id = p_user_id and h.is_test = true
  for update;

  if v_stake is null then raise exception 'Blackjack hand not found'; end if;
  if v_insurance_status = 'pending' then raise exception 'Choose insurance or decline before playing'; end if;
  if v_status <> 'active' then raise exception 'Blackjack hand already settled'; end if;
  if v_count <> p_expected_action_count then raise exception 'Blackjack hand changed; refresh and try again'; end if;
  if v_debit < 0 then raise exception 'Invalid additional wager'; end if;
  if p_stake <> v_stake + v_debit then raise exception 'Blackjack stake mismatch'; end if;

  if v_balance < v_debit then raise exception 'Insufficient test balance'; end if;

  if v_debit > 0 then
    update public.wallets as w
    set balance = w.balance - v_debit, updated_at = now()
    where w.user_id = p_user_id
    returning w.balance into v_balance;

    insert into public.wallet_transactions (
      user_id, wager_id, transaction_type, amount, balance_after, note
    ) values (
      p_user_id, null, 'wager_debit', v_debit, v_balance,
      'Blackjack test additional wager debit'
    );
  end if;

  update public.blackjack_hands h
  set status = p_status,
      stake = p_stake,
      player_cards = p_player_cards,
      player_hands = p_player_hands,
      active_hand_index = p_active_hand_index,
      dealer_cards = p_dealer_cards,
      shoe = p_shoe,
      player_total = p_player_total,
      dealer_total = p_dealer_total,
      payout = coalesce(p_payout, 0),
      action_count = h.action_count + 1,
      settled_at = case when p_status = 'active' then null else now() end
  where h.id = p_hand_id
  returning h.action_count into v_count;

  if p_status <> 'active' and coalesce(p_payout, 0) > 0 then
    update public.wallets as w
    set balance = w.balance + p_payout, updated_at = now()
    where w.user_id = p_user_id
    returning w.balance into v_balance;

    insert into public.wallet_transactions (
      user_id, wager_id, transaction_type, amount, balance_after, note
    ) values (
      p_user_id, null, 'wager_credit', p_payout, v_balance,
      'Blackjack test payout'
    );
  end if;

  return query select p_hand_id, p_status, v_balance, coalesce(p_payout, 0), v_count;
end;
$function$;

revoke all on function public.advance_blackjack_test_hand_v3(
  uuid, uuid, integer, public.blackjack_hand_status, numeric, jsonb, jsonb,
  integer, jsonb, jsonb, integer, integer, numeric, numeric
) from public, anon, authenticated;

grant execute on function public.advance_blackjack_test_hand_v3(
  uuid, uuid, integer, public.blackjack_hand_status, numeric, jsonb, jsonb,
  integer, jsonb, jsonb, integer, integer, numeric, numeric
) to service_role;
