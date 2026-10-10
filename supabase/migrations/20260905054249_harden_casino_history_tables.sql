revoke all privileges on table public.roulette_spins from anon, authenticated;
revoke all privileges on table public.baccarat_rounds from anon, authenticated;
revoke all privileges on table public.slot_spins from anon, authenticated;
grant select on table public.roulette_spins to authenticated;
grant select on table public.baccarat_rounds to authenticated;
grant select on table public.slot_spins to authenticated;
