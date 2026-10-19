# Semantic model contract and provenance

The worker loads an explicitly configured ONNX model using `PLAN_PARSER_MODEL_MANIFEST`.
Weights never enter the authoritative graph and are not loaded as Python/pickle code.
The original upload remains unchanged. Small images use a normalized structural
working copy with an exact inverse transform; semantic inference letterboxes separately.
Raster axes and faces are reconstructed before the optional model or OCR runs.
Model output can propose wall-bound openings but cannot replace the structural graph.
Every analysis records model name, immutable version, license, source and SHA256.

## Selected pretrained model

- Model: ResNet34–UNet, `Yytsi/floorplan-to-3d-walls`.
- Published model revision: `68843a3ab7b12aa03b23c36f955a0d8099b4e2ee`.
- [Model card and stated MIT weights license](https://huggingface.co/Yytsi/floorplan-to-3d-walls).
- [Architecture source](https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/model.py): segmentation-models-pytorch UNet, 3 input channels, 4 output classes.
- [Class order](https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/labels.py): floor, wall, door, window.
- `best.safetensors`: 97,851,168 bytes; SHA256 `d7f6a0fd06e2931aecfc8c4849192c5e153701578026efc78d9a6246731a8d6c`.
- 512 × 512 RGB, aspect-preserving centered letterbox, ImageNet mean/std normalization.
- The model card states training on CubiCasa5K. Its reported segmentation accuracy is an upstream claim, not this application's topology benchmark result.
- The original [CubiCasa5K model and dataset](https://github.com/CubiCasa/CubiCasa5k) carry [CC BY-NC 4.0](https://github.com/CubiCasa/CubiCasa5k/blob/master/LICENSE). Those original weights are not bundled or enabled. Dataset licensing remains separate from a downstream publisher's stated model license; retain this provenance for deployment review.

Install `requirements-export.txt` in a development environment, download the pinned safetensors file from the model card's official repository, and run:

```powershell
services/reconstruction/.venv/Scripts/python.exe services/reconstruction/tools/export_yytsi.py path/to/best.safetensors path/to/exported-model
$env:PLAN_PARSER_MODEL_MANIFEST = (Resolve-Path path/to/exported-model/manifest.json).Path
```

The exporter verifies the source weight hash, loads the standard library architecture, checks strict state-dict compatibility, exports ONNX, and compares ONNX logits against PyTorch on a fixed input. It writes a manifest containing the export hash and library versions. Deploy the ONNX file and manifest as server files/volume mounts; only ONNX Runtime is needed in the worker. Do not commit the model weights or user images.

## Other adapters

The JSON manifest specifies `name`, `version`, `source`, `license`, `commercial_use_permitted`, `weights` (relative ONNX path), `sha256`, `input_size`, `mean`, `std`, and `classes`. `resize_mode` is `letterbox` or direct resize. Each class maps to output channel indices; multitask exports may use `{"channels":[2],"group":[21,33]}` to apply softmax only within that head. This supports a separately licensed floortrans-compatible export without coupling graph reconciliation to floortrans.

Models lacking commercial permission are refused by the worker unless `PLAN_PARSER_RESEARCH=1` is explicitly set for an offline research run. No general vision LLM generates geometry. If the model is absent, the UI explicitly reports CV-only mode.

## OCR

RapidOCR 3.10.0 is the tested OCR engine. Its packaged PP-OCR ONNX detector, orientation classifier and recognizer operate locally. Raw text, centroid, type mapping and confidence stay in candidate metadata. OCR never edits wall coordinates. Model details and package licenses are available in the [RapidOCR project](https://github.com/RapidAI/RapidOCR). The current package used PP-OCRv6 small detector/recognizer and the mobile v2 orientation classifier.

## Reproducible setup

```powershell
services/reconstruction/.venv/Scripts/python.exe -m pip install -r services/reconstruction/requirements-export.txt
services/reconstruction/.venv/Scripts/python.exe services/reconstruction/tools/setup_plan_model.py services/reconstruction/models/yytsi
```

The worker automatically discovers `models/yytsi/manifest.json`. An explicit
`PLAN_PARSER_MODEL_MANIFEST` overrides that path. For containers, mount the model
folder read-only at `/app/models/yytsi`; the runtime image excludes PyTorch and
export dependencies. Restart the worker after replacing a model manifest/weights.
The setup script downloads only pinned safetensors and verifies their hash before
export. Keep the publisher's MIT license notice with redistributed weights.
