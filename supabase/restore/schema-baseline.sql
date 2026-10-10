--
-- PostgreSQL database dump
--

\restrict SvovSQQRN0NPnWSmpHBQHY1TEdcoeirAKyjKla57iTLw9Z9bDFnQzbxWPbDeb77

-- Dumped from database version 17.6 (Debian 17.6-2.pgdg12+1)
-- Dumped by pg_dump version 17.6 (Debian 17.6-2.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- Name: blackjack_hand_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.blackjack_hand_status AS ENUM (
    'active',
    'player_blackjack',
    'player_bust',
    'dealer_bust',
    'won',
    'lost',
    'push'
);


ALTER TYPE public.blackjack_hand_status OWNER TO postgres;

--
-- Name: transaction_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.transaction_type AS ENUM (
    'deposit',
    'withdrawal',
    'wager_debit',
    'wager_credit',
    'refund',
    'adjustment'
);


ALTER TYPE public.transaction_type OWNER TO postgres;

--
-- Name: wager_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.wager_status AS ENUM (
    'pending',
    'accepted',
    'won',
    'lost',
    'void',
    'cancelled'
);


ALTER TYPE public.wager_status OWNER TO postgres;

--
-- Name: wager_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.wager_type AS ENUM (
    'single',
    'parlay'
);


ALTER TYPE public.wager_type OWNER TO postgres;

--
-- Name: advance_blackjack_test_hand_atomic(uuid, uuid, integer, public.blackjack_hand_status, jsonb, jsonb, jsonb, integer, integer, numeric); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.advance_blackjack_test_hand_atomic(p_user_id uuid, p_hand_id uuid, p_expected_action_count integer, p_status public.blackjack_hand_status, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_payout numeric) RETURNS TABLE(hand_id uuid, hand_status public.blackjack_hand_status, balance numeric, payout numeric, action_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_balance numeric;
  v_stake numeric;
  v_count integer;
  v_status public.blackjack_hand_status;
begin
  select h.stake, h.action_count, h.status
  into v_stake, v_count, v_status
  from public.blackjack_hands h
  where h.id = p_hand_id and h.user_id = p_user_id and h.is_test = true
  for update;

  if v_stake is null then raise exception 'Blackjack hand not found'; end if;
  if v_status <> 'active' then raise exception 'Blackjack hand already settled'; end if;
  if v_count <> p_expected_action_count then raise exception 'Blackjack hand changed; refresh and try again'; end if;

  update public.blackjack_hands h
  set status = p_status,
      player_cards = p_player_cards,
      dealer_cards = p_dealer_cards,
      shoe = p_shoe,
      player_total = p_player_total,
      dealer_total = p_dealer_total,
      payout = coalesce(p_payout,0),
      action_count = h.action_count + 1,
      settled_at = case when p_status = 'active' then null else now() end
  where h.id = p_hand_id
  returning h.action_count into v_count;

  select w.balance into v_balance
  from public.wallets w
  where w.user_id = p_user_id
  for update;

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

  return query select p_hand_id, p_status, v_balance, coalesce(p_payout,0), v_count;
end;
$$;


ALTER FUNCTION public.advance_blackjack_test_hand_atomic(p_user_id uuid, p_hand_id uuid, p_expected_action_count integer, p_status public.blackjack_hand_status, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_payout numeric) OWNER TO postgres;

--
-- Name: advance_blackjack_test_hand_v3(uuid, uuid, integer, public.blackjack_hand_status, numeric, jsonb, jsonb, integer, jsonb, jsonb, integer, integer, numeric, numeric); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.advance_blackjack_test_hand_v3(p_user_id uuid, p_hand_id uuid, p_expected_action_count integer, p_status public.blackjack_hand_status, p_stake numeric, p_player_cards jsonb, p_player_hands jsonb, p_active_hand_index integer, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_payout numeric, p_additional_debit numeric) RETURNS TABLE(hand_id uuid, hand_status public.blackjack_hand_status, balance numeric, payout numeric, action_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


ALTER FUNCTION public.advance_blackjack_test_hand_v3(p_user_id uuid, p_hand_id uuid, p_expected_action_count integer, p_status public.blackjack_hand_status, p_stake numeric, p_player_cards jsonb, p_player_hands jsonb, p_active_hand_index integer, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_payout numeric, p_additional_debit numeric) OWNER TO postgres;

--
-- Name: advance_ultimate_texas_holdem_test_atomic(uuid, uuid, text, text, jsonb, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.advance_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_round_id uuid, p_expected_stage text, p_new_stage text, p_community jsonb, p_play_multiplier integer DEFAULT 0) RETURNS TABLE(round_id uuid, balance numeric, play_bet numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


ALTER FUNCTION public.advance_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_round_id uuid, p_expected_stage text, p_new_stage text, p_community jsonb, p_play_multiplier integer) OWNER TO postgres;

--
-- Name: capture_sports_outcome_history(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.capture_sports_outcome_history() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' or new.point is distinct from old.point or new.american_odds is distinct from old.american_odds then
    insert into public.sports_line_history(outcome_id, point, american_odds, source_book_count)
    values (new.id, new.point, new.american_odds, new.source_book_count);
  end if;
  return new;
end;
$$;


ALTER FUNCTION public.capture_sports_outcome_history() OWNER TO postgres;

--
-- Name: claim_operator_alerts(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.claim_operator_alerts(p_limit integer DEFAULT 20) RETURNS TABLE(alert_id uuid, lease_id uuid, payload jsonb, attempt integer)
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  with exhausted as (
    update public.operator_alert_outbox set state='dead',lease_id=null,leased_until=null,last_error_code='delivery_unknown'
    where state='pending' and attempts>=8 and (leased_until is null or leased_until<=now())
  ), picked as (
    select o.id from public.operator_alert_outbox o
    where o.state='pending' and o.next_attempt_at<=now() and (o.leased_until is null or o.leased_until<=now()) and o.attempts<8
    and not exists(select 1 from public.operator_alert_outbox earlier where earlier.check_key=o.check_key and earlier.state='pending' and earlier.transition_sequence<o.transition_sequence)
    order by o.created_at,o.check_key,o.transition_sequence for update skip locked limit greatest(1,least(coalesce(p_limit,20),20))
  ),claimed as (
    update public.operator_alert_outbox o set attempts=o.attempts+1,lease_id=gen_random_uuid(),leased_until=now()+interval '3 minutes'
    from picked where o.id=picked.id returning o.id,o.lease_id,o.payload,o.attempts
  )select id,lease_id,payload,attempts from claimed;
$$;


ALTER FUNCTION public.claim_operator_alerts(p_limit integer) OWNER TO postgres;

--
-- Name: claim_test_wager_settlement_batch(uuid, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.claim_test_wager_settlement_batch(p_processing_token uuid, p_limit integer DEFAULT 100) RETURNS TABLE(wager_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit,100),100));
  v_ids uuid[] := '{}';
  v_more uuid[];
  v_bucket integer;
begin
  if p_processing_token is null then raise exception 'Processing token is required'; end if;
  for v_bucket in 0..2 loop
    select coalesce(array_agg(candidate.wager_id),'{}'::uuid[]) into v_more from (
      select q.wager_id from public.test_wager_settlement_checks q
      join public.wagers w on w.id = q.wager_id
      where w.is_test and w.status in ('pending','accepted')
        and q.next_check_at <= now()
        and (q.lease_until is null or q.lease_until <= now())
        and not(q.wager_id = any(v_ids))
      order by case when v_bucket = 0 then w.placed_at end desc nulls last,
        q.next_check_at, q.wager_id
      limit case when v_bucket = 2 then v_limit-cardinality(v_ids)
        when v_bucket = 0 then (v_limit+1)/2 else v_limit/2 end
      for update of q skip locked
    ) candidate;
    v_ids := v_ids || v_more;
  end loop;
  update public.test_wager_settlement_checks q
  set processing_token = p_processing_token, lease_until = now()+interval '130 seconds',
      next_check_at = now()+interval '5 minutes', last_attempt_at = now(),
      attempt_count = attempt_count+1
  where q.wager_id = any(v_ids);
  return query select unnest(v_ids);
end $$;


ALTER FUNCTION public.claim_test_wager_settlement_batch(p_processing_token uuid, p_limit integer) OWNER TO postgres;

--
-- Name: commit_poker_test_hand_atomic(uuid, text, uuid, jsonb, uuid, integer, numeric, jsonb, numeric, numeric); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.commit_poker_test_hand_atomic(p_user_id uuid, p_game text, p_request_id uuid, p_request_payload jsonb, p_hand_id uuid, p_expected_action_count integer, p_expected_balance numeric, p_state jsonb, p_debit numeric, p_payout numeric) RETURNS TABLE(hand_id uuid, private_state jsonb, balance numeric, started_request_id uuid, last_request_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
$$;


ALTER FUNCTION public.commit_poker_test_hand_atomic(p_user_id uuid, p_game text, p_request_id uuid, p_request_payload jsonb, p_hand_id uuid, p_expected_action_count integer, p_expected_balance numeric, p_state jsonb, p_debit numeric, p_payout numeric) OWNER TO postgres;

--
-- Name: configure_operator_alert_delivery(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.configure_operator_alert_delivery(p_webhook_url text, p_signing_secret text) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
begin
  if p_webhook_url is null or p_webhook_url !~ '^https://[a-zA-Z0-9][a-zA-Z0-9.-]+(:[0-9]+)?(/|$)' or p_webhook_url ~ '[#@]' or length(p_webhook_url)>2048 or p_signing_secret is null or length(p_signing_secret)<32 then raise exception 'Invalid alert delivery configuration'; end if;
  insert into public.operator_monitor_delivery_config(singleton,webhook_url,signing_secret) values(true,p_webhook_url,p_signing_secret)
  on conflict(singleton) do update set webhook_url=excluded.webhook_url,signing_secret=excluded.signing_secret,configured_at=now();
  return true;
end; $_$;


ALTER FUNCTION public.configure_operator_alert_delivery(p_webhook_url text, p_signing_secret text) OWNER TO postgres;

--
-- Name: deal_caribbean_stud_test_atomic(uuid, numeric, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.deal_caribbean_stud_test_atomic(p_user_id uuid, p_ante numeric, p_player_hand jsonb, p_dealer_hand jsonb) RETURNS TABLE(round_id uuid, balance numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_balance numeric;v_round uuid;
begin
 if p_ante is null or p_ante<=0 or p_ante>1000 then raise exception 'Invalid ante'; end if;
 if jsonb_array_length(p_player_hand)<>5 or jsonb_array_length(p_dealer_hand)<>5 then raise exception 'Invalid hand'; end if;
 if exists(select 1 from public.caribbean_stud_rounds where user_id=p_user_id and status='active') then raise exception 'ACTIVE_ROUND_EXISTS'; end if;
 select w.balance into v_balance from public.wallets w where w.user_id=p_user_id for update;
 if v_balance is null then raise exception 'Wallet not found'; end if;
 if v_balance<p_ante then raise exception 'Insufficient test balance'; end if;
 update public.wallets w set balance=w.balance-p_ante,updated_at=now() where w.user_id=p_user_id returning w.balance into v_balance;
 insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note) values(p_user_id,'wager_debit',p_ante,v_balance,'Test Caribbean Stud ante');
 insert into public.caribbean_stud_rounds(user_id,ante,player_hand,dealer_hand,status,is_test) values(p_user_id,p_ante,p_player_hand,p_dealer_hand,'active',true) returning id into v_round;
 return query select v_round,v_balance;
end;$$;


ALTER FUNCTION public.deal_caribbean_stud_test_atomic(p_user_id uuid, p_ante numeric, p_player_hand jsonb, p_dealer_hand jsonb) OWNER TO postgres;

--
-- Name: deal_three_card_poker_test_atomic(uuid, numeric, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.deal_three_card_poker_test_atomic(p_user_id uuid, p_ante numeric, p_player_hand jsonb, p_dealer_hand jsonb) RETURNS TABLE(round_id uuid, balance numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_balance numeric; v_round uuid;
begin
  if p_ante is null or p_ante<=0 or p_ante>1000 then raise exception 'Invalid ante'; end if;
  if jsonb_array_length(p_player_hand)<>3 or jsonb_array_length(p_dealer_hand)<>3 then raise exception 'Invalid hand'; end if;
  if exists(select 1 from public.three_card_poker_rounds where user_id=p_user_id and status='active') then raise exception 'ACTIVE_ROUND_EXISTS'; end if;
  select w.balance into v_balance from public.wallets w where w.user_id=p_user_id for update;
  if v_balance is null then raise exception 'Wallet not found'; end if;
  if v_balance<p_ante then raise exception 'Insufficient test balance'; end if;
  update public.wallets w set balance=w.balance-p_ante,updated_at=now() where w.user_id=p_user_id returning w.balance into v_balance;
  insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note) values(p_user_id,'wager_debit',p_ante,v_balance,'Test Three Card Poker ante');
  insert into public.three_card_poker_rounds(user_id,ante,player_hand,dealer_hand,status,is_test) values(p_user_id,p_ante,p_player_hand,p_dealer_hand,'active',true) returning id into v_round;
  return query select v_round,v_balance;
end;$$;


ALTER FUNCTION public.deal_three_card_poker_test_atomic(p_user_id uuid, p_ante numeric, p_player_hand jsonb, p_dealer_hand jsonb) OWNER TO postgres;

--
-- Name: deal_ultimate_texas_holdem_test_atomic(uuid, numeric, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.deal_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_ante numeric, p_player_hand jsonb, p_dealer_hand jsonb, p_deck_remaining jsonb) RETURNS TABLE(round_id uuid, balance numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


ALTER FUNCTION public.deal_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_ante numeric, p_player_hand jsonb, p_dealer_hand jsonb, p_deck_remaining jsonb) OWNER TO postgres;

--
-- Name: deal_video_poker_test_atomic(uuid, numeric, jsonb, jsonb, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.deal_video_poker_test_atomic(p_user_id uuid, p_stake numeric, p_initial_hand jsonb, p_deck_remaining jsonb, p_game text DEFAULT 'jacks_or_better'::text) RETURNS TABLE(hand_id uuid, balance numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_balance numeric;
  v_hand_id uuid;
begin
  if p_stake is null or p_stake <= 0 or p_stake > 1000 then
    raise exception 'Invalid stake';
  end if;
  if p_game not in ('jacks_or_better', 'bonus_poker', 'deuces_wild') then
    raise exception 'Unsupported video poker game';
  end if;
  if jsonb_array_length(p_initial_hand) <> 5 then
    raise exception 'Invalid initial hand';
  end if;
  if jsonb_array_length(p_deck_remaining) <> 47 then
    raise exception 'Invalid remaining deck';
  end if;

  select w.balance into v_balance
  from public.wallets w
  where w.user_id = p_user_id
  for update;

  if v_balance is null then raise exception 'Wallet not found'; end if;

  if exists(
    select 1
    from public.video_poker_hands
    where user_id = p_user_id and status = 'active'
  ) then
    raise exception 'ACTIVE_HAND_EXISTS';
  end if;

  if v_balance < p_stake then raise exception 'Insufficient test balance'; end if;

  update public.wallets w
  set balance = w.balance - p_stake, updated_at = now()
  where w.user_id = p_user_id
  returning w.balance into v_balance;

  insert into public.wallet_transactions(
    user_id, transaction_type, amount, balance_after, note
  )
  values(
    p_user_id, 'wager_debit', p_stake, v_balance, 'Test video poker deal debit'
  );

  insert into public.video_poker_hands(
    user_id, game, stake, initial_hand, deck_remaining, status, is_test
  )
  values(
    p_user_id, p_game, p_stake, p_initial_hand, p_deck_remaining, 'active', true
  )
  returning id into v_hand_id;

  return query select v_hand_id, v_balance;
end;
$$;


ALTER FUNCTION public.deal_video_poker_test_atomic(p_user_id uuid, p_stake numeric, p_initial_hand jsonb, p_deck_remaining jsonb, p_game text) OWNER TO postgres;

--
-- Name: decide_blackjack_test_insurance(uuid, uuid, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.decide_blackjack_test_insurance(p_user_id uuid, p_hand_id uuid, p_expected_action_count integer, p_accept boolean) RETURNS TABLE(hand_id uuid, balance numeric, replayed boolean)
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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
$$;


ALTER FUNCTION public.decide_blackjack_test_insurance(p_user_id uuid, p_hand_id uuid, p_expected_action_count integer, p_accept boolean) OWNER TO postgres;

--
-- Name: enqueue_test_wager_settlement(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.enqueue_test_wager_settlement() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.is_test and new.status in ('pending','accepted') then
    insert into public.test_wager_settlement_checks(wager_id, next_check_at)
      values(new.id, coalesce(new.placed_at, now())) on conflict(wager_id) do nothing;
  end if;
  return new;
end $$;


ALTER FUNCTION public.enqueue_test_wager_settlement() OWNER TO postgres;

--
-- Name: finish_blackjack_test_hand_atomic(uuid, uuid, public.blackjack_hand_status, jsonb, jsonb, integer, integer, numeric); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.finish_blackjack_test_hand_atomic(p_user_id uuid, p_hand_id uuid, p_status public.blackjack_hand_status, p_player_cards jsonb, p_dealer_cards jsonb, p_player_total integer, p_dealer_total integer, p_payout numeric) RETURNS TABLE(hand_id uuid, hand_status public.blackjack_hand_status, balance numeric, payout numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


ALTER FUNCTION public.finish_blackjack_test_hand_atomic(p_user_id uuid, p_hand_id uuid, p_status public.blackjack_hand_status, p_player_cards jsonb, p_dealer_cards jsonb, p_player_total integer, p_dealer_total integer, p_payout numeric) OWNER TO postgres;

--
-- Name: finish_operator_alert(uuid, uuid, boolean, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.finish_operator_alert(p_alert_id uuid, p_lease_id uuid, p_delivered boolean, p_error_code text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare changed integer;
begin
  update public.operator_alert_outbox
  set state=case when p_delivered then 'delivered' when attempts>=8 then 'dead' else 'pending' end,
      delivered_at=case when p_delivered then now() else null end,
      next_attempt_at=case when p_delivered then next_attempt_at else now()+make_interval(secs=>least(3600,15*power(2,attempts-1))::integer) end,
      leased_until=null,lease_id=null,
      last_error_code=case when p_delivered then null when p_error_code ~ '^(http_[0-9]{3}|timeout|network_error|invalid_config|delivery_unknown)$' then p_error_code else 'delivery_unknown' end
  where id=p_alert_id and lease_id=p_lease_id and state='pending';
  get diagnostics changed=row_count; return changed=1;
end; $_$;


ALTER FUNCTION public.finish_operator_alert(p_alert_id uuid, p_lease_id uuid, p_delivered boolean, p_error_code text) OWNER TO postgres;

--
-- Name: finish_test_wager_settlement_check(uuid, uuid, text, text, text, numeric, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.finish_test_wager_settlement_check(p_wager_id uuid, p_processing_token uuid, p_outcome text, p_reason text DEFAULT NULL::text, p_result text DEFAULT NULL::text, p_credit numeric DEFAULT NULL::numeric, p_grades jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_check public.test_wager_settlement_checks%rowtype;
  v_settlement jsonb;
begin
  if p_processing_token is null or p_outcome is null
    or p_outcome not in ('waiting','provider_error','review','settled','error') then
    raise exception 'Invalid settlement check outcome';
  end if;
  select * into v_check from public.test_wager_settlement_checks
    where wager_id = p_wager_id for update;
  if not found or v_check.processing_token is distinct from p_processing_token
    or v_check.lease_until <= now() then
    return jsonb_build_object('applied',false,'reason','lease_not_owned');
  end if;
  if p_outcome = 'settled' then
    select to_jsonb(s) into v_settlement
      from public.settle_test_wager_auto_atomic(p_wager_id,p_result,p_credit,p_grades) s;
  end if;
  update public.test_wager_settlement_checks
  set processing_token = null, lease_until = null, last_checked_at = now(),
      last_outcome = p_outcome,
      review_required = case when p_outcome = 'settled' then false
        when p_outcome in ('review','error') then true else review_required end,
      review_reason = case when p_outcome = 'settled' then null
        when p_outcome in ('review','error') then left(coalesce(p_reason,'unresolved'),120) else review_reason end,
      next_check_at = now()+case when p_outcome = 'review' then interval '6 hours'
        when p_reason = 'job_budget_reached' then interval '1 minute' else interval '5 minutes' end
  where wager_id = p_wager_id;
  return jsonb_build_object('applied',true,'settlement',v_settlement);
end $$;


ALTER FUNCTION public.finish_test_wager_settlement_check(p_wager_id uuid, p_processing_token uuid, p_outcome text, p_reason text, p_result text, p_credit numeric, p_grades jsonb) OWNER TO postgres;

--
-- Name: get_operator_alert_health(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_operator_alert_health() RETURNS jsonb
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'pending_count',count(*) filter(where state='pending'),
    'dead_count',count(*) filter(where state='dead'),
    'delivered_count_24h',count(*) filter(where state='delivered' and delivered_at>=now()-interval '24 hours'),
    'last_delivery_at',max(delivered_at),
    'max_pending_age_seconds',coalesce(extract(epoch from now()-min(created_at) filter(where state='pending')),0),
    'last_monitor_at',(select checked_at from public.operator_monitor_state where singleton),
    'delivery_configured',coalesce((select delivery_configured from public.operator_monitor_state where singleton),false)
  ) from public.operator_alert_outbox;
$$;


ALTER FUNCTION public.get_operator_alert_health() OWNER TO postgres;

--
-- Name: get_slot_request_history(uuid, integer, timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_slot_request_history(p_user_id uuid, p_limit integer DEFAULT 20, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid) RETURNS TABLE(id uuid, request_id uuid, game text, created_at timestamp with time zone, spin jsonb)
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select r.id,r.request_id,r.game,r.created_at,r.response->'spin'
  from public.slot_request_receipts r
  where r.user_id=p_user_id and
    (p_before_created_at is null or (r.created_at,r.id)<(p_before_created_at,p_before_id))
  order by r.created_at desc,r.id desc
  limit least(greatest(coalesce(p_limit,20),1),51);
$$;


ALTER FUNCTION public.get_slot_request_history(p_user_id uuid, p_limit integer, p_before_created_at timestamp with time zone, p_before_id uuid) OWNER TO postgres;

--
-- Name: get_slot_request_receipt(uuid, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_slot_request_receipt(p_user_id uuid, p_request_id uuid, p_game text, p_payload jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare v_receipt public.slot_request_receipts%rowtype;
begin
  select r.* into v_receipt from public.slot_request_receipts r
    where r.user_id=p_user_id and r.request_id=p_request_id;
  if not found then return null; end if;
  if v_receipt.game <> p_game or
    (p_payload is not null and v_receipt.request_payload <> p_payload) then
    raise exception 'REQUEST_CONFLICT';
  end if;
  return v_receipt.response;
end;
$$;


ALTER FUNCTION public.get_slot_request_receipt(p_user_id uuid, p_request_id uuid, p_game text, p_payload jsonb) OWNER TO postgres;

--
-- Name: get_test_wager_settlement_health(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_test_wager_settlement_health() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with pending as (
    select w.placed_at, q.* from public.wagers w
    join public.test_wager_settlement_checks q on q.wager_id = w.id
    where w.is_test and w.status in ('pending','accepted')
  ), reasons as (
    select review_reason, count(*) as count from pending where review_required group by review_reason
  )
  select jsonb_build_object(
    'pending_count', (select count(*) from pending),
    'review_required_count', (select count(*) from pending where review_required),
    'unchecked_count', (select count(*) from pending where last_checked_at is null),
    'retry_due_count', (select count(*) from pending where next_check_at <= now() and (lease_until is null or lease_until <= now())),
    'active_lease_count', (select count(*) from pending where lease_until > now()),
    'provider_error_count', (select count(*) from pending where last_outcome = 'provider_error'),
    'check_error_count', (select count(*) from pending where last_outcome = 'error'),
    'oldest_unresolved_at', (select min(placed_at) from pending),
    'oldest_checked_at', (select min(last_checked_at) from pending),
    'last_check_at', (select max(last_checked_at) from public.test_wager_settlement_checks),
    'last_attempt_at', (select max(last_attempt_at) from public.test_wager_settlement_checks),
    'last_success_at', (select max(last_checked_at) from public.test_wager_settlement_checks where last_outcome = 'settled'),
    'max_pending_age_seconds', coalesce((select greatest(0, extract(epoch from now()-min(placed_at)))::bigint from pending),0),
    'review_reasons', coalesce((select jsonb_object_agg(review_reason,count) from reasons),'{}'::jsonb)
  );
$$;


ALTER FUNCTION public.get_test_wager_settlement_health() OWNER TO postgres;

--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email));

  insert into public.wallets (user_id, balance)
  values (new.id, 1000);

  insert into public.wallet_transactions(user_id, wager_id, transaction_type, amount, balance_after, note)
  values (new.id, null, 'adjustment', 1000, 1000, 'Initial GameDay test credits');

  return new;
end;
$$;


ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

--
-- Name: initialize_blackjack_insurance(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.initialize_blackjack_insurance() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.original_stake := new.stake;
  new.insurance_status := case when pg_catalog.current_setting('gameday.blackjack_insurance',true) = 'on' and new.status = 'active' and new.dealer_cards->0->>'rank' = 'A' then 'pending' else 'not_offered' end;
  new.insurance_stake := 0;
  new.insurance_payout := 0;
  return new;
end;
$$;


ALTER FUNCTION public.initialize_blackjack_insurance() OWNER TO postgres;

--
-- Name: place_baccarat_test_round_atomic(uuid, numeric, text, jsonb, jsonb, integer, integer, text, numeric); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.place_baccarat_test_round_atomic(p_user_id uuid, p_stake numeric, p_bet_type text, p_player_cards jsonb, p_banker_cards jsonb, p_player_total integer, p_banker_total integer, p_result text, p_payout numeric) RETURNS TABLE(round_id uuid, balance numeric, payout numeric, result text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


ALTER FUNCTION public.place_baccarat_test_round_atomic(p_user_id uuid, p_stake numeric, p_bet_type text, p_player_cards jsonb, p_banker_cards jsonb, p_player_total integer, p_banker_total integer, p_result text, p_payout numeric) OWNER TO postgres;

--
-- Name: place_baccarat_test_round_idempotent(uuid, uuid, numeric, text, jsonb, jsonb, integer, integer, text, numeric); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.place_baccarat_test_round_idempotent(p_user_id uuid, p_request_id uuid, p_stake numeric, p_bet_type text, p_player_cards jsonb, p_banker_cards jsonb, p_player_total integer, p_banker_total integer, p_result text, p_payout numeric) RETURNS TABLE(round_id uuid, balance numeric, replayed boolean, error text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


ALTER FUNCTION public.place_baccarat_test_round_idempotent(p_user_id uuid, p_request_id uuid, p_stake numeric, p_bet_type text, p_player_cards jsonb, p_banker_cards jsonb, p_player_total integer, p_banker_total integer, p_result text, p_payout numeric) OWNER TO postgres;

--
-- Name: place_test_wager_atomic(uuid, public.wager_type, numeric, numeric, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.place_test_wager_atomic(p_user_id uuid, p_wager_type public.wager_type, p_stake numeric, p_potential_return numeric, p_selections jsonb) RETURNS TABLE(wager_id uuid, wager_type public.wager_type, stake numeric, potential_return numeric, status public.wager_status, placed_at timestamp with time zone, is_test boolean, balance numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_balance numeric;
  v_wager_id uuid;
  v_selection jsonb;
  v_fingerprint text;
  v_bucket bigint;
  v_count integer;
begin
  if p_user_id is null then
    raise exception 'User is required';
  end if;
  if p_stake is null or p_stake <= 0 then
    raise exception 'Invalid stake';
  end if;
  if p_potential_return is null or p_potential_return <= 0 then
    raise exception 'Invalid potential return';
  end if;
  if p_selections is null or jsonb_typeof(p_selections) <> 'array' then
    raise exception 'Selections must be an array';
  end if;

  v_count := jsonb_array_length(p_selections);
  if p_wager_type = 'single' and v_count <> 1 then
    raise exception 'A single wager must contain exactly one selection';
  end if;
  if p_wager_type = 'parlay' and (v_count < 2 or v_count > 20) then
    raise exception 'A parlay must contain between 2 and 20 selections';
  end if;
  if v_count = 0 then
    raise exception 'At least one selection is required';
  end if;

  if exists (
    select 1
    from (
      select
        lower(btrim(coalesce(s.value->>'event_id',''))) as event_id,
        lower(btrim(coalesce(s.value->>'market_key',''))) as market_key,
        lower(regexp_replace(btrim(coalesce(s.value->>'selection_name','')), '\s+', ' ', 'g')) as selection_name,
        lower(regexp_replace(btrim(coalesce(s.value->>'description','')), '\s+', ' ', 'g')) as description,
        case
          when nullif(s.value->>'point','') is null then ''
          else ((s.value->>'point')::numeric)::text
        end as point_key,
        count(*) as c
      from jsonb_array_elements(p_selections) as s(value)
      group by 1,2,3,4,5
      having count(*) > 1
    ) d
  ) then
    raise exception 'Duplicate selection in wager';
  end if;

  v_bucket := floor(extract(epoch from clock_timestamp()) / 10)::bigint;
  v_fingerprint := md5(
    p_user_id::text || '|' ||
    p_wager_type::text || '|' ||
    p_stake::text || '|' ||
    p_potential_return::text || '|' ||
    p_selections::text
  );

  select w.balance
  into v_balance
  from public.wallets w
  where w.user_id = p_user_id
  for update;

  if v_balance is null then
    raise exception 'Wallet not found';
  end if;

  if exists (
    select 1 from public.wagers w
    where w.user_id = p_user_id
      and w.placement_fingerprint = v_fingerprint
      and w.placement_bucket = v_bucket
  ) then
    raise exception 'Duplicate wager request ignored';
  end if;

  if v_balance < p_stake then
    raise exception 'Insufficient test balance';
  end if;

  update public.wallets as w
  set balance = w.balance - p_stake,
      updated_at = now()
  where w.user_id = p_user_id
  returning w.balance into v_balance;

  insert into public.wagers (
    user_id, wager_type, stake, potential_return, status, is_test,
    placement_fingerprint, placement_bucket
  ) values (
    p_user_id, p_wager_type, p_stake, p_potential_return, 'pending', true,
    v_fingerprint, v_bucket
  ) returning id into v_wager_id;

  for v_selection in
    select value from jsonb_array_elements(p_selections)
  loop
    insert into public.wager_selections (
      wager_id, event_id, event_name, sport_key, market_key, market_title,
      selection_name, description, point, american_odds, quoted_at
    ) values (
      v_wager_id,
      v_selection->>'event_id',
      v_selection->>'event_name',
      nullif(v_selection->>'sport_key',''),
      v_selection->>'market_key',
      nullif(v_selection->>'market_title',''),
      v_selection->>'selection_name',
      nullif(v_selection->>'description',''),
      case when v_selection->>'point' is null or v_selection->>'point' = '' then null else (v_selection->>'point')::numeric end,
      (v_selection->>'american_odds')::integer,
      case when nullif(v_selection->>'quoted_at','') is null then null else (v_selection->>'quoted_at')::timestamptz end
    );
  end loop;

  insert into public.wallet_transactions (
    user_id, wager_id, transaction_type, amount, balance_after, note
  ) values (
    p_user_id, v_wager_id, 'wager_debit', p_stake, v_balance, 'Test wager debit'
  );

  return query
  select w.id, w.wager_type, w.stake, w.potential_return, w.status,
         w.placed_at, w.is_test, v_balance
  from public.wagers w
  where w.id = v_wager_id;
end;
$$;


ALTER FUNCTION public.place_test_wager_atomic(p_user_id uuid, p_wager_type public.wager_type, p_stake numeric, p_potential_return numeric, p_selections jsonb) OWNER TO postgres;

--
-- Name: play_settle_ultimate_texas_holdem_test_atomic(uuid, uuid, text, integer, jsonb, numeric, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.play_settle_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_round_id uuid, p_expected_stage text, p_play_multiplier integer, p_community jsonb, p_payout numeric, p_result text, p_player_rank text, p_dealer_rank text, p_dealer_qualifies boolean) RETURNS TABLE(round_id uuid, play_bet numeric, payout numeric, balance numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_balance numeric;
  v_ante numeric;
  v_existing_play numeric;
  v_play numeric;
begin
  if p_expected_stage not in ('preflop','flop','river') then raise exception 'Invalid stage'; end if;
  if p_play_multiplier not in (1,2,4) then raise exception 'Invalid Play multiplier'; end if;
  if (p_expected_stage='preflop' and p_play_multiplier<>4)
     or (p_expected_stage='flop' and p_play_multiplier<>2)
     or (p_expected_stage='river' and p_play_multiplier<>1) then
    raise exception 'Play multiplier does not match stage';
  end if;
  if p_payout is null or p_payout<0 then raise exception 'Invalid payout'; end if;

  select ante,play_bet into v_ante,v_existing_play
  from public.ultimate_texas_holdem_rounds
  where id=p_round_id and user_id=p_user_id and status='active' and stage=p_expected_stage
  for update;
  if v_ante is null then raise exception 'Active round/stage not found'; end if;
  if v_existing_play<>0 then raise exception 'Play bet already placed'; end if;

  v_play:=v_ante*p_play_multiplier;
  select w.balance into v_balance from public.wallets w where w.user_id=p_user_id for update;
  if v_balance is null then raise exception 'Wallet not found'; end if;
  if v_balance<v_play then raise exception 'Insufficient test balance for Play bet'; end if;

  update public.wallets w set balance=w.balance-v_play,updated_at=now()
  where w.user_id=p_user_id returning w.balance into v_balance;
  insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note)
  values(p_user_id,'wager_debit',v_play,v_balance,'Test Ultimate Texas Holdem Play bet');

  if p_payout>0 then
    update public.wallets w set balance=w.balance+p_payout,updated_at=now()
    where w.user_id=p_user_id returning w.balance into v_balance;
    insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note)
    values(p_user_id,'wager_credit',p_payout,v_balance,'Test Ultimate Texas Holdem payout');
  end if;

  update public.ultimate_texas_holdem_rounds
  set play_bet=v_play,community=p_community,stage='settled',status='settled',decision='play',payout=p_payout,
      result=p_result,player_rank=p_player_rank,dealer_rank=p_dealer_rank,dealer_qualifies=p_dealer_qualifies,settled_at=now()
  where id=p_round_id and user_id=p_user_id;

  return query select p_round_id,v_play,p_payout,v_balance;
end;
$$;


ALTER FUNCTION public.play_settle_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_round_id uuid, p_expected_stage text, p_play_multiplier integer, p_community jsonb, p_payout numeric, p_result text, p_player_rank text, p_dealer_rank text, p_dealer_qualifies boolean) OWNER TO postgres;

--
-- Name: play_slot_test_spin_atomic(uuid, numeric, jsonb, numeric, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.play_slot_test_spin_atomic(p_user_id uuid, p_stake numeric, p_reels jsonb, p_payout numeric, p_result text) RETURNS TABLE(spin_id uuid, payout numeric, balance numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_balance numeric;
  v_spin_id uuid;
begin
  if p_stake is null or p_stake <= 0 then
    raise exception 'Invalid stake';
  end if;

  if p_payout is null or p_payout < 0 then
    raise exception 'Invalid payout';
  end if;

  if p_result not in ('won','lost') then
    raise exception 'Invalid result';
  end if;

  select w.balance
    into v_balance
  from public.wallets as w
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

  insert into public.wallet_transactions(
    user_id,
    transaction_type,
    amount,
    balance_after,
    note
  ) values (
    p_user_id,
    'wager_debit',
    p_stake,
    v_balance,
    'Test slots spin debit'
  );

  if p_payout > 0 then
    update public.wallets as w
    set balance = w.balance + p_payout,
        updated_at = now()
    where w.user_id = p_user_id
    returning w.balance into v_balance;

    insert into public.wallet_transactions(
      user_id,
      transaction_type,
      amount,
      balance_after,
      note
    ) values (
      p_user_id,
      'wager_credit',
      p_payout,
      v_balance,
      'Test slots payout'
    );
  end if;

  insert into public.slot_spins(
    user_id,
    stake,
    reels,
    payout,
    result,
    is_test
  ) values (
    p_user_id,
    p_stake,
    p_reels,
    p_payout,
    p_result,
    true
  ) returning id into v_spin_id;

  return query
  select v_spin_id, p_payout, v_balance;
end;
$$;


ALTER FUNCTION public.play_slot_test_spin_atomic(p_user_id uuid, p_stake numeric, p_reels jsonb, p_payout numeric, p_result text) OWNER TO postgres;

--
-- Name: play_test_roulette_atomic(uuid, numeric, text, text, integer, text, numeric, text, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.play_test_roulette_atomic(p_user_id uuid, p_stake numeric, p_bet_type text, p_bet_value text, p_winning_number integer, p_winning_color text, p_payout numeric, p_result text, p_request_id uuid DEFAULT NULL::uuid) RETURNS TABLE(spin_id uuid, balance numeric, payout numeric, result text, request_id uuid, winning_number integer, winning_color text, bet_type text, bet_value text, stake numeric, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_balance numeric;
  v_spin public.roulette_spins%rowtype;
  v_bet_value text := null;
  v_multiplier integer := 0;
  v_payout numeric;
  v_color text;
  v_result text;
  v_red integer[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
begin
  if p_user_id is null then raise exception 'Wallet owner is required'; end if;
  if p_stake is null or p_stake <= 0 or p_stake > 10000 or p_stake <> round(p_stake,2) then
    raise exception 'Invalid stake';
  end if;
  if p_bet_type is null or p_bet_type not in ('red','black','odd','even','low','high','number','column1','column2','column3') then
    raise exception 'Invalid bet type';
  end if;
  if p_bet_type = 'number' then
    if p_bet_value is null or p_bet_value !~ '^[0-9]{1,2}$' then raise exception 'Invalid bet number'; end if;
    if p_bet_value::integer > 36 then raise exception 'Invalid bet number'; end if;
    v_bet_value := (p_bet_value::integer)::text;
  end if;

  -- Serializing on the owner's wallet makes the request lookup and debit one transaction.
  select w.balance into v_balance from public.wallets w where w.user_id = p_user_id for update;
  if v_balance is null then raise exception 'Wallet not found'; end if;

  if p_request_id is not null then
    select s.* into v_spin from public.roulette_spins s
    where s.user_id = p_user_id and s.request_id = p_request_id;
    if found then
      if v_spin.stake <> p_stake or v_spin.bet_type <> p_bet_type or v_spin.bet_value is distinct from v_bet_value then
        raise exception 'Request ID already used for a different wager';
      end if;
      return query select v_spin.id, v_balance, v_spin.payout, v_spin.result,
        v_spin.request_id, v_spin.winning_number, v_spin.winning_color,
        v_spin.bet_type, v_spin.bet_value, v_spin.stake, v_spin.created_at;
      return;
    end if;
  end if;

  if p_winning_number is null or p_winning_number < 0 or p_winning_number > 36 then raise exception 'Invalid winning number'; end if;
  v_color := case when p_winning_number = 0 then 'green' when p_winning_number = any(v_red) then 'red' else 'black' end;
  if p_winning_color is distinct from v_color then raise exception 'Invalid winning color'; end if;

  if p_bet_type = 'number' then
    v_multiplier := case when p_winning_number::text = v_bet_value then 36 else 0 end;
  elsif p_winning_number <> 0 then
    v_multiplier := case
      when p_bet_type = 'red' and v_color = 'red' then 2
      when p_bet_type = 'black' and v_color = 'black' then 2
      when p_bet_type = 'odd' and p_winning_number % 2 = 1 then 2
      when p_bet_type = 'even' and p_winning_number % 2 = 0 then 2
      when p_bet_type = 'low' and p_winning_number <= 18 then 2
      when p_bet_type = 'high' and p_winning_number >= 19 then 2
      when p_bet_type = 'column1' and (p_winning_number - 1) % 3 = 0 then 3
      when p_bet_type = 'column2' and (p_winning_number - 1) % 3 = 1 then 3
      when p_bet_type = 'column3' and (p_winning_number - 1) % 3 = 2 then 3
      else 0 end;
  end if;
  v_payout := round(p_stake * v_multiplier,2);
  v_result := case when v_payout > 0 then 'won' else 'lost' end;
  if p_payout is distinct from v_payout or p_result is distinct from v_result then raise exception 'Invalid roulette settlement'; end if;
  if v_balance < p_stake then raise exception 'Insufficient test balance'; end if;

  update public.wallets as w set balance = w.balance - p_stake, updated_at = now()
    where w.user_id = p_user_id returning w.balance into v_balance;
  insert into public.wallet_transactions(user_id, transaction_type, amount, balance_after, note)
    values (p_user_id, 'wager_debit', p_stake, v_balance, 'Test roulette wager debit');

  if v_payout > 0 then
    update public.wallets as w set balance = w.balance + v_payout, updated_at = now()
      where w.user_id = p_user_id returning w.balance into v_balance;
    insert into public.wallet_transactions(user_id, transaction_type, amount, balance_after, note)
      values (p_user_id, 'wager_credit', v_payout, v_balance, 'Test roulette payout');
  end if;

  insert into public.roulette_spins(user_id,request_id,stake,bet_type,bet_value,winning_number,winning_color,payout,result,is_test)
    values (p_user_id,p_request_id,p_stake,p_bet_type,v_bet_value,p_winning_number,v_color,v_payout,v_result,true)
    returning * into v_spin;
  return query select v_spin.id, v_balance, v_spin.payout, v_spin.result,
    v_spin.request_id, v_spin.winning_number, v_spin.winning_color,
    v_spin.bet_type, v_spin.bet_value, v_spin.stake, v_spin.created_at;
end;
$_$;


ALTER FUNCTION public.play_test_roulette_atomic(p_user_id uuid, p_stake numeric, p_bet_type text, p_bet_value text, p_winning_number integer, p_winning_color text, p_payout numeric, p_result text, p_request_id uuid) OWNER TO postgres;

--
-- Name: play_themed_slot_paid_spin_atomic(uuid, text, numeric, jsonb, numeric, text, numeric, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.play_themed_slot_paid_spin_atomic(p_user_id uuid, p_game text, p_stake numeric, p_reels jsonb, p_payout numeric, p_result text, p_bet_per_line numeric, p_bonus_spins integer) RETURNS TABLE(spin_id uuid, balance numeric, bonus_session_id uuid, bonus_spins_remaining integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_balance numeric;
  v_spin_id uuid;
  v_bonus_id uuid;
  v_existing uuid;
begin
  if p_game not in ('midnight-monsters','galactic-rebellion') then raise exception 'Invalid game'; end if;
  if p_stake is null or p_stake <= 0 then raise exception 'Invalid stake'; end if;
  if p_payout is null or p_payout < 0 then raise exception 'Invalid payout'; end if;
  if p_result not in ('won','lost') then raise exception 'Invalid result'; end if;
  if p_bet_per_line is null or p_bet_per_line <= 0 then raise exception 'Invalid bet per line'; end if;
  if p_bonus_spins is null or p_bonus_spins < 0 or p_bonus_spins > 50 then raise exception 'Invalid bonus spins'; end if;

  select s.id into v_existing
  from public.themed_slot_bonus_sessions as s
  where s.user_id=p_user_id and s.game=p_game and s.status='active'
  limit 1
  for update;
  if v_existing is not null then raise exception 'Finish active free spins first'; end if;

  select w.balance into v_balance from public.wallets as w where w.user_id=p_user_id for update;
  if v_balance is null then raise exception 'Wallet not found'; end if;
  if v_balance < p_stake then raise exception 'Insufficient test balance'; end if;

  update public.wallets as w
  set balance=w.balance-p_stake, updated_at=now()
  where w.user_id=p_user_id returning w.balance into v_balance;
  insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note)
  values(p_user_id,'wager_debit',p_stake,v_balance,'Themed slots paid spin debit');

  if p_payout > 0 then
    update public.wallets as w
    set balance=w.balance+p_payout, updated_at=now()
    where w.user_id=p_user_id returning w.balance into v_balance;
    insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note)
    values(p_user_id,'wager_credit',p_payout,v_balance,'Themed slots paid spin payout');
  end if;

  insert into public.slot_spins(user_id,stake,reels,payout,result,is_test)
  values(p_user_id,p_stake,p_reels,p_payout,p_result,true)
  returning id into v_spin_id;

  if p_bonus_spins > 0 then
    insert into public.themed_slot_bonus_sessions(user_id,game,bet_per_line,spins_remaining,total_spins,total_payout,status)
    values(p_user_id,p_game,p_bet_per_line,p_bonus_spins,p_bonus_spins,0,'active')
    returning id into v_bonus_id;
  end if;

  return query select v_spin_id,v_balance,v_bonus_id,coalesce(p_bonus_spins,0);
end;
$$;


ALTER FUNCTION public.play_themed_slot_paid_spin_atomic(p_user_id uuid, p_game text, p_stake numeric, p_reels jsonb, p_payout numeric, p_result text, p_bet_per_line numeric, p_bonus_spins integer) OWNER TO postgres;

--
-- Name: record_operator_health_alerts(jsonb, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.record_operator_health_alerts(p_checks jsonb, p_observed_at timestamp with time zone) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare c jsonb; old public.operator_monitor_checks%rowtype; new_status text; k text; incident integer; kind text; enqueued integer:=0; next_transition bigint;
begin
  if p_checks is null or jsonb_typeof(p_checks)<>'array' or jsonb_array_length(p_checks)>64 then raise exception 'Invalid health checks'; end if;
  if p_observed_at is null or p_observed_at>now()+interval '5 minutes' then raise exception 'Invalid health observation time'; end if;
  for c in select value from jsonb_array_elements(p_checks) loop
    k:=c->>'key';new_status:=c->>'status';
    if k is null or k !~ '^[a-z][a-z0-9_]{0,63}$' or new_status not in ('healthy','stale','degraded') or c->'measured' is distinct from 'true'::jsonb then raise exception 'Invalid measured health check'; end if;
    perform pg_advisory_xact_lock(hashtextextended('operator-health:'||k,0));
    select * into old from public.operator_monitor_checks where check_key=k for update;
    if found and old.last_observed_at>=p_observed_at then continue; end if;
    incident:=coalesce(old.incident_number,0);kind:=null;next_transition:=coalesce(old.transition_sequence,0);
    if new_status<>'healthy' and (old.check_key is null or old.status='healthy') then incident:=incident+1;kind:='opened';
    elsif old.check_key is not null and old.status<>'healthy' and new_status='healthy' then kind:='recovered';
    elsif old.check_key is not null and old.status<>new_status then kind:='changed';end if;
    if kind is not null then next_transition:=next_transition+1;end if;
    insert into public.operator_monitor_checks(check_key,status,incident_number,last_observed_at,transition_sequence)
    values(k,new_status,incident,p_observed_at,next_transition)
    on conflict(check_key) do update set status=excluded.status,incident_number=excluded.incident_number,last_observed_at=excluded.last_observed_at,transition_sequence=excluded.transition_sequence,updated_at=now();
    if kind is not null then
      insert into public.operator_alert_outbox(check_key,incident_number,event_type,health_status,transition_sequence,payload)
      values(k,incident,kind,new_status,next_transition,jsonb_build_object('mode','TEST MODE','check_key',k,'incident_number',incident,'event_type',kind,'status',new_status,'detail',left(coalesce(c->>'detail',''),500),'observed_at',p_observed_at,'transition_sequence',next_transition));
      enqueued:=enqueued+1;
    end if;
  end loop;
  return enqueued;
end; $_$;


ALTER FUNCTION public.record_operator_health_alerts(p_checks jsonb, p_observed_at timestamp with time zone) OWNER TO postgres;

--
-- Name: refill_test_wallet_atomic(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.refill_test_wallet_atomic(p_user_id uuid) RETURNS TABLE(balance numeric, credited numeric, next_refill_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_balance numeric;
  v_credit numeric;
  v_last_refill timestamptz;
  v_next timestamptz;
begin
  if p_user_id is null then
    raise exception 'User is required';
  end if;

  select w.balance into v_balance
  from public.wallets w
  where w.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Test wallet not found';
  end if;

  select max(t.created_at) into v_last_refill
  from public.wallet_transactions t
  where t.user_id = p_user_id
    and t.transaction_type = 'adjustment'
    and t.note = 'Test credit refill';

  if v_last_refill is not null and v_last_refill > now() - interval '24 hours' then
    v_next := v_last_refill + interval '24 hours';
    raise exception 'REFILL_COOLDOWN:%', v_next;
  end if;

  if v_balance >= 25 then
    raise exception 'REFILL_NOT_NEEDED';
  end if;

  v_credit := 1000 - v_balance;
  if v_credit <= 0 then
    raise exception 'REFILL_NOT_NEEDED';
  end if;

  update public.wallets
  set balance = 1000,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.wallet_transactions(user_id, wager_id, transaction_type, amount, balance_after, note)
  values (p_user_id, null, 'adjustment', v_credit, 1000, 'Test credit refill');

  balance := 1000;
  credited := v_credit;
  next_refill_at := now() + interval '24 hours';
  return next;
end;
$$;


ALTER FUNCTION public.refill_test_wallet_atomic(p_user_id uuid) OWNER TO postgres;

--
-- Name: retry_operator_alert(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.retry_operator_alert(p_alert_id uuid) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare changed integer;
begin
  update public.operator_alert_outbox set state='pending',attempts=0,next_attempt_at=now(),lease_id=null,leased_until=null,last_error_code=null
  where id=p_alert_id and state='dead';
  get diagnostics changed=row_count;return changed=1;
end; $$;


ALTER FUNCTION public.retry_operator_alert(p_alert_id uuid) OWNER TO postgres;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION public.set_updated_at() OWNER TO postgres;

--
-- Name: settle_caribbean_stud_test_atomic(uuid, uuid, text, numeric, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.settle_caribbean_stud_test_atomic(p_user_id uuid, p_round_id uuid, p_decision text, p_payout numeric, p_result text, p_player_rank text, p_dealer_rank text, p_dealer_qualifies boolean) RETURNS TABLE(round_id uuid, raise_bet numeric, payout numeric, balance numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_balance numeric;v_ante numeric;v_raise numeric:=0;
begin
 if p_decision not in ('raise','fold') then raise exception 'Invalid decision'; end if;
 if p_payout is null or p_payout<0 then raise exception 'Invalid payout'; end if;
 select ante into v_ante from public.caribbean_stud_rounds where id=p_round_id and user_id=p_user_id and status='active' for update;
 if v_ante is null then raise exception 'Active round not found'; end if;
 select w.balance into v_balance from public.wallets w where w.user_id=p_user_id for update;
 if v_balance is null then raise exception 'Wallet not found'; end if;
 if p_decision='raise' then
   v_raise:=2*v_ante;
   if v_balance<v_raise then raise exception 'Insufficient test balance for Raise bet'; end if;
   update public.wallets w set balance=w.balance-v_raise,updated_at=now() where w.user_id=p_user_id returning w.balance into v_balance;
   insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note) values(p_user_id,'wager_debit',v_raise,v_balance,'Test Caribbean Stud Raise bet');
 else
   if p_payout<>0 then raise exception 'Fold payout must be zero'; end if;
 end if;
 if p_payout>0 then
   update public.wallets w set balance=w.balance+p_payout,updated_at=now() where w.user_id=p_user_id returning w.balance into v_balance;
   insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note) values(p_user_id,'wager_credit',p_payout,v_balance,'Test Caribbean Stud payout');
 end if;
 update public.caribbean_stud_rounds set status='settled',decision=p_decision,raise_bet=v_raise,payout=p_payout,result=p_result,player_rank=p_player_rank,dealer_rank=p_dealer_rank,dealer_qualifies=p_dealer_qualifies,settled_at=now() where id=p_round_id and user_id=p_user_id;
 return query select p_round_id,v_raise,p_payout,v_balance;
end;$$;


ALTER FUNCTION public.settle_caribbean_stud_test_atomic(p_user_id uuid, p_round_id uuid, p_decision text, p_payout numeric, p_result text, p_player_rank text, p_dealer_rank text, p_dealer_qualifies boolean) OWNER TO postgres;

--
-- Name: settle_slot_request_atomic(uuid, uuid, text, text, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.settle_slot_request_atomic(p_user_id uuid, p_request_id uuid, p_game text, p_action text, p_payload jsonb, p_response jsonb, p_settlement jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_prior public.slot_request_receipts%rowtype;
  v_row record;
  v_response jsonb;
  v_spin jsonb;
  v_id uuid := gen_random_uuid();
  v_created_at timestamptz;
begin
  if p_user_id is null or p_request_id is null or p_game not in
    ('midnight-monsters','galactic-rebellion','lucky-7s') or
    p_action not in ('spin','bonus_spin') or
    jsonb_typeof(p_payload) <> 'object' or
    jsonb_typeof(p_response->'spin') <> 'object' then
    raise exception 'Invalid slot request';
  end if;
  -- Serialize a customer's slot requests, including different IDs, so two
  -- paid spins cannot race the creation of an active free-spin session.
  perform pg_advisory_xact_lock(hashtextextended('slot-request:'||p_user_id::text,0));
  select r.* into v_prior from public.slot_request_receipts r
    where r.user_id=p_user_id and r.request_id=p_request_id;
  if found then
    if v_prior.game<>p_game or v_prior.action<>p_action or
      v_prior.request_payload<>p_payload then raise exception 'REQUEST_CONFLICT'; end if;
    return v_prior.response;
  end if;
  v_spin := p_response->'spin';
  if p_action='bonus_spin' then
    if p_game='lucky-7s' or not exists (
      select 1 from public.themed_slot_bonus_sessions s
      where s.id=(p_settlement->>'session_id')::uuid
        and s.user_id=p_user_id and s.game=p_game
    ) then raise exception 'Bonus session not found'; end if;
    select * into v_row from public.settle_themed_bonus_spin_atomic(
      p_user_id,(p_settlement->>'session_id')::uuid,v_spin->'grid',
      (v_spin->>'payout')::numeric,v_spin->>'feature_name');
    v_spin := v_spin || jsonb_build_object(
      'id',v_row.bonus_spin_id,'balance',v_row.balance,
      'bonus_spins_remaining',v_row.spins_remaining,
      'bonus_total_payout',v_row.total_payout,
      'bonus_complete',v_row.session_status='completed');
  elsif p_game='lucky-7s' then
    select * into v_row from public.play_slot_test_spin_atomic(
      p_user_id,(v_spin->>'stake')::numeric,p_settlement->'reels',
      (v_spin->>'payout')::numeric,v_spin->>'result');
    v_spin := v_spin || jsonb_build_object(
      'id',v_row.spin_id,'payout',v_row.payout,'balance',v_row.balance);
  else
    select * into v_row from public.play_themed_slot_paid_spin_atomic(
      p_user_id,p_game,(v_spin->>'stake')::numeric,p_settlement->'reels',
      (v_spin->>'payout')::numeric,v_spin->>'result',
      (v_spin->>'bet_per_line')::numeric,(p_settlement->>'bonus_spins')::integer);
    v_spin := v_spin || jsonb_build_object(
      'id',v_row.spin_id,'balance',v_row.balance,
      'bonus_session_id',v_row.bonus_session_id,
      'bonus_spins_remaining',v_row.bonus_spins_remaining);
  end if;
  v_created_at := clock_timestamp();
  v_spin := v_spin || jsonb_build_object('request_id',p_request_id,
    'receipt_id',v_id,'created_at',v_created_at,
    'is_free_spin',p_action='bonus_spin',
    'spin_type',case when p_action='bonus_spin' then 'bonus' else 'paid' end);
  v_response := p_response || jsonb_build_object('ok',true,'spin',v_spin);
  insert into public.slot_request_receipts
    (id,user_id,request_id,game,action,request_payload,response,created_at)
  values(v_id,p_user_id,p_request_id,p_game,p_action,p_payload,v_response,v_created_at);
  return v_response;
end;
$$;


ALTER FUNCTION public.settle_slot_request_atomic(p_user_id uuid, p_request_id uuid, p_game text, p_action text, p_payload jsonb, p_response jsonb, p_settlement jsonb) OWNER TO postgres;

--
-- Name: settle_test_wager_atomic(uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.settle_test_wager_atomic(p_wager_id uuid, p_result text) RETURNS TABLE(wager_id uuid, status public.wager_status, credited_amount numeric, balance numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_wager public.wagers%rowtype;
  v_balance numeric;
  v_credit numeric := 0;
begin
  if p_result not in ('won','lost','void') then
    raise exception 'Invalid settlement result';
  end if;

  select *
  into v_wager
  from public.wagers
  where id = p_wager_id
    and is_test = true
  for update;

  if not found then
    raise exception 'Test wager not found';
  end if;

  if v_wager.status not in ('pending','accepted') then
    raise exception 'Wager already settled or unavailable';
  end if;

  select w.balance
  into v_balance
  from public.wallets w
  where w.user_id = v_wager.user_id
  for update;

  if v_balance is null then
    raise exception 'Wallet not found';
  end if;

  if p_result = 'won' then
    v_credit := v_wager.potential_return;
  elsif p_result = 'void' then
    v_credit := v_wager.stake;
  else
    v_credit := 0;
  end if;

  if v_credit > 0 then
    update public.wallets w
    set balance = w.balance + v_credit,
        updated_at = now()
    where w.user_id = v_wager.user_id
    returning w.balance into v_balance;

    insert into public.wallet_transactions (
      user_id,
      wager_id,
      transaction_type,
      amount,
      balance_after,
      note
    )
    values (
      v_wager.user_id,
      v_wager.id,
      case when p_result = 'void' then 'refund'::transaction_type else 'wager_credit'::transaction_type end,
      v_credit,
      v_balance,
      case when p_result = 'void' then 'Test wager refund' else 'Test wager win credit' end
    );
  end if;

  update public.wagers w
  set status = p_result::wager_status,
      settled_at = now(),
      updated_at = now()
  where w.id = v_wager.id;

  return query
  select
    v_wager.id,
    p_result::wager_status,
    v_credit,
    v_balance;
end;
$$;


ALTER FUNCTION public.settle_test_wager_atomic(p_wager_id uuid, p_result text) OWNER TO postgres;

--
-- Name: settle_test_wager_auto_atomic(uuid, text, numeric, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.settle_test_wager_auto_atomic(p_wager_id uuid, p_result text, p_credit numeric, p_grades jsonb) RETURNS TABLE(wager_id uuid, status public.wager_status, credited_amount numeric, balance numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_wager public.wagers%rowtype;
  v_balance numeric;
  v_grade jsonb;
  v_credit numeric := coalesce(p_credit, 0);
  v_selection_count integer;
  v_grade_count integer;
  v_distinct_grade_count integer;
  v_valid_grade_count integer;
  v_lost_count integer;
  v_void_count integer;
  v_won_count integer;
  v_expected_result text;
begin
  if p_result is null or p_result not in ('won','lost','void') then
    raise exception 'Invalid settlement result';
  end if;
  if v_credit < 0 then
    raise exception 'Invalid settlement credit';
  end if;
  if p_grades is null or jsonb_typeof(p_grades) <> 'array' then
    raise exception 'Settlement grades must be an array';
  end if;

  select * into v_wager
  from public.wagers
  where id = p_wager_id and is_test = true
  for update;

  if not found then raise exception 'Test wager not found'; end if;
  if v_wager.status not in ('pending','accepted') then
    raise exception 'Wager already settled or unavailable';
  end if;

  select count(*) into v_selection_count
  from public.wager_selections s
  where s.wager_id = v_wager.id;

  select count(*) into v_grade_count
  from jsonb_array_elements(p_grades);

  if v_selection_count = 0 or v_grade_count <> v_selection_count then
    raise exception 'Settlement must grade every wager selection exactly once';
  end if;

  select count(distinct value->>'selection_id') into v_distinct_grade_count
  from jsonb_array_elements(p_grades);

  if v_distinct_grade_count <> v_grade_count then
    raise exception 'Duplicate or missing selection grade id';
  end if;

  select count(*) into v_valid_grade_count
  from jsonb_array_elements(p_grades) g
  join public.wager_selections s
    on s.id = (g.value->>'selection_id')::uuid
   and s.wager_id = v_wager.id
  where g.value->>'result' in ('won','lost','void');

  if v_valid_grade_count <> v_selection_count then
    raise exception 'Settlement contains invalid or foreign selection grades';
  end if;

  select
    count(*) filter (where value->>'result' = 'lost'),
    count(*) filter (where value->>'result' = 'void'),
    count(*) filter (where value->>'result' = 'won')
  into v_lost_count, v_void_count, v_won_count
  from jsonb_array_elements(p_grades);

  if v_lost_count > 0 then
    v_expected_result := 'lost';
  elsif v_void_count = v_selection_count then
    v_expected_result := 'void';
  else
    v_expected_result := 'won';
  end if;

  if p_result <> v_expected_result then
    raise exception 'Overall wager result does not match leg grades';
  end if;

  if p_result = 'lost' and v_credit <> 0 then
    raise exception 'Lost wager cannot have settlement credit';
  end if;
  if p_result = 'void' and v_credit <> v_wager.stake then
    raise exception 'Void wager credit must equal stake';
  end if;
  if p_result = 'won' then
    if v_credit <= 0 or v_credit > v_wager.potential_return then
      raise exception 'Invalid winning settlement credit';
    end if;
    if v_void_count = 0 and v_credit <> v_wager.potential_return then
      raise exception 'Full-win credit must equal potential return';
    end if;
  end if;

  for v_grade in select value from jsonb_array_elements(p_grades)
  loop
    update public.wager_selections s
    set result = v_grade->>'result',
        graded_at = now(),
        final_home_score = case when v_grade->>'final_home_score' is null then null else (v_grade->>'final_home_score')::numeric end,
        final_away_score = case when v_grade->>'final_away_score' is null then null else (v_grade->>'final_away_score')::numeric end
    where s.id = (v_grade->>'selection_id')::uuid
      and s.wager_id = v_wager.id;
  end loop;

  select w.balance into v_balance
  from public.wallets w
  where w.user_id = v_wager.user_id
  for update;

  if v_balance is null then raise exception 'Wallet not found'; end if;

  if v_credit > 0 then
    update public.wallets w
    set balance = w.balance + v_credit,
        updated_at = now()
    where w.user_id = v_wager.user_id
    returning w.balance into v_balance;

    insert into public.wallet_transactions(
      user_id, wager_id, transaction_type, amount, balance_after, note
    ) values (
      v_wager.user_id,
      v_wager.id,
      case when p_result = 'void' then 'refund'::public.transaction_type else 'wager_credit'::public.transaction_type end,
      v_credit,
      v_balance,
      case when p_result = 'void' then 'Automatic test wager refund' else 'Automatic test wager settlement credit' end
    );
  end if;

  update public.wagers w
  set status = p_result::public.wager_status,
      settled_at = now(),
      updated_at = now()
  where w.id = v_wager.id;

  return query select v_wager.id, p_result::public.wager_status, v_credit, v_balance;
end;
$$;


ALTER FUNCTION public.settle_test_wager_auto_atomic(p_wager_id uuid, p_result text, p_credit numeric, p_grades jsonb) OWNER TO postgres;

--
-- Name: settle_themed_bonus_spin_atomic(uuid, uuid, jsonb, numeric, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.settle_themed_bonus_spin_atomic(p_user_id uuid, p_session_id uuid, p_grid jsonb, p_payout numeric, p_feature text) RETURNS TABLE(balance numeric, spins_remaining integer, session_status text, total_payout numeric, bonus_spin_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_session public.themed_slot_bonus_sessions%rowtype;
  v_balance numeric;
  v_spin_id uuid;
begin
  if p_payout is null or p_payout < 0 then raise exception 'Invalid bonus payout'; end if;

  select s.* into v_session
  from public.themed_slot_bonus_sessions as s
  where s.id=p_session_id and s.user_id=p_user_id
  for update;

  if not found then raise exception 'Bonus session not found'; end if;
  if v_session.status <> 'active' or v_session.spins_remaining <= 0 then raise exception 'Bonus session is not active'; end if;

  select w.balance into v_balance
  from public.wallets as w
  where w.user_id=p_user_id
  for update;

  if v_balance is null then raise exception 'Wallet not found'; end if;

  if p_payout > 0 then
    update public.wallets as w
    set balance=w.balance+p_payout, updated_at=now()
    where w.user_id=p_user_id
    returning w.balance into v_balance;

    insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note)
    values(p_user_id,'wager_credit',p_payout,v_balance,'Themed slot free-spin payout');
  end if;

  update public.themed_slot_bonus_sessions as s
  set spins_remaining=s.spins_remaining-1,
      total_payout=s.total_payout+p_payout,
      status=case when s.spins_remaining-1 <= 0 then 'completed' else 'active' end,
      updated_at=now()
  where s.id=p_session_id
  returning s.spins_remaining,s.status,s.total_payout
  into v_session.spins_remaining,v_session.status,v_session.total_payout;

  insert into public.themed_slot_bonus_spins(session_id,user_id,game,grid,payout,feature)
  values(p_session_id,p_user_id,v_session.game,p_grid,p_payout,p_feature)
  returning id into v_spin_id;

  return query
  select v_balance,v_session.spins_remaining,v_session.status,v_session.total_payout,v_spin_id;
end;
$$;


ALTER FUNCTION public.settle_themed_bonus_spin_atomic(p_user_id uuid, p_session_id uuid, p_grid jsonb, p_payout numeric, p_feature text) OWNER TO postgres;

--
-- Name: settle_three_card_poker_test_atomic(uuid, uuid, text, numeric, text, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.settle_three_card_poker_test_atomic(p_user_id uuid, p_round_id uuid, p_decision text, p_payout numeric, p_result text, p_dealer_qualifies boolean) RETURNS TABLE(round_id uuid, payout numeric, balance numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_balance numeric; v_ante numeric;
begin
  if p_decision not in ('play','fold') then raise exception 'Invalid decision'; end if;
  if p_payout is null or p_payout<0 then raise exception 'Invalid payout'; end if;
  select ante into v_ante from public.three_card_poker_rounds where id=p_round_id and user_id=p_user_id and status='active' for update;
  if v_ante is null then raise exception 'Active round not found'; end if;
  select w.balance into v_balance from public.wallets w where w.user_id=p_user_id for update;
  if v_balance is null then raise exception 'Wallet not found'; end if;
  if p_decision='play' then
    if v_balance<v_ante then raise exception 'Insufficient test balance for Play bet'; end if;
    update public.wallets w set balance=w.balance-v_ante,updated_at=now() where w.user_id=p_user_id returning w.balance into v_balance;
    insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note) values(p_user_id,'wager_debit',v_ante,v_balance,'Test Three Card Poker Play bet');
  elsif p_payout<>0 then
    raise exception 'Fold payout must be zero';
  end if;
  if p_payout>0 then
    update public.wallets w set balance=w.balance+p_payout,updated_at=now() where w.user_id=p_user_id returning w.balance into v_balance;
    insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note) values(p_user_id,'wager_credit',p_payout,v_balance,'Test Three Card Poker payout');
  end if;
  update public.three_card_poker_rounds set status='settled',decision=p_decision,result=p_result,dealer_qualifies=p_dealer_qualifies,payout=p_payout,settled_at=now() where id=p_round_id and user_id=p_user_id;
  return query select p_round_id,p_payout,v_balance;
end;$$;


ALTER FUNCTION public.settle_three_card_poker_test_atomic(p_user_id uuid, p_round_id uuid, p_decision text, p_payout numeric, p_result text, p_dealer_qualifies boolean) OWNER TO postgres;

--
-- Name: settle_ultimate_texas_holdem_test_atomic(uuid, uuid, text, jsonb, numeric, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.settle_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_round_id uuid, p_decision text, p_community jsonb, p_payout numeric, p_result text, p_player_rank text, p_dealer_rank text, p_dealer_qualifies boolean) RETURNS TABLE(round_id uuid, payout numeric, balance numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


ALTER FUNCTION public.settle_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_round_id uuid, p_decision text, p_community jsonb, p_payout numeric, p_result text, p_player_rank text, p_dealer_rank text, p_dealer_qualifies boolean) OWNER TO postgres;

--
-- Name: settle_video_poker_test_atomic(uuid, uuid, jsonb, text, numeric, numeric); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.settle_video_poker_test_atomic(p_user_id uuid, p_hand_id uuid, p_final_hand jsonb, p_result text, p_multiplier numeric, p_payout numeric) RETURNS TABLE(hand_id uuid, payout numeric, balance numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


ALTER FUNCTION public.settle_video_poker_test_atomic(p_user_id uuid, p_hand_id uuid, p_final_hand jsonb, p_result text, p_multiplier numeric, p_payout numeric) OWNER TO postgres;

--
-- Name: sportsbook_test_request_commit(uuid, uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sportsbook_test_request_commit(p_user_id uuid, p_request_id uuid, p_processing_token uuid, p_selections jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  r public.sportsbook_placement_requests%rowtype; v_balance numeric; v_stake numeric;
  v_potential_return numeric; v_type public.wager_type; v_id uuid;
  s jsonb; v_decimal numeric := 1; v_odds integer; v_count integer;
begin
  if p_user_id is null or p_request_id is null or p_processing_token is null then raise exception 'Request identity is required'; end if;
  select balance into v_balance from public.wallets where user_id = p_user_id for update;
  if not found then raise exception 'Wallet not found'; end if;
  select * into r from public.sportsbook_placement_requests
    where user_id = p_user_id and request_id = p_request_id for update;
  if not found then raise exception 'Placement request not found'; end if;
  if r.state <> 'pending' or r.processing_token is distinct from p_processing_token then
    return public.sportsbook_test_request_receipt(p_user_id,p_request_id) || jsonb_build_object('replayed',true);
  end if;
  v_type := (r.request_payload->>'wager_type')::public.wager_type;
  v_stake := (r.request_payload->>'stake')::numeric;
  if v_stake is null or v_stake <= 0 or v_stake > 100000 or v_stake <> round(v_stake,2) then raise exception 'Invalid stake'; end if;
  if p_selections is null or jsonb_typeof(p_selections) <> 'array' then raise exception 'Selections must be an array'; end if;
  -- Preserve exact request semantics; quote timestamps are validation metadata.
  if (select jsonb_agg(value - 'quoted_at' order by ord)
      from jsonb_array_elements(p_selections) with ordinality a(value,ord))
       is distinct from r.request_payload->'selections' then raise exception 'Request selections changed'; end if;
  v_count := jsonb_array_length(p_selections);
  if (v_type = 'single' and v_count <> 1) or (v_type = 'parlay' and (v_count < 2 or v_count > 20)) then raise exception 'Invalid selection count'; end if;
  if exists(select 1 from jsonb_array_elements(p_selections) a(value)
    where nullif(btrim(value->>'event_id'),'') is null or nullif(btrim(value->>'sport_key'),'') is null
      or nullif(btrim(value->>'market_key'),'') is null or nullif(btrim(value->>'selection_name'),'') is null) then
    raise exception 'Selection data is incomplete';
  end if;
  if v_type = 'parlay' and exists(select 1 from jsonb_array_elements(p_selections) a(value)
    group by lower(btrim(value->>'event_id')) having count(*) > 1) then
    return public.sportsbook_test_request_reject(p_user_id,p_request_id,p_processing_token,
      'SAME_EVENT_PARLAY','Parlays must use different events. Same-event selections are not available. No test credits were charged.');
  end if;
  for s in select value from jsonb_array_elements(p_selections) loop
    v_odds := (s->>'american_odds')::integer;
    if v_odds is null or v_odds = 0 then raise exception 'Invalid selection odds'; end if;
    v_decimal := v_decimal * case when v_odds > 0 then 1 + v_odds::numeric/100 else 1 + 100/abs(v_odds::numeric) end;
  end loop;
  v_potential_return := round(v_stake * v_decimal,2);
  if v_balance < v_stake then
    return public.sportsbook_test_request_reject(p_user_id,p_request_id,p_processing_token,
      'INSUFFICIENT_BALANCE','Insufficient test balance. No test credits were charged.');
  end if;
  update public.wallets set balance = balance - v_stake, updated_at = now()
    where user_id = p_user_id returning balance into v_balance;
  insert into public.wagers(user_id,wager_type,stake,potential_return,status,is_test,placement_fingerprint,placement_bucket)
    values(p_user_id,v_type,v_stake,v_potential_return,'pending',true,
      md5(p_user_id::text || ':' || p_request_id::text),floor(extract(epoch from clock_timestamp())/10)::bigint)
    returning id into v_id;
  for s in select value from jsonb_array_elements(p_selections) loop
    insert into public.wager_selections(wager_id,event_id,event_name,sport_key,market_key,market_title,
      selection_name,description,point,american_odds,quoted_at)
    values(v_id,s->>'event_id',s->>'event_name',s->>'sport_key',s->>'market_key',nullif(s->>'market_title',''),
      s->>'selection_name',nullif(s->>'description',''),nullif(s->>'point','')::numeric,
      (s->>'american_odds')::integer,nullif(s->>'quoted_at','')::timestamptz);
  end loop;
  insert into public.wallet_transactions(user_id,wager_id,transaction_type,amount,balance_after,note)
    values(p_user_id,v_id,'wager_debit',v_stake,v_balance,'Test wager debit');
  update public.sportsbook_placement_requests set state = 'accepted',wager_id = v_id,
    processing_token = null, lease_until = null, updated_at = now()
    where user_id = p_user_id and request_id = p_request_id;
  return public.sportsbook_test_request_receipt(p_user_id,p_request_id);
end $$;


ALTER FUNCTION public.sportsbook_test_request_commit(p_user_id uuid, p_request_id uuid, p_processing_token uuid, p_selections jsonb) OWNER TO postgres;

--
-- Name: sportsbook_test_request_prepare(uuid, uuid, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sportsbook_test_request_prepare(p_user_id uuid, p_request_id uuid, p_payload jsonb, p_processing_token uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare r public.sportsbook_placement_requests%rowtype; v_balance numeric;
begin
  if p_user_id is null or p_request_id is null or p_processing_token is null then
    raise exception 'User, request ID and processing token are required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'Request payload is required'; end if;
  select balance into v_balance from public.wallets where user_id = p_user_id for update;
  if not found then raise exception 'Wallet not found'; end if;
  select * into r from public.sportsbook_placement_requests
    where user_id = p_user_id and request_id = p_request_id for update;
  if found then
    if r.request_payload <> p_payload then
      return jsonb_build_object('ok',false,'state','conflict','code','REQUEST_CONFLICT',
        'error','This request ID belongs to a different wager. Recover the original wager first.',
        'request_id',p_request_id);
    end if;
    if r.state <> 'pending' then
      return public.sportsbook_test_request_receipt(p_user_id,p_request_id) || jsonb_build_object('replayed',true);
    end if;
    if r.lease_until > clock_timestamp() then
      return public.sportsbook_test_request_receipt(p_user_id,p_request_id);
    end if;
    update public.sportsbook_placement_requests set processing_token = p_processing_token,
      lease_until = clock_timestamp() + interval '60 seconds', updated_at = now()
      where user_id = p_user_id and request_id = p_request_id;
  else
    insert into public.sportsbook_placement_requests(user_id,request_id,request_payload,state,processing_token,lease_until)
      values(p_user_id,p_request_id,p_payload,'pending',p_processing_token,clock_timestamp() + interval '60 seconds');
  end if;
  return jsonb_build_object('ok',false,'state','pending','request_id',p_request_id,'processing',true);
end $$;


ALTER FUNCTION public.sportsbook_test_request_prepare(p_user_id uuid, p_request_id uuid, p_payload jsonb, p_processing_token uuid) OWNER TO postgres;

--
-- Name: sportsbook_test_request_receipt(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sportsbook_test_request_receipt(p_user_id uuid, p_request_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare r public.sportsbook_placement_requests%rowtype; result jsonb;
begin
  if p_user_id is null or p_request_id is null then raise exception 'User and request ID are required'; end if;
  select * into r from public.sportsbook_placement_requests
    where user_id = p_user_id and request_id = p_request_id;
  if not found then
    return jsonb_build_object('ok',false,'state','not_found','request_id',p_request_id,'retry_same_request',true);
  end if;
  if r.state = 'accepted' then
    select jsonb_build_object('ok',true,'state','accepted','request_id',p_request_id,
      'wager',jsonb_build_object('id',w.id,'wager_type',w.wager_type,'stake',w.stake,
        'potential_return',w.potential_return,'status',w.status,'placed_at',w.placed_at,'is_test',w.is_test),
      'balance',b.balance) into result
    from public.wagers w join public.wallets b on b.user_id = w.user_id
    where w.id = r.wager_id and w.user_id = p_user_id;
    if result is null then raise exception 'Placement receipt is unavailable'; end if;
    return result;
  end if;
  if r.state = 'rejected' then
    return jsonb_build_object('ok',false,'state','rejected','request_id',p_request_id,
      'code',r.error_code,'error',r.error_message,'no_credits_charged',true);
  end if;
  return jsonb_build_object('ok',false,'state','pending','request_id',p_request_id,
    'retry_same_request',true,'retry_after_ms',2000);
end $$;


ALTER FUNCTION public.sportsbook_test_request_receipt(p_user_id uuid, p_request_id uuid) OWNER TO postgres;

--
-- Name: sportsbook_test_request_reject(uuid, uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sportsbook_test_request_reject(p_user_id uuid, p_request_id uuid, p_processing_token uuid, p_code text, p_message text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_user_id is null or p_request_id is null or p_processing_token is null then raise exception 'Request identity is required'; end if;
  -- A rejected/cancelled processor can never commit afterwards. If another
  -- processor took over or committed, return its current state instead.
  update public.sportsbook_placement_requests set state = 'rejected',
    error_code = p_code, error_message = p_message, processing_token = null,
    lease_until = null, updated_at = now()
    where user_id = p_user_id and request_id = p_request_id
      and state = 'pending' and processing_token = p_processing_token;
  return public.sportsbook_test_request_receipt(p_user_id,p_request_id);
end $$;


ALTER FUNCTION public.sportsbook_test_request_reject(p_user_id uuid, p_request_id uuid, p_processing_token uuid, p_code text, p_message text) OWNER TO postgres;

--
-- Name: start_blackjack_test_hand_atomic(uuid, numeric, jsonb, jsonb, integer, integer, public.blackjack_hand_status, numeric); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.start_blackjack_test_hand_atomic(p_user_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric) RETURNS TABLE(hand_id uuid, hand_status public.blackjack_hand_status, balance numeric, payout numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


ALTER FUNCTION public.start_blackjack_test_hand_atomic(p_user_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric) OWNER TO postgres;

--
-- Name: start_blackjack_test_hand_idempotent(uuid, uuid, numeric, jsonb, jsonb, jsonb, integer, integer, public.blackjack_hand_status, numeric); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.start_blackjack_test_hand_idempotent(p_user_id uuid, p_request_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric) RETURNS TABLE(hand_id uuid, balance numeric, replayed boolean, error text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


ALTER FUNCTION public.start_blackjack_test_hand_idempotent(p_user_id uuid, p_request_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric) OWNER TO postgres;

--
-- Name: start_blackjack_test_hand_insured(uuid, uuid, numeric, jsonb, jsonb, jsonb, integer, integer, public.blackjack_hand_status, numeric); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.start_blackjack_test_hand_insured(p_user_id uuid, p_request_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric) RETURNS TABLE(hand_id uuid, balance numeric, replayed boolean, error text)
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  perform pg_catalog.set_config('gameday.blackjack_insurance','on',true);
  return query select s.hand_id,s.balance,s.replayed,s.error
  from public.start_blackjack_test_hand_idempotent(p_user_id,p_request_id,p_stake,
    p_player_cards,p_dealer_cards,p_shoe,p_player_total,p_dealer_total,p_status,p_payout) s;
  perform pg_catalog.set_config('gameday.blackjack_insurance','off',true);
end;
$$;


ALTER FUNCTION public.start_blackjack_test_hand_insured(p_user_id uuid, p_request_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric) OWNER TO postgres;

--
-- Name: start_blackjack_test_hand_v2(uuid, numeric, jsonb, jsonb, jsonb, integer, integer, public.blackjack_hand_status, numeric); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.start_blackjack_test_hand_v2(p_user_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric) RETURNS TABLE(hand_id uuid, hand_status public.blackjack_hand_status, balance numeric, payout numeric, action_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


ALTER FUNCTION public.start_blackjack_test_hand_v2(p_user_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric) OWNER TO postgres;

--
-- Name: touch_sports_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.touch_sports_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION public.touch_sports_updated_at() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: baccarat_rounds; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.baccarat_rounds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    stake numeric(12,2) NOT NULL,
    bet_type text NOT NULL,
    player_cards jsonb DEFAULT '[]'::jsonb NOT NULL,
    banker_cards jsonb DEFAULT '[]'::jsonb NOT NULL,
    player_total integer NOT NULL,
    banker_total integer NOT NULL,
    result text NOT NULL,
    payout numeric(12,2) DEFAULT 0 NOT NULL,
    is_test boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT baccarat_rounds_bet_type_check CHECK ((bet_type = ANY (ARRAY['player'::text, 'banker'::text, 'tie'::text]))),
    CONSTRAINT baccarat_rounds_payout_check CHECK ((payout >= (0)::numeric)),
    CONSTRAINT baccarat_rounds_result_check CHECK ((result = ANY (ARRAY['player'::text, 'banker'::text, 'tie'::text]))),
    CONSTRAINT baccarat_rounds_stake_check CHECK ((stake > (0)::numeric))
);


ALTER TABLE public.baccarat_rounds OWNER TO postgres;

--
-- Name: blackjack_hands; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.blackjack_hands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    stake numeric(14,2) NOT NULL,
    status public.blackjack_hand_status DEFAULT 'active'::public.blackjack_hand_status NOT NULL,
    player_cards jsonb DEFAULT '[]'::jsonb NOT NULL,
    dealer_cards jsonb DEFAULT '[]'::jsonb NOT NULL,
    player_total integer,
    dealer_total integer,
    payout numeric(14,2) DEFAULT 0 NOT NULL,
    is_test boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    shoe jsonb DEFAULT '[]'::jsonb NOT NULL,
    action_count integer DEFAULT 0 NOT NULL,
    original_stake numeric(14,2),
    insurance_status text DEFAULT 'not_offered'::text NOT NULL,
    insurance_stake numeric(14,2) DEFAULT 0 NOT NULL,
    insurance_payout numeric(14,2) DEFAULT 0 NOT NULL,
    player_hands jsonb,
    active_hand_index integer,
    CONSTRAINT blackjack_hands_insurance_payout_check CHECK ((insurance_payout >= (0)::numeric)),
    CONSTRAINT blackjack_hands_insurance_stake_check CHECK ((insurance_stake >= (0)::numeric)),
    CONSTRAINT blackjack_hands_insurance_status_check CHECK ((insurance_status = ANY (ARRAY['not_offered'::text, 'pending'::text, 'accepted'::text, 'declined'::text]))),
    CONSTRAINT blackjack_hands_payout_check CHECK ((payout >= (0)::numeric)),
    CONSTRAINT blackjack_hands_stake_check CHECK ((stake > (0)::numeric))
);


ALTER TABLE public.blackjack_hands OWNER TO postgres;

--
-- Name: card_game_deal_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.card_game_deal_requests (
    user_id uuid NOT NULL,
    game text NOT NULL,
    request_id uuid NOT NULL,
    stake numeric NOT NULL,
    bet_type text,
    target_id uuid,
    rejection text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT card_game_deal_requests_check CHECK ((((target_id IS NOT NULL) AND (rejection IS NULL)) OR ((target_id IS NULL) AND (rejection IS NOT NULL) AND (rejection = 'Insufficient test balance'::text)))),
    CONSTRAINT card_game_deal_requests_check1 CHECK ((((game = 'blackjack'::text) AND (bet_type IS NULL)) OR ((game = 'baccarat'::text) AND (bet_type IS NOT NULL) AND (bet_type = ANY (ARRAY['player'::text, 'banker'::text, 'tie'::text]))))),
    CONSTRAINT card_game_deal_requests_game_check CHECK ((game = ANY (ARRAY['blackjack'::text, 'baccarat'::text]))),
    CONSTRAINT card_game_deal_requests_stake_check CHECK (((stake > (0)::numeric) AND (stake <= (10000)::numeric)))
);


ALTER TABLE public.card_game_deal_requests OWNER TO postgres;

--
-- Name: caribbean_stud_rounds; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.caribbean_stud_rounds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    ante numeric NOT NULL,
    raise_bet numeric DEFAULT 0 NOT NULL,
    player_hand jsonb NOT NULL,
    dealer_hand jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    decision text,
    player_rank text,
    dealer_rank text,
    dealer_qualifies boolean,
    result text,
    payout numeric DEFAULT 0 NOT NULL,
    is_test boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    CONSTRAINT caribbean_stud_rounds_ante_check CHECK ((ante > (0)::numeric)),
    CONSTRAINT caribbean_stud_rounds_payout_check CHECK ((payout >= (0)::numeric)),
    CONSTRAINT caribbean_stud_rounds_raise_bet_check CHECK ((raise_bet >= (0)::numeric)),
    CONSTRAINT caribbean_stud_rounds_status_check CHECK ((status = ANY (ARRAY['active'::text, 'settled'::text])))
);


ALTER TABLE public.caribbean_stud_rounds OWNER TO postgres;

--
-- Name: sports_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sports_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_event_id text NOT NULL,
    sport_key text NOT NULL,
    sport_title text,
    commence_time timestamp with time zone NOT NULL,
    home_team text,
    away_team text,
    status text DEFAULT 'scheduled'::text NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sports_events_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'live'::text, 'final'::text, 'cancelled'::text, 'postponed'::text])))
);

ALTER TABLE ONLY public.sports_events FORCE ROW LEVEL SECURITY;


ALTER TABLE public.sports_events OWNER TO postgres;

--
-- Name: sports_markets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sports_markets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    provider_market_key text NOT NULL,
    market_title text,
    market_type text DEFAULT 'game'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    line_method text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sports_markets_market_type_check CHECK ((market_type = ANY (ARRAY['game'::text, 'prop'::text, 'future'::text]))),
    CONSTRAINT sports_markets_status_check CHECK ((status = ANY (ARRAY['open'::text, 'suspended'::text, 'closed'::text])))
);

ALTER TABLE ONLY public.sports_markets FORCE ROW LEVEL SECURITY;


ALTER TABLE public.sports_markets OWNER TO postgres;

--
-- Name: sports_outcomes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sports_outcomes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    outcome_name text NOT NULL,
    description text,
    point numeric,
    american_odds integer NOT NULL,
    source_book_count integer,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    outcome_key text NOT NULL
);

ALTER TABLE ONLY public.sports_outcomes FORCE ROW LEVEL SECURITY;


ALTER TABLE public.sports_outcomes OWNER TO postgres;

--
-- Name: current_gameday_lines; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.current_gameday_lines WITH (security_invoker='true') AS
 SELECT e.provider_event_id,
    e.sport_key,
    e.sport_title,
    e.commence_time,
    e.home_team,
    e.away_team,
    e.status AS event_status,
    m.provider_market_key,
    m.market_title,
    m.market_type,
    m.status AS market_status,
    o.outcome_name,
    o.description,
    o.point,
    o.american_odds,
    o.source_book_count,
    o.is_active,
    o.updated_at
   FROM ((public.sports_events e
     JOIN public.sports_markets m ON ((m.event_id = e.id)))
     JOIN public.sports_outcomes o ON ((o.market_id = m.id)));


ALTER VIEW public.current_gameday_lines OWNER TO postgres;

--
-- Name: internal_job_secrets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.internal_job_secrets (
    name text NOT NULL,
    secret text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.internal_job_secrets FORCE ROW LEVEL SECURITY;


ALTER TABLE public.internal_job_secrets OWNER TO postgres;

--
-- Name: live_casino_games; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.live_casino_games (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_key text NOT NULL,
    provider_game_id text NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    thumbnail_url text,
    enabled boolean DEFAULT false NOT NULL,
    is_test boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT live_casino_games_category_check CHECK ((category = ANY (ARRAY['blackjack'::text, 'roulette'::text, 'baccarat'::text, 'game_show'::text, 'poker'::text, 'other'::text])))
);


ALTER TABLE public.live_casino_games OWNER TO postgres;

--
-- Name: live_casino_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.live_casino_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    game_id uuid NOT NULL,
    provider_key text NOT NULL,
    provider_session_id text,
    launch_url text,
    status text DEFAULT 'requested'::text NOT NULL,
    is_test boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT live_casino_sessions_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'launched'::text, 'failed'::text, 'closed'::text])))
);


ALTER TABLE public.live_casino_sessions OWNER TO postgres;

--
-- Name: odds_response_cache; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.odds_response_cache (
    cache_key text NOT NULL,
    payload jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.odds_response_cache OWNER TO postgres;

--
-- Name: operator_alert_outbox; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.operator_alert_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    check_key text NOT NULL,
    incident_number integer NOT NULL,
    event_type text NOT NULL,
    health_status text NOT NULL,
    payload jsonb NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_id uuid,
    leased_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    last_error_code text,
    transition_sequence bigint NOT NULL,
    CONSTRAINT operator_alert_outbox_attempts_check CHECK (((attempts >= 0) AND (attempts <= 8))),
    CONSTRAINT operator_alert_outbox_event_type_check CHECK ((event_type = ANY (ARRAY['opened'::text, 'changed'::text, 'recovered'::text]))),
    CONSTRAINT operator_alert_outbox_health_status_check CHECK ((health_status = ANY (ARRAY['healthy'::text, 'stale'::text, 'degraded'::text]))),
    CONSTRAINT operator_alert_outbox_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'delivered'::text, 'dead'::text]))),
    CONSTRAINT operator_alert_positive_transition CHECK ((transition_sequence > 0))
);


ALTER TABLE public.operator_alert_outbox OWNER TO postgres;

--
-- Name: operator_monitor_checks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.operator_monitor_checks (
    check_key text NOT NULL,
    status text NOT NULL,
    incident_number integer DEFAULT 0 NOT NULL,
    last_observed_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    transition_sequence bigint DEFAULT 0 NOT NULL,
    CONSTRAINT operator_monitor_checks_check_key_check CHECK ((check_key ~ '^[a-z][a-z0-9_]{0,63}$'::text)),
    CONSTRAINT operator_monitor_checks_status_check CHECK ((status = ANY (ARRAY['healthy'::text, 'stale'::text, 'degraded'::text]))),
    CONSTRAINT operator_monitor_checks_transition_sequence_check CHECK ((transition_sequence >= 0))
);


ALTER TABLE public.operator_monitor_checks OWNER TO postgres;

--
-- Name: operator_monitor_delivery_config; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.operator_monitor_delivery_config (
    singleton boolean DEFAULT true NOT NULL,
    webhook_url text NOT NULL,
    signing_secret text NOT NULL,
    configured_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operator_monitor_delivery_config_signing_secret_check CHECK ((length(signing_secret) >= 32)),
    CONSTRAINT operator_monitor_delivery_config_singleton_check CHECK (singleton)
);


ALTER TABLE public.operator_monitor_delivery_config OWNER TO postgres;

--
-- Name: operator_monitor_job_secret; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.operator_monitor_job_secret (
    singleton boolean DEFAULT true NOT NULL,
    secret text NOT NULL,
    CONSTRAINT operator_monitor_job_secret_secret_check CHECK ((length(secret) >= 64)),
    CONSTRAINT operator_monitor_job_secret_singleton_check CHECK (singleton)
);


ALTER TABLE public.operator_monitor_job_secret OWNER TO postgres;

--
-- Name: operator_monitor_state; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.operator_monitor_state (
    singleton boolean DEFAULT true NOT NULL,
    checked_at timestamp with time zone NOT NULL,
    overall_status text NOT NULL,
    delivery_configured boolean NOT NULL,
    delivered_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT operator_monitor_state_overall_status_check CHECK ((overall_status = ANY (ARRAY['healthy'::text, 'attention'::text, 'degraded'::text]))),
    CONSTRAINT operator_monitor_state_singleton_check CHECK (singleton)
);


ALTER TABLE public.operator_monitor_state OWNER TO postgres;

--
-- Name: poker_test_actions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.poker_test_actions (
    user_id uuid NOT NULL,
    request_id uuid NOT NULL,
    hand_id uuid NOT NULL,
    game text NOT NULL,
    request_payload jsonb NOT NULL,
    state_result jsonb NOT NULL,
    balance numeric NOT NULL,
    started_request_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT poker_test_actions_balance_check CHECK ((balance >= (0)::numeric)),
    CONSTRAINT poker_test_actions_game_check CHECK ((game = ANY (ARRAY['holdem'::text, 'omaha'::text, 'stud'::text, 'draw'::text]))),
    CONSTRAINT poker_test_actions_request_payload_check CHECK ((jsonb_typeof(request_payload) = 'object'::text)),
    CONSTRAINT poker_test_actions_state_result_check CHECK ((jsonb_typeof(state_result) = 'object'::text))
);


ALTER TABLE public.poker_test_actions OWNER TO postgres;

--
-- Name: poker_test_hands; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.poker_test_hands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    game text NOT NULL,
    status text NOT NULL,
    action_count integer NOT NULL,
    stake numeric NOT NULL,
    committed numeric NOT NULL,
    payout numeric DEFAULT 0 NOT NULL,
    private_state jsonb NOT NULL,
    started_request_id uuid NOT NULL,
    last_request_id uuid NOT NULL,
    is_test boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    CONSTRAINT poker_test_hands_action_count_check CHECK ((action_count >= 0)),
    CONSTRAINT poker_test_hands_check CHECK (((committed >= stake) AND (committed = round(committed, 2)))),
    CONSTRAINT poker_test_hands_game_check CHECK ((game = ANY (ARRAY['holdem'::text, 'omaha'::text, 'stud'::text, 'draw'::text]))),
    CONSTRAINT poker_test_hands_is_test_check CHECK (is_test),
    CONSTRAINT poker_test_hands_payout_check CHECK (((payout >= (0)::numeric) AND (payout = round(payout, 2)))),
    CONSTRAINT poker_test_hands_private_state_check CHECK ((jsonb_typeof(private_state) = 'object'::text)),
    CONSTRAINT poker_test_hands_stake_check CHECK (((stake > (0)::numeric) AND (stake <= (10000)::numeric) AND (stake = round(stake, 2)))),
    CONSTRAINT poker_test_hands_status_check CHECK ((status = ANY (ARRAY['active'::text, 'settled'::text])))
);


ALTER TABLE public.poker_test_hands OWNER TO postgres;

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    display_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.profiles OWNER TO postgres;

--
-- Name: roulette_spins; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.roulette_spins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    stake numeric NOT NULL,
    bet_type text NOT NULL,
    bet_value text,
    winning_number integer NOT NULL,
    winning_color text NOT NULL,
    payout numeric DEFAULT 0 NOT NULL,
    result text NOT NULL,
    is_test boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    request_id uuid,
    CONSTRAINT roulette_spins_bet_type_check CHECK ((bet_type = ANY (ARRAY['red'::text, 'black'::text, 'odd'::text, 'even'::text, 'low'::text, 'high'::text, 'number'::text, 'column1'::text, 'column2'::text, 'column3'::text]))),
    CONSTRAINT roulette_spins_payout_check CHECK ((payout >= (0)::numeric)),
    CONSTRAINT roulette_spins_result_check CHECK ((result = ANY (ARRAY['won'::text, 'lost'::text]))),
    CONSTRAINT roulette_spins_stake_check CHECK ((stake > (0)::numeric)),
    CONSTRAINT roulette_spins_winning_color_check CHECK ((winning_color = ANY (ARRAY['red'::text, 'black'::text, 'green'::text]))),
    CONSTRAINT roulette_spins_winning_number_check CHECK (((winning_number >= 0) AND (winning_number <= 36)))
);


ALTER TABLE public.roulette_spins OWNER TO postgres;

--
-- Name: slot_request_receipts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.slot_request_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    request_id uuid NOT NULL,
    game text NOT NULL,
    action text NOT NULL,
    request_payload jsonb NOT NULL,
    response jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT slot_request_receipts_action_check CHECK ((action = ANY (ARRAY['spin'::text, 'bonus_spin'::text]))),
    CONSTRAINT slot_request_receipts_game_check CHECK ((game = ANY (ARRAY['midnight-monsters'::text, 'galactic-rebellion'::text, 'lucky-7s'::text])))
);


ALTER TABLE public.slot_request_receipts OWNER TO postgres;

--
-- Name: slot_spins; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.slot_spins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    stake numeric NOT NULL,
    reels jsonb DEFAULT '[]'::jsonb NOT NULL,
    payout numeric DEFAULT 0 NOT NULL,
    result text NOT NULL,
    is_test boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT slot_spins_payout_check CHECK ((payout >= (0)::numeric)),
    CONSTRAINT slot_spins_result_check CHECK ((result = ANY (ARRAY['won'::text, 'lost'::text]))),
    CONSTRAINT slot_spins_stake_check CHECK ((stake > (0)::numeric))
);


ALTER TABLE public.slot_spins OWNER TO postgres;

--
-- Name: sports_line_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sports_line_history (
    id bigint NOT NULL,
    outcome_id uuid NOT NULL,
    point numeric,
    american_odds integer NOT NULL,
    source_book_count integer,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.sports_line_history FORCE ROW LEVEL SECURITY;


ALTER TABLE public.sports_line_history OWNER TO postgres;

--
-- Name: sports_line_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.sports_line_history ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.sports_line_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sports_provider_snapshots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sports_provider_snapshots (
    id bigint NOT NULL,
    provider text NOT NULL,
    mode text NOT NULL,
    sport_key text,
    provider_event_id text,
    payload jsonb NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.sports_provider_snapshots FORCE ROW LEVEL SECURITY;


ALTER TABLE public.sports_provider_snapshots OWNER TO postgres;

--
-- Name: sports_provider_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.sports_provider_snapshots ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.sports_provider_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sportsbook_placement_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sportsbook_placement_requests (
    user_id uuid NOT NULL,
    request_id uuid NOT NULL,
    request_payload jsonb NOT NULL,
    state text NOT NULL,
    processing_token uuid,
    lease_until timestamp with time zone,
    wager_id uuid,
    error_code text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sportsbook_placement_requests_check CHECK (((state = 'accepted'::text) = (wager_id IS NOT NULL))),
    CONSTRAINT sportsbook_placement_requests_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])))
);


ALTER TABLE public.sportsbook_placement_requests OWNER TO postgres;

--
-- Name: test_wager_final_scores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.test_wager_final_scores (
    sport_key text NOT NULL,
    provider_event_id text NOT NULL,
    game jsonb NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT test_wager_final_scores_check CHECK ((((game ->> 'id'::text) = provider_event_id) IS TRUE)),
    CONSTRAINT test_wager_final_scores_game_check CHECK ((((jsonb_typeof(game) = 'object'::text) AND ((game -> 'completed'::text) = 'true'::jsonb)) IS TRUE))
);


ALTER TABLE public.test_wager_final_scores OWNER TO postgres;

--
-- Name: test_wager_settlement_checks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.test_wager_settlement_checks (
    wager_id uuid NOT NULL,
    next_check_at timestamp with time zone DEFAULT now() NOT NULL,
    processing_token uuid,
    lease_until timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_attempt_at timestamp with time zone,
    last_checked_at timestamp with time zone,
    last_outcome text,
    review_required boolean DEFAULT false NOT NULL,
    review_reason text,
    CONSTRAINT settlement_lease_pair CHECK (((processing_token IS NULL) = (lease_until IS NULL))),
    CONSTRAINT test_wager_settlement_checks_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT test_wager_settlement_checks_last_outcome_check CHECK ((last_outcome = ANY (ARRAY['waiting'::text, 'provider_error'::text, 'review'::text, 'settled'::text, 'error'::text])))
);


ALTER TABLE public.test_wager_settlement_checks OWNER TO postgres;

--
-- Name: themed_slot_bonus_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.themed_slot_bonus_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    game text NOT NULL,
    bet_per_line numeric NOT NULL,
    spins_remaining integer NOT NULL,
    total_spins integer NOT NULL,
    total_payout numeric DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT themed_slot_bonus_sessions_bet_per_line_check CHECK ((bet_per_line > (0)::numeric)),
    CONSTRAINT themed_slot_bonus_sessions_game_check CHECK ((game = ANY (ARRAY['midnight-monsters'::text, 'galactic-rebellion'::text]))),
    CONSTRAINT themed_slot_bonus_sessions_spins_remaining_check CHECK ((spins_remaining >= 0)),
    CONSTRAINT themed_slot_bonus_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text]))),
    CONSTRAINT themed_slot_bonus_sessions_total_payout_check CHECK ((total_payout >= (0)::numeric)),
    CONSTRAINT themed_slot_bonus_sessions_total_spins_check CHECK ((total_spins > 0))
);


ALTER TABLE public.themed_slot_bonus_sessions OWNER TO postgres;

--
-- Name: themed_slot_bonus_spins; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.themed_slot_bonus_spins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    game text NOT NULL,
    grid jsonb NOT NULL,
    payout numeric NOT NULL,
    feature text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT themed_slot_bonus_spins_payout_check CHECK ((payout >= (0)::numeric))
);


ALTER TABLE public.themed_slot_bonus_spins OWNER TO postgres;

--
-- Name: three_card_poker_rounds; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.three_card_poker_rounds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    ante numeric NOT NULL,
    player_hand jsonb NOT NULL,
    dealer_hand jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    decision text,
    result text,
    dealer_qualifies boolean,
    payout numeric DEFAULT 0 NOT NULL,
    is_test boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    CONSTRAINT three_card_poker_rounds_ante_check CHECK ((ante > (0)::numeric)),
    CONSTRAINT three_card_poker_rounds_decision_check CHECK ((decision = ANY (ARRAY['play'::text, 'fold'::text]))),
    CONSTRAINT three_card_poker_rounds_payout_check CHECK ((payout >= (0)::numeric)),
    CONSTRAINT three_card_poker_rounds_status_check CHECK ((status = ANY (ARRAY['active'::text, 'settled'::text])))
);


ALTER TABLE public.three_card_poker_rounds OWNER TO postgres;

--
-- Name: ultimate_texas_holdem_rounds; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ultimate_texas_holdem_rounds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    ante numeric NOT NULL,
    blind numeric NOT NULL,
    play_bet numeric DEFAULT 0 NOT NULL,
    player_hand jsonb NOT NULL,
    dealer_hand jsonb NOT NULL,
    deck_remaining jsonb NOT NULL,
    community jsonb DEFAULT '[]'::jsonb NOT NULL,
    stage text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    decision text,
    player_rank text,
    dealer_rank text,
    dealer_qualifies boolean,
    result text,
    payout numeric DEFAULT 0 NOT NULL,
    is_test boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    CONSTRAINT ultimate_texas_holdem_rounds_ante_check CHECK ((ante > (0)::numeric)),
    CONSTRAINT ultimate_texas_holdem_rounds_blind_check CHECK ((blind > (0)::numeric)),
    CONSTRAINT ultimate_texas_holdem_rounds_payout_check CHECK ((payout >= (0)::numeric)),
    CONSTRAINT ultimate_texas_holdem_rounds_play_bet_check CHECK ((play_bet >= (0)::numeric)),
    CONSTRAINT ultimate_texas_holdem_rounds_stage_check CHECK ((stage = ANY (ARRAY['preflop'::text, 'flop'::text, 'river'::text, 'settled'::text]))),
    CONSTRAINT ultimate_texas_holdem_rounds_status_check CHECK ((status = ANY (ARRAY['active'::text, 'settled'::text])))
);


ALTER TABLE public.ultimate_texas_holdem_rounds OWNER TO postgres;

--
-- Name: video_poker_hands; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.video_poker_hands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    game text DEFAULT 'jacks_or_better'::text NOT NULL,
    stake numeric NOT NULL,
    initial_hand jsonb NOT NULL,
    final_hand jsonb,
    deck_remaining jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    result text,
    multiplier numeric DEFAULT 0 NOT NULL,
    payout numeric DEFAULT 0 NOT NULL,
    is_test boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    CONSTRAINT video_poker_hands_multiplier_check CHECK ((multiplier >= (0)::numeric)),
    CONSTRAINT video_poker_hands_payout_check CHECK ((payout >= (0)::numeric)),
    CONSTRAINT video_poker_hands_stake_check CHECK ((stake > (0)::numeric)),
    CONSTRAINT video_poker_hands_status_check CHECK ((status = ANY (ARRAY['active'::text, 'settled'::text])))
);


ALTER TABLE public.video_poker_hands OWNER TO postgres;

--
-- Name: wager_selections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.wager_selections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wager_id uuid NOT NULL,
    event_id text NOT NULL,
    event_name text NOT NULL,
    sport_key text,
    market_key text NOT NULL,
    market_title text,
    selection_name text NOT NULL,
    description text,
    point numeric,
    american_odds integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    quoted_at timestamp with time zone,
    result text,
    graded_at timestamp with time zone,
    final_home_score numeric,
    final_away_score numeric,
    CONSTRAINT wager_selections_result_check CHECK (((result IS NULL) OR (result = ANY (ARRAY['won'::text, 'lost'::text, 'void'::text]))))
);


ALTER TABLE public.wager_selections OWNER TO postgres;

--
-- Name: wagers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.wagers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    wager_type public.wager_type NOT NULL,
    stake numeric(14,2) NOT NULL,
    potential_return numeric(14,2) NOT NULL,
    status public.wager_status DEFAULT 'pending'::public.wager_status NOT NULL,
    placed_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_test boolean DEFAULT true NOT NULL,
    placement_fingerprint text,
    placement_bucket bigint,
    CONSTRAINT wagers_potential_return_check CHECK ((potential_return >= (0)::numeric)),
    CONSTRAINT wagers_stake_check CHECK ((stake > (0)::numeric))
);


ALTER TABLE public.wagers OWNER TO postgres;

--
-- Name: wallet_transactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.wallet_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    wager_id uuid,
    transaction_type public.transaction_type NOT NULL,
    amount numeric(14,2) NOT NULL,
    balance_after numeric(14,2),
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wallet_transactions_amount_check CHECK ((amount > (0)::numeric))
);


ALTER TABLE public.wallet_transactions OWNER TO postgres;

--
-- Name: wallets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.wallets (
    user_id uuid NOT NULL,
    balance numeric(14,2) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wallets_balance_check CHECK ((balance >= (0)::numeric))
);


ALTER TABLE public.wallets OWNER TO postgres;

--
-- Name: baccarat_rounds baccarat_rounds_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.baccarat_rounds
    ADD CONSTRAINT baccarat_rounds_pkey PRIMARY KEY (id);


--
-- Name: blackjack_hands blackjack_hands_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.blackjack_hands
    ADD CONSTRAINT blackjack_hands_pkey PRIMARY KEY (id);


--
-- Name: card_game_deal_requests card_game_deal_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.card_game_deal_requests
    ADD CONSTRAINT card_game_deal_requests_pkey PRIMARY KEY (user_id, game, request_id);


--
-- Name: caribbean_stud_rounds caribbean_stud_rounds_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.caribbean_stud_rounds
    ADD CONSTRAINT caribbean_stud_rounds_pkey PRIMARY KEY (id);


--
-- Name: internal_job_secrets internal_job_secrets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.internal_job_secrets
    ADD CONSTRAINT internal_job_secrets_pkey PRIMARY KEY (name);


--
-- Name: live_casino_games live_casino_games_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.live_casino_games
    ADD CONSTRAINT live_casino_games_pkey PRIMARY KEY (id);


--
-- Name: live_casino_games live_casino_games_provider_key_provider_game_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.live_casino_games
    ADD CONSTRAINT live_casino_games_provider_key_provider_game_id_key UNIQUE (provider_key, provider_game_id);


--
-- Name: live_casino_sessions live_casino_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.live_casino_sessions
    ADD CONSTRAINT live_casino_sessions_pkey PRIMARY KEY (id);


--
-- Name: odds_response_cache odds_response_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.odds_response_cache
    ADD CONSTRAINT odds_response_cache_pkey PRIMARY KEY (cache_key);


--
-- Name: operator_alert_outbox operator_alert_check_transition_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operator_alert_outbox
    ADD CONSTRAINT operator_alert_check_transition_unique UNIQUE (check_key, transition_sequence);


--
-- Name: operator_alert_outbox operator_alert_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operator_alert_outbox
    ADD CONSTRAINT operator_alert_outbox_pkey PRIMARY KEY (id);


--
-- Name: operator_monitor_checks operator_monitor_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operator_monitor_checks
    ADD CONSTRAINT operator_monitor_checks_pkey PRIMARY KEY (check_key);


--
-- Name: operator_monitor_delivery_config operator_monitor_delivery_config_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operator_monitor_delivery_config
    ADD CONSTRAINT operator_monitor_delivery_config_pkey PRIMARY KEY (singleton);


--
-- Name: operator_monitor_job_secret operator_monitor_job_secret_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operator_monitor_job_secret
    ADD CONSTRAINT operator_monitor_job_secret_pkey PRIMARY KEY (singleton);


--
-- Name: operator_monitor_state operator_monitor_state_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operator_monitor_state
    ADD CONSTRAINT operator_monitor_state_pkey PRIMARY KEY (singleton);


--
-- Name: poker_test_actions poker_test_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.poker_test_actions
    ADD CONSTRAINT poker_test_actions_pkey PRIMARY KEY (user_id, request_id);


--
-- Name: poker_test_hands poker_test_hands_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.poker_test_hands
    ADD CONSTRAINT poker_test_hands_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: roulette_spins roulette_spins_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roulette_spins
    ADD CONSTRAINT roulette_spins_pkey PRIMARY KEY (id);


--
-- Name: slot_request_receipts slot_request_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.slot_request_receipts
    ADD CONSTRAINT slot_request_receipts_pkey PRIMARY KEY (id);


--
-- Name: slot_request_receipts slot_request_receipts_user_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.slot_request_receipts
    ADD CONSTRAINT slot_request_receipts_user_id_request_id_key UNIQUE (user_id, request_id);


--
-- Name: slot_spins slot_spins_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.slot_spins
    ADD CONSTRAINT slot_spins_pkey PRIMARY KEY (id);


--
-- Name: sports_events sports_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sports_events
    ADD CONSTRAINT sports_events_pkey PRIMARY KEY (id);


--
-- Name: sports_events sports_events_provider_event_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sports_events
    ADD CONSTRAINT sports_events_provider_event_id_key UNIQUE (provider_event_id);


--
-- Name: sports_line_history sports_line_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sports_line_history
    ADD CONSTRAINT sports_line_history_pkey PRIMARY KEY (id);


--
-- Name: sports_markets sports_markets_event_id_provider_market_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sports_markets
    ADD CONSTRAINT sports_markets_event_id_provider_market_key_key UNIQUE (event_id, provider_market_key);


--
-- Name: sports_markets sports_markets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sports_markets
    ADD CONSTRAINT sports_markets_pkey PRIMARY KEY (id);


--
-- Name: sports_outcomes sports_outcomes_market_outcome_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sports_outcomes
    ADD CONSTRAINT sports_outcomes_market_outcome_key_key UNIQUE (market_id, outcome_key);


--
-- Name: sports_outcomes sports_outcomes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sports_outcomes
    ADD CONSTRAINT sports_outcomes_pkey PRIMARY KEY (id);


--
-- Name: sports_provider_snapshots sports_provider_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sports_provider_snapshots
    ADD CONSTRAINT sports_provider_snapshots_pkey PRIMARY KEY (id);


--
-- Name: sportsbook_placement_requests sportsbook_placement_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sportsbook_placement_requests
    ADD CONSTRAINT sportsbook_placement_requests_pkey PRIMARY KEY (user_id, request_id);


--
-- Name: test_wager_final_scores test_wager_final_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.test_wager_final_scores
    ADD CONSTRAINT test_wager_final_scores_pkey PRIMARY KEY (sport_key, provider_event_id);


--
-- Name: test_wager_settlement_checks test_wager_settlement_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.test_wager_settlement_checks
    ADD CONSTRAINT test_wager_settlement_checks_pkey PRIMARY KEY (wager_id);


--
-- Name: themed_slot_bonus_sessions themed_slot_bonus_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.themed_slot_bonus_sessions
    ADD CONSTRAINT themed_slot_bonus_sessions_pkey PRIMARY KEY (id);


--
-- Name: themed_slot_bonus_spins themed_slot_bonus_spins_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.themed_slot_bonus_spins
    ADD CONSTRAINT themed_slot_bonus_spins_pkey PRIMARY KEY (id);


--
-- Name: three_card_poker_rounds three_card_poker_rounds_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.three_card_poker_rounds
    ADD CONSTRAINT three_card_poker_rounds_pkey PRIMARY KEY (id);


--
-- Name: ultimate_texas_holdem_rounds ultimate_texas_holdem_rounds_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ultimate_texas_holdem_rounds
    ADD CONSTRAINT ultimate_texas_holdem_rounds_pkey PRIMARY KEY (id);


--
-- Name: video_poker_hands video_poker_hands_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.video_poker_hands
    ADD CONSTRAINT video_poker_hands_pkey PRIMARY KEY (id);


--
-- Name: wager_selections wager_selections_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wager_selections
    ADD CONSTRAINT wager_selections_pkey PRIMARY KEY (id);


--
-- Name: wagers wagers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wagers
    ADD CONSTRAINT wagers_pkey PRIMARY KEY (id);


--
-- Name: wallet_transactions wallet_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (user_id);


--
-- Name: baccarat_rounds_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX baccarat_rounds_user_id_idx ON public.baccarat_rounds USING btree (user_id);


--
-- Name: baccarat_settled_history_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX baccarat_settled_history_idx ON public.baccarat_rounds USING btree (user_id, created_at DESC, id DESC) WHERE (is_test = true);


--
-- Name: blackjack_hands_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX blackjack_hands_status_idx ON public.blackjack_hands USING btree (status);


--
-- Name: blackjack_hands_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX blackjack_hands_user_id_idx ON public.blackjack_hands USING btree (user_id);


--
-- Name: blackjack_one_active_hand_per_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX blackjack_one_active_hand_per_user ON public.blackjack_hands USING btree (user_id) WHERE (status = 'active'::public.blackjack_hand_status);


--
-- Name: blackjack_settled_history_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX blackjack_settled_history_idx ON public.blackjack_hands USING btree (user_id, created_at DESC, id DESC) WHERE ((is_test = true) AND (status <> 'active'::public.blackjack_hand_status) AND (settled_at IS NOT NULL));


--
-- Name: caribbean_stud_one_active_per_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX caribbean_stud_one_active_per_user ON public.caribbean_stud_rounds USING btree (user_id) WHERE (status = 'active'::text);


--
-- Name: live_casino_sessions_game_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX live_casino_sessions_game_id_idx ON public.live_casino_sessions USING btree (game_id);


--
-- Name: live_casino_sessions_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX live_casino_sessions_user_id_idx ON public.live_casino_sessions USING btree (user_id);


--
-- Name: odds_response_cache_expires_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX odds_response_cache_expires_idx ON public.odds_response_cache USING btree (expires_at);


--
-- Name: operator_alert_outbox_pending_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX operator_alert_outbox_pending_idx ON public.operator_alert_outbox USING btree (next_attempt_at, created_at, id) WHERE (state = 'pending'::text);


--
-- Name: poker_settled_history_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX poker_settled_history_idx ON public.poker_test_hands USING btree (user_id, game, created_at DESC, id DESC) WHERE ((is_test = true) AND (status = 'settled'::text) AND (settled_at IS NOT NULL));


--
-- Name: poker_test_actions_hand_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX poker_test_actions_hand_id_idx ON public.poker_test_actions USING btree (hand_id);


--
-- Name: poker_test_hands_one_active_per_game_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX poker_test_hands_one_active_per_game_idx ON public.poker_test_hands USING btree (user_id, game) WHERE (status = 'active'::text);


--
-- Name: poker_test_hands_user_game_latest_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX poker_test_hands_user_game_latest_idx ON public.poker_test_hands USING btree (user_id, game, created_at DESC);


--
-- Name: roulette_settled_history_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX roulette_settled_history_idx ON public.roulette_spins USING btree (user_id, created_at DESC, id DESC) WHERE (is_test = true);


--
-- Name: roulette_spins_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX roulette_spins_user_id_idx ON public.roulette_spins USING btree (user_id);


--
-- Name: roulette_spins_user_request_once_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX roulette_spins_user_request_once_idx ON public.roulette_spins USING btree (user_id, request_id);


--
-- Name: slot_request_receipts_owner_history_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX slot_request_receipts_owner_history_idx ON public.slot_request_receipts USING btree (user_id, created_at DESC, id DESC);


--
-- Name: slot_spins_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX slot_spins_user_id_idx ON public.slot_spins USING btree (user_id);


--
-- Name: sports_events_sport_time_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sports_events_sport_time_idx ON public.sports_events USING btree (sport_key, commence_time);


--
-- Name: sports_events_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sports_events_status_idx ON public.sports_events USING btree (status, commence_time);


--
-- Name: sports_line_history_outcome_time_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sports_line_history_outcome_time_idx ON public.sports_line_history USING btree (outcome_id, captured_at DESC);


--
-- Name: sports_markets_event_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sports_markets_event_idx ON public.sports_markets USING btree (event_id);


--
-- Name: sports_markets_type_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sports_markets_type_status_idx ON public.sports_markets USING btree (market_type, status);


--
-- Name: sports_outcomes_identity_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX sports_outcomes_identity_idx ON public.sports_outcomes USING btree (market_id, outcome_name, COALESCE(description, ''::text));


--
-- Name: sports_outcomes_market_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sports_outcomes_market_idx ON public.sports_outcomes USING btree (market_id);


--
-- Name: sports_provider_snapshots_captured_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sports_provider_snapshots_captured_idx ON public.sports_provider_snapshots USING btree (captured_at DESC);


--
-- Name: sports_provider_snapshots_lookup_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sports_provider_snapshots_lookup_idx ON public.sports_provider_snapshots USING btree (provider, mode, sport_key, captured_at DESC);


--
-- Name: sports_provider_snapshots_mode_sport_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sports_provider_snapshots_mode_sport_idx ON public.sports_provider_snapshots USING btree (mode, sport_key, captured_at DESC);


--
-- Name: sports_provider_snapshots_provider_time_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sports_provider_snapshots_provider_time_idx ON public.sports_provider_snapshots USING btree (provider, captured_at DESC);


--
-- Name: sportsbook_placement_requests_wager_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sportsbook_placement_requests_wager_idx ON public.sportsbook_placement_requests USING btree (wager_id);


--
-- Name: test_wager_settlement_checks_due_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX test_wager_settlement_checks_due_idx ON public.test_wager_settlement_checks USING btree (next_check_at, wager_id);


--
-- Name: themed_slot_bonus_sessions_user_game_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX themed_slot_bonus_sessions_user_game_idx ON public.themed_slot_bonus_sessions USING btree (user_id, game, status);


--
-- Name: themed_slot_bonus_spins_session_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX themed_slot_bonus_spins_session_idx ON public.themed_slot_bonus_spins USING btree (session_id, created_at);


--
-- Name: themed_slot_bonus_spins_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX themed_slot_bonus_spins_user_id_idx ON public.themed_slot_bonus_spins USING btree (user_id);


--
-- Name: three_card_poker_one_active_per_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX three_card_poker_one_active_per_user ON public.three_card_poker_rounds USING btree (user_id) WHERE (status = 'active'::text);


--
-- Name: ultimate_texas_holdem_one_active_per_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ultimate_texas_holdem_one_active_per_user ON public.ultimate_texas_holdem_rounds USING btree (user_id) WHERE (status = 'active'::text);


--
-- Name: video_poker_one_active_per_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX video_poker_one_active_per_user ON public.video_poker_hands USING btree (user_id) WHERE (status = 'active'::text);


--
-- Name: video_poker_settled_history_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX video_poker_settled_history_idx ON public.video_poker_hands USING btree (user_id, game, created_at DESC, id DESC) WHERE ((is_test = true) AND (status = 'settled'::text) AND (settled_at IS NOT NULL));


--
-- Name: wager_selections_wager_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX wager_selections_wager_id_idx ON public.wager_selections USING btree (wager_id);


--
-- Name: wagers_open_test_settlement_age_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX wagers_open_test_settlement_age_idx ON public.wagers USING btree (placed_at, id) WHERE (is_test AND (status = ANY (ARRAY['pending'::public.wager_status, 'accepted'::public.wager_status])));


--
-- Name: wagers_recent_duplicate_guard_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX wagers_recent_duplicate_guard_idx ON public.wagers USING btree (user_id, placement_fingerprint, placement_bucket) WHERE ((placement_fingerprint IS NOT NULL) AND (placement_bucket IS NOT NULL));


--
-- Name: wagers_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX wagers_status_idx ON public.wagers USING btree (status);


--
-- Name: wagers_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX wagers_user_id_idx ON public.wagers USING btree (user_id);


--
-- Name: wallet_transactions_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX wallet_transactions_user_id_idx ON public.wallet_transactions USING btree (user_id);


--
-- Name: wallet_transactions_wager_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX wallet_transactions_wager_id_idx ON public.wallet_transactions USING btree (wager_id);


--
-- Name: wallet_transactions_wager_type_once_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX wallet_transactions_wager_type_once_idx ON public.wallet_transactions USING btree (wager_id, transaction_type) WHERE ((wager_id IS NOT NULL) AND (transaction_type = ANY (ARRAY['wager_debit'::public.transaction_type, 'wager_credit'::public.transaction_type, 'refund'::public.transaction_type])));


--
-- Name: wagers enqueue_test_wager_settlement; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER enqueue_test_wager_settlement AFTER INSERT OR UPDATE OF status, is_test ON public.wagers FOR EACH ROW EXECUTE FUNCTION public.enqueue_test_wager_settlement();


--
-- Name: blackjack_hands initialize_blackjack_insurance; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER initialize_blackjack_insurance BEFORE INSERT ON public.blackjack_hands FOR EACH ROW EXECUTE FUNCTION public.initialize_blackjack_insurance();


--
-- Name: profiles profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sports_events sports_events_touch_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER sports_events_touch_updated_at BEFORE UPDATE ON public.sports_events FOR EACH ROW EXECUTE FUNCTION public.touch_sports_updated_at();


--
-- Name: sports_markets sports_markets_touch_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER sports_markets_touch_updated_at BEFORE UPDATE ON public.sports_markets FOR EACH ROW EXECUTE FUNCTION public.touch_sports_updated_at();


--
-- Name: sports_outcomes sports_outcomes_history_trg; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER sports_outcomes_history_trg AFTER INSERT OR UPDATE OF point, american_odds ON public.sports_outcomes FOR EACH ROW EXECUTE FUNCTION public.capture_sports_outcome_history();


--
-- Name: sports_outcomes sports_outcomes_touch_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER sports_outcomes_touch_updated_at BEFORE UPDATE ON public.sports_outcomes FOR EACH ROW EXECUTE FUNCTION public.touch_sports_updated_at();


--
-- Name: wagers wagers_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER wagers_set_updated_at BEFORE UPDATE ON public.wagers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: wallets wallets_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER wallets_set_updated_at BEFORE UPDATE ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: baccarat_rounds baccarat_rounds_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.baccarat_rounds
    ADD CONSTRAINT baccarat_rounds_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: blackjack_hands blackjack_hands_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.blackjack_hands
    ADD CONSTRAINT blackjack_hands_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: card_game_deal_requests card_game_deal_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.card_game_deal_requests
    ADD CONSTRAINT card_game_deal_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: caribbean_stud_rounds caribbean_stud_rounds_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.caribbean_stud_rounds
    ADD CONSTRAINT caribbean_stud_rounds_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: live_casino_sessions live_casino_sessions_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.live_casino_sessions
    ADD CONSTRAINT live_casino_sessions_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.live_casino_games(id) ON DELETE RESTRICT;


--
-- Name: live_casino_sessions live_casino_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.live_casino_sessions
    ADD CONSTRAINT live_casino_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: operator_alert_outbox operator_alert_outbox_check_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operator_alert_outbox
    ADD CONSTRAINT operator_alert_outbox_check_key_fkey FOREIGN KEY (check_key) REFERENCES public.operator_monitor_checks(check_key);


--
-- Name: poker_test_actions poker_test_actions_hand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.poker_test_actions
    ADD CONSTRAINT poker_test_actions_hand_id_fkey FOREIGN KEY (hand_id) REFERENCES public.poker_test_hands(id) ON DELETE CASCADE;


--
-- Name: poker_test_actions poker_test_actions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.poker_test_actions
    ADD CONSTRAINT poker_test_actions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: poker_test_hands poker_test_hands_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.poker_test_hands
    ADD CONSTRAINT poker_test_hands_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: roulette_spins roulette_spins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roulette_spins
    ADD CONSTRAINT roulette_spins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: slot_request_receipts slot_request_receipts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.slot_request_receipts
    ADD CONSTRAINT slot_request_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: slot_spins slot_spins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.slot_spins
    ADD CONSTRAINT slot_spins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sports_line_history sports_line_history_outcome_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sports_line_history
    ADD CONSTRAINT sports_line_history_outcome_id_fkey FOREIGN KEY (outcome_id) REFERENCES public.sports_outcomes(id) ON DELETE CASCADE;


--
-- Name: sports_markets sports_markets_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sports_markets
    ADD CONSTRAINT sports_markets_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.sports_events(id) ON DELETE CASCADE;


--
-- Name: sports_outcomes sports_outcomes_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sports_outcomes
    ADD CONSTRAINT sports_outcomes_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.sports_markets(id) ON DELETE CASCADE;


--
-- Name: sportsbook_placement_requests sportsbook_placement_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sportsbook_placement_requests
    ADD CONSTRAINT sportsbook_placement_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sportsbook_placement_requests sportsbook_placement_requests_wager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sportsbook_placement_requests
    ADD CONSTRAINT sportsbook_placement_requests_wager_id_fkey FOREIGN KEY (wager_id) REFERENCES public.wagers(id);


--
-- Name: test_wager_settlement_checks test_wager_settlement_checks_wager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.test_wager_settlement_checks
    ADD CONSTRAINT test_wager_settlement_checks_wager_id_fkey FOREIGN KEY (wager_id) REFERENCES public.wagers(id) ON DELETE CASCADE;


--
-- Name: themed_slot_bonus_sessions themed_slot_bonus_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.themed_slot_bonus_sessions
    ADD CONSTRAINT themed_slot_bonus_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: themed_slot_bonus_spins themed_slot_bonus_spins_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.themed_slot_bonus_spins
    ADD CONSTRAINT themed_slot_bonus_spins_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.themed_slot_bonus_sessions(id) ON DELETE CASCADE;


--
-- Name: themed_slot_bonus_spins themed_slot_bonus_spins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.themed_slot_bonus_spins
    ADD CONSTRAINT themed_slot_bonus_spins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: three_card_poker_rounds three_card_poker_rounds_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.three_card_poker_rounds
    ADD CONSTRAINT three_card_poker_rounds_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ultimate_texas_holdem_rounds ultimate_texas_holdem_rounds_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ultimate_texas_holdem_rounds
    ADD CONSTRAINT ultimate_texas_holdem_rounds_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: video_poker_hands video_poker_hands_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.video_poker_hands
    ADD CONSTRAINT video_poker_hands_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: wager_selections wager_selections_wager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wager_selections
    ADD CONSTRAINT wager_selections_wager_id_fkey FOREIGN KEY (wager_id) REFERENCES public.wagers(id) ON DELETE CASCADE;


--
-- Name: wagers wagers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wagers
    ADD CONSTRAINT wagers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: wallet_transactions wallet_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: wallet_transactions wallet_transactions_wager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_wager_id_fkey FOREIGN KEY (wager_id) REFERENCES public.wagers(id) ON DELETE SET NULL;


--
-- Name: wallets wallets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: baccarat_rounds Users can view own baccarat rounds; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own baccarat rounds" ON public.baccarat_rounds FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: slot_spins Users can view own slot spins; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view own slot spins" ON public.slot_spins FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: baccarat_rounds; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.baccarat_rounds ENABLE ROW LEVEL SECURITY;

--
-- Name: blackjack_hands; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.blackjack_hands ENABLE ROW LEVEL SECURITY;

--
-- Name: blackjack_hands blackjack_hands_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY blackjack_hands_select_own ON public.blackjack_hands FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: card_game_deal_requests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.card_game_deal_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: caribbean_stud_rounds; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.caribbean_stud_rounds ENABLE ROW LEVEL SECURITY;

--
-- Name: internal_job_secrets; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.internal_job_secrets ENABLE ROW LEVEL SECURITY;

--
-- Name: live_casino_games live casino games readable; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "live casino games readable" ON public.live_casino_games FOR SELECT TO authenticated USING (true);


--
-- Name: live_casino_games; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.live_casino_games ENABLE ROW LEVEL SECURITY;

--
-- Name: live_casino_sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.live_casino_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: odds_response_cache; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.odds_response_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: operator_alert_outbox; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.operator_alert_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: operator_monitor_checks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.operator_monitor_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: operator_monitor_delivery_config; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.operator_monitor_delivery_config ENABLE ROW LEVEL SECURITY;

--
-- Name: operator_monitor_job_secret; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.operator_monitor_job_secret ENABLE ROW LEVEL SECURITY;

--
-- Name: operator_monitor_state; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.operator_monitor_state ENABLE ROW LEVEL SECURITY;

--
-- Name: poker_test_actions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.poker_test_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: poker_test_hands; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.poker_test_hands ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = id));


--
-- Name: profiles profiles_update_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = id)) WITH CHECK ((( SELECT auth.uid() AS uid) = id));


--
-- Name: roulette_spins; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.roulette_spins ENABLE ROW LEVEL SECURITY;

--
-- Name: roulette_spins roulette_spins_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY roulette_spins_select_own ON public.roulette_spins FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: slot_request_receipts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.slot_request_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: slot_spins; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.slot_spins ENABLE ROW LEVEL SECURITY;

--
-- Name: sports_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.sports_events ENABLE ROW LEVEL SECURITY;

--
-- Name: sports_line_history; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.sports_line_history ENABLE ROW LEVEL SECURITY;

--
-- Name: sports_markets; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.sports_markets ENABLE ROW LEVEL SECURITY;

--
-- Name: sports_outcomes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.sports_outcomes ENABLE ROW LEVEL SECURITY;

--
-- Name: sports_provider_snapshots; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.sports_provider_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: sportsbook_placement_requests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.sportsbook_placement_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: test_wager_final_scores; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.test_wager_final_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: test_wager_settlement_checks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.test_wager_settlement_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: themed_slot_bonus_sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.themed_slot_bonus_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: themed_slot_bonus_spins; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.themed_slot_bonus_spins ENABLE ROW LEVEL SECURITY;

--
-- Name: three_card_poker_rounds; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.three_card_poker_rounds ENABLE ROW LEVEL SECURITY;

--
-- Name: ultimate_texas_holdem_rounds; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ultimate_texas_holdem_rounds ENABLE ROW LEVEL SECURITY;

--
-- Name: live_casino_sessions users read own live casino sessions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "users read own live casino sessions" ON public.live_casino_sessions FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: themed_slot_bonus_sessions users_read_own_themed_bonus_sessions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY users_read_own_themed_bonus_sessions ON public.themed_slot_bonus_sessions FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: themed_slot_bonus_spins users_read_own_themed_bonus_spins; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY users_read_own_themed_bonus_spins ON public.themed_slot_bonus_spins FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: video_poker_hands; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.video_poker_hands ENABLE ROW LEVEL SECURITY;

--
-- Name: wager_selections; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.wager_selections ENABLE ROW LEVEL SECURITY;

--
-- Name: wager_selections wager_selections_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY wager_selections_select_own ON public.wager_selections FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.wagers w
  WHERE ((w.id = wager_selections.wager_id) AND (w.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: wagers; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.wagers ENABLE ROW LEVEL SECURITY;

--
-- Name: wagers wagers_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY wagers_select_own ON public.wagers FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: wallet_transactions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: wallet_transactions wallet_transactions_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY wallet_transactions_select_own ON public.wallet_transactions FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: wallets; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

--
-- Name: wallets wallets_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY wallets_select_own ON public.wallets FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION advance_blackjack_test_hand_atomic(p_user_id uuid, p_hand_id uuid, p_expected_action_count integer, p_status public.blackjack_hand_status, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_payout numeric); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.advance_blackjack_test_hand_atomic(p_user_id uuid, p_hand_id uuid, p_expected_action_count integer, p_status public.blackjack_hand_status, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_payout numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.advance_blackjack_test_hand_atomic(p_user_id uuid, p_hand_id uuid, p_expected_action_count integer, p_status public.blackjack_hand_status, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_payout numeric) TO service_role;


--
-- Name: FUNCTION advance_blackjack_test_hand_v3(p_user_id uuid, p_hand_id uuid, p_expected_action_count integer, p_status public.blackjack_hand_status, p_stake numeric, p_player_cards jsonb, p_player_hands jsonb, p_active_hand_index integer, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_payout numeric, p_additional_debit numeric); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.advance_blackjack_test_hand_v3(p_user_id uuid, p_hand_id uuid, p_expected_action_count integer, p_status public.blackjack_hand_status, p_stake numeric, p_player_cards jsonb, p_player_hands jsonb, p_active_hand_index integer, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_payout numeric, p_additional_debit numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.advance_blackjack_test_hand_v3(p_user_id uuid, p_hand_id uuid, p_expected_action_count integer, p_status public.blackjack_hand_status, p_stake numeric, p_player_cards jsonb, p_player_hands jsonb, p_active_hand_index integer, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_payout numeric, p_additional_debit numeric) TO service_role;


--
-- Name: FUNCTION advance_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_round_id uuid, p_expected_stage text, p_new_stage text, p_community jsonb, p_play_multiplier integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.advance_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_round_id uuid, p_expected_stage text, p_new_stage text, p_community jsonb, p_play_multiplier integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.advance_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_round_id uuid, p_expected_stage text, p_new_stage text, p_community jsonb, p_play_multiplier integer) TO service_role;


--
-- Name: FUNCTION capture_sports_outcome_history(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.capture_sports_outcome_history() FROM PUBLIC;
GRANT ALL ON FUNCTION public.capture_sports_outcome_history() TO service_role;


--
-- Name: FUNCTION claim_operator_alerts(p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_operator_alerts(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_operator_alerts(p_limit integer) TO service_role;


--
-- Name: FUNCTION claim_test_wager_settlement_batch(p_processing_token uuid, p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_test_wager_settlement_batch(p_processing_token uuid, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_test_wager_settlement_batch(p_processing_token uuid, p_limit integer) TO service_role;


--
-- Name: FUNCTION commit_poker_test_hand_atomic(p_user_id uuid, p_game text, p_request_id uuid, p_request_payload jsonb, p_hand_id uuid, p_expected_action_count integer, p_expected_balance numeric, p_state jsonb, p_debit numeric, p_payout numeric); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.commit_poker_test_hand_atomic(p_user_id uuid, p_game text, p_request_id uuid, p_request_payload jsonb, p_hand_id uuid, p_expected_action_count integer, p_expected_balance numeric, p_state jsonb, p_debit numeric, p_payout numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.commit_poker_test_hand_atomic(p_user_id uuid, p_game text, p_request_id uuid, p_request_payload jsonb, p_hand_id uuid, p_expected_action_count integer, p_expected_balance numeric, p_state jsonb, p_debit numeric, p_payout numeric) TO service_role;


--
-- Name: FUNCTION configure_operator_alert_delivery(p_webhook_url text, p_signing_secret text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.configure_operator_alert_delivery(p_webhook_url text, p_signing_secret text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.configure_operator_alert_delivery(p_webhook_url text, p_signing_secret text) TO service_role;


--
-- Name: FUNCTION deal_caribbean_stud_test_atomic(p_user_id uuid, p_ante numeric, p_player_hand jsonb, p_dealer_hand jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.deal_caribbean_stud_test_atomic(p_user_id uuid, p_ante numeric, p_player_hand jsonb, p_dealer_hand jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.deal_caribbean_stud_test_atomic(p_user_id uuid, p_ante numeric, p_player_hand jsonb, p_dealer_hand jsonb) TO service_role;


--
-- Name: FUNCTION deal_three_card_poker_test_atomic(p_user_id uuid, p_ante numeric, p_player_hand jsonb, p_dealer_hand jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.deal_three_card_poker_test_atomic(p_user_id uuid, p_ante numeric, p_player_hand jsonb, p_dealer_hand jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.deal_three_card_poker_test_atomic(p_user_id uuid, p_ante numeric, p_player_hand jsonb, p_dealer_hand jsonb) TO service_role;


--
-- Name: FUNCTION deal_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_ante numeric, p_player_hand jsonb, p_dealer_hand jsonb, p_deck_remaining jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.deal_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_ante numeric, p_player_hand jsonb, p_dealer_hand jsonb, p_deck_remaining jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.deal_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_ante numeric, p_player_hand jsonb, p_dealer_hand jsonb, p_deck_remaining jsonb) TO service_role;


--
-- Name: FUNCTION deal_video_poker_test_atomic(p_user_id uuid, p_stake numeric, p_initial_hand jsonb, p_deck_remaining jsonb, p_game text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.deal_video_poker_test_atomic(p_user_id uuid, p_stake numeric, p_initial_hand jsonb, p_deck_remaining jsonb, p_game text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.deal_video_poker_test_atomic(p_user_id uuid, p_stake numeric, p_initial_hand jsonb, p_deck_remaining jsonb, p_game text) TO service_role;


--
-- Name: FUNCTION decide_blackjack_test_insurance(p_user_id uuid, p_hand_id uuid, p_expected_action_count integer, p_accept boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.decide_blackjack_test_insurance(p_user_id uuid, p_hand_id uuid, p_expected_action_count integer, p_accept boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.decide_blackjack_test_insurance(p_user_id uuid, p_hand_id uuid, p_expected_action_count integer, p_accept boolean) TO service_role;


--
-- Name: FUNCTION enqueue_test_wager_settlement(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.enqueue_test_wager_settlement() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enqueue_test_wager_settlement() TO service_role;


--
-- Name: FUNCTION finish_blackjack_test_hand_atomic(p_user_id uuid, p_hand_id uuid, p_status public.blackjack_hand_status, p_player_cards jsonb, p_dealer_cards jsonb, p_player_total integer, p_dealer_total integer, p_payout numeric); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.finish_blackjack_test_hand_atomic(p_user_id uuid, p_hand_id uuid, p_status public.blackjack_hand_status, p_player_cards jsonb, p_dealer_cards jsonb, p_player_total integer, p_dealer_total integer, p_payout numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.finish_blackjack_test_hand_atomic(p_user_id uuid, p_hand_id uuid, p_status public.blackjack_hand_status, p_player_cards jsonb, p_dealer_cards jsonb, p_player_total integer, p_dealer_total integer, p_payout numeric) TO service_role;


--
-- Name: FUNCTION finish_operator_alert(p_alert_id uuid, p_lease_id uuid, p_delivered boolean, p_error_code text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.finish_operator_alert(p_alert_id uuid, p_lease_id uuid, p_delivered boolean, p_error_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.finish_operator_alert(p_alert_id uuid, p_lease_id uuid, p_delivered boolean, p_error_code text) TO service_role;


--
-- Name: FUNCTION finish_test_wager_settlement_check(p_wager_id uuid, p_processing_token uuid, p_outcome text, p_reason text, p_result text, p_credit numeric, p_grades jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.finish_test_wager_settlement_check(p_wager_id uuid, p_processing_token uuid, p_outcome text, p_reason text, p_result text, p_credit numeric, p_grades jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.finish_test_wager_settlement_check(p_wager_id uuid, p_processing_token uuid, p_outcome text, p_reason text, p_result text, p_credit numeric, p_grades jsonb) TO service_role;


--
-- Name: FUNCTION get_operator_alert_health(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_operator_alert_health() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_operator_alert_health() TO service_role;


--
-- Name: FUNCTION get_slot_request_history(p_user_id uuid, p_limit integer, p_before_created_at timestamp with time zone, p_before_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_slot_request_history(p_user_id uuid, p_limit integer, p_before_created_at timestamp with time zone, p_before_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_slot_request_history(p_user_id uuid, p_limit integer, p_before_created_at timestamp with time zone, p_before_id uuid) TO service_role;


--
-- Name: FUNCTION get_slot_request_receipt(p_user_id uuid, p_request_id uuid, p_game text, p_payload jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_slot_request_receipt(p_user_id uuid, p_request_id uuid, p_game text, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_slot_request_receipt(p_user_id uuid, p_request_id uuid, p_game text, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION get_test_wager_settlement_health(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_test_wager_settlement_health() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_test_wager_settlement_health() TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION initialize_blackjack_insurance(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.initialize_blackjack_insurance() FROM PUBLIC;
GRANT ALL ON FUNCTION public.initialize_blackjack_insurance() TO service_role;


--
-- Name: FUNCTION place_baccarat_test_round_atomic(p_user_id uuid, p_stake numeric, p_bet_type text, p_player_cards jsonb, p_banker_cards jsonb, p_player_total integer, p_banker_total integer, p_result text, p_payout numeric); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.place_baccarat_test_round_atomic(p_user_id uuid, p_stake numeric, p_bet_type text, p_player_cards jsonb, p_banker_cards jsonb, p_player_total integer, p_banker_total integer, p_result text, p_payout numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.place_baccarat_test_round_atomic(p_user_id uuid, p_stake numeric, p_bet_type text, p_player_cards jsonb, p_banker_cards jsonb, p_player_total integer, p_banker_total integer, p_result text, p_payout numeric) TO service_role;


--
-- Name: FUNCTION place_baccarat_test_round_idempotent(p_user_id uuid, p_request_id uuid, p_stake numeric, p_bet_type text, p_player_cards jsonb, p_banker_cards jsonb, p_player_total integer, p_banker_total integer, p_result text, p_payout numeric); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.place_baccarat_test_round_idempotent(p_user_id uuid, p_request_id uuid, p_stake numeric, p_bet_type text, p_player_cards jsonb, p_banker_cards jsonb, p_player_total integer, p_banker_total integer, p_result text, p_payout numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.place_baccarat_test_round_idempotent(p_user_id uuid, p_request_id uuid, p_stake numeric, p_bet_type text, p_player_cards jsonb, p_banker_cards jsonb, p_player_total integer, p_banker_total integer, p_result text, p_payout numeric) TO service_role;


--
-- Name: FUNCTION place_test_wager_atomic(p_user_id uuid, p_wager_type public.wager_type, p_stake numeric, p_potential_return numeric, p_selections jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.place_test_wager_atomic(p_user_id uuid, p_wager_type public.wager_type, p_stake numeric, p_potential_return numeric, p_selections jsonb) FROM PUBLIC;


--
-- Name: FUNCTION play_settle_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_round_id uuid, p_expected_stage text, p_play_multiplier integer, p_community jsonb, p_payout numeric, p_result text, p_player_rank text, p_dealer_rank text, p_dealer_qualifies boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.play_settle_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_round_id uuid, p_expected_stage text, p_play_multiplier integer, p_community jsonb, p_payout numeric, p_result text, p_player_rank text, p_dealer_rank text, p_dealer_qualifies boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.play_settle_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_round_id uuid, p_expected_stage text, p_play_multiplier integer, p_community jsonb, p_payout numeric, p_result text, p_player_rank text, p_dealer_rank text, p_dealer_qualifies boolean) TO service_role;


--
-- Name: FUNCTION play_slot_test_spin_atomic(p_user_id uuid, p_stake numeric, p_reels jsonb, p_payout numeric, p_result text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.play_slot_test_spin_atomic(p_user_id uuid, p_stake numeric, p_reels jsonb, p_payout numeric, p_result text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.play_slot_test_spin_atomic(p_user_id uuid, p_stake numeric, p_reels jsonb, p_payout numeric, p_result text) TO service_role;


--
-- Name: FUNCTION play_test_roulette_atomic(p_user_id uuid, p_stake numeric, p_bet_type text, p_bet_value text, p_winning_number integer, p_winning_color text, p_payout numeric, p_result text, p_request_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.play_test_roulette_atomic(p_user_id uuid, p_stake numeric, p_bet_type text, p_bet_value text, p_winning_number integer, p_winning_color text, p_payout numeric, p_result text, p_request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.play_test_roulette_atomic(p_user_id uuid, p_stake numeric, p_bet_type text, p_bet_value text, p_winning_number integer, p_winning_color text, p_payout numeric, p_result text, p_request_id uuid) TO service_role;


--
-- Name: FUNCTION play_themed_slot_paid_spin_atomic(p_user_id uuid, p_game text, p_stake numeric, p_reels jsonb, p_payout numeric, p_result text, p_bet_per_line numeric, p_bonus_spins integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.play_themed_slot_paid_spin_atomic(p_user_id uuid, p_game text, p_stake numeric, p_reels jsonb, p_payout numeric, p_result text, p_bet_per_line numeric, p_bonus_spins integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.play_themed_slot_paid_spin_atomic(p_user_id uuid, p_game text, p_stake numeric, p_reels jsonb, p_payout numeric, p_result text, p_bet_per_line numeric, p_bonus_spins integer) TO service_role;


--
-- Name: FUNCTION record_operator_health_alerts(p_checks jsonb, p_observed_at timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.record_operator_health_alerts(p_checks jsonb, p_observed_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_operator_health_alerts(p_checks jsonb, p_observed_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION refill_test_wallet_atomic(p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.refill_test_wallet_atomic(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refill_test_wallet_atomic(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION retry_operator_alert(p_alert_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.retry_operator_alert(p_alert_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.retry_operator_alert(p_alert_id uuid) TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION settle_caribbean_stud_test_atomic(p_user_id uuid, p_round_id uuid, p_decision text, p_payout numeric, p_result text, p_player_rank text, p_dealer_rank text, p_dealer_qualifies boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.settle_caribbean_stud_test_atomic(p_user_id uuid, p_round_id uuid, p_decision text, p_payout numeric, p_result text, p_player_rank text, p_dealer_rank text, p_dealer_qualifies boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_caribbean_stud_test_atomic(p_user_id uuid, p_round_id uuid, p_decision text, p_payout numeric, p_result text, p_player_rank text, p_dealer_rank text, p_dealer_qualifies boolean) TO service_role;


--
-- Name: FUNCTION settle_slot_request_atomic(p_user_id uuid, p_request_id uuid, p_game text, p_action text, p_payload jsonb, p_response jsonb, p_settlement jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.settle_slot_request_atomic(p_user_id uuid, p_request_id uuid, p_game text, p_action text, p_payload jsonb, p_response jsonb, p_settlement jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_slot_request_atomic(p_user_id uuid, p_request_id uuid, p_game text, p_action text, p_payload jsonb, p_response jsonb, p_settlement jsonb) TO service_role;


--
-- Name: FUNCTION settle_test_wager_atomic(p_wager_id uuid, p_result text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.settle_test_wager_atomic(p_wager_id uuid, p_result text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_test_wager_atomic(p_wager_id uuid, p_result text) TO service_role;


--
-- Name: FUNCTION settle_test_wager_auto_atomic(p_wager_id uuid, p_result text, p_credit numeric, p_grades jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.settle_test_wager_auto_atomic(p_wager_id uuid, p_result text, p_credit numeric, p_grades jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_test_wager_auto_atomic(p_wager_id uuid, p_result text, p_credit numeric, p_grades jsonb) TO service_role;


--
-- Name: FUNCTION settle_themed_bonus_spin_atomic(p_user_id uuid, p_session_id uuid, p_grid jsonb, p_payout numeric, p_feature text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.settle_themed_bonus_spin_atomic(p_user_id uuid, p_session_id uuid, p_grid jsonb, p_payout numeric, p_feature text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_themed_bonus_spin_atomic(p_user_id uuid, p_session_id uuid, p_grid jsonb, p_payout numeric, p_feature text) TO service_role;


--
-- Name: FUNCTION settle_three_card_poker_test_atomic(p_user_id uuid, p_round_id uuid, p_decision text, p_payout numeric, p_result text, p_dealer_qualifies boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.settle_three_card_poker_test_atomic(p_user_id uuid, p_round_id uuid, p_decision text, p_payout numeric, p_result text, p_dealer_qualifies boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_three_card_poker_test_atomic(p_user_id uuid, p_round_id uuid, p_decision text, p_payout numeric, p_result text, p_dealer_qualifies boolean) TO service_role;


--
-- Name: FUNCTION settle_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_round_id uuid, p_decision text, p_community jsonb, p_payout numeric, p_result text, p_player_rank text, p_dealer_rank text, p_dealer_qualifies boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.settle_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_round_id uuid, p_decision text, p_community jsonb, p_payout numeric, p_result text, p_player_rank text, p_dealer_rank text, p_dealer_qualifies boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_ultimate_texas_holdem_test_atomic(p_user_id uuid, p_round_id uuid, p_decision text, p_community jsonb, p_payout numeric, p_result text, p_player_rank text, p_dealer_rank text, p_dealer_qualifies boolean) TO service_role;


--
-- Name: FUNCTION settle_video_poker_test_atomic(p_user_id uuid, p_hand_id uuid, p_final_hand jsonb, p_result text, p_multiplier numeric, p_payout numeric); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.settle_video_poker_test_atomic(p_user_id uuid, p_hand_id uuid, p_final_hand jsonb, p_result text, p_multiplier numeric, p_payout numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_video_poker_test_atomic(p_user_id uuid, p_hand_id uuid, p_final_hand jsonb, p_result text, p_multiplier numeric, p_payout numeric) TO service_role;


--
-- Name: FUNCTION sportsbook_test_request_commit(p_user_id uuid, p_request_id uuid, p_processing_token uuid, p_selections jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.sportsbook_test_request_commit(p_user_id uuid, p_request_id uuid, p_processing_token uuid, p_selections jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sportsbook_test_request_commit(p_user_id uuid, p_request_id uuid, p_processing_token uuid, p_selections jsonb) TO service_role;


--
-- Name: FUNCTION sportsbook_test_request_prepare(p_user_id uuid, p_request_id uuid, p_payload jsonb, p_processing_token uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.sportsbook_test_request_prepare(p_user_id uuid, p_request_id uuid, p_payload jsonb, p_processing_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sportsbook_test_request_prepare(p_user_id uuid, p_request_id uuid, p_payload jsonb, p_processing_token uuid) TO service_role;


--
-- Name: FUNCTION sportsbook_test_request_receipt(p_user_id uuid, p_request_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.sportsbook_test_request_receipt(p_user_id uuid, p_request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sportsbook_test_request_receipt(p_user_id uuid, p_request_id uuid) TO service_role;


--
-- Name: FUNCTION sportsbook_test_request_reject(p_user_id uuid, p_request_id uuid, p_processing_token uuid, p_code text, p_message text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.sportsbook_test_request_reject(p_user_id uuid, p_request_id uuid, p_processing_token uuid, p_code text, p_message text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sportsbook_test_request_reject(p_user_id uuid, p_request_id uuid, p_processing_token uuid, p_code text, p_message text) TO service_role;


--
-- Name: FUNCTION start_blackjack_test_hand_atomic(p_user_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.start_blackjack_test_hand_atomic(p_user_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.start_blackjack_test_hand_atomic(p_user_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric) TO service_role;


--
-- Name: FUNCTION start_blackjack_test_hand_idempotent(p_user_id uuid, p_request_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.start_blackjack_test_hand_idempotent(p_user_id uuid, p_request_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.start_blackjack_test_hand_idempotent(p_user_id uuid, p_request_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric) TO service_role;


--
-- Name: FUNCTION start_blackjack_test_hand_insured(p_user_id uuid, p_request_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.start_blackjack_test_hand_insured(p_user_id uuid, p_request_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.start_blackjack_test_hand_insured(p_user_id uuid, p_request_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric) TO service_role;


--
-- Name: FUNCTION start_blackjack_test_hand_v2(p_user_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.start_blackjack_test_hand_v2(p_user_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.start_blackjack_test_hand_v2(p_user_id uuid, p_stake numeric, p_player_cards jsonb, p_dealer_cards jsonb, p_shoe jsonb, p_player_total integer, p_dealer_total integer, p_status public.blackjack_hand_status, p_payout numeric) TO service_role;


--
-- Name: FUNCTION touch_sports_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.touch_sports_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.touch_sports_updated_at() TO service_role;


--
-- Name: TABLE baccarat_rounds; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.baccarat_rounds TO service_role;
GRANT SELECT ON TABLE public.baccarat_rounds TO authenticated;


--
-- Name: TABLE blackjack_hands; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.blackjack_hands TO service_role;


--
-- Name: COLUMN blackjack_hands.id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(id) ON TABLE public.blackjack_hands TO authenticated;


--
-- Name: COLUMN blackjack_hands.stake; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(stake) ON TABLE public.blackjack_hands TO authenticated;


--
-- Name: COLUMN blackjack_hands.status; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(status) ON TABLE public.blackjack_hands TO authenticated;


--
-- Name: COLUMN blackjack_hands.player_total; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(player_total) ON TABLE public.blackjack_hands TO authenticated;


--
-- Name: COLUMN blackjack_hands.dealer_total; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(dealer_total) ON TABLE public.blackjack_hands TO authenticated;


--
-- Name: COLUMN blackjack_hands.payout; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(payout) ON TABLE public.blackjack_hands TO authenticated;


--
-- Name: COLUMN blackjack_hands.created_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(created_at) ON TABLE public.blackjack_hands TO authenticated;


--
-- Name: COLUMN blackjack_hands.settled_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(settled_at) ON TABLE public.blackjack_hands TO authenticated;


--
-- Name: TABLE card_game_deal_requests; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.card_game_deal_requests TO service_role;


--
-- Name: TABLE caribbean_stud_rounds; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.caribbean_stud_rounds TO service_role;


--
-- Name: TABLE sports_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.sports_events TO service_role;


--
-- Name: TABLE sports_markets; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.sports_markets TO service_role;


--
-- Name: TABLE sports_outcomes; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.sports_outcomes TO service_role;


--
-- Name: TABLE current_gameday_lines; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.current_gameday_lines TO service_role;


--
-- Name: TABLE internal_job_secrets; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.internal_job_secrets TO service_role;


--
-- Name: TABLE live_casino_games; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.live_casino_games TO service_role;


--
-- Name: TABLE live_casino_sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.live_casino_sessions TO service_role;


--
-- Name: TABLE odds_response_cache; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.odds_response_cache TO service_role;


--
-- Name: TABLE operator_alert_outbox; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.operator_alert_outbox TO service_role;


--
-- Name: TABLE operator_monitor_checks; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.operator_monitor_checks TO service_role;


--
-- Name: TABLE operator_monitor_delivery_config; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.operator_monitor_delivery_config TO service_role;


--
-- Name: TABLE operator_monitor_job_secret; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.operator_monitor_job_secret TO service_role;


--
-- Name: TABLE operator_monitor_state; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.operator_monitor_state TO service_role;


--
-- Name: TABLE poker_test_actions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.poker_test_actions TO service_role;


--
-- Name: TABLE poker_test_hands; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.poker_test_hands TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.profiles TO service_role;
GRANT SELECT,UPDATE ON TABLE public.profiles TO authenticated;


--
-- Name: TABLE roulette_spins; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.roulette_spins TO service_role;
GRANT SELECT ON TABLE public.roulette_spins TO authenticated;


--
-- Name: TABLE slot_request_receipts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.slot_request_receipts TO service_role;


--
-- Name: TABLE slot_spins; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.slot_spins TO service_role;
GRANT SELECT ON TABLE public.slot_spins TO authenticated;


--
-- Name: TABLE sports_line_history; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.sports_line_history TO service_role;


--
-- Name: SEQUENCE sports_line_history_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.sports_line_history_id_seq TO anon;
GRANT ALL ON SEQUENCE public.sports_line_history_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.sports_line_history_id_seq TO service_role;


--
-- Name: TABLE sports_provider_snapshots; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.sports_provider_snapshots TO service_role;


--
-- Name: SEQUENCE sports_provider_snapshots_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.sports_provider_snapshots_id_seq TO anon;
GRANT ALL ON SEQUENCE public.sports_provider_snapshots_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.sports_provider_snapshots_id_seq TO service_role;


--
-- Name: TABLE sportsbook_placement_requests; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.sportsbook_placement_requests TO service_role;


--
-- Name: TABLE test_wager_final_scores; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.test_wager_final_scores TO service_role;


--
-- Name: TABLE test_wager_settlement_checks; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.test_wager_settlement_checks TO service_role;


--
-- Name: TABLE themed_slot_bonus_sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.themed_slot_bonus_sessions TO service_role;
GRANT SELECT,MAINTAIN ON TABLE public.themed_slot_bonus_sessions TO authenticated;


--
-- Name: TABLE themed_slot_bonus_spins; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.themed_slot_bonus_spins TO service_role;
GRANT SELECT,MAINTAIN ON TABLE public.themed_slot_bonus_spins TO authenticated;


--
-- Name: TABLE three_card_poker_rounds; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.three_card_poker_rounds TO service_role;


--
-- Name: TABLE ultimate_texas_holdem_rounds; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ultimate_texas_holdem_rounds TO service_role;


--
-- Name: TABLE video_poker_hands; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.video_poker_hands TO service_role;


--
-- Name: TABLE wager_selections; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.wager_selections TO service_role;
GRANT SELECT ON TABLE public.wager_selections TO authenticated;


--
-- Name: TABLE wagers; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.wagers TO service_role;
GRANT SELECT ON TABLE public.wagers TO authenticated;


--
-- Name: TABLE wallet_transactions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.wallet_transactions TO service_role;
GRANT SELECT ON TABLE public.wallet_transactions TO authenticated;


--
-- Name: TABLE wallets; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.wallets TO service_role;
GRANT SELECT ON TABLE public.wallets TO authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict SvovSQQRN0NPnWSmpHBQHY1TEdcoeirAKyjKla57iTLw9Z9bDFnQzbxWPbDeb77

