"""Verified-pair benchmark. Empty datasets and failed plans remain visible in JSON."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess

import networkx as nx
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import polygonize

from .pipeline import analyze_plan
from .topology import validate


def matching(scores: list[list[float]], minimum: float) -> list[tuple[int,int]]:
    network = nx.Graph()
    for i,row in enumerate(scores):
        for j,score in enumerate(row):
            if score >= minimum: network.add_edge(('p',i),('t',j),weight=score)
    pairs = []
    for a,b in nx.max_weight_matching(network,maxcardinality=True):
        if a[0]=='t': a,b=b,a
        pairs.append((a[1],b[1]))
    return sorted(pairs)


def lines(graph: dict, aspect: float) -> list:
    vertices = {v['id']:(v['x'],v['y']*aspect) for v in graph['vertices']}
    return [LineString([vertices[w['a']],vertices[w['b']]]) for w in graph['walls']]


def room_faces(graph: dict, aspect: float) -> list:
    return list(polygonize(lines(graph,aspect)))


def metrics(predicted: dict, truth: dict, aspect: float, tolerance: float=.01) -> dict:
    gold = truth['graph']
    p_physical={**predicted,'walls':[w for w in predicted['walls'] if w['kind']!='virtual']}
    t_physical={**gold,'walls':[w for w in gold['walls'] if w['kind']!='virtual']}
    p_lines,t_lines = lines(p_physical,aspect),lines(t_physical,aspect)
    # Match line axes by distance and overlap, not arbitrary element UUIDs.
    scores = [[max(0.,1-p.hausdorff_distance(t)/(tolerance*2)) for t in t_lines] for p in p_lines]
    wall_pairs = matching(scores,.25)
    endpoint = []
    moved = 0
    for i,j in wall_pairs:
        p,t = list(p_lines[i].coords),list(t_lines[j].coords)
        direct = [Point(p[k]).distance(Point(t[k])) for k in (0,1)]
        reverse = [Point(p[k]).distance(Point(t[1-k])) for k in (0,1)]
        distances = min((direct,reverse),key=sum)
        endpoint.extend(distances); moved += sum(d>tolerance for d in distances)
    p_faces,t_faces = room_faces(predicted,aspect),room_faces(gold,aspect)
    ious = [[p.intersection(t).area/p.union(t).area for t in t_faces] for p in p_faces]
    room_pairs = matching(ious,.1)
    mapped = dict(room_pairs)
    def adjacency(faces):
        return {(i,j) for i,a in enumerate(faces) for j,b in enumerate(faces) if i<j and a.boundary.intersection(b.boundary).length>1e-6}
    p_adj = {tuple(sorted((mapped[i],mapped[j]))) for i,j in adjacency(p_faces) if i in mapped and j in mapped}
    t_adj = adjacency(t_faces)
    def footprint(graph):
        vertices={v['id']:v for v in graph['vertices']}
        return Polygon([(vertices[key]['x'],vertices[key]['y']*aspect) for key in graph['building_boundary']])
    p_foot,t_foot = footprint(predicted),footprint(gold)
    p_walls = {w['id']:i for i,w in enumerate(p_physical['walls'])}
    t_walls = {w['id']:i for i,w in enumerate(t_physical['walls'])}
    wall_map = {p_physical['walls'][i]['id']:t_physical['walls'][j]['id'] for i,j in wall_pairs}
    def opening_line(opening, wall_lines, indices):
        if opening['wall_id'] not in indices: return None
        line=wall_lines[indices[opening['wall_id']]]
        return LineString([line.interpolate(opening[key],normalized=True) for key in ('start','end')])
    opening_results,opening_edits = {},0
    for kind in ('door','window'):
        p_open = [o for o in predicted['openings'] if kind in o['type']]
        t_open = [o for o in gold['openings'] if kind in o['type']]
        opening_scores=[]
        for p in p_open:
            pl=opening_line(p,p_lines,p_walls)
            row=[]
            for t in t_open:
                tl=opening_line(t,t_lines,t_walls)
                row.append(max(0.,1-pl.hausdorff_distance(tl)/(tolerance*2)) if pl and tl else 0.)
            opening_scores.append(row)
        pairs=matching(opening_scores,.25)
        attached=sum(wall_map.get(p_open[i]['wall_id'])==t_open[j]['wall_id'] for i,j in pairs)
        opening_results[kind]={'precision':len(pairs)/len(p_open) if p_open else (1. if not t_open else 0.),
            'recall':len(pairs)/len(t_open) if t_open else 1.,
            'attachment_accuracy':attached/len(pairs) if pairs else None,
            'predicted':len(p_open),'ground_truth':len(t_open)}
        opening_edits += len(p_open)+len(t_open)-2*len(pairs)
    def label_for(graph, specs, face):
        seed=next((s for s in graph['rooms'] if face.contains(Point(s['point']['x'],s['point']['y']*aspect))),None)
        return next((r['space_type'] for r in specs if seed and r['id']==seed['room_id']),None)
    correct=0; labeled=0
    for i,j in room_pairs:
        expected=label_for(gold,truth.get('rooms',[]),t_faces[j])
        if expected:
            labeled+=1
            correct+=label_for(predicted,truth.get('predicted_rooms',[]),p_faces[i])==expected
    scale=truth.get('predicted_width_m')
    expected_scale=truth.get('width_m')
    wall_edits=len(p_lines)+len(t_lines)-2*len(wall_pairs)+moved
    return {'wall_precision':len(wall_pairs)/len(p_lines) if p_lines else 0.,
        'wall_recall':len(wall_pairs)/len(t_lines) if t_lines else 1.,
        'wall_endpoint_distance_image_width':sum(endpoint)/len(endpoint) if endpoint else None,
        'building_footprint_iou':p_foot.intersection(t_foot).area/p_foot.union(t_foot).area,
        'detected_room_count':len(p_faces),'ground_truth_room_count':len(t_faces),
        'room_polygon_iou':sum(ious[i][j] for i,j in room_pairs)/max(1,len(t_faces)),
        'room_adjacency_precision':len(p_adj&t_adj)/len(p_adj) if p_adj else (1. if not t_adj else 0.),
        'room_adjacency_recall':len(p_adj&t_adj)/len(t_adj) if t_adj else 1.,
        'openings':opening_results,'room_label_accuracy':correct/labeled if labeled else None,
        'scale_relative_error':abs(scale-expected_scale)/expected_scale if scale and expected_scale else None,
        'invalid_topology_count':len(validate(predicted)),
        'estimated_edit_operations':wall_edits+opening_edits+(labeled-correct)+abs(len(p_faces)-len(t_faces)),
        'edit_cost_definition':'Unmatched walls/openings: add/delete; displaced endpoints: move; unmatched rooms: assign; wrong labels: edit. Estimate, not observed UI operations.'}


def ts_validate(graphs: list, root: Path) -> list:
    proc = subprocess.run(['node',str(root/'scripts'/'validate-plan-candidate.mjs')], input=json.dumps(graphs),
                          capture_output=True,text=True,cwd=root,check=True)
    return json.loads(proc.stdout)


def downstream(result: dict, width: float=12.) -> dict:
    from geometry import build_model
    import trimesh
    graph=result['graph']; vertices={v['id']:v for v in graph['vertices']}
    rooms=[];polygons=[]
    for index,face in enumerate(polygonize([LineString([(vertices[w['a']]['x'],vertices[w['a']]['y']), (vertices[w['b']]['x'],vertices[w['b']]['y'])]) for w in graph['walls']])):
        room={'id':str(index),'name':f'Face {index}','level_id':'benchmark','category':'indoor','height':2.7}
        rooms.append(room);polygons.append({'room_id':room['id'],'level_id':'benchmark','points':[{'x':x,'y':y} for x,y in list(face.exterior.coords)[:-1]]})
    glb,encoded=build_model({'id':'benchmark','layout_width_m':width},[{'id':'benchmark','name':'Benchmark','elevation':0,'canvas_width':result['quality']['width'],'canvas_height':result['quality']['height']}],rooms,polygons,[],[{'level_id':'benchmark','graph':graph}])
    manifest=json.loads(encoded)
    mesh=trimesh.load(file_obj=io.BytesIO(glb),file_type='glb',force='scene')
    if len(manifest['walls'])!=sum(w['kind']!='virtual' for w in graph['walls']): raise ValueError('Shared wall extrusion count mismatch')
    if not mesh.geometry: raise ValueError('Empty GLB')
    return {'succeeded':True,'bytes':len(glb),'physical_wall_count':len(manifest['walls']),'room_faces':len(rooms),'test_width_m':width}


def run(manifest_path: Path, split: str, root: Path, debug_dir: Path | None=None) -> dict:
    config=json.loads(manifest_path.read_text(encoding='utf-8'))
    hashes={}
    for item in config['fixtures']:
        digest=hashlib.sha256((manifest_path.parent/item['image']).read_bytes()).hexdigest()
        if digest in hashes and hashes[digest]!=item['split']: raise ValueError('The same image is in development and held-out splits')
        hashes[digest]=item['split']
    report={'split':split,'cases':[],'production_ready':False,'status':'no_verified_fixtures',
            'semantic_comparison':'not run unless a licensed model manifest is configured',
            'correction_time':'Only operator-recorded correction_seconds is reported; no fabricated time estimates.'}
    for item in config['fixtures']:
        if item['split']!=split: continue
        raw=(manifest_path.parent/item['image']).read_bytes()
        truth=json.loads((manifest_path.parent/item['truth']).read_text(encoding='utf-8'))
        if not truth.get('verified_by') or not truth.get('verified_at') or truth.get('image_sha256')!=hashlib.sha256(raw).hexdigest(): raise ValueError(f"Unverified or stale ground truth: {item['id']}")
        if validate(truth['graph']) or ts_validate([truth['graph']],root)[0]: raise ValueError(f"Invalid ground truth: {item['id']}")
        for semantic in (False,True):
            case_debug=debug_dir/item['id']/('semantic' if semantic else 'cv') if debug_dir else None
            result,_=analyze_plan(raw,use_semantic=semantic,debug_dir=case_debug)
            case={'id':item['id'],'mode':'semantic+geometry' if semantic else 'CV-only','status':result['status'],
                  'structure_confidence':result.get('structure_confidence'),'semantic_confidence':result.get('semantic_confidence'),
                  'opening_confidence':result.get('opening_confidence'),'scale_confidence':result.get('scale_confidence'),
                  'reference_kind':truth.get('reference_kind','human_verified'),
                  'errors':result['validation_errors'],'quality':result['quality'],'model':result['model'],
                  'manual_correction_seconds':item.get('correction_seconds')}
            if semantic and not result['model']['available']: case['semantic_evidence']='unavailable; structure evaluated independently'
            if result['graph'] and result['status'] in ('USABLE','NEEDS_REVIEW','candidate'):
                problem=ts_validate([result['graph']],root)[0]
                case['typescript_validation']=problem
                if not problem:
                    case['metrics']=metrics(result['graph'],truth|{'predicted_rooms':result['room_candidates']},result['quality']['height']/result['quality']['width'])
                    case['metrics']['unresolved_elements']=len(result['unresolved'])+sum(r['confidence']<.5 for r in result['room_candidates'])
                    try: case['downstream_3d']=downstream(result,truth.get('width_m') or 12.)
                    except (ValueError,RuntimeError,KeyError) as exc:
                        case['downstream_3d']={'succeeded':False,'error':str(exc)}
                        case['status']='downstream_failed'
                else: case['status']='invalid_topology'
            report['cases'].append(case)
    if report['cases']:
        report['status']='evaluated_requires_human_assessment'
        report['semantic_comparison']='Optional semantic/opening evidence after identical raster structural reconstruction'
    report['reference_counts']={'authored_analytic':sum(item.get('kind')=='authored_analytic' and item['split']==split for item in config['fixtures']),
                                'human_verified':sum(item.get('kind')!='authored_analytic' and item['split']==split for item in config['fixtures'])}
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('manifest',type=Path)
    parser.add_argument('--split',choices=['development','held-out'],default='held-out')
    parser.add_argument('--debug-dir',type=Path,default=None)
    parser.add_argument('--output',type=Path,default=Path('benchmark-results.json'))
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[3]
    result=run(args.manifest,args.split,root,args.debug_dir)
    args.output.write_text(json.dumps(result,indent=2,allow_nan=False),encoding='utf-8')
    print(f"{result['status']}: {len(result['cases'])} cases; production_ready=false; report={args.output}")
