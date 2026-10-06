-- A property may be opened concurrently by React and multiple browser tabs.
create function public.ensure_default_level(pid uuid) returns public.levels
language plpgsql security definer set search_path = public, pg_temp as $$
declare result public.levels;
begin
  if not public.can_edit(public.property_org(pid)) then raise exception 'Forbidden'; end if;
  perform 1 from public.properties where id = pid for update;
  select * into result from public.levels where property_id = pid order by sort_order, created_at limit 1;
  if result.id is null then
    insert into public.levels(property_id, name, level_type, sort_order, elevation)
    values(pid, 'Ground Floor', 'ground', 0, 0) returning * into result;
  end if;
  return result;
end $$;
revoke all on function public.ensure_default_level(uuid) from public;
grant execute on function public.ensure_default_level(uuid) to authenticated;

create or replace function public.delete_empty_level(lid uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare pid uuid;
begin
  select property_id into pid from public.levels where id = lid;
  if pid is null or not public.can_edit(public.property_org(pid)) then raise exception 'Forbidden'; end if;
  perform pg_advisory_xact_lock(hashtext(pid::text));
  if (select count(*) from public.levels where property_id = pid) <= 1 then raise exception 'A property needs at least one level'; end if;
  if exists(select 1 from public.rooms where level_id = lid)
    or exists(select 1 from public.floor_plans where level_id = lid)
    or exists(select 1 from public.stair_connections where destination_level_id = lid)
    or exists(select 1 from public.layout_graphs where level_id = lid) then
    raise exception 'Remove this level''s rooms, floor plan, stair connections, and topology before deleting it';
  end if;
  delete from public.levels where id = lid;
end $$;

-- Starter templates must not silently remove a boundary-only topology layout.
alter function public.apply_layout_template(uuid, jsonb) rename to apply_layout_template_legacy;
revoke all on function public.apply_layout_template_legacy(uuid, jsonb) from public, authenticated;
create function public.apply_layout_template(pid uuid, spec jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.can_edit(public.property_org(pid)) then raise exception 'Forbidden'; end if;
  if exists(select 1 from public.layout_graphs g join public.levels l on l.id = g.level_id where l.property_id = pid) then
    raise exception 'A traced topology layout cannot be replaced by a starter template';
  end if;
  perform public.apply_layout_template_legacy(pid, spec);
  update public.levels set geometry_mode = 'legacy' where property_id = pid;
end $$;
revoke all on function public.apply_layout_template(uuid, jsonb) from public;
grant execute on function public.apply_layout_template(uuid, jsonb) to authenticated;
