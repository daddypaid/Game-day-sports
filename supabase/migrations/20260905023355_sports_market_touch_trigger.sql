create or replace function public.touch_sports_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sports_events_touch_updated_at on public.sports_events;
create trigger sports_events_touch_updated_at before update on public.sports_events for each row execute function public.touch_sports_updated_at();
drop trigger if exists sports_markets_touch_updated_at on public.sports_markets;
create trigger sports_markets_touch_updated_at before update on public.sports_markets for each row execute function public.touch_sports_updated_at();
drop trigger if exists sports_outcomes_touch_updated_at on public.sports_outcomes;
create trigger sports_outcomes_touch_updated_at before update on public.sports_outcomes for each row execute function public.touch_sports_updated_at();
revoke execute on function public.touch_sports_updated_at() from public, anon, authenticated;
grant execute on function public.touch_sports_updated_at() to service_role;
