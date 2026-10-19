-- Candidate jobs reuse the reconstruction worker. No candidate writes a live graph.
create table public.plan_extractions (
  id uuid primary key default gen_random_uuid(),
  level_id uuid not null references public.levels(id) on delete cascade,
  floor_plan_id uuid not null references public.floor_plans(id) on delete cascade,
  source_path text not null,
  status text not null default 'queued' check(status in ('queued','processing','completed','failed','rejected','accepted')),
  result jsonb,
  original_path text,
  normalized_path text,
  error_message text,
  attempts integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  accepted_at timestamptz,
  review_stats jsonb,
  created_at timestamptz not null default now()
);
create index plan_extractions_recent on public.plan_extractions(level_id,created_at desc);
create unique index plan_extractions_active on public.plan_extractions(level_id) where status in ('queued','processing');
alter table public.plan_extractions enable row level security;
create policy plan_extractions_read on public.plan_extractions for select to authenticated
using (exists(select 1 from public.levels l where l.id=level_id and public.can_read(public.property_org(l.property_id))));

create function public.queue_plan_extraction(lid uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.floor_plans; eid uuid;
begin
  select * into f from public.floor_plans where level_id=lid for update;
  if f.id is null or not public.can_edit(public.property_org(f.property_id)) then raise exception 'A floor plan and editor access are required'; end if;
  insert into public.plan_extractions(level_id,floor_plan_id,source_path) values(lid,f.id,f.storage_path) returning id into eid;
  return eid;
end $$;
revoke all on function public.queue_plan_extraction(uuid) from public;
grant execute on function public.queue_plan_extraction(uuid) to authenticated;

create function public.claim_plan_extraction() returns setof public.plan_extractions
language plpgsql security definer set search_path=public,pg_temp as $$
declare claimed public.plan_extractions;
begin
  update public.plan_extractions set status='failed',error_message='Analysis worker stopped repeatedly; retry analysis.',completed_at=now()
  where status='processing' and started_at<now()-interval '30 minutes' and attempts>=3;
  select * into claimed from public.plan_extractions where status='queued' or
    (status='processing' and started_at<now()-interval '30 minutes' and attempts<3)
    order by created_at for update skip locked limit 1;
  if not found then return; end if;
  update public.plan_extractions set status='processing',started_at=now(),attempts=attempts+1,error_message=null
  where id=claimed.id returning * into claimed;
  return next claimed;
end $$;
revoke all on function public.claim_plan_extraction() from public,anon,authenticated;
grant execute on function public.claim_plan_extraction() to service_role;

create function public.reject_plan_extraction(eid uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.plan_extractions e set status='rejected' from public.levels l
  where e.id=eid and l.id=e.level_id and public.can_edit(public.property_org(l.property_id))
    and e.status in ('completed','failed');
  if not found then raise exception 'Candidate is unavailable or cannot be rejected'; end if;
end $$;
revoke all on function public.reject_plan_extraction(uuid) from public;
grant execute on function public.reject_plan_extraction(uuid) to authenticated;

-- Equivalent server checks for a corrected planar candidate, independent of ML.
create function public.validate_plan_candidate(g jsonb, regions jsonb) returns void
language plpgsql set search_path=public,pg_temp as $$
declare
  v jsonb; w jsonb; o jsonb; r jsonb; a jsonb; b jsonb; c jsonb; d jsonb;
  outline jsonb; ids text[]; ring text[]; aid text; bid text; i integer; uses integer;
  seg lseg; other_seg lseg; total_area numeric:=0; outline_area numeric;
begin
  if jsonb_typeof(g->'vertices')<>'array' or jsonb_typeof(g->'walls')<>'array' or
     jsonb_typeof(g->'building_boundary')<>'array' or jsonb_typeof(regions)<>'array' or
     jsonb_array_length(g->'vertices') not between 3 and 500 or jsonb_array_length(g->'walls') not between 3 and 700
     then raise exception 'Invalid candidate graph'; end if;
  select array_agg(value->>'id') into ids from jsonb_array_elements(g->'vertices');
  if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Duplicate vertices'; end if;
  for v in select value from jsonb_array_elements(g->'vertices') loop
    if (v->>'x')::numeric not between 0 and 1 or (v->>'y')::numeric not between 0 and 1 then raise exception 'Vertex outside image'; end if;
    if exists(select 1 from jsonb_array_elements(g->'vertices') q where q->>'id'<>v->>'id' and
      abs((q->>'x')::numeric-(v->>'x')::numeric)<.0000001 and abs((q->>'y')::numeric-(v->>'y')::numeric)<.0000001) then raise exception 'Junctions must share vertices'; end if;
    if (select count(*) from jsonb_array_elements(g->'walls') q where q->>'a'=v->>'id' or q->>'b'=v->>'id')<2 then raise exception 'Disconnected endpoint'; end if;
  end loop;
  select array_agg(value #>> '{}') into ring from jsonb_array_elements(g->'building_boundary');
  select jsonb_agg(jsonb_build_object('x',q->'x','y',q->'y') order by ord) into outline
  from jsonb_array_elements(g->'building_boundary') with ordinality p(key,ord)
  join jsonb_array_elements(g->'vertices') q on q->>'id'=p.key #>> '{}';
  if outline is null or jsonb_array_length(outline)<>cardinality(ring) or not public.valid_polygon(outline) then raise exception 'Invalid building footprint'; end if;
  for i in 1..cardinality(ring) loop
    aid:=ring[i]; bid:=ring[(i%cardinality(ring))+1];
    if not exists(select 1 from jsonb_array_elements(g->'walls') q where q->>'kind'='exterior' and
      ((q->>'a'=aid and q->>'b'=bid) or (q->>'b'=aid and q->>'a'=bid))) then raise exception 'Footprint must follow exterior shared walls'; end if;
  end loop;
  for w in select value from jsonb_array_elements(g->'walls') loop
    select value into a from jsonb_array_elements(g->'vertices') where value->>'id'=w->>'a';
    select value into b from jsonb_array_elements(g->'vertices') where value->>'id'=w->>'b';
    if a is null or b is null or w->>'a'=w->>'b' then raise exception 'Orphan wall'; end if;
    seg:=lseg(point((a->>'x')::float8,(a->>'y')::float8),point((b->>'x')::float8,(b->>'y')::float8));
    for o in select value from jsonb_array_elements(g->'walls') where value->>'id'<>w->>'id' loop
      select value into c from jsonb_array_elements(g->'vertices') where value->>'id'=o->>'a';
      select value into d from jsonb_array_elements(g->'vertices') where value->>'id'=o->>'b';
      other_seg:=lseg(point((c->>'x')::float8,(c->>'y')::float8),point((d->>'x')::float8,(d->>'y')::float8));
      if seg ?# other_seg and not (w->>'a' in (o->>'a',o->>'b') or w->>'b' in (o->>'a',o->>'b')) then raise exception 'Walls cross without a shared junction'; end if;
      if ((w->>'a'=o->>'a' and w->>'b'=o->>'b') or (w->>'a'=o->>'b' and w->>'b'=o->>'a')) then raise exception 'Duplicate physical wall'; end if;
      if (seg @> point((c->>'x')::float8,(c->>'y')::float8) and o->>'a' not in (w->>'a',w->>'b')) or
         (seg @> point((d->>'x')::float8,(d->>'y')::float8) and o->>'b' not in (w->>'a',w->>'b')) then raise exception 'Overlapping or unnoded walls'; end if;
    end loop;
    uses:=0;
    for r in select value from jsonb_array_elements(regions) loop
      for i in 0..jsonb_array_length(r->'vertex_ids')-1 loop
        aid:=r->'vertex_ids'->>i; bid:=r->'vertex_ids'->>((i+1)%jsonb_array_length(r->'vertex_ids'));
        if (w->>'a'=aid and w->>'b'=bid) or (w->>'a'=bid and w->>'b'=aid) then uses:=uses+1; end if;
      end loop;
    end loop;
    if uses<>(case when w->>'kind'='exterior' then 1 else 2 end) then raise exception 'Room faces must share exact physical walls'; end if;
  end loop;
  with recursive reachable(id) as (
    select ids[1]
    union
    select case when w->>'a'=r.id then w->>'b' else w->>'a' end
    from reachable r cross join jsonb_array_elements(g->'walls') w where w->>'a'=r.id or w->>'b'=r.id
  ) select count(*) into uses from reachable;
  if uses<>cardinality(ids) then raise exception 'Disconnected wall graph'; end if;
  if jsonb_array_length(regions)<>jsonb_array_length(g->'walls')-jsonb_array_length(g->'vertices')+1 then raise exception 'Invalid planar face count'; end if;
  for r in select value from jsonb_array_elements(regions) loop
    if not public.valid_polygon(r->'points') or jsonb_array_length(r->'points')<>jsonb_array_length(r->'vertex_ids') then raise exception 'Invalid candidate room face'; end if;
    for i in 0..jsonb_array_length(r->'vertex_ids')-1 loop
      select value into a from jsonb_array_elements(g->'vertices') where value->>'id'=r->'vertex_ids'->>i;
      b:=r->'points'->i;
      if a is null or a->'x'<>b->'x' or a->'y'<>b->'y' then raise exception 'Room face does not follow shared vertices'; end if;
    end loop;
    select abs(sum((p->>'x')::numeric*(r->'points'->((ord::integer)%jsonb_array_length(r->'points'))->>'y')::numeric-
      (r->'points'->((ord::integer)%jsonb_array_length(r->'points'))->>'x')::numeric*(p->>'y')::numeric))/2
      into outline_area from jsonb_array_elements(r->'points') with ordinality x(p,ord);
    total_area:=total_area+outline_area;
  end loop;
  select abs(sum((p->>'x')::numeric*(outline->((ord::integer)%jsonb_array_length(outline))->>'y')::numeric-
    (outline->((ord::integer)%jsonb_array_length(outline))->>'x')::numeric*(p->>'y')::numeric))/2
    into outline_area from jsonb_array_elements(outline) with ordinality x(p,ord);
  if abs(total_area-outline_area)>.000001 then raise exception 'Room faces do not cover the building'; end if;
end $$;
revoke all on function public.validate_plan_candidate(jsonb,jsonb) from public;

create function public.accept_plan_extraction(eid uuid, payload jsonb, room_specs jsonb, face_regions jsonb,
  width_m numeric, calibration jsonb, stats jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.plan_extractions; l public.levels; p public.properties; r jsonb; a jsonb; b jsonb; wall jsonb; measured numeric; boundary jsonb;
begin
  select * into e from public.plan_extractions where id=eid for update;
  select * into l from public.levels where id=e.level_id for update;
  select * into p from public.properties where id=l.property_id for update;
  if e.id is null or not public.can_edit(p.organization_id) then raise exception 'Forbidden'; end if;
  if e.status<>'completed' or e.result->>'status'<>'candidate' then raise exception 'A successful reviewed candidate is required'; end if;
  perform 1 from public.floor_plans where id=e.floor_plan_id for update;
  if not exists(select 1 from public.floor_plans f where f.id=e.floor_plan_id and f.storage_path=e.source_path) then raise exception 'The uploaded plan changed; analyze the current image'; end if;
  if exists(select 1 from public.rooms where level_id=l.id) or exists(select 1 from public.layout_graphs where level_id=l.id and jsonb_array_length(graph->'walls')>0) then raise exception 'Existing layouts are preserved. Accept on a new empty level.'; end if;
  select coalesce(points,'[]'::jsonb) into boundary from public.property_boundaries where property_id=p.id for update;
  boundary:=coalesce(boundary,'[]'::jsonb);
  if payload->'property_boundary'<>boundary then raise exception 'The property boundary changed; reopen the review'; end if;
  perform public.validate_plan_candidate(payload,face_regions);
  if width_m not between 2 and 100 or calibration->>'source'<>'wall_measurement' or (calibration->>'length_m')::numeric<=0 then raise exception 'Select a wall and calibrate its known length'; end if;
  select value into wall from jsonb_array_elements(payload->'walls') where value->>'id'=calibration->>'wall_id';
  select value into a from jsonb_array_elements(payload->'vertices') where value->>'id'=wall->>'a';
  select value into b from jsonb_array_elements(payload->'vertices') where value->>'id'=wall->>'b';
  measured:=sqrt(power((a->>'x')::numeric-(b->>'x')::numeric,2)+power(((a->>'y')::numeric-(b->>'y')::numeric)*l.canvas_height/l.canvas_width,2))*width_m;
  if measured is null or abs(measured-(calibration->>'length_m')::numeric)>.04 then raise exception 'Calibration does not match the selected wall'; end if;
  if exists(select 1 from public.rooms where property_id=p.id) and abs(width_m-p.layout_width_m)>.05 then raise exception 'This property already has scaled levels. Use a matching plan scale or update the property scale deliberately.'; end if;
  update public.properties set layout_width_m=width_m where id=p.id;
  if jsonb_array_length(room_specs)<>jsonb_array_length(payload->'rooms') then raise exception 'Room assignments must match the graph'; end if;
  for r in select value from jsonb_array_elements(room_specs) loop
    if r->>'space_type' not in ('living_room','bedroom','kitchen','bathroom','dining_room','corridor','office','store','garage','utility','studio','other') or
      length(trim(r->>'name')) not between 1 and 80 or not exists(select 1 from jsonb_array_elements(payload->'rooms') s where s->>'room_id'=r->>'id') then raise exception 'Invalid candidate room'; end if;
    insert into public.rooms(id,property_id,level_id,name,space_type,category,height,sort_order)
      values((r->>'id')::uuid,p.id,l.id,r->>'name',r->>'space_type','indoor',2.7,(r->>'sort_order')::integer);
  end loop;
  perform public.save_layout_graph(l.id,payload,(select coalesce(jsonb_agg(jsonb_build_object('room_id',r->'room_id','points',r->'points')),'[]'::jsonb) from jsonb_array_elements(face_regions) r where r->>'room_id' is not null));
  update public.plan_extractions set status='accepted',accepted_at=now(),review_stats=stats||jsonb_build_object('calibration',calibration) where id=e.id;
end $$;
revoke all on function public.accept_plan_extraction(uuid,jsonb,jsonb,jsonb,numeric,jsonb,jsonb) from public;
grant execute on function public.accept_plan_extraction(uuid,jsonb,jsonb,jsonb,numeric,jsonb,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('plan-analysis','plan-analysis',false,52428800,array['image/png','application/json','application/octet-stream']) on conflict(id) do nothing;
create policy plan_analysis_read on storage.objects for select to authenticated
using(bucket_id='plan-analysis' and public.can_read(public.storage_org(name)));
