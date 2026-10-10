create or replace function public.play_themed_slot_paid_spin_atomic(
  p_user_id uuid,
  p_game text,
  p_stake numeric,
  p_reels jsonb,
  p_payout numeric,
  p_result text,
  p_bet_per_line numeric,
  p_bonus_spins integer
)
returns table(spin_id uuid, balance numeric, bonus_session_id uuid, bonus_spins_remaining integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  select id into v_existing
  from public.themed_slot_bonus_sessions
  where user_id=p_user_id and game=p_game and status='active'
  limit 1
  for update;
  if v_existing is not null then raise exception 'Finish active free spins first'; end if;

  select w.balance into v_balance from public.wallets w where w.user_id=p_user_id for update;
  if v_balance is null then raise exception 'Wallet not found'; end if;
  if v_balance < p_stake then raise exception 'Insufficient test balance'; end if;

  update public.wallets set balance=balance-p_stake, updated_at=now()
  where user_id=p_user_id returning balance into v_balance;
  insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,note)
  values(p_user_id,'wager_debit',p_stake,v_balance,'Themed slots paid spin debit');

  if p_payout > 0 then
    update public.wallets set balance=balance+p_payout, updated_at=now()
    where user_id=p_user_id returning balance into v_balance;
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
