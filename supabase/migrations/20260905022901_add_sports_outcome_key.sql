alter table public.sports_outcomes add column if not exists outcome_key text;
update public.sports_outcomes set outcome_key = md5(outcome_name || '|' || coalesce(description,'')) where outcome_key is null;
alter table public.sports_outcomes alter column outcome_key set not null;
create unique index if not exists sports_outcomes_market_key_idx on public.sports_outcomes (market_id, outcome_key);
