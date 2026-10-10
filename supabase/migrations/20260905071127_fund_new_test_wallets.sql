create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email));

  insert into public.wallets (user_id, balance)
  values (new.id, 1000);

  insert into public.wallet_transactions(user_id, wager_id, transaction_type, amount, balance_after, note)
  values (new.id, null, 'adjustment', 1000, 1000, 'Initial GameDay test credits');

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to postgres, service_role;
