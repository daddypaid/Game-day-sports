-- Existing deployed settlement functions, retained only as isolated test fixtures.
CREATE OR REPLACE FUNCTION public.play_slot_test_spin_atomic(p_user_id uuid, p_stake numeric, p_reels jsonb, p_payout numeric, p_result text)
 RETURNS TABLE(spin_id uuid, payout numeric, balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;


CREATE OR REPLACE FUNCTION public.play_themed_slot_paid_spin_atomic(p_user_id uuid, p_game text, p_stake numeric, p_reels jsonb, p_payout numeric, p_result text, p_bet_per_line numeric, p_bonus_spins integer)
 RETURNS TABLE(spin_id uuid, balance numeric, bonus_session_id uuid, bonus_spins_remaining integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;


CREATE OR REPLACE FUNCTION public.settle_themed_bonus_spin_atomic(p_user_id uuid, p_session_id uuid, p_grid jsonb, p_payout numeric, p_feature text)
 RETURNS TABLE(balance numeric, spins_remaining integer, session_status text, total_payout numeric, bonus_spin_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

