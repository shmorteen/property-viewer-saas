-- PostgreSQL uses point <@ lseg for point-on-segment tests.
create or replace function public.validate_plan_candidate(g jsonb, regions jsonb) returns void
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
      if (point((c->>'x')::float8,(c->>'y')::float8) <@ seg and o->>'a' not in (w->>'a',w->>'b')) or
         (point((d->>'x')::float8,(d->>'y')::float8) <@ seg and o->>'b' not in (w->>'a',w->>'b')) then raise exception 'Overlapping or unnoded walls'; end if;
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
    select case when edge.value->>'a'=reach.id then edge.value->>'b' else edge.value->>'a' end
    from reachable reach cross join jsonb_array_elements(g->'walls') edge(value) where edge.value->>'a'=reach.id or edge.value->>'b'=reach.id
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
