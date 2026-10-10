revoke all on function public.play_themed_slot_paid_spin_atomic(uuid,text,numeric,jsonb,numeric,text,numeric,integer) from public, anon, authenticated;
grant execute on function public.play_themed_slot_paid_spin_atomic(uuid,text,numeric,jsonb,numeric,text,numeric,integer) to service_role;

revoke all on function public.settle_themed_bonus_spin_atomic(uuid,uuid,jsonb,numeric,text) from public, anon, authenticated;
grant execute on function public.settle_themed_bonus_spin_atomic(uuid,uuid,jsonb,numeric,text) to service_role;
