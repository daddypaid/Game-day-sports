-- Reconcile columns previously created outside recorded migration history.
-- The current insurance-aware v3 RPC is intentionally preserved.
alter table public.blackjack_hands
  add column if not exists player_hands jsonb,
  add column if not exists active_hand_index integer;
