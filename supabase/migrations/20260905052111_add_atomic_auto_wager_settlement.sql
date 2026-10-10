alter table public.wager_selections
  add column if not exists result text,
  add column if not exists graded_at timestamptz,
  add column if not exists final_home_score numeric,
  add column if not exists final_away_score numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'wager_selections_result_check'
      and conrelid = 'public.wager_selections'::regclass
  ) then
    alter table public.wager_selections
      add constraint wager_selections_result_check
      check (result is null or result in ('won','lost','void'));
  end if;
end $$;

create or replace function public.settle_test_wager_auto_atomic(
  p_wager_id uuid,
  p_result text,
  p_credit numeric,
  p_grades jsonb
)
returns table(wager_id uuid, status wager_status, credited_amount numeric, balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wager public.wagers%rowtype;
  v_balance numeric;
  v_grade jsonb;
  v_credit numeric := coalesce(p_credit, 0);
begin
  if p_result not in ('won','lost','void') then
    raise exception 'Invalid settlement result';
  end if;
  if v_credit < 0 then
    raise exception 'Invalid settlement credit';
  end if;

  select * into v_wager
  from public.wagers
  where id = p_wager_id and is_test = true
  for update;

  if not found then raise exception 'Test wager not found'; end if;
  if v_wager.status not in ('pending','accepted') then
    raise exception 'Wager already settled or unavailable';
  end if;
  if p_result = 'lost' and v_credit <> 0 then
    raise exception 'Lost wager cannot have settlement credit';
  end if;
  if p_result = 'void' and v_credit <> v_wager.stake then
    raise exception 'Void wager credit must equal stake';
  end if;

  for v_grade in select value from jsonb_array_elements(coalesce(p_grades, '[]'::jsonb))
  loop
    update public.wager_selections
    set result = v_grade->>'result',
        graded_at = now(),
        final_home_score = case when v_grade->>'final_home_score' is null then null else (v_grade->>'final_home_score')::numeric end,
        final_away_score = case when v_grade->>'final_away_score' is null then null else (v_grade->>'final_away_score')::numeric end
    where id = (v_grade->>'selection_id')::uuid
      and wager_id = v_wager.id;
  end loop;

  select w.balance into v_balance
  from public.wallets w
  where w.user_id = v_wager.user_id
  for update;

  if v_balance is null then raise exception 'Wallet not found'; end if;

  if v_credit > 0 then
    update public.wallets w
    set balance = w.balance + v_credit,
        updated_at = now()
    where w.user_id = v_wager.user_id
    returning w.balance into v_balance;

    insert into public.wallet_transactions(
      user_id, wager_id, transaction_type, amount, balance_after, note
    ) values (
      v_wager.user_id,
      v_wager.id,
      case when p_result = 'void' then 'refund'::transaction_type else 'wager_credit'::transaction_type end,
      v_credit,
      v_balance,
      case when p_result = 'void' then 'Automatic test wager refund' else 'Automatic test wager settlement credit' end
    );
  end if;

  update public.wagers w
  set status = p_result::wager_status,
      settled_at = now(),
      updated_at = now()
  where w.id = v_wager.id;

  return query select v_wager.id, p_result::wager_status, v_credit, v_balance;
end;
$$;

revoke all on function public.settle_test_wager_auto_atomic(uuid,text,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.settle_test_wager_auto_atomic(uuid,text,numeric,jsonb) to service_role;
