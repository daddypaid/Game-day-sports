-- Durable, service-only monitoring. Payloads contain health aggregates only.
create table public.operator_monitor_job_secret (
  singleton boolean primary key default true check(singleton),
  secret text not null check(length(secret) >= 64)
);
insert into public.operator_monitor_job_secret(singleton,secret)
values (true,replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''));
create table public.operator_monitor_delivery_config (
  singleton boolean primary key default true check(singleton),
  webhook_url text not null,
  signing_secret text not null check(length(signing_secret)>=32),
  configured_at timestamptz not null default now()
);
create table public.operator_monitor_checks (
  check_key text primary key check(check_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  status text not null check(status in ('healthy','stale','degraded')),
  incident_number integer not null default 0,
  last_observed_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create table public.operator_alert_outbox (
  id uuid primary key default gen_random_uuid(),
  check_key text not null references public.operator_monitor_checks(check_key),
  incident_number integer not null,
  event_type text not null check(event_type in ('opened','changed','recovered')),
  health_status text not null check(health_status in ('healthy','stale','degraded')),
  payload jsonb not null,
  state text not null default 'pending' check(state in ('pending','delivered','dead')),
  attempts integer not null default 0 check(attempts between 0 and 8),
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  leased_until timestamptz,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error_code text,
  unique(check_key,incident_number,event_type,health_status)
);
create index operator_alert_outbox_pending_idx on public.operator_alert_outbox(next_attempt_at,created_at,id) where state='pending';
create table public.operator_monitor_state (
  singleton boolean primary key default true check(singleton),
  checked_at timestamptz not null,
  overall_status text not null check(overall_status in ('healthy','attention','degraded')),
  delivery_configured boolean not null,
  delivered_count integer not null default 0,
  failed_count integer not null default 0
);

alter table public.operator_monitor_job_secret enable row level security;
alter table public.operator_monitor_delivery_config enable row level security;
alter table public.operator_monitor_checks enable row level security;
alter table public.operator_alert_outbox enable row level security;
alter table public.operator_monitor_state enable row level security;
revoke all on public.operator_monitor_job_secret,public.operator_monitor_delivery_config,public.operator_monitor_checks,public.operator_alert_outbox,public.operator_monitor_state from public,anon,authenticated;
grant select,insert,update,delete on public.operator_monitor_job_secret,public.operator_monitor_delivery_config,public.operator_monitor_checks,public.operator_alert_outbox,public.operator_monitor_state to service_role;

create or replace function public.configure_operator_alert_delivery(p_webhook_url text,p_signing_secret text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_webhook_url is null or p_webhook_url !~ '^https://[a-zA-Z0-9][a-zA-Z0-9.-]+(:[0-9]+)?(/|$)' or p_webhook_url ~ '[#@]' or length(p_webhook_url)>2048 or p_signing_secret is null or length(p_signing_secret)<32 then raise exception 'Invalid alert delivery configuration'; end if;
  insert into public.operator_monitor_delivery_config(singleton,webhook_url,signing_secret) values(true,p_webhook_url,p_signing_secret)
  on conflict(singleton) do update set webhook_url=excluded.webhook_url,signing_secret=excluded.signing_secret,configured_at=now();
  return true;
end; $$;

create or replace function public.record_operator_health_alerts(p_checks jsonb,p_observed_at timestamptz)
returns integer language plpgsql security invoker set search_path='' as $$
declare c jsonb; old public.operator_monitor_checks%rowtype; new_status text; k text; incident integer; kind text; enqueued integer:=0; inserted integer;
begin
  if p_checks is null or jsonb_typeof(p_checks) <> 'array' or jsonb_array_length(p_checks)>64 then raise exception 'Invalid health checks'; end if;
  if p_observed_at is null or p_observed_at > now()+interval '5 minutes' then raise exception 'Invalid health observation time'; end if;
  for c in select value from jsonb_array_elements(p_checks) loop
    k:=c->>'key'; new_status:=c->>'status';
    if k is null or k !~ '^[a-z][a-z0-9_]{0,63}$' or new_status not in ('healthy','stale','degraded') or c->'measured' is distinct from 'true'::jsonb then raise exception 'Invalid measured health check'; end if;
    -- Serialize concurrent collectors for this check even before its first row.
    perform pg_advisory_xact_lock(hashtextextended('operator-health:'||k,0));
    select * into old from public.operator_monitor_checks where check_key=k for update;
    if found and old.last_observed_at >= p_observed_at then continue; end if;
    incident:=coalesce(old.incident_number,0); kind:=null;
    if new_status<>'healthy' and (old.check_key is null or old.status='healthy') then incident:=incident+1; kind:='opened';
    elsif old.check_key is not null and old.status<>'healthy' and new_status='healthy' then kind:='recovered';
    elsif old.check_key is not null and old.status<>new_status then kind:='changed'; end if;
    insert into public.operator_monitor_checks(check_key,status,incident_number,last_observed_at)
    values(k,new_status,incident,p_observed_at)
    on conflict(check_key) do update set status=excluded.status,incident_number=excluded.incident_number,last_observed_at=excluded.last_observed_at,updated_at=now();
    if kind is not null then
      insert into public.operator_alert_outbox(check_key,incident_number,event_type,health_status,payload)
      values(k,incident,kind,new_status,jsonb_build_object('mode','TEST MODE','check_key',k,'incident_number',incident,'event_type',kind,'status',new_status,'detail',left(coalesce(c->>'detail',''),500),'observed_at',p_observed_at))
      on conflict(check_key,incident_number,event_type,health_status) do nothing;
      get diagnostics inserted=row_count; enqueued:=enqueued+inserted;
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
    and not exists (
      select 1 from public.operator_alert_outbox earlier where earlier.check_key=o.check_key and earlier.state='pending'
      and (earlier.created_at,earlier.id)<(o.created_at,o.id)
    )
    order by o.created_at,o.id for update skip locked limit greatest(1,least(coalesce(p_limit,20),20))
  ), claimed as (
    update public.operator_alert_outbox o set attempts=o.attempts+1,lease_id=gen_random_uuid(),leased_until=now()+interval '3 minutes'
    from picked where o.id=picked.id returning o.id,o.lease_id,o.payload,o.attempts
  ) select id,lease_id,payload,attempts from claimed;
$$;

create or replace function public.finish_operator_alert(p_alert_id uuid,p_lease_id uuid,p_delivered boolean,p_error_code text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  update public.operator_alert_outbox
  set state=case when p_delivered then 'delivered' when attempts>=8 then 'dead' else 'pending' end,
      delivered_at=case when p_delivered then now() else null end,
      next_attempt_at=case when p_delivered then next_attempt_at else now()+make_interval(secs=>least(3600,15*power(2,attempts-1))::integer) end,
      leased_until=null,lease_id=null,
      last_error_code=case when p_delivered then null when p_error_code ~ '^(http_[0-9]{3}|timeout|network_error|invalid_config|delivery_unknown)$' then p_error_code else 'delivery_unknown' end
  where id=p_alert_id and lease_id=p_lease_id and state='pending';
  get diagnostics changed=row_count; return changed=1;
end; $$;

create or replace function public.retry_operator_alert(p_alert_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  update public.operator_alert_outbox set state='pending',attempts=0,next_attempt_at=now(),lease_id=null,leased_until=null,last_error_code=null
  where id=p_alert_id and state='dead';
  get diagnostics changed=row_count;return changed=1;
end; $$;

create or replace function public.get_operator_alert_health()
returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object(
    'pending_count',count(*) filter(where state='pending'),
    'dead_count',count(*) filter(where state='dead'),
    'delivered_count_24h',count(*) filter(where state='delivered' and delivered_at>=now()-interval '24 hours'),
    'last_delivery_at',max(delivered_at),
    'max_pending_age_seconds',coalesce(extract(epoch from now()-min(created_at) filter(where state='pending')),0),
    'last_monitor_at',(select checked_at from public.operator_monitor_state where singleton),
    'delivery_configured',coalesce((select delivery_configured from public.operator_monitor_state where singleton),false)
  ) from public.operator_alert_outbox;
$$;

revoke all on function public.configure_operator_alert_delivery(text,text),public.record_operator_health_alerts(jsonb,timestamptz),public.claim_operator_alerts(integer),public.finish_operator_alert(uuid,uuid,boolean,text),public.retry_operator_alert(uuid),public.get_operator_alert_health() from public,anon,authenticated;
grant execute on function public.configure_operator_alert_delivery(text,text),public.record_operator_health_alerts(jsonb,timestamptz),public.claim_operator_alerts(integer),public.finish_operator_alert(uuid,uuid,boolean,text),public.retry_operator_alert(uuid),public.get_operator_alert_health() to service_role;
