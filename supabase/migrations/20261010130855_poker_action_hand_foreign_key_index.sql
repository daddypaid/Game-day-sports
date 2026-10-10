-- Support hand deletion/cascade checks without scanning every poker action.
-- Existing (user_id, request_id) primary key does not cover this foreign key.
create index if not exists poker_test_actions_hand_id_idx
  on public.poker_test_actions (hand_id);
