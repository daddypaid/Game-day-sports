create index if not exists sports_provider_snapshots_provider_time_idx on public.sports_provider_snapshots(provider, captured_at desc);
