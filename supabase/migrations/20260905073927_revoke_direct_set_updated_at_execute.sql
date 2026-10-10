revoke execute on function public.set_updated_at() from anon, authenticated, public;
grant execute on function public.set_updated_at() to postgres, service_role;
