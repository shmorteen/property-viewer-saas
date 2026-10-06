-- Existing levels remain editable in their legacy mode until an owner explicitly traces a new layout.
alter table public.levels add column geometry_mode text not null default 'topology' check (geometry_mode in ('legacy', 'topology'));
update public.levels set geometry_mode = 'legacy';
alter table public.room_polygons add column topology_managed boolean not null default false;

create table public.property_boundaries (
  property_id uuid primary key references public.properties(id) on delete cascade,
  points jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint boundary_is_array check (jsonb_typeof(points) = 'array')
);
create table public.layout_graphs (
  level_id uuid primary key references public.levels(id) on delete cascade,
  graph jsonb not null,
  updated_at timestamptz not null default now(),
  constraint graph_is_object check (jsonb_typeof(graph) = 'object')
);
create index layout_graphs_updated_at_idx on public.layout_graphs(updated_at);
alter table public.property_boundaries enable row level security;
alter table public.layout_graphs enable row level security;
create policy property_boundaries_select on public.property_boundaries for select to authenticated using (public.can_read(public.property_org(property_id)));
create policy layout_graphs_select on public.layout_graphs for select to authenticated using (public.can_read(public.level_org(level_id)));
-- Writes go through one checked transaction, so graph and derived room polygons cannot diverge.

create or replace function public.save_layout_graph(lid uuid, payload jsonb, derived_rooms jsonb)
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
       opening->>'type' not in ('standard_door', 'double_door', 'standard_window', 'wide_window') or
       (opening->>'start')::numeric < .02 or (opening->>'end')::numeric > .98 or
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
revoke all on function public.save_layout_graph(uuid, jsonb, jsonb) from public;
grant execute on function public.save_layout_graph(uuid, jsonb, jsonb) to authenticated;
