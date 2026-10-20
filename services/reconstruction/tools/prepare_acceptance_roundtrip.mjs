/** Prepare an isolated committed acceptance check. No credentials or source images are copied.
 * Run from the repository root: node .../prepare_acceptance_roundtrip.mjs result.json private-output-dir
 * Execute seed.sql, then readback.sql in a separate Supabase CLI request.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import console from 'node:console'
const [input,output]=process.argv.slice(2)
if(!input||!output)throw new Error('Provide an analysis result JSON and a private output directory.')
const analysis=JSON.parse((await fs.readFile(input,'utf8')).replace(/^\uFEFF/,''))
if (!analysis.graph || analysis.graph.rooms.length < 2) throw new Error('Use a reviewable candidate with at least two assigned faces for the partial-write check.')
const bundle=await build({entryPoints:['src/lib/plan-review.ts','src/lib/topology.ts','src/lib/plan-acceptance.ts'],bundle:true,platform:'node',format:'esm',write:false,outdir:'out'})
const moduleFor=async name=>import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles.find(file=>file.path.endsWith('/'+name+'.js')||file.path.endsWith('\\'+name+'.js')).text).toString('base64')}`)
const {preparePlanReview}=await moduleFor('plan-review')
const {faces,validateGraph,wallLengthM,preserveOpeningWidths}=await moduleFor('topology')
const org=randomUUID(),pid=randomUUID(),lid=randomUUID(),fid=randomUUID(),eid=randomUUID()
const org2=org,pid2=randomUUID(),lid2=randomUUID(),fid2=randomUUID(),eid2=randomUUID()
const literal=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb"
const aspect=analysis.quality.height/analysis.quality.width
function reviewed(){
 const review=preparePlanReview(analysis,[]),graph=review.graph
 const wall=graph.walls.filter(w=>w.kind==='exterior').sort((a,b)=>wallLengthM(graph,b,1,aspect)-wallLengthM(graph,a,1,aspect))[0]
 const calibration={source:'wall_measurement',wall_id:wall.id,length_m:9.25}
 const width=calibration.length_m/wallLengthM(graph,wall,1,aspect)
 graph.openings.push({id:randomUUID(),wall_id:wall.id,type:'standard_door',start:.32,end:.42,height:2.1,sill:0,swing:1,preset:'custom'})
 const calibrated=preserveOpeningWidths(graph,width,aspect)
 const problem=validateGraph(calibrated);if(problem)throw new Error(problem)
 const rooms=review.room_candidates.map((room,index)=>({id:room.id,name:index===0?'Recovery QA corrected bedroom':room.name,space_type:index===0?'bedroom':room.space_type,sort_order:index,category:'indoor'}))
 const regions=faces(calibrated).map(face=>({room_id:face.room_id||null,points:face.points.map(p=>({x:p.x,y:p.y})),vertex_ids:face.ids}))
 return {graph:calibrated,rooms,regions,width,calibration}
}
const a=reviewed(),b=reviewed()
const invalidRooms=a.rooms.map((room,index)=>index===1?{...room,space_type:'invalid-test-type'}:room)
let seed=`begin;\nselect set_config('request.jwt.claim.sub',(select id::text from auth.users order by created_at limit 1),true);\ninsert into public.organizations(id,name,slug) values('${org}','Recovery acceptance QA','recovery-${org}');\n`
for(const [property,level,floor,extraction] of [[pid,lid,fid,eid],[pid2,lid2,fid2,eid2]])seed+=`insert into public.properties(id,organization_id,title,address) values('${property}','${org2}','Recovery acceptance QA','Disposable prepared-payload fixture');
insert into public.levels(id,property_id,name,level_type,sort_order,elevation,canvas_width,canvas_height) values('${level}','${property}','QA','ground',0,0,1200,${Math.round(1200*aspect)});
insert into public.floor_plans(id,property_id,level_id,storage_path,width,height) values('${floor}','${property}','${level}','${org}/prepared-original.png',${analysis.quality.width},${analysis.quality.height});
insert into public.plan_extractions(id,level_id,floor_plan_id,source_path,status,result) values('${extraction}','${level}','${floor}','${org}/prepared-original.png','completed','{"status":"NEEDS_REVIEW"}');\n`
seed+=`set local role authenticated;
do $check$ declare denied boolean:=false; begin
 begin perform public.accept_plan_extraction('${eid}',jsonb_set(${literal(a.graph)},'{walls,0,a}','"missing"'),${literal(a.rooms)},${literal(a.regions)},${a.width},${literal(a.calibration)});
 exception when others then denied:=true; end;
 if not denied or exists(select 1 from public.rooms where level_id='${lid}') then raise exception 'Rejected save was not atomic';end if;
 denied:=false;
 begin perform public.accept_plan_extraction('${eid}',${literal(a.graph)},${literal(invalidRooms)},${literal(a.regions)},${a.width},${literal(a.calibration)});
 exception when others then denied:=true; end;
 if not denied or exists(select 1 from public.rooms where level_id='${lid}') or
    exists(select 1 from public.layout_graphs where level_id='${lid}') or
    exists(select 1 from public.room_polygons where level_id='${lid}') or
    (select layout_width_m from public.properties where id='${pid}')<>12 or
    (select status from public.plan_extractions where id='${eid}')<>'completed'
 then raise exception 'Mid-write rejection left partial data';end if;
end $check$;\n`
for(const [extraction,payload] of [[eid,a],[eid2,b]])seed+=`select public.accept_plan_extraction('${extraction}',${literal(payload.graph)},${literal(payload.rooms)},${literal(payload.regions)},${payload.width},${literal(payload.calibration)});\n`
seed+=`commit;\nselect 'PASS: rejected save atomic; two independent reviews of one image accepted and committed' as result;\n`
const readback=`begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users order by created_at limit 1),true);
set local role authenticated;
select jsonb_build_object('level_id',l.id,'property_id',p.id,'canvas_width',l.canvas_width,'canvas_height',l.canvas_height,'graph',g.graph,'rooms',(select jsonb_agg(to_jsonb(r) order by r.sort_order) from public.rooms r where r.level_id=l.id),'polygons',(select jsonb_agg(to_jsonb(rp)) from public.room_polygons rp where rp.level_id=l.id),'width',p.layout_width_m,'status',(select status from public.plan_extractions e where e.level_id=l.id)) as saved
from public.levels l join public.properties p on p.id=l.property_id join public.layout_graphs g on g.level_id=l.id where l.id in ('${lid}','${lid2}');
commit;`
await fs.mkdir(output,{recursive:true})
await fs.writeFile(path.join(output,'expected.json'),JSON.stringify({organization_id:org,source_sha256:analysis.input_sha256,calibration_note:'Declared QA measurement, not a claim about the real building',cases:[{property_id:pid,level_id:lid,...a},{property_id:pid2,level_id:lid2,...b}]},null,2),{flag:'wx'})
await fs.writeFile(path.join(output,'seed.sql'),seed)
await fs.writeFile(path.join(output,'readback.sql'),readback)
console.log('Prepared two isolated QA properties. Source images remain private. No SQL has been executed.')
