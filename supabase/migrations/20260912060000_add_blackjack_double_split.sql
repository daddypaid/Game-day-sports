alter table public.blackjack_hands
  add column if not exists player_hands jsonb,
  add column if not exists active_hand_index integer;

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
  v_debit numeric := coalesce(p_additional_debit, 0);
begin
  select h.stake, h.action_count, h.status
  into v_stake, v_count, v_status
  from public.blackjack_hands h
  where h.id = p_hand_id and h.user_id = p_user_id and h.is_test = true
  for update;

  if v_stake is null then raise exception 'Blackjack hand not found'; end if;
  if v_status <> 'active' then raise exception 'Blackjack hand already settled'; end if;
  if v_count <> p_expected_action_count then raise exception 'Blackjack hand changed; refresh and try again'; end if;
  if v_debit < 0 then raise exception 'Invalid additional wager'; end if;
  if p_stake <> v_stake + v_debit then raise exception 'Blackjack stake mismatch'; end if;

  select w.balance into v_balance
  from public.wallets w
  where w.user_id = p_user_id
  for update;

  if v_balance is null then raise exception 'Wallet not found'; end if;
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
