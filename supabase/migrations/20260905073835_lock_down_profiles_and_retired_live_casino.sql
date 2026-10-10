revoke all on table public.live_casino_games from anon, authenticated;
revoke all on table public.live_casino_sessions from anon, authenticated;

revoke all on table public.profiles from anon, authenticated;
grant select, update on table public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
for select to authenticated
using ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);
