alter table public.blackjack_hands
add column if not exists shoe jsonb not null default '[]'::jsonb;

alter table public.blackjack_hands
add column if not exists action_count integer not null default 0;
