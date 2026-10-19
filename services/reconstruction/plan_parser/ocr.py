import re
from functools import lru_cache

import numpy as np

LABELS = {
    'master bedroom': 'bedroom', 'bedroom': 'bedroom', 'bed room': 'bedroom',
    'family room': 'living_room', 'kitchen': 'kitchen', 'living room': 'living_room', 'living': 'living_room',
    'dining area': 'dining_room', 'dining': 'dining_room', 'bathroom': 'bathroom',
    'bath': 'bathroom', 'washroom': 'utility', 'wash room': 'utility', 'closet': 'store',
    'store': 'store', 'office': 'office', 'garage': 'garage', 'corridor': 'corridor',
    'hall': 'corridor', 'utility': 'utility',
}


def normalize_label(text: str) -> str | None:
    normalized = re.sub(r'[^a-z ]', '', text.lower()).strip()
    return next((kind for label,kind in LABELS.items() if re.search(r'\b'+re.escape(label)+r'\b', normalized)), None)


@lru_cache(maxsize=1)
def _engine():
    from rapidocr import RapidOCR
    return RapidOCR(params={'EngineConfig.onnxruntime.intra_op_num_threads':2,
                            'EngineConfig.onnxruntime.inter_op_num_threads':1,'Global.log_level':'warning'})


def _unrotate(points,turns,w,h):
    p=np.asarray(points,dtype=float).copy()
    if turns==1: return np.column_stack((w-1-p[:,1],p[:,0]))
    if turns==2: return np.column_stack((w-1-p[:,0],h-1-p[:,1]))
    if turns==3: return np.column_stack((p[:,1],h-1-p[:,0]))
    return p


def recognize(rgb: np.ndarray) -> tuple[list[dict],dict]:
    try:
        engine=_engine();labels=[];orientations=[]
        h,w=rgb.shape[:2]
        # Always try the original. If room-label evidence is sparse, try the
        # remaining quarter turns; boxes/centroids return to working coordinates.
        for turns in (0,1,2,3):
            if turns and sum(bool(label['space_type']) for label in labels)>=3: break
            image=np.ascontiguousarray(np.rot90(rgb,turns)[...,::-1])
            output=engine(image);orientations.append(turns*90)
            for box,text,score in zip(output.boxes if output.boxes is not None else [],output.txts if output.txts is not None else [],output.scores if output.scores is not None else []):
                restored=_unrotate(box,turns,w,h);center=restored.mean(axis=0)
                existing=next((item for item in labels if np.linalg.norm(np.array(item['center'])-center)<max(10,min(w,h)*.015)
                    and (item['text'].lower()==text.lower() or item['space_type'] and item['space_type']==normalize_label(text))),None)
                label={'text':text,'space_type':normalize_label(text),'confidence':float(score),
                       'center':center.tolist(),'box':restored.tolist(),'orientation_degrees':turns*90}
                if existing:
                    if score>existing['confidence']: existing.update(label)
                else: labels.append(label)
        return labels,{'available':True,'engine':'RapidOCR / PP-OCR ONNX','geometry_modified':False,'orientations_evaluated':orientations}
    except Exception as exc:
        return [],{'available':False,'reason':str(exc)[:200],'geometry_modified':False}


def dimensions(labels: list[dict]) -> list[dict]:
    result = []
    pattern = re.compile(r'(?<!\d)(\d+(?:[.,]\d+)?)\s*(mm|cm|m|ft|feet|\x27)(?![a-z])', re.I)
    for label in labels:
        match = pattern.search(label['text'])
        if match:
            value = float(match[1].replace(',', '.'))
            unit = match[2].lower()
            metres = value * {'mm':.001,'cm':.01,'m':1,'ft':.3048,'feet':.3048,"'":.3048}[unit]
            result.append({'raw_text':label['text'], 'metres':metres, 'confidence':label['confidence'],
                           'center':label['center'], 'accepted':False,
                           'reason':'Dimension endpoints are not established; use wall calibration.'})
    return result
