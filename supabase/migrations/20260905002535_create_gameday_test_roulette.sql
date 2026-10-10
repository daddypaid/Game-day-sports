create table if not exists public.roulette_spins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stake numeric not null check (stake > 0),
  bet_type text not null check (bet_type in ('red','black','odd','even','low','high','number')),
  bet_value text,
  winning_number integer not null check (winning_number between 0 and 36),
  winning_color text not null check (winning_color in ('red','black','green')),
  payout numeric not null default 0 check (payout >= 0),
  result text not null check (result in ('won','lost')),
  is_test boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.roulette_spins enable row level security;

drop policy if exists roulette_spins_select_own on public.roulette_spins;
create policy roulette_spins_select_own on public.roulette_spins
for select to authenticated
using (auth.uid() = user_id);

create or replace function public.play_test_roulette_atomic(
  p_user_id uuid,
  p_stake numeric,
  p_bet_type text,
  p_bet_value text,
  p_winning_number integer,
  p_winning_color text,
  p_payout numeric,
  p_result text
)
returns table(
  spin_id uuid,
  balance numeric,
  payout numeric,
  result text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_spin_id uuid;
begin
  if p_stake <= 0 then raise exception 'Invalid stake'; end if;
  if p_bet_type not in ('red','black','odd','even','low','high','number') then raise exception 'Invalid bet type'; end if;
  if p_winning_number < 0 or p_winning_number > 36 then raise exception 'Invalid winning number'; end if;
  if p_winning_color not in ('red','black','green') then raise exception 'Invalid winning color'; end if;
  if p_result not in ('won','lost') then raise exception 'Invalid result'; end if;

  select w.balance into v_balance
  from public.wallets w
  where w.user_id = p_user_id
  for update;

  if v_balance is null then raise exception 'Wallet not found'; end if;
  if v_balance < p_stake then raise exception 'Insufficient test balance'; end if;

  update public.wallets as w
  set balance = w.balance - p_stake,
      updated_at = now()
  where w.user_id = p_user_id
  returning w.balance into v_balance;

  insert into public.wallet_transactions(user_id, transaction_type, amount, balance_after, note)
  values (p_user_id, 'wager_debit', p_stake, v_balance, 'Test roulette wager debit');

  if p_payout > 0 then
    update public.wallets as w
    set balance = w.balance + p_payout,
        updated_at = now()
    where w.user_id = p_user_id
    returning w.balance into v_balance;

    insert into public.wallet_transactions(user_id, transaction_type, amount, balance_after, note)
    values (p_user_id, 'wager_credit', p_payout, v_balance, 'Test roulette payout');
  end if;

  insert into public.roulette_spins(
    user_id, stake, bet_type, bet_value, winning_number, winning_color, payout, result, is_test
  ) values (
    p_user_id, p_stake, p_bet_type, p_bet_value, p_winning_number, p_winning_color, p_payout, p_result, true
  ) returning id into v_spin_id;

  return query select v_spin_id, v_balance, p_payout, p_result;
end;
$$;

revoke all on function public.play_test_roulette_atomic(uuid,numeric,text,text,integer,text,numeric,text) from public, anon, authenticated;
grant execute on function public.play_test_roulette_atomic(uuid,numeric,text,text,integer,text,numeric,text) to service_role;
