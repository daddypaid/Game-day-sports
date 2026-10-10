
create or replace function public.deal_video_poker_test_atomic(
  p_user_id uuid,
  p_stake numeric,
  p_initial_hand jsonb,
  p_deck_remaining jsonb,
  p_game text default 'jacks_or_better'::text
)
returns table(hand_id uuid, balance numeric)
language plpgsql
security definer
set search_path = ''
as $function$
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
$function$;

revoke all on function public.deal_video_poker_test_atomic(uuid,numeric,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.deal_video_poker_test_atomic(uuid,numeric,jsonb,jsonb,text) to service_role;

