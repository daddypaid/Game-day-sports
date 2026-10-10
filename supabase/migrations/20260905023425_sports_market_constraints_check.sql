alter table public.sports_markets drop constraint if exists sports_markets_market_type_check;
alter table public.sports_markets add constraint sports_markets_market_type_check check (market_type in ('game','prop','future'));
alter table public.sports_markets drop constraint if exists sports_markets_status_check;
alter table public.sports_markets add constraint sports_markets_status_check check (status in ('open','suspended','closed'));
alter table public.sports_events drop constraint if exists sports_events_status_check;
alter table public.sports_events add constraint sports_events_status_check check (status in ('scheduled','live','final','cancelled','postponed'));
