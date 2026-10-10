create table if not exists public.baccarat_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stake numeric(12,2) not null check (stake > 0),
  bet_type text not null check (bet_type in ('player','banker','tie')),
  player_cards jsonb not null default '[]'::jsonb,
  banker_cards jsonb not null default '[]'::jsonb,
  player_total integer not null,
  banker_total integer not null,
  result text not null check (result in ('player','banker','tie')),
  payout numeric(12,2) not null default 0,
  is_test boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.baccarat_rounds enable row level security;

drop policy if exists "Users can view own baccarat rounds" on public.baccarat_rounds;
create policy "Users can view own baccarat rounds"
on public.baccarat_rounds
for select
using (auth.uid() = user_id);

create or replace function public.place_baccarat_test_round_atomic(
  p_user_id uuid,
  p_stake numeric,
  p_bet_type text,
  p_player_cards jsonb,
  p_banker_cards jsonb,
  p_player_total integer,
  p_banker_total integer,
  p_result text,
  p_payout numeric
)
returns table (
  round_id uuid,
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

revoke all on function public.place_baccarat_test_round_atomic(uuid,numeric,text,jsonb,jsonb,integer,integer,text,numeric) from public, anon, authenticated;
grant execute on function public.place_baccarat_test_round_atomic(uuid,numeric,text,jsonb,jsonb,integer,integer,text,numeric) to service_role;
