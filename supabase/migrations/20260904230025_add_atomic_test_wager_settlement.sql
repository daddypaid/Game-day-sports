create or replace function public.settle_test_wager_atomic(
  p_wager_id uuid,
  p_result text
)
returns table (
  wager_id uuid,
  status wager_status,
  credited_amount numeric,
  balance numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wager public.wagers%rowtype;
  v_balance numeric;
  v_credit numeric := 0;
begin
  if p_result not in ('won','lost','void') then
    raise exception 'Invalid settlement result';
  end if;

  select *
  into v_wager
  from public.wagers
  where id = p_wager_id
    and is_test = true
  for update;

  if not found then
    raise exception 'Test wager not found';
  end if;

  if v_wager.status not in ('pending','accepted') then
    raise exception 'Wager already settled or unavailable';
  end if;

  select w.balance
  into v_balance
  from public.wallets w
  where w.user_id = v_wager.user_id
  for update;

  if v_balance is null then
    raise exception 'Wallet not found';
  end if;

  if p_result = 'won' then
    v_credit := v_wager.potential_return;
  elsif p_result = 'void' then
    v_credit := v_wager.stake;
  else
    v_credit := 0;
  end if;

  if v_credit > 0 then
    update public.wallets w
    set balance = w.balance + v_credit,
        updated_at = now()
    where w.user_id = v_wager.user_id
    returning w.balance into v_balance;

    insert into public.wallet_transactions (
      user_id,
      wager_id,
      transaction_type,
      amount,
      balance_after,
      note
    )
    values (
      v_wager.user_id,
      v_wager.id,
      case when p_result = 'void' then 'refund'::transaction_type else 'wager_credit'::transaction_type end,
      v_credit,
      v_balance,
      case when p_result = 'void' then 'Test wager refund' else 'Test wager win credit' end
    );
  end if;

  update public.wagers w
  set status = p_result::wager_status,
      settled_at = now(),
      updated_at = now()
  where w.id = v_wager.id;

  return query
  select
    v_wager.id,
    p_result::wager_status,
    v_credit,
    v_balance;
end;
$$;

revoke all on function public.settle_test_wager_atomic(uuid, text) from public;
revoke all on function public.settle_test_wager_atomic(uuid, text) from anon;
revoke all on function public.settle_test_wager_atomic(uuid, text) from authenticated;
grant execute on function public.settle_test_wager_atomic(uuid, text) to service_role;
