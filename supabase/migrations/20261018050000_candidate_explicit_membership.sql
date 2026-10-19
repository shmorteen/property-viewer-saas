-- SQL NULL must never grant access to a security-definer RPC.
create or replace function public.queue_plan_extraction(lid uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.floor_plans; eid uuid;
begin
  select * into f from public.floor_plans where level_id=lid for update;
  if f.id is null or public.can_edit(public.property_org(f.property_id)) is not true then raise exception 'A floor plan and editor access are required'; end if;
  insert into public.plan_extractions(level_id,floor_plan_id,source_path) values(lid,f.id,f.storage_path) returning id into eid;
  return eid;
end $$;

-- Keep SQL aliases distinct from PL/pgSQL variables; require explicit calibration.
create or replace function public.accept_plan_extraction(eid uuid, payload jsonb, room_specs jsonb, face_regions jsonb,
  width_m numeric, calibration jsonb, stats jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.plan_extractions; l public.levels; p public.properties; r jsonb; a jsonb; b jsonb; wall jsonb; measured numeric; boundary jsonb;
begin
  select * into e from public.plan_extractions where id=eid for update;
  select * into l from public.levels where id=e.level_id for update;
  select * into p from public.properties where id=l.property_id for update;
  if e.id is null or public.can_edit(p.organization_id) is not true then raise exception 'Forbidden'; end if;
  if e.status<>'completed' or e.result->>'status'<>'candidate' then raise exception 'A successful reviewed candidate is required'; end if;
  perform 1 from public.floor_plans where id=e.floor_plan_id for update;
  if not exists(select 1 from public.floor_plans f where f.id=e.floor_plan_id and f.storage_path=e.source_path) then raise exception 'The uploaded plan changed; analyze the current image'; end if;
  if exists(select 1 from public.rooms where level_id=l.id) or exists(select 1 from public.layout_graphs where level_id=l.id and jsonb_array_length(graph->'walls')>0) then raise exception 'Existing layouts are preserved. Accept on a new empty level.'; end if;
  select coalesce(points,'[]'::jsonb) into boundary from public.property_boundaries where property_id=p.id for update;
  boundary:=coalesce(boundary,'[]'::jsonb);
  if payload->'property_boundary'<>boundary then raise exception 'The property boundary changed; reopen the review'; end if;
  perform public.validate_plan_candidate(payload,face_regions);
  if width_m is null or width_m not between 2 and 100 or calibration->>'source' is distinct from 'wall_measurement' or calibration->>'length_m' is null or (calibration->>'length_m')::numeric<=0 then raise exception 'Select a wall and calibrate its known length'; end if;
  select value into wall from jsonb_array_elements(payload->'walls') where value->>'id'=calibration->>'wall_id';
  select value into a from jsonb_array_elements(payload->'vertices') where value->>'id'=wall->>'a';
  select value into b from jsonb_array_elements(payload->'vertices') where value->>'id'=wall->>'b';
  measured:=sqrt(power((a->>'x')::numeric-(b->>'x')::numeric,2)+power(((a->>'y')::numeric-(b->>'y')::numeric)*l.canvas_height/l.canvas_width,2))*width_m;
  if measured is null or abs(measured-(calibration->>'length_m')::numeric)>.04 then raise exception 'Calibration does not match the selected wall'; end if;
  if exists(select 1 from public.rooms where property_id=p.id) and abs(width_m-p.layout_width_m)>.05 then raise exception 'This property already has scaled levels. Use a matching plan scale or update the property scale deliberately.'; end if;
  update public.properties set layout_width_m=width_m where id=p.id;
  if jsonb_typeof(room_specs) is distinct from 'array' then raise exception 'Missing room specifications'; end if;
  if jsonb_array_length(room_specs)<>jsonb_array_length(payload->'rooms') then raise exception 'Room assignments must match the graph'; end if;
  for r in select value from jsonb_array_elements(room_specs) loop
    if r->>'space_type' not in ('living_room','bedroom','kitchen','bathroom','dining_room','corridor','office','store','garage','utility','studio','other') or
      length(trim(r->>'name')) not between 1 and 80 or not exists(select 1 from jsonb_array_elements(payload->'rooms') s where s->>'room_id'=r->>'id') then raise exception 'Invalid candidate room'; end if;
    insert into public.rooms(id,property_id,level_id,name,space_type,category,height,sort_order)
      values((r->>'id')::uuid,p.id,l.id,r->>'name',r->>'space_type','indoor',2.7,(r->>'sort_order')::integer);
  end loop;
  perform public.save_layout_graph(l.id,payload,(select coalesce(jsonb_agg(jsonb_build_object('room_id',face.value->'room_id','points',face.value->'points')),'[]'::jsonb) from jsonb_array_elements(face_regions) face(value) where face.value->>'room_id' is not null));
  update public.plan_extractions set status='accepted',accepted_at=now(),review_stats=stats||jsonb_build_object('calibration',calibration) where id=e.id;
end $$;
