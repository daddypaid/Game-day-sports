revoke all privileges on table public.blackjack_hands from anon, authenticated;
grant select (id, stake, status, payout, player_total, dealer_total, created_at, settled_at) on table public.blackjack_hands to authenticated;
