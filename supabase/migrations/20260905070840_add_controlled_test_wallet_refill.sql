create or replace function public.refill_test_wallet_atomic(p_user_id uuid)
returns table(balance numeric, credited numeric, next_refill_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_credit numeric;
  v_last_refill timestamptz;
  v_next timestamptz;
begin
  if p_user_id is null then
    raise exception 'User is required';
  end if;

  select w.balance into v_balance
  from public.wallets w
  where w.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Test wallet not found';
  end if;

  select max(t.created_at) into v_last_refill
  from public.wallet_transactions t
  where t.user_id = p_user_id
    and t.transaction_type = 'adjustment'
    and t.note = 'Test credit refill';

  if v_last_refill is not null and v_last_refill > now() - interval '24 hours' then
    v_next := v_last_refill + interval '24 hours';
    raise exception 'REFILL_COOLDOWN:%', v_next;
  end if;

  if v_balance >= 25 then
    raise exception 'REFILL_NOT_NEEDED';
  end if;

  v_credit := 1000 - v_balance;
  if v_credit <= 0 then
    raise exception 'REFILL_NOT_NEEDED';
  end if;

  update public.wallets
  set balance = 1000,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.wallet_transactions(user_id, wager_id, transaction_type, amount, balance_after, note)
  values (p_user_id, null, 'adjustment', v_credit, 1000, 'Test credit refill');

  balance := 1000;
  credited := v_credit;
  next_refill_at := now() + interval '24 hours';
  return next;
end;
$$;

revoke all on function public.refill_test_wallet_atomic(uuid) from public, anon, authenticated;
grant execute on function public.refill_test_wallet_atomic(uuid) to postgres, service_role;
