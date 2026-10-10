drop policy if exists users_read_own_themed_bonus_sessions on public.themed_slot_bonus_sessions;
create policy users_read_own_themed_bonus_sessions
on public.themed_slot_bonus_sessions
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists users_read_own_themed_bonus_spins on public.themed_slot_bonus_spins;
create policy users_read_own_themed_bonus_spins
on public.themed_slot_bonus_spins
for select
to authenticated
using ((select auth.uid()) = user_id);

create index if not exists themed_slot_bonus_spins_user_id_idx
on public.themed_slot_bonus_spins (user_id);
