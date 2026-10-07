create or replace function public.save_layout_graph_base(lid uuid, payload jsonb, derived_rooms jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pid uuid;
  vertex jsonb;
  wall jsonb;
  opening jsonb;
  region jsonb;
  seen uuid[] := '{}';
  wall_ids uuid[] := '{}';
  room_ids uuid[] := '{}';
  fid uuid;
  count_vertices integer;
  aid uuid;
  bid uuid;
  wid uuid;
  rid uuid;
  x numeric;
  y numeric;
begin
  select property_id into pid from public.levels where id = lid for update;
  if pid is null or not public.can_edit(public.property_org(pid)) then raise exception 'Forbidden'; end if;
  if jsonb_typeof(payload) <> 'object' or jsonb_typeof(payload->'vertices') <> 'array' or
     jsonb_typeof(payload->'walls') <> 'array' or jsonb_typeof(payload->'building_boundary') <> 'array' or
     jsonb_typeof(payload->'rooms') <> 'array' or jsonb_typeof(payload->'openings') <> 'array' or
     jsonb_typeof(payload->'property_boundary') <> 'array' or jsonb_typeof(derived_rooms) <> 'array' then
    raise exception 'Invalid topology payload';
  end if;
  if jsonb_array_length(payload->'vertices') > 500 or jsonb_array_length(payload->'walls') > 700 or
     jsonb_array_length(payload->'rooms') > 200 or jsonb_array_length(payload->'openings') > 300 then
    raise exception 'Layout is too large';
  end if;
  for vertex in select value from jsonb_array_elements(payload->'vertices') loop
    fid := (vertex->>'id')::uuid;
    x := (vertex->>'x')::numeric; y := (vertex->>'y')::numeric;
    if fid = any(seen) or x < 0 or x > 1 or y < 0 or y > 1 then raise exception 'Invalid or duplicate vertex'; end if;
    seen := array_append(seen, fid);
  end loop;
  count_vertices := cardinality(seen);
  for wall in select value from jsonb_array_elements(payload->'walls') loop
    wid := (wall->>'id')::uuid; aid := (wall->>'a')::uuid; bid := (wall->>'b')::uuid;
    if wid = any(wall_ids) or aid = bid or not aid = any(seen) or not bid = any(seen) or
       wall->>'kind' not in ('exterior', 'interior', 'virtual') or
       (wall->>'height')::numeric <= 0 or (wall->>'thickness')::numeric <= 0 then
      raise exception 'Invalid wall';
    end if;
    wall_ids := array_append(wall_ids, wid);
  end loop;
  if jsonb_array_length(payload->'building_boundary') > 0 and
     (jsonb_array_length(payload->'building_boundary') < 3 or count_vertices < 3) then raise exception 'Invalid building boundary'; end if;
  for vertex in select value from jsonb_array_elements(payload->'building_boundary') loop
    if not (vertex #>> '{}')::uuid = any(seen) then raise exception 'Building boundary references a missing vertex'; end if;
  end loop;
  for region in select value from jsonb_array_elements(payload->'rooms') loop
    rid := (region->>'room_id')::uuid;
    if rid = any(room_ids) or not exists(select 1 from public.rooms where id = rid and level_id = lid and property_id = pid and category = 'indoor') then
      raise exception 'Room is missing, duplicated, or belongs to another level';
    end if;
    room_ids := array_append(room_ids, rid);
  end loop;
  for opening in select value from jsonb_array_elements(payload->'openings') loop
    if not (opening->>'wall_id')::uuid = any(wall_ids) or
       opening->>'type' not in ('standard_door', 'double_door', 'standard_window', 'wide_window', 'entrance') or
       (opening->>'start')::numeric < (case when opening->>'type' = 'entrance' or coalesce(opening->>'path_id', '') <> '' then 0 else .02 end) or
       (opening->>'end')::numeric > (case when opening->>'type' = 'entrance' or coalesce(opening->>'path_id', '') <> '' then 1 else .98 end) or
       (opening->>'start')::numeric >= (opening->>'end')::numeric or
       (opening->>'height')::numeric <= 0 or (opening->>'sill')::numeric < 0 then
      raise exception 'Invalid wall opening';
    end if;
  end loop;
  for region in select value from jsonb_array_elements(derived_rooms) loop
    rid := (region->>'room_id')::uuid;
    if not rid = any(room_ids) or jsonb_typeof(region->'points') <> 'array' or jsonb_array_length(region->'points') < 3 then
      raise exception 'Invalid derived room polygon';
    end if;
  end loop;
  if cardinality(room_ids) <> jsonb_array_length(derived_rooms) then raise exception 'Every assigned room requires one derived polygon'; end if;
  insert into public.property_boundaries(property_id, points) values(pid, payload->'property_boundary')
    on conflict(property_id) do update set points = excluded.points, updated_at = now();
  insert into public.layout_graphs(level_id, graph) values(lid, payload - 'property_boundary')
    on conflict(level_id) do update set graph = excluded.graph, updated_at = now();
  update public.levels set geometry_mode = 'topology' where id = lid;
  delete from public.room_polygons where level_id = lid and topology_managed and room_id <> all(room_ids);
  for region in select value from jsonb_array_elements(derived_rooms) loop
    rid := (region->>'room_id')::uuid;
    update public.room_polygons set points = region->'points', topology_managed = true where room_id = rid and level_id = lid;
    if not found then
      insert into public.room_polygons(level_id, floor_plan_id, room_id, points, topology_managed)
      values(lid, (select id from public.floor_plans where level_id = lid limit 1), rid, region->'points', true);
    end if;
  end loop;
end $$;
alter table public.stair_connections drop constraint if exists stair_connections_stair_type_check;
alter table public.stair_connections add constraint stair_connections_stair_type_check check (stair_type in ('straight','l_shaped','u_shaped','spiral'));
create or replace function public.save_layout_graph(lid uuid, payload jsonb, derived_rooms jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  region jsonb;
  opening jsonb;
  edge jsonb;
  wall jsonb;
  a jsonb;
  b jsonb;
  dx numeric;
  dy numeric;
  pid uuid;
  actual_width numeric;
begin
  select property_id into pid from public.levels where id = lid;
  if pid is null or not public.can_edit(public.property_org(pid)) then raise exception 'Forbidden'; end if;
  if jsonb_typeof(payload) <> 'object' or jsonb_typeof(payload->'property_boundary') <> 'array' or
     jsonb_typeof(payload->'building_boundary') <> 'array' or jsonb_typeof(payload->'vertices') <> 'array' or
     jsonb_typeof(payload->'walls') <> 'array' or jsonb_typeof(payload->'rooms') <> 'array' or
     jsonb_typeof(payload->'openings') <> 'array' or jsonb_typeof(derived_rooms) <> 'array' then
    raise exception 'Invalid topology payload';
  end if;
  if payload ? 'site_edges' and jsonb_typeof(payload->'site_edges') <> 'array' then
    raise exception 'Invalid site edge metadata';
  end if;
  if jsonb_array_length(coalesce(payload->'site_edges', '[]'::jsonb)) > 500 then
    raise exception 'Too many site edges';
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
    if opening ? 'preset' and opening->>'preset' not in ('narrow','standard','wide','double','custom') then
      raise exception 'Invalid opening preset';
    end if;
    if opening ? 'width_m' then
      if (opening->>'width_m')::numeric < .05 or (opening->>'width_m')::numeric > 10 then
        raise exception 'Invalid opening width';
      end if;
      select value into wall from jsonb_array_elements(payload->'walls') where value->>'id' = opening->>'wall_id' limit 1;
      select value into a from jsonb_array_elements(payload->'vertices') where value->>'id' = wall->>'a' limit 1;
      select value into b from jsonb_array_elements(payload->'vertices') where value->>'id' = wall->>'b' limit 1;
      select sqrt(power(((b->>'x')::numeric - (a->>'x')::numeric) * p.layout_width_m, 2) +
                  power(((b->>'y')::numeric - (a->>'y')::numeric) * p.layout_width_m * l.canvas_height / l.canvas_width, 2))
        into actual_width from public.properties p join public.levels l on l.property_id = p.id
        where p.id = pid and l.id = lid;
      if abs(actual_width * ((opening->>'end')::numeric - (opening->>'start')::numeric) - (opening->>'width_m')::numeric) > .04 then
        raise exception 'Opening width does not match its wall span';
      end if;
    end if;
    if exists(select 1 from jsonb_array_elements(payload->'openings') value
      where value->>'id' <> opening->>'id' and value->>'wall_id' = opening->>'wall_id' and
        (value->>'start')::numeric < (opening->>'end')::numeric + .01 and
        (opening->>'start')::numeric < (value->>'end')::numeric + .01) then
      raise exception 'Openings on one wall overlap';
    end if;
  end loop;
  for edge in select value from jsonb_array_elements(coalesce(payload->'site_edges', '[]'::jsonb)) loop
    if edge->>'behavior' not in ('wall','open','railing','parapet') or
       (edge->>'height')::numeric < 0 or (edge->>'height')::numeric > 4 or
       (edge->>'thickness')::numeric <= 0 or (edge->>'thickness')::numeric > .5 or
       not exists(select 1 from public.rooms r join public.room_polygons rp on rp.room_id = r.id
         where r.id = (edge->>'room_id')::uuid and r.property_id = pid and r.level_id = lid and r.category = 'outdoor'
           and (edge->>'segment_index')::integer >= 0 and (edge->>'segment_index')::integer < jsonb_array_length(rp.points)) then
      raise exception 'Invalid outdoor edge';
    end if;
    if exists(select 1 from jsonb_array_elements(coalesce(payload->'site_edges', '[]'::jsonb)) value
      where value <> edge and value->>'room_id' = edge->>'room_id' and value->>'segment_index' = edge->>'segment_index') then
      raise exception 'Duplicate outdoor edge';
    end if;
  end loop;
  perform public.save_layout_graph_base(lid, payload, derived_rooms);
end $$;

-- Stair features live in the level's topology graph, beside walls and openings.
-- This guard keeps source/destination ownership and dimensions valid without
-- changing legacy stair_connections or room IDs.
create or replace function public.validate_layout_stairs()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  stair jsonb;
  source_level public.levels%rowtype;
  destination public.levels%rowtype;
begin
  if jsonb_typeof(coalesce(new.graph->'stairs', '[]'::jsonb)) <> 'array' or
     jsonb_array_length(coalesce(new.graph->'stairs', '[]'::jsonb)) > 100 then
    raise exception 'Invalid stair feature list';
  end if;
  select * into source_level from public.levels where id = new.level_id;
  for stair in select value from jsonb_array_elements(coalesce(new.graph->'stairs', '[]'::jsonb)) loop
    if not (stair ?& array['id','source_level_id','destination_level_id','type','footprint','width_m','total_rise_m','direction','step_count','railing_height_m']) or
       stair->>'source_level_id' <> new.level_id::text or
       stair->>'type' not in ('straight','l_shaped','u_shaped','spiral') or
       stair->>'direction' not in ('north','east','south','west') or
       jsonb_typeof(stair->'footprint') <> 'array' or
       jsonb_array_length(stair->'footprint') <> 4 or
       not public.valid_polygon(stair->'footprint') or
       (stair->>'width_m')::numeric not between .6 and 3 or
       (stair->>'total_rise_m')::numeric not between .1 and 10 or
       (stair->>'step_count')::integer not between 3 and 60 or
       (stair->>'railing_height_m')::numeric not between .7 and 1.5 then
      raise exception 'Invalid stair feature';
    end if;
    select * into destination from public.levels where id = (stair->>'destination_level_id')::uuid;
    if destination.id is null or destination.property_id <> source_level.property_id or
       destination.elevation <= source_level.elevation or
       abs(destination.elevation - source_level.elevation - (stair->>'total_rise_m')::numeric) > .1 then
      raise exception 'Stair must connect two ascending levels of the same property';
    end if;
  end loop;
  return new;
end $$;
create trigger layout_stairs_guard before insert or update of graph on public.layout_graphs
for each row execute function public.validate_layout_stairs();
