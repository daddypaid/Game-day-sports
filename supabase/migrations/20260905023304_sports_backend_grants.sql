grant usage on schema public to service_role;
grant select, insert, update, delete on public.sports_events, public.sports_markets, public.sports_outcomes, public.sports_line_history, public.sports_provider_snapshots to service_role;
grant usage, select on all sequences in schema public to service_role;
