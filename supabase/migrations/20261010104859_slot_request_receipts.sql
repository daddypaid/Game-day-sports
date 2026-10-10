-- A spin and its customer receipt commit together. Only authenticated Edge
-- handlers using the service role can supply the owner and server-made result.
create table public.slot_request_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  game text not null check (game in ('midnight-monsters','galactic-rebellion','lucky-7s')),
  action text not null check (action in ('spin','bonus_spin')),
  request_payload jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (user_id, request_id)
);
create index slot_request_receipts_owner_history_idx
  on public.slot_request_receipts(user_id, created_at desc, id desc);
alter table public.slot_request_receipts enable row level security;
revoke all on public.slot_request_receipts from public, anon, authenticated;
grant select, insert on public.slot_request_receipts to service_role;

create function public.get_slot_request_receipt(
  p_user_id uuid, p_request_id uuid, p_game text, p_payload jsonb default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_receipt public.slot_request_receipts%rowtype;
begin
  select r.* into v_receipt from public.slot_request_receipts r
    where r.user_id=p_user_id and r.request_id=p_request_id;
  if not found then return null; end if;
  if v_receipt.game <> p_game or
    (p_payload is not null and v_receipt.request_payload <> p_payload) then
    raise exception 'REQUEST_CONFLICT';
  end if;
  return v_receipt.response;
end;
$$;

create function public.get_slot_request_history(
  p_user_id uuid, p_limit integer default 20,
  p_before_created_at timestamptz default null, p_before_id uuid default null
) returns table(id uuid, request_id uuid, game text, created_at timestamptz, spin jsonb)
language sql security invoker set search_path = '' as $$
  select r.id,r.request_id,r.game,r.created_at,r.response->'spin'
  from public.slot_request_receipts r
  where r.user_id=p_user_id and
    (p_before_created_at is null or (r.created_at,r.id)<(p_before_created_at,p_before_id))
  order by r.created_at desc,r.id desc
  limit least(greatest(coalesce(p_limit,20),1),51);
$$;

create function public.settle_slot_request_atomic(
  p_user_id uuid, p_request_id uuid, p_game text, p_action text,
  p_payload jsonb, p_response jsonb, p_settlement jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_prior public.slot_request_receipts%rowtype;
  v_row record;
  v_response jsonb;
  v_spin jsonb;
  v_id uuid := gen_random_uuid();
  v_created_at timestamptz;
begin
  if p_user_id is null or p_request_id is null or p_game not in
    ('midnight-monsters','galactic-rebellion','lucky-7s') or
    p_action not in ('spin','bonus_spin') or
    jsonb_typeof(p_payload) <> 'object' or
    jsonb_typeof(p_response->'spin') <> 'object' then
    raise exception 'Invalid slot request';
  end if;
  -- Serialize a customer's slot requests, including different IDs, so two
  -- paid spins cannot race the creation of an active free-spin session.
  perform pg_advisory_xact_lock(hashtextextended('slot-request:'||p_user_id::text,0));
  select r.* into v_prior from public.slot_request_receipts r
    where r.user_id=p_user_id and r.request_id=p_request_id;
  if found then
    if v_prior.game<>p_game or v_prior.action<>p_action or
      v_prior.request_payload<>p_payload then raise exception 'REQUEST_CONFLICT'; end if;
    return v_prior.response;
  end if;
  v_spin := p_response->'spin';
  if p_action='bonus_spin' then
    if p_game='lucky-7s' or not exists (
      select 1 from public.themed_slot_bonus_sessions s
      where s.id=(p_settlement->>'session_id')::uuid
        and s.user_id=p_user_id and s.game=p_game
    ) then raise exception 'Bonus session not found'; end if;
    select * into v_row from public.settle_themed_bonus_spin_atomic(
      p_user_id,(p_settlement->>'session_id')::uuid,v_spin->'grid',
      (v_spin->>'payout')::numeric,v_spin->>'feature_name');
    v_spin := v_spin || jsonb_build_object(
      'id',v_row.bonus_spin_id,'balance',v_row.balance,
      'bonus_spins_remaining',v_row.spins_remaining,
      'bonus_total_payout',v_row.total_payout,
      'bonus_complete',v_row.session_status='completed');
  elsif p_game='lucky-7s' then
    select * into v_row from public.play_slot_test_spin_atomic(
      p_user_id,(v_spin->>'stake')::numeric,p_settlement->'reels',
      (v_spin->>'payout')::numeric,v_spin->>'result');
    v_spin := v_spin || jsonb_build_object(
      'id',v_row.spin_id,'payout',v_row.payout,'balance',v_row.balance);
  else
    select * into v_row from public.play_themed_slot_paid_spin_atomic(
      p_user_id,p_game,(v_spin->>'stake')::numeric,p_settlement->'reels',
      (v_spin->>'payout')::numeric,v_spin->>'result',
      (v_spin->>'bet_per_line')::numeric,(p_settlement->>'bonus_spins')::integer);
    v_spin := v_spin || jsonb_build_object(
      'id',v_row.spin_id,'balance',v_row.balance,
      'bonus_session_id',v_row.bonus_session_id,
      'bonus_spins_remaining',v_row.bonus_spins_remaining);
  end if;
  v_created_at := clock_timestamp();
  v_spin := v_spin || jsonb_build_object('request_id',p_request_id,
    'receipt_id',v_id,'created_at',v_created_at,
    'is_free_spin',p_action='bonus_spin',
    'spin_type',case when p_action='bonus_spin' then 'bonus' else 'paid' end);
  v_response := p_response || jsonb_build_object('ok',true,'spin',v_spin);
  insert into public.slot_request_receipts
    (id,user_id,request_id,game,action,request_payload,response,created_at)
  values(v_id,p_user_id,p_request_id,p_game,p_action,p_payload,v_response,v_created_at);
  return v_response;
end;
$$;

revoke all on function public.get_slot_request_receipt(uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.get_slot_request_history(uuid,integer,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.settle_slot_request_atomic(uuid,uuid,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.get_slot_request_receipt(uuid,uuid,text,jsonb) to service_role;
grant execute on function public.get_slot_request_history(uuid,integer,timestamptz,uuid) to service_role;
grant execute on function public.settle_slot_request_atomic(uuid,uuid,text,text,jsonb,jsonb,jsonb) to service_role;
