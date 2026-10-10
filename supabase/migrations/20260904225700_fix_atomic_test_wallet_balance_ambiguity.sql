create or replace function public.place_test_wager_atomic(
  p_user_id uuid,
  p_wager_type wager_type,
  p_stake numeric,
  p_potential_return numeric,
  p_selections jsonb
)
returns table (
  wager_id uuid,
  wager_type wager_type,
  stake numeric,
  potential_return numeric,
  status wager_status,
  placed_at timestamptz,
  is_test boolean,
  balance numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_wager_id uuid;
  v_selection jsonb;
begin
  if p_stake <= 0 then
    raise exception 'Invalid stake';
  end if;

  select w.balance
  into v_balance
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

  insert into public.wagers (
    user_id,
    wager_type,
    stake,
    potential_return,
    status,
    is_test
  )
  values (
    p_user_id,
    p_wager_type,
    p_stake,
    p_potential_return,
    'pending',
    true
  )
  returning id into v_wager_id;

  for v_selection in
    select value from jsonb_array_elements(p_selections)
  loop
    insert into public.wager_selections (
      wager_id,
      event_id,
      event_name,
      sport_key,
      market_key,
      market_title,
      selection_name,
      description,
      point,
      american_odds
    )
    values (
      v_wager_id,
      v_selection->>'event_id',
      v_selection->>'event_name',
      nullif(v_selection->>'sport_key',''),
      v_selection->>'market_key',
      nullif(v_selection->>'market_title',''),
      v_selection->>'selection_name',
      nullif(v_selection->>'description',''),
      case when v_selection->>'point' is null or v_selection->>'point' = '' then null else (v_selection->>'point')::numeric end,
      (v_selection->>'american_odds')::integer
    );
  end loop;

  insert into public.wallet_transactions (
    user_id,
    wager_id,
    transaction_type,
    amount,
    balance_after,
    note
  )
  values (
    p_user_id,
    v_wager_id,
    'wager_debit',
    p_stake,
    v_balance,
    'Test wager debit'
  );

  return query
  select
    w.id,
    w.wager_type,
    w.stake,
    w.potential_return,
    w.status,
    w.placed_at,
    w.is_test,
    v_balance
  from public.wagers w
  where w.id = v_wager_id;
end;
$$;

revoke all on function public.place_test_wager_atomic(uuid, wager_type, numeric, numeric, jsonb) from public;
revoke all on function public.place_test_wager_atomic(uuid, wager_type, numeric, numeric, jsonb) from anon;
revoke all on function public.place_test_wager_atomic(uuid, wager_type, numeric, numeric, jsonb) from authenticated;
grant execute on function public.place_test_wager_atomic(uuid, wager_type, numeric, numeric, jsonb) to service_role;
