-- Open room boundaries participate in topology but cannot host physical openings.
create function public.validate_physical_opening_hosts() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if exists(select 1 from jsonb_array_elements(new.graph->'openings') o
    join jsonb_array_elements(new.graph->'walls') w on w->>'id'=o->>'wall_id'
    where w->>'kind'='virtual') then raise exception 'An opening requires a physical wall, not an open room boundary'; end if;
  return new;
end $$;
create trigger physical_opening_host_guard before insert or update of graph on public.layout_graphs
for each row execute function public.validate_physical_opening_hosts();
