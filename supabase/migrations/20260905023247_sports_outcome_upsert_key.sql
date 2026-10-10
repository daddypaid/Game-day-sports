alter table public.sports_outcomes add constraint sports_outcomes_market_outcome_key_key unique (market_id, outcome_key);
