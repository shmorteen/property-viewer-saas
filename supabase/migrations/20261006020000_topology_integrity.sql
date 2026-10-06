-- Clients cannot mutate derived indoor room polygons without synchronizing their wall graph.
drop policy polygons_insert on public.room_polygons;
drop policy polygons_update on public.room_polygons;
drop policy polygons_delete on public.room_polygons;
create policy polygons_insert on public.room_polygons for insert to authenticated
with check (public.can_edit(public.room_org(room_id)) and not topology_managed and
  (exists(select 1 from public.rooms r where r.id = room_id and r.category = 'outdoor') or
   exists(select 1 from public.levels l where l.id = level_id and l.geometry_mode = 'legacy')));
create policy polygons_update on public.room_polygons for update to authenticated
using (public.can_edit(public.room_org(room_id)) and not topology_managed)
with check (public.can_edit(public.room_org(room_id)) and not topology_managed);
create policy polygons_delete on public.room_polygons for delete to authenticated
using (public.can_edit(public.room_org(room_id)) and not topology_managed);

alter table public.property_boundaries add constraint property_boundary_points_valid
check (points = '[]'::jsonb or public.valid_polygon(points));

-- The graph RPC is the only write route. Validate JSON geometry again on the server.
alter function public.save_layout_graph(uuid, jsonb, jsonb) rename to save_layout_graph_base;
revoke all on function public.save_layout_graph_base(uuid, jsonb, jsonb) from public, authenticated;
create function public.save_layout_graph(lid uuid, payload jsonb, derived_rooms jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  region jsonb;
  opening jsonb;
  wall jsonb;
  a jsonb;
  b jsonb;
  dx numeric;
  dy numeric;
begin
  if jsonb_typeof(payload) <> 'object' or jsonb_typeof(payload->'property_boundary') <> 'array' or
     jsonb_typeof(payload->'building_boundary') <> 'array' or jsonb_typeof(payload->'vertices') <> 'array' or
     jsonb_typeof(payload->'walls') <> 'array' or jsonb_typeof(payload->'rooms') <> 'array' or
     jsonb_typeof(payload->'openings') <> 'array' or jsonb_typeof(derived_rooms) <> 'array' then
    raise exception 'Invalid topology payload';
  end if;
  if payload->'property_boundary' <> '[]'::jsonb and not public.valid_polygon(payload->'property_boundary') then
    raise exception 'Invalid property boundary';
  end if;
  if jsonb_array_length(payload->'walls') > 0 and jsonb_array_length(payload->'building_boundary') < 3 then
    raise exception 'A building needs a closed footprint';
  end if;
  for region in select value from jsonb_array_elements(derived_rooms) loop
    if not public.valid_polygon(region->'points') then raise exception 'Invalid room face'; end if;
  end loop;
  for wall in select value from jsonb_array_elements(payload->'walls') loop
    select value into a from jsonb_array_elements(payload->'vertices') where value->>'id' = wall->>'a' limit 1;
    select value into b from jsonb_array_elements(payload->'vertices') where value->>'id' = wall->>'b' limit 1;
    if a is null or b is null then raise exception 'Wall endpoint is missing'; end if;
    dx := (a->>'x')::numeric - (b->>'x')::numeric;
    dy := (a->>'y')::numeric - (b->>'y')::numeric;
    if dx * dx + dy * dy < .000025 then raise exception 'Wall is too short'; end if;
  end loop;
  for opening in select value from jsonb_array_elements(payload->'openings') loop
    if (opening->>'end')::numeric - (opening->>'start')::numeric < .02 then raise exception 'Opening is too narrow'; end if;
    if exists(select 1 from jsonb_array_elements(payload->'openings') value
      where value->>'id' <> opening->>'id' and value->>'wall_id' = opening->>'wall_id' and
        (value->>'start')::numeric < (opening->>'end')::numeric + .01 and
        (opening->>'start')::numeric < (value->>'end')::numeric + .01) then
      raise exception 'Openings on one wall overlap';
    end if;
  end loop;
  perform public.save_layout_graph_base(lid, payload, derived_rooms);
end $$;
revoke all on function public.save_layout_graph(uuid, jsonb, jsonb) from public;
grant execute on function public.save_layout_graph(uuid, jsonb, jsonb) to authenticated;
