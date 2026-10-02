-- Keep level deletion safe even when a client bypasses the editor's checks.
-- Property deletion still uses the existing foreign-key cascades.
drop policy levels_delete on public.levels;

create function public.delete_empty_level(lid uuid) returns void
language plpgsql security definer set search_path=public as $$
declare pid uuid;
begin
  select property_id into pid from public.levels where id = lid;
  if pid is null or not public.can_edit(public.property_org(pid)) then
    raise exception 'Forbidden';
  end if;
  perform pg_advisory_xact_lock(hashtext(pid::text));
  if (select count(*) from public.levels where property_id = pid) <= 1 then
    raise exception 'A property needs at least one level';
  end if;
  if exists (select 1 from public.rooms where level_id = lid)
    or exists (select 1 from public.floor_plans where level_id = lid)
    or exists (select 1 from public.stair_connections where destination_level_id = lid) then
    raise exception 'Remove this level''s spaces, floor plan, and stair connections before deleting it';
  end if;
  delete from public.levels where id = lid;
end $$;
revoke all on function public.delete_empty_level(uuid) from public;
grant execute on function public.delete_empty_level(uuid) to authenticated;

-- Template creation replaces only an empty layout and still needs to remove
-- the backfilled Ground Floor level after direct level deletion is revoked.
alter function public.apply_layout_template(uuid,jsonb) security definer;

-- A stair connection must never survive a space being changed to another type.
create function public.keep_stair_connection_consistent() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.space_type <> 'stairs' then
    delete from public.stair_connections where space_id = new.id;
  elsif exists (select 1 from public.stair_connections where space_id = new.id and destination_level_id = new.level_id) then
    raise exception 'Stairs cannot connect a level to itself';
  end if;
  return new;
end $$;
create trigger room_stair_consistency after update of space_type, level_id on public.rooms
for each row execute function public.keep_stair_connection_consistent();
