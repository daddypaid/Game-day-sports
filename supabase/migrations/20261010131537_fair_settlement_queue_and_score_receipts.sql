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

revoke all on function public.settle_test_wager_auto_atomic(uuid,text,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.settle_test_wager_auto_atomic(uuid,text,numeric,jsonb) to service_role;

-- Internal grading state. It never contains a guessed result or authorizes a refund.
create table public.test_wager_settlement_checks (
  wager_id uuid primary key references public.wagers(id) on delete cascade,
  next_check_at timestamptz not null default now(),
  processing_token uuid,
  lease_until timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  last_checked_at timestamptz,
  last_outcome text check (last_outcome in ('waiting','provider_error','review','settled','error')),
  review_required boolean not null default false,
  review_reason text,
  constraint settlement_lease_pair check ((processing_token is null) = (lease_until is null))
);
create index test_wager_settlement_checks_due_idx
  on public.test_wager_settlement_checks(next_check_at, wager_id);
create index wagers_open_test_settlement_age_idx
  on public.wagers(placed_at, id) where is_test and status in ('pending','accepted');

-- Retain authoritative completed scores while other parlay legs are still running.
-- The provider only exposes completed scores for the preceding three days.
create table public.test_wager_final_scores (
  sport_key text not null,
  provider_event_id text not null,
  game jsonb not null,
  captured_at timestamptz not null default now(),
  primary key(sport_key, provider_event_id),
  check ((jsonb_typeof(game) = 'object' and game->'completed' = 'true'::jsonb) is true),
  check ((game->>'id' = provider_event_id) is true)
);
alter table public.test_wager_settlement_checks enable row level security;
alter table public.test_wager_final_scores enable row level security;
revoke all on public.test_wager_settlement_checks, public.test_wager_final_scores from public, anon, authenticated;
grant select, insert, update, delete on public.test_wager_settlement_checks, public.test_wager_final_scores to service_role;

create function public.enqueue_test_wager_settlement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_test and new.status in ('pending','accepted') then
    insert into public.test_wager_settlement_checks(wager_id, next_check_at)
      values(new.id, coalesce(new.placed_at, now())) on conflict(wager_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.enqueue_test_wager_settlement() from public, anon, authenticated;
create trigger enqueue_test_wager_settlement
  after insert or update of status, is_test on public.wagers
  for each row execute function public.enqueue_test_wager_settlement();
insert into public.test_wager_settlement_checks(wager_id, next_check_at)
  select id, coalesce(placed_at, now()) from public.wagers
  where is_test and status in ('pending','accepted') on conflict(wager_id) do nothing;

-- Reserve half for the newest due tickets and half for the oldest due work.
-- This protects fresh tickets even when an untouched backlog is only hours old.
-- Unused places are refilled; due-time ordering rotates unresolved retries.
-- SKIP LOCKED and the lease keep overlapping jobs from sharing work.
create function public.claim_test_wager_settlement_batch(p_processing_token uuid, p_limit integer default 100)
returns table(wager_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit,100),100));
  v_ids uuid[] := '{}';
  v_more uuid[];
  v_bucket integer;
begin
  if p_processing_token is null then raise exception 'Processing token is required'; end if;
  for v_bucket in 0..2 loop
    select coalesce(array_agg(candidate.wager_id),'{}'::uuid[]) into v_more from (
      select q.wager_id from public.test_wager_settlement_checks q
      join public.wagers w on w.id = q.wager_id
      where w.is_test and w.status in ('pending','accepted')
        and q.next_check_at <= now()
        and (q.lease_until is null or q.lease_until <= now())
        and not(q.wager_id = any(v_ids))
      order by case when v_bucket = 0 then w.placed_at end desc nulls last,
        q.next_check_at, q.wager_id
      limit case when v_bucket = 2 then v_limit-cardinality(v_ids)
        when v_bucket = 0 then (v_limit+1)/2 else v_limit/2 end
      for update of q skip locked
    ) candidate;
    v_ids := v_ids || v_more;
  end loop;
  update public.test_wager_settlement_checks q
  set processing_token = p_processing_token, lease_until = now()+interval '130 seconds',
      next_check_at = now()+interval '5 minutes', last_attempt_at = now(),
      attempt_count = attempt_count+1
  where q.wager_id = any(v_ids);
  return query select unnest(v_ids);
end $$;

-- Finishing a check and crediting a fully graded wager happen in one transaction.
-- Replays and expired workers cannot issue another credit. The existing atomic
-- grader retains its complete-leg validation, wager lock and wallet lock.
create function public.finish_test_wager_settlement_check(
  p_wager_id uuid, p_processing_token uuid, p_outcome text, p_reason text default null,
  p_result text default null, p_credit numeric default null, p_grades jsonb default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_check public.test_wager_settlement_checks%rowtype;
  v_settlement jsonb;
begin
  if p_processing_token is null or p_outcome is null
    or p_outcome not in ('waiting','provider_error','review','settled','error') then
    raise exception 'Invalid settlement check outcome';
  end if;
  select * into v_check from public.test_wager_settlement_checks
    where wager_id = p_wager_id for update;
  if not found or v_check.processing_token is distinct from p_processing_token
    or v_check.lease_until <= now() then
    return jsonb_build_object('applied',false,'reason','lease_not_owned');
  end if;
  if p_outcome = 'settled' then
    select to_jsonb(s) into v_settlement
      from public.settle_test_wager_auto_atomic(p_wager_id,p_result,p_credit,p_grades) s;
  end if;
  update public.test_wager_settlement_checks
  set processing_token = null, lease_until = null, last_checked_at = now(),
      last_outcome = p_outcome,
      review_required = case when p_outcome = 'settled' then false
        when p_outcome in ('review','error') then true else review_required end,
      review_reason = case when p_outcome = 'settled' then null
        when p_outcome in ('review','error') then left(coalesce(p_reason,'unresolved'),120) else review_reason end,
      next_check_at = now()+case when p_outcome = 'review' then interval '6 hours'
        when p_reason = 'job_budget_reached' then interval '1 minute' else interval '5 minutes' end
  where wager_id = p_wager_id;
  return jsonb_build_object('applied',true,'settlement',v_settlement);
end $$;

create function public.get_test_wager_settlement_health()
returns jsonb language sql stable security definer set search_path = '' as $$
  with pending as (
    select w.placed_at, q.* from public.wagers w
    join public.test_wager_settlement_checks q on q.wager_id = w.id
    where w.is_test and w.status in ('pending','accepted')
  ), reasons as (
    select review_reason, count(*) as count from pending where review_required group by review_reason
  )
  select jsonb_build_object(
    'pending_count', (select count(*) from pending),
    'review_required_count', (select count(*) from pending where review_required),
    'unchecked_count', (select count(*) from pending where last_checked_at is null),
    'retry_due_count', (select count(*) from pending where next_check_at <= now() and (lease_until is null or lease_until <= now())),
    'active_lease_count', (select count(*) from pending where lease_until > now()),
    'provider_error_count', (select count(*) from pending where last_outcome = 'provider_error'),
    'check_error_count', (select count(*) from pending where last_outcome = 'error'),
    'oldest_unresolved_at', (select min(placed_at) from pending),
    'oldest_checked_at', (select min(last_checked_at) from pending),
    'last_check_at', (select max(last_checked_at) from public.test_wager_settlement_checks),
    'last_attempt_at', (select max(last_attempt_at) from public.test_wager_settlement_checks),
    'last_success_at', (select max(last_checked_at) from public.test_wager_settlement_checks where last_outcome = 'settled'),
    'max_pending_age_seconds', coalesce((select greatest(0, extract(epoch from now()-min(placed_at)))::bigint from pending),0),
    'review_reasons', coalesce((select jsonb_object_agg(review_reason,count) from reasons),'{}'::jsonb)
  );
$$;

revoke all on function public.claim_test_wager_settlement_batch(uuid,integer),
  public.finish_test_wager_settlement_check(uuid,uuid,text,text,text,numeric,jsonb),
  public.get_test_wager_settlement_health() from public, anon, authenticated;
grant execute on function public.claim_test_wager_settlement_batch(uuid,integer),
  public.finish_test_wager_settlement_check(uuid,uuid,text,text,text,numeric,jsonb),
  public.get_test_wager_settlement_health() to service_role;
comment on function public.get_test_wager_settlement_health() is
  'Service-only grading backlog health. Review flags require operator investigation; age alone does not imply a finished or cancelled event.';
