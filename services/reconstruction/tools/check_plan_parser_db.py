"""Generate a rollback-only linked-project acceptance/RLS integration check.

Uses an analytic synthetic drawing. Does not publish, upload files, delete user
data, or read credentials. Execute its SQL with `supabase db query --linked -f`.
"""
import json
from pathlib import Path
import sys
import uuid

import cv2
import numpy as np
from shapely.geometry import LineString,Point
from shapely.ops import polygonize

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from plan_parser import analyze_plan

root=Path(__file__).resolve().parents[3]
image=np.full((800,1000,3),255,np.uint8)
cv2.rectangle(image,(100,100),(900,700),(0,0,0),8)
cv2.line(image,(500,100),(500,700),(0,0,0),8)
result,_=analyze_plan(cv2.imencode('.png',image)[1].tobytes(),use_semantic=False,use_ocr=False)
if result['status'] not in ('USABLE','NEEDS_REVIEW'): raise ValueError(result['validation_errors'])
graph=result['graph'];vertices={v['id']:v for v in graph['vertices']}
lookup={(v['x'],v['y']):v['id'] for v in graph['vertices']}
regions=[]
for face in polygonize([LineString([(vertices[w['a']]['x'],vertices[w['a']]['y']),(vertices[w['b']]['x'],vertices[w['b']]['y'])]) for w in graph['walls']]):
    points=[{'x':x,'y':y} for x,y in list(face.exterior.coords)[:-1]]
    room=next(seed for seed in graph['rooms'] if face.contains(Point(seed['point']['x'],seed['point']['y'])))
    regions.append({'room_id':room['room_id'],'points':points,'vertex_ids':[lookup[(p['x'],p['y'])] for p in points]})
specs=[{'id':r['id'],'name':r['name'],'space_type':'other','sort_order':i} for i,r in enumerate(result['room_candidates'])]
wall=graph['walls'][0];a,b=vertices[wall['a']],vertices[wall['b']]
calibration={'source':'wall_measurement','wall_id':wall['id'],'length_m':float(np.hypot(a['x']-b['x'],(a['y']-b['y'])*.8)*12)}
org,pid,lid,fid=[str(uuid.uuid4()) for _ in range(4)]
literal=lambda value:"'"+json.dumps(value).replace("'","''")+"'::jsonb"
sql=f"""begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users order by created_at limit 1),true);
insert into public.organizations(id,name,slug) values('{org}','Plan parser rollback test','plan-parser-{uuid.uuid4().hex[:12]}');
insert into public.properties(id,organization_id,title,address) values('{pid}','{org}','Parser rollback test','Synthetic integration fixture');
insert into public.levels(id,property_id,name,level_type,sort_order,elevation,canvas_width,canvas_height) values('{lid}','{pid}','Synthetic','ground',0,0,1200,960);
insert into public.floor_plans(id,property_id,level_id,storage_path,width,height) values('{fid}','{pid}','{lid}','{org}/synthetic.png',1000,800);
select public.queue_plan_extraction('{lid}');
update public.plan_extractions set status='completed',result='{{"status":"NEEDS_REVIEW"}}'::jsonb where level_id='{lid}';
set local role authenticated;
do $test$
declare g jsonb:={literal(graph)}; regions jsonb:={literal(regions)}; specs jsonb:={literal(specs)};
  calibration jsonb:={literal(calibration)}; eid uuid; denied boolean:=false;
begin
  select id into eid from public.plan_extractions where level_id='{lid}';
  if eid is null then raise exception 'Owner cannot read candidate'; end if;
  begin
    perform public.accept_plan_extraction(eid,jsonb_set(g,'{{walls,0,a}}','"missing"'),specs,regions,12,calibration);
  exception when others then denied:=true; end;
  if not denied or exists(select 1 from public.rooms where level_id='{lid}') then raise exception 'Invalid acceptance was not atomic'; end if;
  perform public.accept_plan_extraction(eid,g,specs,regions,12,calibration);
  if (select count(*) from public.rooms where level_id='{lid}')<>2 then raise exception 'Room creation mismatch'; end if;
  if not exists(select 1 from public.layout_graphs where level_id='{lid}' and graph->'walls'=g->'walls') then raise exception 'Authoritative graph was not saved'; end if;
  if not exists(select 1 from public.plan_extractions where id=eid and status='accepted') then raise exception 'Candidate status was not accepted'; end if;
  denied:=false;
  begin perform public.accept_plan_extraction(eid,g,specs,regions,12,calibration);
  exception when others then denied:=true; end;
  if not denied then raise exception 'Duplicate acceptance was allowed'; end if;
  perform set_config('request.jwt.claim.sub','{uuid.uuid4()}',true);
  if exists(select 1 from public.plan_extractions where level_id='{lid}') then raise exception 'Cross-tenant candidate leak'; end if;
  denied:=false;
  begin perform public.queue_plan_extraction('{lid}'); exception when others then denied:=true; end;
  if not denied then raise exception 'Cross-tenant analysis was allowed'; end if;
end $test$;
reset role;
rollback;
select 'PASS: candidate acceptance, atomic rejection, duplicate protection, and tenant RLS; all test rows rolled back' as result;
"""
path=root/'.local-backups'/'plan-parser'/'database-check.sql'
path.parent.mkdir(parents=True,exist_ok=True);path.write_text(sql,encoding='utf-8')
print(path)
