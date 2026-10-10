create or replace function public.capture_sports_outcome_history()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.point is distinct from old.point or new.american_odds is distinct from old.american_odds then
    insert into public.sports_line_history(outcome_id, point, american_odds, source_book_count)
    values (new.id, new.point, new.american_odds, new.source_book_count);
  end if;
  return new;
end;
$$;

drop trigger if exists sports_outcomes_history_trg on public.sports_outcomes;
create trigger sports_outcomes_history_trg
after insert or update of point, american_odds on public.sports_outcomes
for each row execute function public.capture_sports_outcome_history();
