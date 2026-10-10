create unique index if not exists blackjack_one_active_hand_per_user
on public.blackjack_hands(user_id)
where status = 'active';
