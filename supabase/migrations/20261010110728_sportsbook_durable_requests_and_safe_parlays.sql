-- Durable owner-scoped sportsbook placement identity. A request is reserved
-- before external quote validation and fenced by a processing token. Replays
-- return the existing receipt rather than relying on a time-bucket heuristic.
create table public.sportsbook_placement_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  request_payload jsonb not null,
  state text not null check (state in ('pending', 'accepted', 'rejected')),
  processing_token uuid,
  lease_until timestamptz,
  wager_id uuid references public.wagers(id),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, request_id),
  check ((state = 'accepted') = (wager_id is not null))
);
create index sportsbook_placement_requests_wager_idx
  on public.sportsbook_placement_requests(wager_id);
alter table public.sportsbook_placement_requests enable row level security;
revoke all on public.sportsbook_placement_requests from public, anon, authenticated;
grant all on public.sportsbook_placement_requests to service_role;

create function public.sportsbook_test_request_receipt(p_user_id uuid, p_request_id uuid)
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
    select jsonb_build_object('ok',true,'state','accepted','request_id',p_request_id,
      'wager',jsonb_build_object('id',w.id,'wager_type',w.wager_type,'stake',w.stake,
        'potential_return',w.potential_return,'status',w.status,'placed_at',w.placed_at,'is_test',w.is_test),
      'balance',b.balance) into result
    from public.wagers w join public.wallets b on b.user_id = w.user_id
    where w.id = r.wager_id and w.user_id = p_user_id;
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

create function public.sportsbook_test_request_prepare(
  p_user_id uuid, p_request_id uuid, p_payload jsonb, p_processing_token uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.sportsbook_placement_requests%rowtype; v_balance numeric;
begin
  if p_user_id is null or p_request_id is null or p_processing_token is null then
    raise exception 'User, request ID and processing token are required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'Request payload is required'; end if;
  select balance into v_balance from public.wallets where user_id = p_user_id for update;
  if not found then raise exception 'Wallet not found'; end if;
  select * into r from public.sportsbook_placement_requests
    where user_id = p_user_id and request_id = p_request_id for update;
  if found then
    if r.request_payload <> p_payload then
      return jsonb_build_object('ok',false,'state','conflict','code','REQUEST_CONFLICT',
        'error','This request ID belongs to a different wager. Recover the original wager first.',
        'request_id',p_request_id);
    end if;
    if r.state <> 'pending' then
      return public.sportsbook_test_request_receipt(p_user_id,p_request_id) || jsonb_build_object('replayed',true);
    end if;
    if r.lease_until > clock_timestamp() then
      return public.sportsbook_test_request_receipt(p_user_id,p_request_id);
    end if;
    update public.sportsbook_placement_requests set processing_token = p_processing_token,
      lease_until = clock_timestamp() + interval '60 seconds', updated_at = now()
      where user_id = p_user_id and request_id = p_request_id;
  else
    insert into public.sportsbook_placement_requests(user_id,request_id,request_payload,state,processing_token,lease_until)
      values(p_user_id,p_request_id,p_payload,'pending',p_processing_token,clock_timestamp() + interval '60 seconds');
  end if;
  return jsonb_build_object('ok',false,'state','pending','request_id',p_request_id,'processing',true);
end $$;

create function public.sportsbook_test_request_reject(
  p_user_id uuid, p_request_id uuid, p_processing_token uuid, p_code text, p_message text
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is null or p_request_id is null or p_processing_token is null then raise exception 'Request identity is required'; end if;
  -- A rejected/cancelled processor can never commit afterwards. If another
  -- processor took over or committed, return its current state instead.
  update public.sportsbook_placement_requests set state = 'rejected',
    error_code = p_code, error_message = p_message, processing_token = null,
    lease_until = null, updated_at = now()
    where user_id = p_user_id and request_id = p_request_id
      and state = 'pending' and processing_token = p_processing_token;
  return public.sportsbook_test_request_receipt(p_user_id,p_request_id);
end $$;

create function public.sportsbook_test_request_commit(
  p_user_id uuid, p_request_id uuid, p_processing_token uuid, p_selections jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.sportsbook_placement_requests%rowtype; v_balance numeric; v_stake numeric;
  v_potential_return numeric; v_type public.wager_type; v_id uuid;
  s jsonb; v_decimal numeric := 1; v_odds integer; v_count integer;
begin
  if p_user_id is null or p_request_id is null or p_processing_token is null then raise exception 'Request identity is required'; end if;
  select balance into v_balance from public.wallets where user_id = p_user_id for update;
  if not found then raise exception 'Wallet not found'; end if;
  select * into r from public.sportsbook_placement_requests
    where user_id = p_user_id and request_id = p_request_id for update;
  if not found then raise exception 'Placement request not found'; end if;
  if r.state <> 'pending' or r.processing_token is distinct from p_processing_token then
    return public.sportsbook_test_request_receipt(p_user_id,p_request_id) || jsonb_build_object('replayed',true);
  end if;
  v_type := (r.request_payload->>'wager_type')::public.wager_type;
  v_stake := (r.request_payload->>'stake')::numeric;
  if v_stake is null or v_stake <= 0 or v_stake > 100000 or v_stake <> round(v_stake,2) then raise exception 'Invalid stake'; end if;
  if p_selections is null or jsonb_typeof(p_selections) <> 'array' then raise exception 'Selections must be an array'; end if;
  -- Preserve exact request semantics; quote timestamps are validation metadata.
  if (select jsonb_agg(value - 'quoted_at' order by ord)
      from jsonb_array_elements(p_selections) with ordinality a(value,ord))
       is distinct from r.request_payload->'selections' then raise exception 'Request selections changed'; end if;
  v_count := jsonb_array_length(p_selections);
  if (v_type = 'single' and v_count <> 1) or (v_type = 'parlay' and (v_count < 2 or v_count > 20)) then raise exception 'Invalid selection count'; end if;
  if exists(select 1 from jsonb_array_elements(p_selections) a(value)
    where nullif(btrim(value->>'event_id'),'') is null or nullif(btrim(value->>'sport_key'),'') is null
      or nullif(btrim(value->>'market_key'),'') is null or nullif(btrim(value->>'selection_name'),'') is null) then
    raise exception 'Selection data is incomplete';
  end if;
  if v_type = 'parlay' and exists(select 1 from jsonb_array_elements(p_selections) a(value)
    group by lower(btrim(value->>'event_id')) having count(*) > 1) then
    return public.sportsbook_test_request_reject(p_user_id,p_request_id,p_processing_token,
      'SAME_EVENT_PARLAY','Parlays must use different events. Same-event selections are not available. No test credits were charged.');
  end if;
  for s in select value from jsonb_array_elements(p_selections) loop
    v_odds := (s->>'american_odds')::integer;
    if v_odds is null or v_odds = 0 then raise exception 'Invalid selection odds'; end if;
    v_decimal := v_decimal * case when v_odds > 0 then 1 + v_odds::numeric/100 else 1 + 100/abs(v_odds::numeric) end;
  end loop;
  v_potential_return := round(v_stake * v_decimal,2);
  if v_balance < v_stake then
    return public.sportsbook_test_request_reject(p_user_id,p_request_id,p_processing_token,
      'INSUFFICIENT_BALANCE','Insufficient test balance. No test credits were charged.');
  end if;
  update public.wallets set balance = balance - v_stake, updated_at = now()
    where user_id = p_user_id returning balance into v_balance;
  insert into public.wagers(user_id,wager_type,stake,potential_return,status,is_test,placement_fingerprint,placement_bucket)
    values(p_user_id,v_type,v_stake,v_potential_return,'pending',true,
      md5(p_user_id::text || ':' || p_request_id::text),floor(extract(epoch from clock_timestamp())/10)::bigint)
    returning id into v_id;
  for s in select value from jsonb_array_elements(p_selections) loop
    insert into public.wager_selections(wager_id,event_id,event_name,sport_key,market_key,market_title,
      selection_name,description,point,american_odds,quoted_at)
    values(v_id,s->>'event_id',s->>'event_name',s->>'sport_key',s->>'market_key',nullif(s->>'market_title',''),
      s->>'selection_name',nullif(s->>'description',''),nullif(s->>'point','')::numeric,
      (s->>'american_odds')::integer,nullif(s->>'quoted_at','')::timestamptz);
  end loop;
  insert into public.wallet_transactions(user_id,wager_id,transaction_type,amount,balance_after,note)
    values(p_user_id,v_id,'wager_debit',v_stake,v_balance,'Test wager debit');
  update public.sportsbook_placement_requests set state = 'accepted',wager_id = v_id,
    processing_token = null, lease_until = null, updated_at = now()
    where user_id = p_user_id and request_id = p_request_id;
  return public.sportsbook_test_request_receipt(p_user_id,p_request_id);
end $$;

revoke execute on function public.sportsbook_test_request_receipt(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.sportsbook_test_request_prepare(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
revoke execute on function public.sportsbook_test_request_reject(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke execute on function public.sportsbook_test_request_commit(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sportsbook_test_request_receipt(uuid,uuid) to service_role;
grant execute on function public.sportsbook_test_request_prepare(uuid,uuid,jsonb,uuid) to service_role;
grant execute on function public.sportsbook_test_request_reject(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.sportsbook_test_request_commit(uuid,uuid,uuid,jsonb) to service_role;
-- Retire the unfenced placement path. Only the request-aware edge endpoint
-- may place new wagers; direct browser execution remains forbidden.
revoke execute on function public.place_test_wager_atomic(uuid,public.wager_type,numeric,numeric,jsonb)
  from public,anon,authenticated,service_role;
