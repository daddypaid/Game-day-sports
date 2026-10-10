-- Isolated baseline fixture reflects the two deployed atomic RPCs used by recovery wrappers.
create schema auth;
create table auth.users(id uuid primary key);
create role anon; create role authenticated; create role service_role;
create type public.blackjack_hand_status as enum('active','player_blackjack','player_bust','dealer_bust','won','lost','push');
create table public.wallets(user_id uuid primary key references auth.users(id),balance numeric(14,2),updated_at timestamptz);
create table public.wallet_transactions(id uuid primary key default gen_random_uuid(),user_id uuid,wager_id uuid,transaction_type text,amount numeric,balance_after numeric,note text);
create table public.blackjack_hands(id uuid primary key default gen_random_uuid(),user_id uuid,stake numeric,status public.blackjack_hand_status,player_cards jsonb,dealer_cards jsonb,shoe jsonb,player_total integer,dealer_total integer,payout numeric,is_test boolean,action_count integer,created_at timestamptz default now(),settled_at timestamptz,player_hands jsonb,active_hand_index integer);
create unique index blackjack_one_active_hand_per_user on public.blackjack_hands(user_id) where status='active';
create table public.baccarat_rounds(id uuid primary key default gen_random_uuid(),user_id uuid,stake numeric,bet_type text,player_cards jsonb,banker_cards jsonb,player_total integer,banker_total integer,result text,payout numeric,is_test boolean,created_at timestamptz default now());

CREATE OR REPLACE FUNCTION public.place_baccarat_test_round_atomic(p_user_id uuid, p_stake numeric, p_bet_type text, p_player_cards jsonb, p_banker_cards jsonb, p_player_total integer, p_banker_total integer, p_result text, p_payout numeric)
 RETURNS TABLE(round_id uuid, balance numeric, payout numeric, result text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_balance numeric;
  v_round_id uuid;
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

  insert into public.wallet_transactions (
    user_id, transaction_type, amount, balance_after, note
  ) values (
    p_user_id, 'wager_debit', p_stake, v_balance, 'Baccarat test wager debit'
  );

  insert into public.baccarat_rounds (
    user_id, stake, bet_type, player_cards, banker_cards,
    player_total, banker_total, result, payout, is_test
  ) values (
    p_user_id, p_stake, p_bet_type, p_player_cards, p_banker_cards,
    p_player_total, p_banker_total, p_result, p_payout, true
  ) returning id into v_round_id;

  if p_payout > 0 then
    update public.wallets as w
    set balance = w.balance + p_payout,
        updated_at = now()
    where w.user_id = p_user_id
    returning w.balance into v_balance;

    insert into public.wallet_transactions (
      user_id, transaction_type, amount, balance_after, note
    ) values (
      p_user_id, 'wager_credit', p_payout, v_balance, 'Baccarat test payout'
    );
  end if;

  return query
  select v_round_id, v_balance, p_payout, p_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_blackjack_test_hand_v2(p_user_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_status blackjack_hand_status, p_payout numeric)
 RETURNS TABLE(hand_id uuid, hand_status blackjack_hand_status, balance numeric, payout numeric, action_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_balance numeric;
  v_hand_id uuid;
begin
  if p_stake <= 0 then raise exception 'Invalid stake'; end if;

  select w.balance into v_balance
  from public.wallets w
  where w.user_id = p_user_id
  for update;

  if v_balance is null then raise exception 'Wallet not found'; end if;
  if v_balance < p_stake then raise exception 'Insufficient test balance'; end if;

  update public.wallets as w
  set balance = w.balance - p_stake, updated_at = now()
  where w.user_id = p_user_id
  returning w.balance into v_balance;

  insert into public.blackjack_hands (
    user_id, stake, status, player_cards, dealer_cards, shoe,
    player_total, dealer_total, payout, is_test, action_count, settled_at
  ) values (
    p_user_id, p_stake, p_status, p_player_cards, p_dealer_cards, p_shoe,
    p_player_total, p_dealer_total, coalesce(p_payout,0), true, 0,
    case when p_status = 'active' then null else now() end
  ) returning id into v_hand_id;

  insert into public.wallet_transactions (
    user_id, wager_id, transaction_type, amount, balance_after, note
  ) values (
    p_user_id, null, 'wager_debit', p_stake, v_balance, 'Blackjack test wager debit'
  );

  if p_status <> 'active' and coalesce(p_payout,0) > 0 then
    update public.wallets as w
    set balance = w.balance + p_payout, updated_at = now()
    where w.user_id = p_user_id
    returning w.balance into v_balance;

    insert into public.wallet_transactions (
      user_id, wager_id, transaction_type, amount, balance_after, note
    ) values (
      p_user_id, null, 'wager_credit', p_payout, v_balance, 'Blackjack test payout'
    );
  end if;

  return query select v_hand_id, p_status, v_balance, coalesce(p_payout,0), 0;
end;
$function$;

