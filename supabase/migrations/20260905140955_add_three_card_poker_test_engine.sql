create table if not exists public.three_card_poker_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ante numeric not null check (ante > 0),
  player_hand jsonb not null,
  dealer_hand jsonb not null,
  status text not null default 'active' check (status in ('active','settled')),
  decision text check (decision in ('play','fold')),
  result text,
  dealer_qualifies boolean,
  payout numeric not null default 0 check (payout >= 0),
  is_test boolean not null default true,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create unique index if not exists three_card_poker_one_active_per_user on public.three_card_poker_rounds(user_id) where status='active';
alter table public.three_card_poker_rounds enable row level security;
revoke all on public.three_card_poker_rounds from anon, authenticated;
grant select, insert, update on public.three_card_poker_rounds to service_role;

create or replace function public.deal_three_card_poker_test_atomic(p_user_id uuid,p_ante numeric,p_player_hand jsonb,p_dealer_hand jsonb)
returns table(round_id uuid,balance numeric)
language plpgsql security definer set search_path=public
as $$
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

create or replace function public.settle_three_card_poker_test_atomic(p_user_id uuid,p_round_id uuid,p_decision text,p_payout numeric,p_result text,p_dealer_qualifies boolean)
returns table(round_id uuid,payout numeric,balance numeric)
language plpgsql security definer set search_path=public
as $$
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

revoke all on function public.deal_three_card_poker_test_atomic(uuid,numeric,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.settle_three_card_poker_test_atomic(uuid,uuid,text,numeric,text,boolean) from public,anon,authenticated;
grant execute on function public.deal_three_card_poker_test_atomic(uuid,numeric,jsonb,jsonb) to postgres,service_role;
grant execute on function public.settle_three_card_poker_test_atomic(uuid,uuid,text,numeric,text,boolean) to postgres,service_role;
