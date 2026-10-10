-- Owner-scoped settled history uses a deterministic (created_at,id) keyset.
-- These indexes grant no new browser access to table rows or private game state.
create index if not exists blackjack_settled_history_idx
  on public.blackjack_hands(user_id,created_at desc,id desc)
  where is_test = true and status <> 'active' and settled_at is not null;
create index if not exists baccarat_settled_history_idx
  on public.baccarat_rounds(user_id,created_at desc,id desc) where is_test = true;
create index if not exists roulette_settled_history_idx
  on public.roulette_spins(user_id,created_at desc,id desc) where is_test = true;
create index if not exists video_poker_settled_history_idx
  on public.video_poker_hands(user_id,game,created_at desc,id desc)
  where is_test = true and status = 'settled' and settled_at is not null;
create index if not exists poker_settled_history_idx
  on public.poker_test_hands(user_id,game,created_at desc,id desc)
  where is_test = true and status = 'settled' and settled_at is not null;
