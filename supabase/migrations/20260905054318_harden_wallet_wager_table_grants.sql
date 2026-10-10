revoke all privileges on table public.wallets from anon, authenticated;
revoke all privileges on table public.wallet_transactions from anon, authenticated;
revoke all privileges on table public.wagers from anon, authenticated;
revoke all privileges on table public.wager_selections from anon, authenticated;
grant select on table public.wallets to authenticated;
grant select on table public.wallet_transactions to authenticated;
grant select on table public.wagers to authenticated;
grant select on table public.wager_selections to authenticated;
