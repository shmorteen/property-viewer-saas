"""Small ONNX adapter. Class channels, preprocessing and license are explicit.

No model/code/weights are fetched or unpickled at runtime. CV is always available.
"""
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path

import cv2
import numpy as np


@lru_cache(maxsize=2)
def _session(weights: str, digest: str):
    if hashlib.sha256(Path(weights).read_bytes()).hexdigest() != digest:
        raise ValueError('Semantic weights do not match the expected SHA256.')
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    return ort.InferenceSession(weights, sess_options=options, providers=['CPUExecutionProvider'])


def evidence(rgb: np.ndarray, manifest_path: str | None = None) -> tuple[dict, dict]:
    manifest_path = manifest_path or os.environ.get('PLAN_PARSER_MODEL_MANIFEST')
    default = Path(__file__).resolve().parent.parent / 'models/yytsi/manifest.json'
    if not manifest_path and default.is_file(): manifest_path = str(default)
    if not manifest_path:
        return {}, {'available': False, 'name': 'CV-only', 'reason': 'No licensed semantic model configured.'}
    path = Path(manifest_path).resolve()
    spec = json.loads(path.read_text(encoding='utf-8'))
    required = ('name', 'version', 'source', 'license', 'sha256', 'weights', 'classes', 'mean', 'std')
    if any(not spec.get(key) for key in required):
        raise ValueError('Semantic model manifest is missing source, version, license or tensor contract.')
    if not spec.get('commercial_use_permitted') and os.environ.get('PLAN_PARSER_RESEARCH') != '1':
        raise ValueError('This model is restricted to offline research; configure licensed weights for the product.')
    weights = (path.parent / spec['weights']).resolve()
    if weights.suffix != '.onnx':
        raise ValueError('Semantic weights must be ONNX with the expected SHA256.')
    session = _session(str(weights), spec['sha256'])
    h, w = rgb.shape[:2]
    size = int(spec.get('input_size', 1024))
    if not 256 <= size <= 2048: raise ValueError('Invalid model input size')
    # The structural CV branch remains native resolution; only model inference resizes.
    padding = None
    if spec.get('resize_mode') == 'letterbox':
        ratio = min(size/w,size/h)
        rw,rh = max(1,round(w*ratio)),max(1,round(h*ratio))
        left,top = (size-rw)//2,(size-rh)//2
        tensor = np.empty((size,size,3),np.float32)
        tensor[:] = np.array(spec['mean'],np.float32)
        tensor[top:top+rh,left:left+rw] = cv2.resize(rgb,(rw,rh)).astype(np.float32)/255
        padding = (left,top,rw,rh)
    else: tensor = cv2.resize(rgb, (size, size)).astype(np.float32) / 255
    tensor = (tensor - np.array(spec['mean'], np.float32)) / np.array(spec['std'], np.float32)
    output = session.run(None, {session.get_inputs()[0].name: tensor.transpose(2, 0, 1)[None]})[int(spec.get('output_index', 0))][0]
    if output.ndim != 3: raise ValueError('Expected semantic logits in NCHW layout')
    masks = {}
    for name, definition in spec['classes'].items():
        # Multi-task floortrans heads require separate softmax groups.
        group = definition.get('group', [0,len(output)]) if isinstance(definition,dict) else [0,len(output)]
        channels = definition['channels'] if isinstance(definition,dict) else definition
        channels = [channels] if isinstance(channels,int) else channels
        if not 0 <= group[0] < group[1] <= len(output) or any(c<0 or c>=group[1]-group[0] for c in channels): raise ValueError('Invalid semantic channel mapping')
        logits = output[group[0]:group[1]]
        logits = logits-logits.max(axis=0,keepdims=True)
        probabilities = np.exp(logits)
        probabilities /= probabilities.sum(axis=0,keepdims=True)
        mask = probabilities[channels].sum(axis=0)
        if padding:
            left,top,rw,rh=padding
            oh,ow=mask.shape
            mask=mask[round(top*oh/size):round((top+rh)*oh/size),round(left*ow/size):round((left+rw)*ow/size)]
        masks[name] = cv2.resize(mask, (w, h))
    return masks, {key: spec[key] for key in ('name', 'version', 'source', 'license', 'sha256')} | {'available': True}
