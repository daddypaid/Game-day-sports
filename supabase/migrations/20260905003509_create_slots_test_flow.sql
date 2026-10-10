create table if not exists public.slot_spins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stake numeric not null check (stake > 0),
  reels jsonb not null default '[]'::jsonb,
  payout numeric not null default 0 check (payout >= 0),
  result text not null check (result in ('won','lost')),
  is_test boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.slot_spins enable row level security;

drop policy if exists "Users can view own slot spins" on public.slot_spins;
create policy "Users can view own slot spins"
  on public.slot_spins
  for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.play_slot_test_spin_atomic(
  p_user_id uuid,
  p_stake numeric,
  p_reels jsonb,
  p_payout numeric,
  p_result text
)
returns table (
  spin_id uuid,
  payout numeric,
  balance numeric
)
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.play_slot_test_spin_atomic(uuid,numeric,jsonb,numeric,text) from public;
revoke all on function public.play_slot_test_spin_atomic(uuid,numeric,jsonb,numeric,text) from anon;
revoke all on function public.play_slot_test_spin_atomic(uuid,numeric,jsonb,numeric,text) from authenticated;
grant execute on function public.play_slot_test_spin_atomic(uuid,numeric,jsonb,numeric,text) to service_role;
