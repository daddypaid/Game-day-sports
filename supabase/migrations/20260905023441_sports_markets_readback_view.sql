drop view if exists public.current_gameday_lines;
create view public.current_gameday_lines with (security_invoker=true) as
select e.provider_event_id,e.sport_key,e.sport_title,e.commence_time,e.home_team,e.away_team,e.status as event_status,m.provider_market_key,m.market_title,m.market_type,m.status as market_status,o.outcome_name,o.description,o.point,o.american_odds,o.source_book_count,o.is_active,o.updated_at
from public.sports_events e
join public.sports_markets m on m.event_id=e.id
join public.sports_outcomes o on o.market_id=m.id;
revoke all on public.current_gameday_lines from anon,authenticated;
grant select on public.current_gameday_lines to service_role;
