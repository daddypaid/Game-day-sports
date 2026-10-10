-- Single-zero roulette: column bets and owner-scoped recovery of settled spins.
alter table public.roulette_spins add column if not exists request_id uuid;
create unique index if not exists roulette_spins_user_request_once_idx
  on public.roulette_spins (user_id, request_id);

alter table public.roulette_spins drop constraint if exists roulette_spins_bet_type_check;
alter table public.roulette_spins add constraint roulette_spins_bet_type_check
  check (bet_type in ('red','black','odd','even','low','high','number','column1','column2','column3'));

-- The ninth argument defaults to null so older service-role callers still resolve.
-- New browser spins must supply a request UUID through the authenticated Edge Function.
drop function if exists public.play_test_roulette_atomic(uuid,numeric,text,text,integer,text,numeric,text);

create or replace function public.play_test_roulette_atomic(
  p_user_id uuid,
  p_stake numeric,
  p_bet_type text,
  p_bet_value text,
  p_winning_number integer,
  p_winning_color text,
  p_payout numeric,
  p_result text,
  p_request_id uuid default null
)
returns table (
  spin_id uuid, balance numeric, payout numeric, result text,
  request_id uuid, winning_number integer, winning_color text,
  bet_type text, bet_value text, stake numeric, created_at timestamptz
)
language plpgsql
security definer
set search_path to public
as $function$
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
$function$;

revoke all on function public.play_test_roulette_atomic(uuid,numeric,text,text,integer,text,numeric,text,uuid) from public,anon,authenticated;
grant execute on function public.play_test_roulette_atomic(uuid,numeric,text,text,integer,text,numeric,text,uuid) to service_role;
