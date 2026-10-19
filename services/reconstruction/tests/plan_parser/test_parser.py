"""Analytically constructed drawings for unit tests, never reported as real benchmarks."""
import hashlib
import io
import json

import cv2
import numpy as np
import pytest
from PIL import Image
from shapely.geometry import Polygon

from plan_parser import analyze_plan
from plan_parser.reconcile import reconcile
from plan_parser.vectorize import vectorize
from plan_parser.preprocess import prepare
from plan_parser.topology import validate
from plan_parser.ocr import normalize_label, dimensions
from plan_parser.evaluate import downstream, metrics


def drawing(concave=False):
    image=np.full((800,1000,3),255,np.uint8)
    points=[(100,100),(900,100),(900,450),(650,450),(650,700),(100,700)] if concave else [(100,100),(900,100),(900,700),(100,700)]
    cv2.polylines(image,[np.array(points)],True,(0,0,0),8)
    cv2.line(image,(500,100),(500,700),(0,0,0),8)
    return cv2.imencode('.png',image)[1].tobytes()


def test_native_input_unchanged_and_shared_wall_candidate():
    raw=drawing(); before=hashlib.sha256(raw).hexdigest()
    result,normalized=analyze_plan(raw,use_semantic=False,use_ocr=False)
    assert result['quality']['width']==1000 and result['quality']['height']==800
    assert result['input_sha256']==before and hashlib.sha256(raw).hexdigest()==before
    assert Image.open(io.BytesIO(normalized)).size==(1000,800)
    assert result['status'] in ('USABLE','NEEDS_REVIEW'),result['validation_errors']
    assert not result['graph']['property_boundary']
    assert len(result['room_candidates'])==2
    assert sum(w['kind']=='interior' for w in result['graph']['walls'])==1
    assert not validate(result['graph'])
    assert result['scale']['width_m'] is None
    assert json.loads(json.dumps(result))['graph']==result['graph']
    assert downstream(result)['succeeded']


def test_concave_footprint_is_not_a_bounding_rectangle():
    result,_=analyze_plan(drawing(True),use_semantic=False,use_ocr=False)
    assert result['status'] in ('USABLE','NEEDS_REVIEW'),result['validation_errors']
    vertices={v['id']:v for v in result['graph']['vertices']}
    poly=Polygon([(vertices[k]['x'],vertices[k]['y']) for k in result['graph']['building_boundary']])
    assert poly.area < poly.envelope.area*.9


def test_unusable_images_refuse_without_geometry():
    image=np.full((800,1000,3),255,np.uint8)
    result,_=analyze_plan(cv2.imencode('.png',image)[1].tobytes(),use_ocr=False)
    assert result['status']=='FAILED' and result['graph'] is None
    assert result['quality']['errors']
    with pytest.raises((ValueError,OSError)): analyze_plan(b'not an image')


def test_crossing_walls_node_exactly_and_angled_edges_are_preserved():
    segments=[(np.array(a,dtype=float),np.array(b,dtype=float)) for a,b in [
        ((100,100),(800,150)),((800,150),(900,700)),((900,700),(100,700)),((100,700),(100,100)),
        ((450,125),(500,700)),((100,400),(845,425))]]
    edges,building,_=reconcile(segments,(1000,800))
    prepared=prepare(drawing())
    graph,rooms,_,_=vectorize(edges,building,prepared,[],{})
    assert not validate(graph)
    assert len(rooms)==4
    assert len({(v['x'],v['y']) for v in graph['vertices']})==len(graph['vertices'])


def test_ocr_maps_labels_without_guessing_scale():
    assert normalize_label('MASTER BEDROOM 2')=='bedroom'
    assert normalize_label('WASHROOM')=='utility'
    assert normalize_label('SOFA') is None
    result=dimensions([{'text':'12.5 m','center':[100,50],'confidence':.99}])
    assert result[0]['metres']==12.5 and not result[0]['accepted']


def test_metrics_identity_and_missing_walls():
    result,_=analyze_plan(drawing(),use_semantic=False,use_ocr=False)
    graph=result['graph']
    report=metrics(graph,{'graph':graph,'rooms':[]},.8)
    assert report['wall_precision']==report['wall_recall']==1
    assert report['room_polygon_iou']==pytest.approx(1)
    assert report['estimated_edit_operations']==0
    assert report['scale_relative_error'] is None


def test_no_floating_or_overlapping_opening_is_valid():
    result,_=analyze_plan(drawing(),use_semantic=False,use_ocr=False)
    graph=result['graph']
    graph['openings']=[{'id':'bad','wall_id':'missing','type':'standard_window','start':.1,'end':.3,'height':1.2,'sill':.9}]
    assert 'Orphan opening' in validate(graph)


def test_virtual_room_boundary_has_no_physical_extrusion():
    result,_=analyze_plan(drawing(),use_semantic=False,use_ocr=False)
    graph=result['graph']
    partition=next(w for w in graph['walls'] if w['kind']=='interior')
    partition['kind']='virtual'
    assert not validate(graph)
    checked=downstream(result)
    assert checked['room_faces']==2
    assert checked['physical_wall_count']==len(graph['walls'])-1
    graph['openings']=[{'id':'bad','wall_id':partition['id'],'type':'standard_window','start':.2,'end':.4,'height':1.2,'sill':.9}]
    assert 'Opening requires a physical wall' in validate(graph)


def test_multiple_open_area_labels_do_not_invent_partitions():
    raw=drawing(); prepared=prepare(raw)
    segments=[(np.array(a,float),np.array(b,float)) for a,b in [((100,100),(900,100)),((900,100),(900,700)),((900,700),(100,700)),((100,700),(100,100))]]
    edges,building,_=reconcile(segments,(1000,800))
    labels=[{'space_type':'kitchen','text':'Kitchen','confidence':.99,'center':[200,300]},
            {'space_type':'dining_room','text':'Dining','confidence':.99,'center':[700,300]}]
    graph,rooms,_,_=vectorize(edges,building,prepared,labels,{})
    assert len(graph['walls'])==4 and len(rooms)==1
    assert rooms[0]['space_type']=='other' and len(rooms[0]['label_options'])==2


def test_semantic_letterbox_contract(monkeypatch,tmp_path):
    import plan_parser.semantic as semantic
    class Input: name='image'
    class Session:
        def get_inputs(self): return [Input()]
        def run(self,_,inputs):
            assert inputs['image'].shape==(1,3,256,256)
            logits=np.zeros((1,4,256,256),np.float32);logits[:,1]=4
            return [logits]
    monkeypatch.setattr(semantic,'_session',lambda *args:Session())
    manifest={'name':'unit-test','version':'1','source':'analytic fixture','license':'test','commercial_use_permitted':True,
              'sha256':'test','weights':'test.onnx','classes':{'wall':1},'mean':[.5]*3,'std':[.5]*3,'input_size':256,'resize_mode':'letterbox'}
    path=tmp_path/'manifest.json';path.write_text(json.dumps(manifest))
    masks,model=semantic.evidence(np.full((80,120,3),255,np.uint8),str(path))
    assert masks['wall'].shape==(80,120) and masks['wall'].min()>.9 and model['available']


def test_reconciliation_preserves_unresolved_structural_evidence_for_review():
    square=[(np.array(a,float),np.array(b,float)) for a,b in [((100,100),(300,100)),((300,100),(300,300)),((300,300),(100,300)),((100,300),(100,100)),((200,100),(200,750)),((100,200),(900,200))]]
    _,_,info=reconcile(square,(1000,800))
    assert info['discarded_structural_length_fraction']>.2
    assert info['unresolved_structural_fragments']


@pytest.mark.parametrize('name',['clean-dark','gray-furnished'])
def test_orthogonal_baseline_gaps_annotations_and_furniture(name,tmp_path):
    from pathlib import Path
    fixture=Path(__file__).with_name('fixtures')/name
    truth=json.loads(fixture.with_suffix('.truth.json').read_text())
    result,_=analyze_plan(fixture.with_suffix('.png').read_bytes(),use_semantic=False,use_ocr=False,debug_dir=tmp_path)
    assert result['status']=='NEEDS_REVIEW',result['validation_errors']
    measured=metrics(result['graph'],truth,.8)
    assert measured['wall_precision']>.95 and measured['wall_recall']>.95
    assert measured['building_footprint_iou']>.98
    assert measured['detected_room_count']==measured['ground_truth_room_count']==3
    assert measured['room_adjacency_precision']==measured['room_adjacency_recall']==1
    assert measured['invalid_topology_count']==0
    assert len(result['unresolved'])>=4 and all(item.get('wall_id') for item in result['unresolved'])
    assert downstream(result)['succeeded']
    assert len(list(tmp_path.rglob('*.png')))==10


@pytest.mark.parametrize('width',[350,600,1400])
def test_resolution_normalization_maps_back_to_original_coordinates(width):
    from pathlib import Path
    source=cv2.imread(str(Path(__file__).with_name('fixtures')/'gray-furnished.png'))
    resized=cv2.resize(source,(width,round(width*.8)),interpolation=cv2.INTER_AREA if width<500 else cv2.INTER_CUBIC)
    result,_=analyze_plan(cv2.imencode('.png',resized)[1].tobytes(),use_semantic=False,use_ocr=False)
    assert result['structure_confidence']['valid'],result['validation_errors']
    vertices={v['id']:v for v in result['graph']['vertices']}
    footprint=Polygon([(vertices[key]['x'],vertices[key]['y']) for key in result['graph']['building_boundary']])
    assert footprint.bounds==pytest.approx((.14,.175,.86,.825),abs=.012)
    assert result['summary']['enclosed_spaces']==3


def test_optional_model_and_ocr_failure_cannot_discard_valid_structure(monkeypatch):
    import plan_parser.pipeline as pipeline
    stages=[]
    original=pipeline.reconcile
    def structure(*args):
        stages.append('structure');return original(*args)
    def fail(*args):
        assert stages==['structure'];raise RuntimeError('optional evidence failed')
    monkeypatch.setattr(pipeline,'reconcile',structure)
    monkeypatch.setattr(pipeline,'evidence',fail);monkeypatch.setattr(pipeline,'recognize',fail)
    result,_=pipeline.analyze_plan(drawing())
    assert result['status']=='NEEDS_REVIEW' and result['graph']
    assert result['structure_confidence']['valid'] and not result['validation_errors']
    assert not result['ocr']['available'] and result['optional_warnings']


def test_rotated_ocr_coordinates_return_to_working_image(monkeypatch):
    import plan_parser.ocr as ocr
    from types import SimpleNamespace
    seen=[]
    def engine(image):
        seen.append(image.shape)
        return SimpleNamespace(boxes=[np.array([[5,10],[15,10],[15,20],[5,20]])],txts=['BEDROOM'],scores=[.95])
    monkeypatch.setattr(ocr,'_engine',lambda:engine)
    labels,metadata=ocr.recognize(np.full((80,120,3),255,np.uint8))
    assert metadata['orientations_evaluated']==[0,90,180]
    rotated=next(label for label in labels if label['orientation_degrees']==90)
    assert rotated['center']==pytest.approx([104,10])
    assert not metadata['geometry_modified']


def test_failure_debug_artifacts_show_unreached_stages(tmp_path):
    raw=cv2.imencode('.png',np.full((300,400,3),255,np.uint8))[1].tobytes()
    result,_=analyze_plan(raw,use_semantic=False,use_ocr=False,debug_dir=tmp_path)
    assert result['status']=='FAILED' and result['failed_stage']=='quality'
    assert len(list(tmp_path.rglob('*.png')))==10


@pytest.mark.parametrize('score,expected',[(.99,'USABLE'),(.2,'NEEDS_REVIEW')])
def test_result_states_depend_on_structure_then_label_certainty(monkeypatch,score,expected):
    import plan_parser.pipeline as pipeline
    labels=[{'text':'BEDROOM','space_type':'bedroom','confidence':score,'center':[250,400]},
            {'text':'KITCHEN','space_type':'kitchen','confidence':score,'center':[750,400]}]
    monkeypatch.setattr(pipeline,'recognize',lambda *args:(labels,{'available':True}))
    result,_=pipeline.analyze_plan(drawing(),use_semantic=False)
    assert result['status']==expected
    assert result['structure_confidence']['valid'] and not result['validation_errors']
