"""Structure first; optional semantic, OCR and opening failures never veto topology."""
import io
import os
import time
import numpy as np
from PIL import Image

from .preprocess import prepare
from .semantic import evidence
from .lines import extract
from .ocr import recognize, dimensions
from .reconcile import reconcile
from .vectorize import vectorize
from .topology import validate
from .confidence import report
from .debug import Debug, NAMES

VERSION='0.2.0-orthogonal-baseline'


def analyze_plan(raw: bytes, use_semantic: bool=True, use_ocr: bool=True, debug_dir=None) -> tuple[dict,bytes]:
    started=time.monotonic();prepared=prepare(raw)
    output=io.BytesIO();Image.fromarray(prepared.rgb).save(output,format='PNG')
    debug=Debug(prepared,debug_dir or os.environ.get('PLAN_PARSER_DEBUG_DIR'))
    result={'parser_version':VERSION,'input_sha256':prepared.digest,'quality':prepared.quality,
        'graph':None,'room_candidates':[],'unresolved':[],'validation_errors':[],
        'scale':{'status':'calibration_required','width_m':None,'dimensions':[]},
        'status':'FAILED','failed_stage':None,'model':{'available':False,'name':'CV-only'},
        'stage_order':['preprocess','structural_axes','reconcile','faces','semantic','ocr','openings'],
        'structure_confidence':{'score':0.,'valid':False},'semantic_confidence':{'score':0.},
        'opening_confidence':{'score':0.},'scale_confidence':{'score':0.,'reason':'Wall measurement required'}}
    stage='quality'
    try:
        if not prepared.quality['accepted']: raise ValueError('; '.join(prepared.quality['errors']))
        stage='structural_axes'
        segments,line_info=extract(prepared.binary,{},prepared.thresholds)
        debug.save(NAMES[2],line_info.pop('structural_mask'))
        raw_axes=line_info.pop('raw_axes')
        debug.lines(NAMES[3],[(np.array([r['lo'],r['at']]) if r['axis']==0 else np.array([r['at'],r['lo']]),
                              np.array([r['hi'],r['at']]) if r['axis']==0 else np.array([r['at'],r['hi']])) for r in raw_axes])
        debug.lines(NAMES[4],segments)
        result.update(line_evidence=line_info,line_candidates=[[a.tolist(),b.tolist()] for a,b in segments])
        h,w=prepared.binary.shape;stage='reconcile'
        edges,building,reconciliation=reconcile(segments,(w,h),line_info['estimated_stroke_px'])
        result['reconciliation']=reconciliation;debug.structure(edges,building)
        stage='faces'
        graph,rooms,_,_=vectorize(edges,building,prepared,[],{})
        errors=validate(graph)
        if errors: raise ValueError('; '.join(errors))
        # Structure is now complete. Optional evidence cannot make it disappear.
        masks={};labels=[];ocr={'available':False,'reason':'disabled'}
        model={'available':False,'name':'CV-only'};optional_errors=[]
        if use_semantic:
            try: masks,model=evidence(prepared.rgb)
            except Exception as exc: optional_errors.append('Semantic evidence unavailable: '+str(exc)[:200])
        if use_ocr:
            try: labels,ocr=recognize(prepared.rgb)
            except Exception as exc: ocr={'available':False,'reason':str(exc)[:200]}
        result.update(model=model,ocr=ocr,labels=labels);debug.labels(labels)
        unresolved=[];opening_meta={}
        try:
            enriched,enriched_rooms,unresolved,opening_meta=vectorize(edges,building,prepared,labels,masks,line_info.get('gap_candidates',[]))
            # Keep reliable structure even if optional opening projections conflict.
            if validate(enriched):
                enriched['openings']=[];opening_meta={}
                optional_errors.append('Opening projections require manual placement; structural graph retained.')
            if not validate(enriched): graph,rooms=enriched,enriched_rooms
        except Exception as exc: optional_errors.append('Label/opening review required: '+str(exc)[:200])
        def normalized_points(pixels):
            points=[]
            for pixel in pixels:
                q=prepared.inverse@np.array([*pixel,1.])
                points.append({'x':float(q[0]/prepared.quality['width']),'y':float(q[1]/prepared.quality['height'])})
            return points
        for gap in line_info.get('gap_candidates',[]):
            points=normalized_points(gap['points'])
            # A proposal is wall-bound even when its door/window kind is unknown.
            from shapely.geometry import Point,LineString
            midpoint=Point(np.mean(gap['points'],axis=0))
            ranked=sorted([(LineString(edge).distance(midpoint),wall) for edge,wall in zip(sorted(edges),graph['walls'])],key=lambda item:item[0])
            host=ranked[0][1]['id'] if ranked and ranked[0][0]<line_info['estimated_stroke_px']*2 else None
            unresolved.append({'kind':'wall gap','points':points,'box':[],'wall_id':host,'confidence':gap['confidence'],
                'reason':'Host wall reconstructed through raster gap; review door/window/open passage type and extent.'})
        for fragment in reconciliation.get('unresolved_structural_fragments',[]):
            unresolved.append({'kind':'structural fragment','points':normalized_points(fragment),'box':[],
                'reason':'Evidence does not terminate in an enclosed face; inspect or correct with existing partition tools.'})
        confidence=report(graph,rooms,model,reconciliation,opening_meta)
        missing_labels=sum(r['space_type']=='other' for r in rooms)
        needs_review=bool(unresolved or missing_labels or optional_errors or graph['openings'])
        structure_score=max(.5,.92-min(.35,reconciliation['discarded_structural_length_fraction']*.4))
        result.update(graph=graph,room_candidates=rooms,unresolved=unresolved,confidence=confidence,
            status='NEEDS_REVIEW' if needs_review else 'USABLE',optional_warnings=optional_errors,
            structure_confidence={'score':round(structure_score,3),'valid':True,'method':'topology validity + retained structural evidence; heuristic'},
            semantic_confidence={'score':round(float(np.mean([r['confidence'] for r in rooms])),3) if labels else 0.,'labels_detected':len(labels)},
            opening_confidence={'score':.65 if opening_meta else 0.,'review_candidates':len(unresolved)},
            summary={'wall_segments':len(graph['walls']),'enclosed_spaces':len(rooms),
                'doors':sum('door' in o['type'] for o in graph['openings']),
                'windows':sum('window' in o['type'] for o in graph['openings']),
                'unresolved_openings':sum(item['kind']!='structural fragment' for item in unresolved),'unidentified_rooms':missing_labels})
        result['scale']['dimensions']=dimensions(labels);debug.openings(unresolved)
    except (ValueError,RuntimeError,OSError,ImportError) as exc:
        result['validation_errors']=[str(exc)];result['failed_stage']=stage
    result['duration_seconds']=round(time.monotonic()-started,3)
    return result,output.getvalue()
