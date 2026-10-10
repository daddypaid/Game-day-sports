-- Preserve every measured state transition and order notifications causally.
-- UUIDs are delivery identities; wall-clock transaction start time is not order.
lock table public.operator_monitor_checks,public.operator_alert_outbox in access exclusive mode;
alter table public.operator_monitor_checks add column transition_sequence bigint not null default 0 check(transition_sequence>=0);
alter table public.operator_alert_outbox add column transition_sequence bigint;

-- The previous recorder accepted strictly increasing observed_at per check.
-- Recover that order from its typed observation timestamp, not now()/random UUID.
with ordered as (
  select id,row_number() over(partition by check_key order by
    coalesce((payload->>'observed_at')::timestamptz,created_at),
    incident_number,case event_type when 'opened' then 0 when 'changed' then 1 else 2 end,id
  ) as sequence from public.operator_alert_outbox
)
update public.operator_alert_outbox o set transition_sequence=ordered.sequence,
  payload=o.payload||jsonb_build_object('transition_sequence',ordered.sequence)
from ordered where o.id=ordered.id;
update public.operator_monitor_checks c set transition_sequence=coalesce((select max(o.transition_sequence) from public.operator_alert_outbox o where o.check_key=c.check_key),0);
alter table public.operator_alert_outbox alter column transition_sequence set not null;
alter table public.operator_alert_outbox add constraint operator_alert_positive_transition check(transition_sequence>0);

do $$
declare old_constraint text;
begin
  select conname into old_constraint from pg_constraint
  where conrelid='public.operator_alert_outbox'::regclass and contype='u'
  and pg_get_constraintdef(oid)='UNIQUE (check_key, incident_number, event_type, health_status)';
  if old_constraint is null then raise exception 'Previous alert deduplication constraint is missing'; end if;
  execute format('alter table public.operator_alert_outbox drop constraint %I',old_constraint);
end; $$;
alter table public.operator_alert_outbox add constraint operator_alert_check_transition_unique unique(check_key,transition_sequence);

-- If the former unique constraint dropped a later repeated status, preserve the
-- existing IDs/history and enqueue the current measured state as a correction.
do $$
declare c record; transition bigint; kind text;
begin
  for c in
    select checks.*,latest.health_status as last_status
    from public.operator_monitor_checks checks
    left join lateral(select health_status from public.operator_alert_outbox where check_key=checks.check_key order by transition_sequence desc limit 1) latest on true
    where checks.status is distinct from latest.health_status and (latest.health_status is not null or checks.status<>'healthy')
  loop
    transition:=c.transition_sequence+1;
    kind:=case when c.status='healthy' then 'recovered' when c.last_status is null then 'opened' else 'changed' end;
    update public.operator_monitor_checks set transition_sequence=transition,incident_number=greatest(incident_number,1) where check_key=c.check_key;
    insert into public.operator_alert_outbox(check_key,incident_number,event_type,health_status,transition_sequence,payload)
    values(c.check_key,greatest(c.incident_number,1),kind,c.status,transition,jsonb_build_object(
      'mode','TEST MODE','check_key',c.check_key,'incident_number',greatest(c.incident_number,1),'event_type',kind,'status',c.status,
      'detail','Current measured status reconciled after alert transition sequencing repair.','observed_at',c.last_observed_at,'transition_sequence',transition
    ));
  end loop;
end; $$;

create or replace function public.record_operator_health_alerts(p_checks jsonb,p_observed_at timestamptz)
returns integer language plpgsql security invoker set search_path='' as $$
declare c jsonb; old public.operator_monitor_checks%rowtype; new_status text; k text; incident integer; kind text; enqueued integer:=0; next_transition bigint;
begin
  if p_checks is null or jsonb_typeof(p_checks)<>'array' or jsonb_array_length(p_checks)>64 then raise exception 'Invalid health checks'; end if;
  if p_observed_at is null or p_observed_at>now()+interval '5 minutes' then raise exception 'Invalid health observation time'; end if;
  for c in select value from jsonb_array_elements(p_checks) loop
    k:=c->>'key';new_status:=c->>'status';
    if k is null or k !~ '^[a-z][a-z0-9_]{0,63}$' or new_status not in ('healthy','stale','degraded') or c->'measured' is distinct from 'true'::jsonb then raise exception 'Invalid measured health check'; end if;
    perform pg_advisory_xact_lock(hashtextextended('operator-health:'||k,0));
    select * into old from public.operator_monitor_checks where check_key=k for update;
    if found and old.last_observed_at>=p_observed_at then continue; end if;
    incident:=coalesce(old.incident_number,0);kind:=null;next_transition:=coalesce(old.transition_sequence,0);
    if new_status<>'healthy' and (old.check_key is null or old.status='healthy') then incident:=incident+1;kind:='opened';
    elsif old.check_key is not null and old.status<>'healthy' and new_status='healthy' then kind:='recovered';
    elsif old.check_key is not null and old.status<>new_status then kind:='changed';end if;
    if kind is not null then next_transition:=next_transition+1;end if;
    insert into public.operator_monitor_checks(check_key,status,incident_number,last_observed_at,transition_sequence)
    values(k,new_status,incident,p_observed_at,next_transition)
    on conflict(check_key) do update set status=excluded.status,incident_number=excluded.incident_number,last_observed_at=excluded.last_observed_at,transition_sequence=excluded.transition_sequence,updated_at=now();
    if kind is not null then
      insert into public.operator_alert_outbox(check_key,incident_number,event_type,health_status,transition_sequence,payload)
      values(k,incident,kind,new_status,next_transition,jsonb_build_object('mode','TEST MODE','check_key',k,'incident_number',incident,'event_type',kind,'status',new_status,'detail',left(coalesce(c->>'detail',''),500),'observed_at',p_observed_at,'transition_sequence',next_transition));
      enqueued:=enqueued+1;
    end if;
  end loop;
  return enqueued;
end; $$;

create or replace function public.claim_operator_alerts(p_limit integer default 20)
returns table(alert_id uuid,lease_id uuid,payload jsonb,attempt integer)
language sql security invoker set search_path='' as $$
  with exhausted as (
    update public.operator_alert_outbox set state='dead',lease_id=null,leased_until=null,last_error_code='delivery_unknown'
    where state='pending' and attempts>=8 and (leased_until is null or leased_until<=now())
  ), picked as (
    select o.id from public.operator_alert_outbox o
    where o.state='pending' and o.next_attempt_at<=now() and (o.leased_until is null or o.leased_until<=now()) and o.attempts<8
    and not exists(select 1 from public.operator_alert_outbox earlier where earlier.check_key=o.check_key and earlier.state='pending' and earlier.transition_sequence<o.transition_sequence)
    order by o.created_at,o.check_key,o.transition_sequence for update skip locked limit greatest(1,least(coalesce(p_limit,20),20))
  ),claimed as (
    update public.operator_alert_outbox o set attempts=o.attempts+1,lease_id=gen_random_uuid(),leased_until=now()+interval '3 minutes'
    from picked where o.id=picked.id returning o.id,o.lease_id,o.payload,o.attempts
  )select id,lease_id,payload,attempts from claimed;
$$;

revoke all on function public.record_operator_health_alerts(jsonb,timestamptz),public.claim_operator_alerts(integer) from public,anon,authenticated;
grant execute on function public.record_operator_health_alerts(jsonb,timestamptz),public.claim_operator_alerts(integer) to service_role;
