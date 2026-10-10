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
  v_selection_count integer;
  v_grade_count integer;
  v_distinct_grade_count integer;
  v_valid_grade_count integer;
  v_lost_count integer;
  v_void_count integer;
  v_won_count integer;
  v_expected_result text;
begin
  if p_result not in ('won','lost','void') then
    raise exception 'Invalid settlement result';
  end if;
  if v_credit < 0 then
    raise exception 'Invalid settlement credit';
  end if;
  if p_grades is null or jsonb_typeof(p_grades) <> 'array' then
    raise exception 'Settlement grades must be an array';
  end if;

  select * into v_wager
  from public.wagers
  where id = p_wager_id and is_test = true
  for update;

  if not found then raise exception 'Test wager not found'; end if;
  if v_wager.status not in ('pending','accepted') then
    raise exception 'Wager already settled or unavailable';
  end if;

  select count(*) into v_selection_count
  from public.wager_selections
  where wager_id = v_wager.id;

  select count(*) into v_grade_count
  from jsonb_array_elements(p_grades);

  if v_selection_count = 0 or v_grade_count <> v_selection_count then
    raise exception 'Settlement must grade every wager selection exactly once';
  end if;

  select count(distinct value->>'selection_id') into v_distinct_grade_count
  from jsonb_array_elements(p_grades);

  if v_distinct_grade_count <> v_grade_count then
    raise exception 'Duplicate or missing selection grade id';
  end if;

  select count(*) into v_valid_grade_count
  from jsonb_array_elements(p_grades) g
  join public.wager_selections s
    on s.id = (g.value->>'selection_id')::uuid
   and s.wager_id = v_wager.id
  where g.value->>'result' in ('won','lost','void');

  if v_valid_grade_count <> v_selection_count then
    raise exception 'Settlement contains invalid or foreign selection grades';
  end if;

  select
    count(*) filter (where value->>'result' = 'lost'),
    count(*) filter (where value->>'result' = 'void'),
    count(*) filter (where value->>'result' = 'won')
  into v_lost_count, v_void_count, v_won_count
  from jsonb_array_elements(p_grades);

  if v_lost_count > 0 then
    v_expected_result := 'lost';
  elsif v_void_count = v_selection_count then
    v_expected_result := 'void';
  else
    v_expected_result := 'won';
  end if;

  if p_result <> v_expected_result then
    raise exception 'Overall wager result does not match leg grades';
  end if;

  if p_result = 'lost' and v_credit <> 0 then
    raise exception 'Lost wager cannot have settlement credit';
  end if;
  if p_result = 'void' and v_credit <> v_wager.stake then
    raise exception 'Void wager credit must equal stake';
  end if;
  if p_result = 'won' then
    if v_credit <= 0 or v_credit > v_wager.potential_return then
      raise exception 'Invalid winning settlement credit';
    end if;
    if v_void_count = 0 and v_credit <> v_wager.potential_return then
      raise exception 'Full-win credit must equal potential return';
    end if;
  end if;

  for v_grade in select value from jsonb_array_elements(p_grades)
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
