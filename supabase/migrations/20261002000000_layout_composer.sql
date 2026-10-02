-- Additive layout model. Existing room and media IDs remain valid.
create table public.levels (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  level_type text not null check (level_type in ('site','ground','upper','basement','roof_terrace','custom')),
  sort_order integer not null default 0,
  elevation numeric(8,2) not null default 0 check (elevation between -100 and 1000),
  canvas_width integer not null default 1200 check (canvas_width between 200 and 10000),
  canvas_height integer not null default 900 check (canvas_height between 200 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, property_id)
);
create index levels_property_order_idx on public.levels(property_id, sort_order, created_at);
create trigger levels_touch before update on public.levels for each row execute function public.touch_updated_at();

insert into public.levels(property_id, name, level_type, sort_order, elevation)
select id, 'Ground Floor', 'ground', 0, 0 from public.properties;

alter table public.floor_plans add column level_id uuid;
update public.floor_plans f set level_id = l.id from public.levels l where l.property_id = f.property_id;
alter table public.floor_plans alter column level_id set not null;
alter table public.floor_plans drop constraint floor_plans_property_id_key;
alter table public.floor_plans add constraint floor_plans_level_id_key unique (level_id);
alter table public.floor_plans add constraint floor_plans_level_property_fk foreign key (level_id, property_id) references public.levels(id, property_id);
alter table public.floor_plans add constraint floor_plans_id_level_key unique (id, level_id);

alter table public.rooms add column level_id uuid;
update public.rooms r set level_id = l.id from public.levels l where l.property_id = r.property_id;
alter table public.rooms alter column level_id set not null;
alter table public.rooms add constraint rooms_level_property_fk foreign key (level_id, property_id) references public.levels(id, property_id);
alter table public.rooms add constraint rooms_id_level_key unique (id, level_id);
alter table public.rooms add column space_type text not null default 'other'
  check (space_type in ('living_room','bedroom','kitchen','bathroom','dining_room','corridor','office','store','garage','utility','studio','stairs','building_footprint','garden','pool','parking','driveway','patio','terrace','balcony','yard','other'));
alter table public.rooms add column category text not null default 'indoor' check (category in ('indoor','outdoor'));
alter table public.rooms add column height numeric(5,2) not null default 2.70 check (height between 0.1 and 20);
create index rooms_level_order_idx on public.rooms(level_id, sort_order);

alter table public.room_polygons add column level_id uuid;
update public.room_polygons p set level_id = r.level_id from public.rooms r where r.id = p.room_id;
alter table public.room_polygons alter column level_id set not null;
alter table public.room_polygons alter column floor_plan_id drop not null;
alter table public.room_polygons add constraint polygons_room_level_fk foreign key (room_id, level_id) references public.rooms(id, level_id) on delete cascade;
alter table public.room_polygons add constraint polygons_floor_level_fk foreign key (floor_plan_id, level_id) references public.floor_plans(id, level_id);
create index room_polygons_level_idx on public.room_polygons(level_id);

create or replace function public.same_property_polygon() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if (select level_id from public.rooms where id = new.room_id) is distinct from new.level_id then
    raise exception 'Space and polygon must belong to the same level';
  end if;
  if new.floor_plan_id is not null and (select level_id from public.floor_plans where id = new.floor_plan_id) is distinct from new.level_id then
    raise exception 'Floor plan and polygon must belong to the same level';
  end if;
  return new;
end $$;

-- Applying a starter layout is atomic, so a failed template never leaves half a property behind.
create function public.apply_layout_template(pid uuid, spec jsonb) returns void language plpgsql security invoker set search_path=public as $$
declare level_spec jsonb; space_spec jsonb; level_ids uuid[] := array[]::uuid[]; new_level uuid; new_space uuid; level_index integer := 0; space_index integer; destination_index integer;
begin
  if not public.can_edit(public.property_org(pid)) then raise exception 'Forbidden'; end if;
  perform pg_advisory_xact_lock(hashtext(pid::text));
  if exists (select 1 from public.rooms where property_id=pid) or exists (select 1 from public.floor_plans where property_id=pid) then
    raise exception 'Templates require an empty property layout';
  end if;
  if jsonb_typeof(spec->'levels') <> 'array' or jsonb_array_length(spec->'levels') not between 1 and 5 then
    raise exception 'Template must contain one to five levels';
  end if;
  delete from public.levels where property_id=pid;
  for level_spec in select value from jsonb_array_elements(spec->'levels') loop
    level_index := level_index + 1;
    if jsonb_typeof(level_spec->'spaces') <> 'array' or jsonb_array_length(level_spec->'spaces') not between 1 and 30 then
      raise exception 'Each template level needs one to thirty spaces';
    end if;
    insert into public.levels(property_id,name,level_type,sort_order,elevation,canvas_width,canvas_height)
    values (pid, level_spec->>'name', level_spec->>'type', level_index-1,
      (level_spec->>'elevation')::numeric, coalesce((level_spec->>'width')::integer,1200), coalesce((level_spec->>'height')::integer,900))
    returning id into new_level;
    level_ids := array_append(level_ids,new_level);
  end loop;
  level_index := 0;
  for level_spec in select value from jsonb_array_elements(spec->'levels') loop
    level_index := level_index + 1;
    space_index := 0;
    for space_spec in select value from jsonb_array_elements(level_spec->'spaces') loop
      if not public.valid_polygon(space_spec->'polygon') then raise exception 'Invalid template polygon'; end if;
      insert into public.rooms(property_id,level_id,name,description,sort_order,space_type,category,height)
      values (pid,level_ids[level_index],space_spec->>'name','',space_index,
        space_spec->>'type',space_spec->>'category',coalesce((space_spec->>'height')::numeric,2.7))
      returning id into new_space;
      insert into public.room_polygons(level_id,room_id,points) values (level_ids[level_index],new_space,space_spec->'polygon');
      if space_spec ? 'destination_level_index' then
        destination_index := (space_spec->>'destination_level_index')::integer + 1;
        if destination_index not between 1 and array_length(level_ids,1) then raise exception 'Invalid stair destination'; end if;
        insert into public.stair_connections(space_id,destination_level_id,stair_type)
        values (new_space,level_ids[destination_index],coalesce(space_spec->>'stair_type','straight'));
      end if;
      space_index := space_index + 1;
    end loop;
  end loop;
end $$;
revoke all on function public.apply_layout_template(uuid,jsonb) from public;
grant execute on function public.apply_layout_template(uuid,jsonb) to authenticated;

create table public.openings (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.rooms(id) on delete cascade,
  polygon_id uuid not null references public.room_polygons(id) on delete cascade,
  opening_type text not null check (opening_type in ('standard_door','double_door','standard_window','wide_window')),
  segment_index integer not null check (segment_index between 0 and 99),
  position numeric(5,4) not null default 0.5 check (position between 0 and 1),
  width numeric(5,2) not null check (width between 0.4 and 4),
  height numeric(5,2) not null check (height between 0.4 and 4),
  sill_height numeric(5,2) not null default 0 check (sill_height between 0 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index openings_space_idx on public.openings(space_id);
create index openings_polygon_idx on public.openings(polygon_id);
create trigger openings_touch before update on public.openings for each row execute function public.touch_updated_at();
create function public.validate_opening() returns trigger language plpgsql security definer set search_path=public as $$
declare polygon_space uuid; vertex_count integer;
begin
  select room_id, jsonb_array_length(points) into polygon_space, vertex_count from public.room_polygons where id = new.polygon_id;
  if polygon_space is distinct from new.space_id or new.segment_index >= vertex_count then
    raise exception 'Opening must attach to a wall segment of its space';
  end if;
  if new.opening_type like '%door' and new.sill_height <> 0 then raise exception 'Doors must start at floor level'; end if;
  return new;
end $$;
create trigger opening_wall_guard before insert or update on public.openings for each row execute function public.validate_opening();
create function public.validate_polygon_openings() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists (select 1 from public.openings where polygon_id = new.id and segment_index >= jsonb_array_length(new.points)) then
    raise exception 'Move or remove openings before removing wall segments';
  end if;
  return new;
end $$;
create trigger polygon_openings_guard before update of points on public.room_polygons for each row execute function public.validate_polygon_openings();

create table public.stair_connections (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null unique references public.rooms(id) on delete cascade,
  destination_level_id uuid not null references public.levels(id),
  stair_type text not null check (stair_type in ('straight','l_shaped','u_shaped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index stair_connections_destination_idx on public.stair_connections(destination_level_id);
create trigger stairs_touch before update on public.stair_connections for each row execute function public.touch_updated_at();
create function public.validate_stair_connection() returns trigger language plpgsql security definer set search_path=public as $$
declare source_property uuid; source_level uuid; destination_property uuid; source_type text;
begin
  select property_id, level_id, space_type into source_property, source_level, source_type from public.rooms where id = new.space_id;
  select property_id into destination_property from public.levels where id = new.destination_level_id;
  if source_type is distinct from 'stairs' or source_property is distinct from destination_property or source_level = new.destination_level_id then
    raise exception 'Stairs must connect two different levels of the same property';
  end if;
  return new;
end $$;
create trigger stair_level_guard before insert or update on public.stair_connections for each row execute function public.validate_stair_connection();

create function public.level_org(lid uuid) returns uuid language sql stable security definer set search_path=public as $$
  select p.organization_id from public.levels l join public.properties p on p.id = l.property_id where l.id = lid
$$;
revoke all on function public.level_org(uuid) from public;
grant execute on function public.level_org(uuid) to authenticated;

alter table public.levels enable row level security;
alter table public.openings enable row level security;
alter table public.stair_connections enable row level security;
create policy levels_select on public.levels for select to authenticated using (public.can_read(public.property_org(property_id)));
create policy levels_insert on public.levels for insert to authenticated with check (public.can_edit(public.property_org(property_id)));
create policy levels_update on public.levels for update to authenticated using (public.can_edit(public.property_org(property_id))) with check (public.can_edit(public.property_org(property_id)));
create policy levels_delete on public.levels for delete to authenticated using (public.can_edit(public.property_org(property_id)));
drop policy polygons_select on public.room_polygons;
drop policy polygons_insert on public.room_polygons;
drop policy polygons_update on public.room_polygons;
drop policy polygons_delete on public.room_polygons;
create policy polygons_select on public.room_polygons for select to authenticated using (public.can_read(public.room_org(room_id)));
create policy polygons_insert on public.room_polygons for insert to authenticated with check (public.can_edit(public.room_org(room_id)));
create policy polygons_update on public.room_polygons for update to authenticated using (public.can_edit(public.room_org(room_id))) with check (public.can_edit(public.room_org(room_id)));
create policy polygons_delete on public.room_polygons for delete to authenticated using (public.can_edit(public.room_org(room_id)));
create policy openings_select on public.openings for select to authenticated using (public.can_read(public.room_org(space_id)));
create policy openings_insert on public.openings for insert to authenticated with check (public.can_edit(public.room_org(space_id)));
create policy openings_update on public.openings for update to authenticated using (public.can_edit(public.room_org(space_id))) with check (public.can_edit(public.room_org(space_id)));
create policy openings_delete on public.openings for delete to authenticated using (public.can_edit(public.room_org(space_id)));
create policy stairs_select on public.stair_connections for select to authenticated using (public.can_read(public.room_org(space_id)));
create policy stairs_insert on public.stair_connections for insert to authenticated with check (public.can_edit(public.room_org(space_id)));
create policy stairs_update on public.stair_connections for update to authenticated using (public.can_edit(public.room_org(space_id))) with check (public.can_edit(public.room_org(space_id)));
create policy stairs_delete on public.stair_connections for delete to authenticated using (public.can_edit(public.room_org(space_id)));

-- A room is now a space; the existing table name retains media and public-tour compatibility.
create or replace function public.enforce_tour_limit() returns trigger language plpgsql security definer set search_path=public as $$
declare oid uuid; active_plan text; live_count integer; space_count integer; ready_count integer;
begin
  if new.published then
    select organization_id into oid from public.properties where id=new.property_id;
    perform pg_advisory_xact_lock(hashtext(oid::text));
    select count(*) into space_count from public.rooms where property_id=new.property_id;
    select count(*) into ready_count from public.rooms r where r.property_id=new.property_id
      and exists (select 1 from public.room_media m where m.room_id=r.id)
      and exists (select 1 from public.room_polygons poly where poly.room_id=r.id and poly.level_id=r.level_id);
    if space_count=0 or space_count<>ready_count then raise exception 'Every space needs a photo and a layout area'; end if;
    select plan into active_plan from public.subscriptions where organization_id=oid and status in ('active','trialing');
    if coalesce(active_plan,'free') <> 'professional' then
      select count(*) into live_count from public.tours t join public.properties p on p.id=t.property_id where p.organization_id=oid and t.published and t.property_id<>new.property_id;
      if live_count >= 1 then raise exception 'Free plan allows one published tour'; end if;
    end if;
  end if;
  return new;
end $$;
