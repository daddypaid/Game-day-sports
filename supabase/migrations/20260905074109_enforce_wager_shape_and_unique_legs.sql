create or replace function public.place_test_wager_atomic(
  p_user_id uuid,
  p_wager_type wager_type,
  p_stake numeric,
  p_potential_return numeric,
  p_selections jsonb
)
returns table(
  wager_id uuid,
  wager_type wager_type,
  stake numeric,
  potential_return numeric,
  status wager_status,
  placed_at timestamptz,
  is_test boolean,
  balance numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_wager_id uuid;
  v_selection jsonb;
  v_fingerprint text;
  v_bucket bigint;
  v_count integer;
begin
  if p_user_id is null then
    raise exception 'User is required';
  end if;
  if p_stake is null or p_stake <= 0 then
    raise exception 'Invalid stake';
  end if;
  if p_potential_return is null or p_potential_return <= 0 then
    raise exception 'Invalid potential return';
  end if;
  if p_selections is null or jsonb_typeof(p_selections) <> 'array' then
    raise exception 'Selections must be an array';
  end if;

  v_count := jsonb_array_length(p_selections);
  if p_wager_type = 'single' and v_count <> 1 then
    raise exception 'A single wager must contain exactly one selection';
  end if;
  if p_wager_type = 'parlay' and (v_count < 2 or v_count > 20) then
    raise exception 'A parlay must contain between 2 and 20 selections';
  end if;
  if v_count = 0 then
    raise exception 'At least one selection is required';
  end if;

  if exists (
    select 1
    from (
      select
        lower(btrim(coalesce(s.value->>'event_id',''))) as event_id,
        lower(btrim(coalesce(s.value->>'market_key',''))) as market_key,
        lower(regexp_replace(btrim(coalesce(s.value->>'selection_name','')), '\s+', ' ', 'g')) as selection_name,
        lower(regexp_replace(btrim(coalesce(s.value->>'description','')), '\s+', ' ', 'g')) as description,
        case
          when nullif(s.value->>'point','') is null then ''
          else ((s.value->>'point')::numeric)::text
        end as point_key,
        count(*) as c
      from jsonb_array_elements(p_selections) as s(value)
      group by 1,2,3,4,5
      having count(*) > 1
    ) d
  ) then
    raise exception 'Duplicate selection in wager';
  end if;

  v_bucket := floor(extract(epoch from clock_timestamp()) / 10)::bigint;
  v_fingerprint := md5(
    p_user_id::text || '|' ||
    p_wager_type::text || '|' ||
    p_stake::text || '|' ||
    p_potential_return::text || '|' ||
    p_selections::text
  );

  select w.balance
  into v_balance
  from public.wallets w
  where w.user_id = p_user_id
  for update;

  if v_balance is null then
    raise exception 'Wallet not found';
  end if;

  if exists (
    select 1 from public.wagers w
    where w.user_id = p_user_id
      and w.placement_fingerprint = v_fingerprint
      and w.placement_bucket = v_bucket
  ) then
    raise exception 'Duplicate wager request ignored';
  end if;

  if v_balance < p_stake then
    raise exception 'Insufficient test balance';
  end if;

  update public.wallets as w
  set balance = w.balance - p_stake,
      updated_at = now()
  where w.user_id = p_user_id
  returning w.balance into v_balance;

  insert into public.wagers (
    user_id, wager_type, stake, potential_return, status, is_test,
    placement_fingerprint, placement_bucket
  ) values (
    p_user_id, p_wager_type, p_stake, p_potential_return, 'pending', true,
    v_fingerprint, v_bucket
  ) returning id into v_wager_id;

  for v_selection in
    select value from jsonb_array_elements(p_selections)
  loop
    insert into public.wager_selections (
      wager_id, event_id, event_name, sport_key, market_key, market_title,
      selection_name, description, point, american_odds, quoted_at
    ) values (
      v_wager_id,
      v_selection->>'event_id',
      v_selection->>'event_name',
      nullif(v_selection->>'sport_key',''),
      v_selection->>'market_key',
      nullif(v_selection->>'market_title',''),
      v_selection->>'selection_name',
      nullif(v_selection->>'description',''),
      case when v_selection->>'point' is null or v_selection->>'point' = '' then null else (v_selection->>'point')::numeric end,
      (v_selection->>'american_odds')::integer,
      case when nullif(v_selection->>'quoted_at','') is null then null else (v_selection->>'quoted_at')::timestamptz end
    );
  end loop;

  insert into public.wallet_transactions (
    user_id, wager_id, transaction_type, amount, balance_after, note
  ) values (
    p_user_id, v_wager_id, 'wager_debit', p_stake, v_balance, 'Test wager debit'
  );

  return query
  select w.id, w.wager_type, w.stake, w.potential_return, w.status,
         w.placed_at, w.is_test, v_balance
  from public.wagers w
  where w.id = v_wager_id;
end;
$$;

revoke execute on function public.place_test_wager_atomic(uuid,wager_type,numeric,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.place_test_wager_atomic(uuid,wager_type,numeric,numeric,jsonb) to postgres, service_role;
