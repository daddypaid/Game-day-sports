-- Round Robin test-credit wagering. Each combination is an ordinary parlay,
-- charged and persisted in one atomic transaction, with owner-scoped recovery.
-- Existing single/parlay placement and automatic grading remain unchanged.
alter table public.wagers
  add column round_robin_group_id uuid,
  add column round_robin_leg_count integer,
  add constraint wagers_round_robin_metadata_check check (
    (round_robin_group_id is null and round_robin_leg_count is null)
    or
    (round_robin_group_id is not null and round_robin_leg_count between 2 and 5 and wager_type = 'parlay' and is_test = true)
  );
create index wagers_round_robin_group_idx on public.wagers(user_id,round_robin_group_id)
  where round_robin_group_id is not null;

-- Keep existing receipts unchanged for Singles and Parlays. An accepted Round
-- Robin request returns the entire group, not only its first child ticket.
create or replace function public.sportsbook_test_request_receipt(p_user_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.sportsbook_placement_requests%rowtype; result jsonb;
begin
  if p_user_id is null or p_request_id is null then raise exception 'User and request ID are required'; end if;
  select * into r from public.sportsbook_placement_requests
    where user_id = p_user_id and request_id = p_request_id;
  if not found then
    return jsonb_build_object('ok',false,'state','not_found','request_id',p_request_id,'retry_same_request',true);
  end if;
  if r.state = 'accepted' then
    if r.request_payload->>'wager_type' = 'round_robin' then
      select jsonb_build_object(
        'ok',true,'state','accepted','request_id',p_request_id,
        'wager',jsonb_build_object(
          'id',r.wager_id,'wager_type','round_robin',
          'stake',(r.request_payload->>'stake')::numeric * count(w.id),
          'stake_per_combination',(r.request_payload->>'stake')::numeric,
          'combinations',count(w.id),
          'legs_per_combination',(r.request_payload->>'round_robin_legs')::integer,
          'potential_return',coalesce(sum(w.potential_return),0),
          'status',case when bool_and(w.status::text in ('won','lost','void','cancelled')) then 'settled' else 'pending' end,
          'placed_at',min(w.placed_at),'is_test',true
        ),
        'balance',b.balance
      ) into result
      from public.wagers w join public.wallets b on b.user_id=w.user_id
      where w.user_id=p_user_id and w.round_robin_group_id=p_request_id
      group by b.balance;
      if result is null then raise exception 'Round Robin receipt is unavailable'; end if;
      return result;
    end if;
    select jsonb_build_object('ok',true,'state','accepted','request_id',p_request_id,
      'wager',jsonb_build_object('id',w.id,'wager_type',w.wager_type,'stake',w.stake,
        'potential_return',w.potential_return,'status',w.status,'placed_at',w.placed_at,'is_test',w.is_test),
      'balance',b.balance) into result
    from public.wagers w join public.wallets b on b.user_id=w.user_id
    where w.id=r.wager_id and w.user_id=p_user_id;
    if result is null then raise exception 'Placement receipt is unavailable'; end if;
    return result;
  end if;
  if r.state = 'rejected' then
    return jsonb_build_object('ok',false,'state','rejected','request_id',p_request_id,
      'code',r.error_code,'error',r.error_message,'no_credits_charged',true);
  end if;
  return jsonb_build_object('ok',false,'state','pending','request_id',p_request_id,
    'retry_same_request',true,'retry_after_ms',2000);
end $$;

-- Called after the Edge Function validates every original/fresh provider price.
-- Locks wallet + request and creates all 2- to 5-leg parlay tickets atomically.
create function public.sportsbook_test_request_commit_round_robin(
  p_user_id uuid, p_request_id uuid, p_processing_token uuid, p_selections jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.sportsbook_placement_requests%rowtype;
  v_balance numeric; v_stake numeric; v_total numeric; v_return numeric;
  v_id uuid; v_first_id uuid; v_ways integer := 1;
  v_count integer; v_legs integer; v_i integer; v_pos integer; v_ticket_num integer := 0;
  v_indices integer[]; v_decimal numeric; v_odds integer; v_pick jsonb;
begin
  if p_user_id is null or p_request_id is null or p_processing_token is null then raise exception 'Request identity is required'; end if;
  select balance into v_balance from public.wallets where user_id=p_user_id for update;
  if not found then raise exception 'Wallet not found'; end if;
  select * into r from public.sportsbook_placement_requests
    where user_id=p_user_id and request_id=p_request_id for update;
  if not found then raise exception 'Placement request not found'; end if;
  if r.state <> 'pending' or r.processing_token is distinct from p_processing_token then
    return public.sportsbook_test_request_receipt(p_user_id,p_request_id) || jsonb_build_object('replayed',true);
  end if;
  if r.request_payload->>'wager_type' <> 'round_robin' then raise exception 'Not a Round Robin request'; end if;
  if p_selections is null or jsonb_typeof(p_selections) <> 'array' then raise exception 'Selections must be an array'; end if;
  if (select jsonb_agg(value-'quoted_at' order by ord)
      from jsonb_array_elements(p_selections) with ordinality a(value,ord))
       is distinct from r.request_payload->'selections' then raise exception 'Request selections changed'; end if;
  v_count := jsonb_array_length(p_selections);
  v_legs := (r.request_payload->>'round_robin_legs')::integer;
  v_stake := (r.request_payload->>'stake')::numeric;
  if v_count < 3 or v_count > 6 or v_legs < 2 or v_legs >= v_count or v_stake is null
       or v_stake < 0.01 or v_stake > 100000 or v_stake <> round(v_stake,2) then
    raise exception 'Invalid Round Robin selections or stake';
  end if;
  if exists(select 1 from jsonb_array_elements(p_selections) a(value)
      where nullif(btrim(value->>'event_id'),'') is null or nullif(btrim(value->>'sport_key'),'') is null
         or nullif(btrim(value->>'market_key'),'') is null or nullif(btrim(value->>'selection_name'),'') is null) then
    raise exception 'Selection data is incomplete';
  end if;
  if exists(select 1 from jsonb_array_elements(p_selections) a(value)
      group by lower(btrim(value->>'event_id')) having count(*) > 1) then
    return public.sportsbook_test_request_reject(p_user_id,p_request_id,p_processing_token,
      'SAME_EVENT_ROUND_ROBIN','Round Robin requires picks from different events. No test credits were charged.');
  end if;
  for v_i in 1..v_legs loop
    v_ways := v_ways * (v_count - v_i + 1) / v_i;
  end loop;
  if v_ways > 20 then raise exception 'Round Robin combination count exceeds the limit'; end if;
  v_total := v_stake * v_ways;
  if v_total > 100000 then raise exception 'Total Round Robin stake exceeds the limit'; end if;
  if v_balance < v_total then
    return public.sportsbook_test_request_reject(p_user_id,p_request_id,p_processing_token,
      'INSUFFICIENT_BALANCE','Insufficient test balance for all Round Robin combinations. No test credits were charged.');
  end if;

  for v_indices in
    with recursive combinations(indices,last_idx) as (
      select array[i]::int[],i from generate_series(1,v_count) as i
      union all
      select c.indices || i,i from combinations c
      cross join lateral generate_series(c.last_idx+1,v_count) as i
      where cardinality(c.indices) < v_legs
    )
    select indices from combinations where cardinality(indices)=v_legs order by indices
  loop
    v_decimal := 1;
    for v_pos in select unnest(v_indices) loop
      v_pick := p_selections->(v_pos-1);
      v_odds := (v_pick->>'american_odds')::integer;
      if v_odds is null or v_odds=0 then raise exception 'Invalid selection odds'; end if;
      v_decimal := v_decimal * case when v_odds>0 then 1+v_odds::numeric/100 else 1+100/abs(v_odds::numeric) end;
    end loop;
    v_return := round(v_stake*v_decimal,2);
    insert into public.wagers(user_id,wager_type,stake,potential_return,status,is_test,round_robin_group_id,
      round_robin_leg_count,placement_fingerprint,placement_bucket)
      values(p_user_id,'parlay',v_stake,v_return,'pending',true,p_request_id,v_legs,
        md5(p_user_id::text||':'||p_request_id::text||':'||v_indices::text),
        floor(extract(epoch from clock_timestamp())/10)::bigint)
      returning id into v_id;
    if v_first_id is null then v_first_id := v_id; end if;
    for v_pos in select unnest(v_indices) loop
      v_pick := p_selections->(v_pos-1);
      insert into public.wager_selections(wager_id,event_id,event_name,sport_key,market_key,market_title,
        selection_name,description,point,american_odds,quoted_at)
      values(v_id,v_pick->>'event_id',v_pick->>'event_name',v_pick->>'sport_key',v_pick->>'market_key',
        nullif(v_pick->>'market_title',''),v_pick->>'selection_name',nullif(v_pick->>'description',''),
        nullif(v_pick->>'point','')::numeric,(v_pick->>'american_odds')::integer,
        nullif(v_pick->>'quoted_at','')::timestamptz);
    end loop;
    update public.wallets set balance=balance-v_stake,updated_at=now()
      where user_id=p_user_id returning balance into v_balance;
    insert into public.wallet_transactions(user_id,wager_id,transaction_type,amount,balance_after,note)
      values(p_user_id,v_id,'wager_debit',v_stake,v_balance,'Round Robin test wager debit');
    v_ticket_num := v_ticket_num + 1;
  end loop;
  if v_first_id is null or v_ticket_num <> v_ways then raise exception 'Incomplete Round Robin combinations'; end if;
  update public.sportsbook_placement_requests set state='accepted',wager_id=v_first_id,
    processing_token=null,lease_until=null,updated_at=now()
    where user_id=p_user_id and request_id=p_request_id;
  return public.sportsbook_test_request_receipt(p_user_id,p_request_id);
end $$;

revoke execute on function public.sportsbook_test_request_commit_round_robin(uuid,uuid,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.sportsbook_test_request_commit_round_robin(uuid,uuid,uuid,jsonb) to service_role;
