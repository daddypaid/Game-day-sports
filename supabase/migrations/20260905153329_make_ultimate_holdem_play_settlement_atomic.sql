create or replace function public.play_settle_ultimate_texas_holdem_test_atomic(
  p_user_id uuid,
  p_round_id uuid,
  p_expected_stage text,
  p_play_multiplier integer,
  p_community jsonb,
  p_payout numeric,
  p_result text,
  p_player_rank text,
  p_dealer_rank text,
  p_dealer_qualifies boolean
) returns table(round_id uuid, play_bet numeric, payout numeric, balance numeric)
language plpgsql
security definer
set search_path=public
as $$
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

revoke all on function public.play_settle_ultimate_texas_holdem_test_atomic(uuid,uuid,text,integer,jsonb,numeric,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.play_settle_ultimate_texas_holdem_test_atomic(uuid,uuid,text,integer,jsonb,numeric,text,text,text,boolean) to service_role;
