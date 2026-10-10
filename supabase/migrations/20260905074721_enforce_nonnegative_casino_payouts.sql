alter table public.blackjack_hands add constraint blackjack_hands_payout_check check (payout >= 0); alter table public.baccarat_rounds add constraint baccarat_rounds_payout_check check (payout >= 0);
