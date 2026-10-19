"""Offline reproducible export of the published MIT floor-plan model.

No project code is downloaded/executed. The architecture is provided by the
installed segmentation-models-pytorch package; weights use safetensors, not pickle.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
import onnxruntime as ort
import segmentation_models_pytorch as smp
from safetensors.torch import load_file
import torch

REVISION='68843a3ab7b12aa03b23c36f955a0d8099b4e2ee'
WEIGHT_SHA='d7f6a0fd06e2931aecfc8c4849192c5e153701578026efc78d9a6246731a8d6c'


def export(weights: Path, destination: Path):
    if hashlib.sha256(weights.read_bytes()).hexdigest()!=WEIGHT_SHA: raise ValueError('Unexpected pretrained weight SHA256')
    torch.set_num_threads(2)
    model=smp.Unet(encoder_name='resnet34',encoder_weights=None,in_channels=3,classes=4).eval()
    model.load_state_dict(load_file(str(weights)),strict=True)
    destination.mkdir(parents=True,exist_ok=True)
    output=destination/'model.onnx'
    torch.manual_seed(17)
    sample=torch.randn(1,3,512,512)
    with torch.inference_mode():
        expected=model(sample).numpy()
        torch.onnx.export(model,sample,str(output),input_names=['image'],output_names=['logits'],opset_version=17,dynamo=False)
    options=ort.SessionOptions(); options.intra_op_num_threads=2; options.inter_op_num_threads=1
    session=ort.InferenceSession(str(output),sess_options=options,providers=['CPUExecutionProvider'])
    actual=session.run(None,{'image':sample.numpy()})[0]
    error=float(np.max(np.abs(expected-actual)))
    if not np.allclose(expected,actual,atol=5e-4,rtol=5e-4): raise ValueError(f'ONNX parity failed: {error}')
    spec={'name':'Yytsi floorplan-to-3d-walls / ResNet34-UNet','version':REVISION,
        'source':f'https://huggingface.co/Yytsi/floorplan-to-3d-walls/tree/{REVISION}',
        'license':'MIT (published model card); trained on CubiCasa5K',
        'license_url':'https://huggingface.co/Yytsi/floorplan-to-3d-walls#license',
        'commercial_use_permitted':True,'weights':'model.onnx','sha256':hashlib.sha256(output.read_bytes()).hexdigest(),
        'source_weights_sha256':WEIGHT_SHA,'input_size':512,'resize_mode':'letterbox',
        'mean':[.485,.456,.406],'std':[.229,.224,.225],
        'classes':{'floor':0,'wall':1,'door':2,'window':3},'onnx_export_max_abs_error':error,
        'export_versions':{'torch':torch.__version__,'segmentation_models_pytorch':smp.__version__}}
    (destination/'manifest.json').write_text(json.dumps(spec,indent=2),encoding='utf-8')
    shutil.copyfile(Path(__file__).with_name('YYTSI_LICENSE.txt'),destination/'LICENSE.txt')
    print(json.dumps(spec,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('weights',type=Path)
    parser.add_argument('destination',type=Path)
    args=parser.parse_args()
    export(args.weights,args.destination)
