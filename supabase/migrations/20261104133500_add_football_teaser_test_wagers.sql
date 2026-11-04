-- GameDay football 6-/7-point TEST MODE teasers.
-- Teasers are stored as parlay tickets with immutable teaser pricing metadata,
-- not with fabricated per-leg alternate bookmaker odds. All settlement credits
-- are revalidated in the atomic ledger function.
alter table public.wagers
  add column teaser_points integer,
  add column teaser_american_odds integer,
  add constraint wagers_teaser_metadata_check check (
    (teaser_points is null and teaser_american_odds is null)
    or
    (teaser_points in (6,7) and teaser_american_odds is not null
       and wager_type='parlay' and is_test=true and round_robin_group_id is null)
  );
alter table public.wager_selections
  add column teaser_original_point numeric;
-- Fixed TEST MODE reference payout table (not a live bookmaker offer).
-- Published football teaser table used for deterministic simulation.
create or replace function public.test_teaser_american_odds(p_sport text,p_points integer,p_legs integer)
returns integer language sql immutable security invoker set search_path = '' as $$
  select case
    when p_sport='americanfootball_nfl' and p_points=6 then
      case p_legs when 2 then -135 when 3 then 140 when 4 then 240 when 5 then 333 when 6 then 500 end
    when p_sport='americanfootball_nfl' and p_points=7 then
      case p_legs when 2 then -150 when 3 then 120 when 4 then 180 when 5 then 250 when 6 then 350 end
    when p_sport='americanfootball_ncaaf' and p_points=6 then
      case p_legs when 2 then -115 when 3 then 160 when 4 then 260 when 5 then 475 when 6 then 750 end
    when p_sport='americanfootball_ncaaf' and p_points=7 then
      case p_legs when 2 then -125 when 3 then 140 when 4 then 230 when 5 then 380 when 6 then 600 end
    else null
  end::integer;
$$;
revoke execute on function public.test_teaser_american_odds(text,integer,integer) from public,anon,authenticated;
grant execute on function public.test_teaser_american_odds(text,integer,integer) to service_role;

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
      'wager',jsonb_build_object('id',w.id,'wager_type',case when w.teaser_points is not null then 'teaser' else w.wager_type::text end,'stake',w.stake,
        'potential_return',w.potential_return,'status',w.status,'placed_at',w.placed_at,'is_test',w.is_test,
        'teaser_points',w.teaser_points,'teaser_american_odds',w.teaser_american_odds),
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


-- Durable fenced Teaser commit; the Edge Function independently validates
-- fresh pregame base quotes and favorable spread/total adjustment first.
create or replace function public.sportsbook_test_request_commit_teaser(
  p_user_id uuid,p_request_id uuid,p_processing_token uuid,p_selections jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.sportsbook_placement_requests%rowtype;
  v_balance numeric;v_stake numeric;v_return numeric;v_wager uuid;
  v_points integer;v_count integer;v_price integer;v_sport text;
  v_original numeric;v_adjusted numeric;v_odds integer;v_market text;v_side text;
  s jsonb;
begin
  if p_user_id is null or p_request_id is null or p_processing_token is null then
    raise exception 'Teaser request identity required';
  end if;
  select balance into v_balance from public.wallets where user_id=p_user_id for update;
  if not found then raise exception 'Wallet not found'; end if;
  select * into r from public.sportsbook_placement_requests
    where user_id=p_user_id and request_id=p_request_id for update;
  if not found then raise exception 'Placement request not found'; end if;
  if r.state <> 'pending' or r.processing_token is distinct from p_processing_token then
    return public.sportsbook_test_request_receipt(p_user_id,p_request_id) || jsonb_build_object('replayed',true);
  end if;
  if r.request_payload->>'wager_type' <> 'teaser' then raise exception 'Not a Teaser request'; end if;
  if p_selections is null or jsonb_typeof(p_selections) <> 'array' then raise exception 'Teaser selections must be an array'; end if;
  if (select jsonb_agg(value-'quoted_at' order by ord)
      from jsonb_array_elements(p_selections) with ordinality a(value,ord))
      is distinct from r.request_payload->'selections' then
    raise exception 'Teaser request selections changed';
  end if;
  v_count:=jsonb_array_length(p_selections);
  v_points:=(r.request_payload->>'teaser_points')::integer;
  v_stake:=(r.request_payload->>'stake')::numeric;
  if v_count not between 2 and 6 or v_points not in (6,7)
    or v_stake is null or v_stake<0.01 or v_stake>100000 or v_stake<>round(v_stake,2)
    then raise exception 'Invalid football Teaser selection count, points, or stake'; end if;
  select min(s.value->>'sport_key') into v_sport from jsonb_array_elements(p_selections) as s(value);
  if v_sport not in ('americanfootball_nfl','americanfootball_ncaaf')
     or (select count(distinct value->>'sport_key') from jsonb_array_elements(p_selections))<>1
    then raise exception 'Teasers require one supported football league'; end if;
  if exists(select 1 from jsonb_array_elements(p_selections) s(value)
      group by lower(btrim(value->>'event_id')) having count(*)>1) then
    return public.sportsbook_test_request_reject(p_user_id,p_request_id,p_processing_token,
      'SAME_EVENT_TEASER','Teasers require selections from different games. No test credits were charged.');
  end if;
  for s in select value from jsonb_array_elements(p_selections) loop
    if nullif(btrim(s->>'event_id'),'') is null
       or nullif(btrim(s->>'event_name'),'') is null
       or nullif(btrim(s->>'selection_name'),'') is null
       or s->>'buy_points'='true' then
      raise exception 'Invalid Teaser leg';
    end if;
    v_original:=(s->>'teaser_original_point')::numeric;
    v_adjusted:=(s->>'point')::numeric;
    v_odds:=(s->>'american_odds')::integer;
    v_market:=s->>'market_key';
    v_side:=lower(btrim(s->>'selection_name'));
    if v_original is null or v_adjusted is null or v_odds is null or abs(v_odds)<100
       or v_original<>round(v_original*2)/2 or v_adjusted<>round(v_adjusted*2)/2
       or v_market not in ('spreads','totals') then
      raise exception 'Invalid Teaser line or odds';
    end if;
    if v_market='spreads' and v_adjusted<>v_original+v_points then
      raise exception 'Teaser spread adjustment is invalid';
    elsif v_market='totals' and
        not ((v_side='over' and v_adjusted=v_original-v_points)
          or (v_side='under' and v_adjusted=v_original+v_points)) then
      raise exception 'Teaser total adjustment is invalid';
    end if;
  end loop;
  v_price:=public.test_teaser_american_odds(v_sport,v_points,v_count);
  if v_price is null then raise exception 'Teaser payout unavailable'; end if;
  v_return:=round(v_stake*case when v_price>0
      then 1+v_price::numeric/100 else 1+100/abs(v_price::numeric) end,2);
  if v_balance<v_stake then
    return public.sportsbook_test_request_reject(p_user_id,p_request_id,p_processing_token,
      'INSUFFICIENT_BALANCE','Insufficient test credits. No test credits were charged.');
  end if;
  update public.wallets set balance=balance-v_stake,updated_at=now()
    where user_id=p_user_id returning balance into v_balance;
  insert into public.wagers(user_id,wager_type,stake,potential_return,status,is_test,
      teaser_points,teaser_american_odds,placement_fingerprint,placement_bucket)
    values(p_user_id,'parlay',v_stake,v_return,'pending',true,v_points,v_price,
      md5(p_user_id::text||':'||p_request_id::text),floor(extract(epoch from clock_timestamp())/10)::bigint)
    returning id into v_wager;
  for s in select value from jsonb_array_elements(p_selections) loop
    insert into public.wager_selections(wager_id,event_id,event_name,sport_key,market_key,
      market_title,selection_name,description,point,american_odds,quoted_at,teaser_original_point)
    values(v_wager,s->>'event_id',s->>'event_name',s->>'sport_key',s->>'market_key',
      nullif(s->>'market_title',''),s->>'selection_name',nullif(s->>'description',''),
      (s->>'point')::numeric,(s->>'american_odds')::integer,
      nullif(s->>'quoted_at','')::timestamptz,(s->>'teaser_original_point')::numeric);
  end loop;
  insert into public.wallet_transactions(user_id,wager_id,transaction_type,amount,balance_after,note)
    values(p_user_id,v_wager,'wager_debit',v_stake,v_balance,'Football Teaser TEST MODE wager debit');
  update public.sportsbook_placement_requests set state='accepted',wager_id=v_wager,
    processing_token=null,lease_until=null,updated_at=now()
    where user_id=p_user_id and request_id=p_request_id;
  return public.sportsbook_test_request_receipt(p_user_id,p_request_id);
end $$;
revoke execute on function public.sportsbook_test_request_commit_teaser(uuid,uuid,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.sportsbook_test_request_commit_teaser(uuid,uuid,uuid,jsonb) to service_role;

-- Keep all preexisting settlement invariants, extending only the teaser-specific
-- result/payout validation before a wallet credit can be issued.
-- Qualify selection columns: the TABLE result also declares a wager_id variable.
-- Retain the deployed complete-leg integrity checks and atomic wallet locks.
create or replace function public.settle_test_wager_auto_atomic(
  p_wager_id uuid,
  p_result text,
  p_credit numeric,
  p_grades jsonb
)
returns table(wager_id uuid, status public.wager_status, credited_amount numeric, balance numeric)
language plpgsql
security definer
set search_path = ''
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
  v_teaser_sport text;
  v_teaser_price integer;
  v_expected_credit numeric;
begin
  if p_result is null or p_result not in ('won','lost','void') then
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
  from public.wager_selections s
  where s.wager_id = v_wager.id;

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
  elsif v_wager.teaser_points is not null and v_won_count < 2 then
    -- A two-leg teaser with a push, or a larger teaser reduced to
    -- fewer than two winning legs, is no action unless another leg lost.
    v_expected_result := 'void';
  elsif v_void_count = v_selection_count then
    v_expected_result := 'void';
  else
    v_expected_result := 'won';
  end if;

  if p_result <> v_expected_result then
    raise exception 'Overall wager result does not match leg grades';
  end if;
  if v_wager.teaser_points is not null then
    select min(s.sport_key), count(distinct s.sport_key)
      into v_teaser_sport, v_selection_count
      from public.wager_selections s where s.wager_id=v_wager.id;
    if v_selection_count <> 1 then raise exception 'Mixed teaser sports are invalid'; end if;
    if p_result='won' then
      v_teaser_price := public.test_teaser_american_odds(v_teaser_sport,v_wager.teaser_points,v_won_count);
      if v_teaser_price is null then raise exception 'Unsupported teaser payout'; end if;
      v_expected_credit := round(v_wager.stake * case when v_teaser_price>0
        then 1+v_teaser_price::numeric/100 else 1+100/abs(v_teaser_price::numeric) end,2);
    else
      v_expected_credit := case when p_result='void' then v_wager.stake else 0 end;
    end if;
    if v_credit <> v_expected_credit then raise exception 'Teaser settlement credit does not match verified test payout'; end if;
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
    update public.wager_selections s
    set result = v_grade->>'result',
        graded_at = now(),
        final_home_score = case when v_grade->>'final_home_score' is null then null else (v_grade->>'final_home_score')::numeric end,
        final_away_score = case when v_grade->>'final_away_score' is null then null else (v_grade->>'final_away_score')::numeric end
    where s.id = (v_grade->>'selection_id')::uuid
      and s.wager_id = v_wager.id;
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
      case when p_result = 'void' then 'refund'::public.transaction_type else 'wager_credit'::public.transaction_type end,
      v_credit,
      v_balance,
      case when p_result = 'void' then 'Automatic test wager refund' else 'Automatic test wager settlement credit' end
    );
  end if;

  update public.wagers w
  set status = p_result::public.wager_status,
      settled_at = now(),
      updated_at = now()
  where w.id = v_wager.id;

  return query select v_wager.id, p_result::public.wager_status, v_credit, v_balance;
end;
$$;


revoke all on function public.settle_test_wager_auto_atomic(uuid,text,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.settle_test_wager_auto_atomic(uuid,text,numeric,jsonb) to service_role;
