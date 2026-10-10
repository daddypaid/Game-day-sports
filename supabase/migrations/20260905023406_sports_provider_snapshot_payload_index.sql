create index if not exists sports_provider_snapshots_mode_sport_idx on public.sports_provider_snapshots(mode, sport_key, captured_at desc);
