# Reconstruction recovery — Plan 2 lower-right office

Date: 24 October 2026 (Africa/Lagos).

## Reproduction and cause

The private original `plan 2.png` is 333 × 600 pixels, SHA256
`cbcf98d38a3d26559d5e798948d067e7149193d0d198feee5f6830388c17fbe1`.
It remains under `.local-backups/recovery-20261020/evidence/pvs test/` and is
not committed. CV-only parsing reproduced the stored candidate's **45 physical
wall segments and eight closed faces**. The lower-right office was outside the
retained building footprint. Semantic mode uses the same raster structure.

The working raster is 900 × 1,622 pixels. The right exterior axis at approximately
`x=824` is extracted through `y=1,370`. Its lower dark section around
`y=1,491..1,559` is visible in the threshold masks, but directional morphology
classed its roughly 17 × 68 pixel component as too wide for its length:
`17 / 68 = 0.25`, above the former 0.22 aspect cutoff. The window region between
the sections has only thin line evidence. Consequently, no lower right exterior
axis reaches the bottom wall. GEOS cannot close the office face and correctly
excludes the dangling office top and bottom edges from its face-bound graph.
The evidence is lost first in **structural axis extraction**, with face loss a
downstream consequence. This is not an OCR or semantic-label failure.

The extractor now admits short components up to a 0.35 aspect ratio only when
their stroke passes the existing structural threshold and they continue an
independently supported, long collinear axis within the existing bounded gap.
Isolated compact furniture strokes still fail that continuation test. The
existing junction/GEOS reconciliation and single shared-wall graph are unchanged.

## Structural results

The observation gate uses three normalized points: office `(0.72, 0.89)`,
room above `(0.72, 0.72)`, and corridor west `(0.50, 0.89)`. It requires a
separate office face with shared boundaries to both neighbors. These are
visual observations, **not** a complete human-verified reference graph.

| Measure | Before | After |
|---|---:|---:|
| Physical wall segments | 45 | 47 |
| Enclosed faces | 8 | 9 |
| Office face at observed point | Absent | Present |
| Office shared boundary with room above, in image-width units | 0 | 0.386934 |
| Office shared boundary with corridor west, in image-width units | 0 | 0.251996 |
| Discarded structural length fraction | 0.2605 | 0.2209 |
| Python topology errors | 0 | 0 |

The restored office face spans normalized `x=0.528983..0.915918` and
`y=0.815344..0.955201`; its normalized area is 0.054116. The other eight
faces have before/after IoU from 0.999881 to 1.000000. The footprint area grows
from 0.668080 to 0.722186 in normalized image coordinates, corresponding to
the previously omitted office area. Both CV-only and semantic-enabled runs
return `NEEDS_REVIEW`, pass the existing TypeScript graph validator, and build
a GLB with 47 physical walls extruded once. The semantic model changes optional
review evidence, not the structural graph.

The authored clean-dark and gray-furnished regression plans still have three
faces, ten physical walls, wall precision and recall of 1.000, room adjacency
precision and recall of 1.000, and zero topology errors in both parser modes.
The neighboring private Plan 1 development image still returns `NEEDS_REVIEW`
with 35 wall segments and nine faces in CV-only mode.
The parser test suite passes (23 tests), including a short thick continuation
case and a private-source Plan 2 face/adjacency check. The private-source check
is skipped when the ignored image is unavailable. The analytic fixtures do not
measure real-plan accuracy.

## Evaluation workflow and remaining uncertainty

`services/reconstruction/tests/plan_parser/recovery-manifest.json` registers
this private source as `observed_real` in the existing evaluation CLI. The CLI
checks its SHA256, reports observational face and adjacency metrics, validates
the graph in Python and TypeScript, and runs the GLB builder. Results are in
`services/reconstruction/tests/plan_parser/recovery-results.json`. To rerun in
the workspace containing the private image:

```powershell
$env:PYTHONPATH='services/reconstruction'
services/reconstruction/.venv/Scripts/python.exe -m plan_parser.evaluate services/reconstruction/tests/plan_parser/recovery-manifest.json --split development --output services/reconstruction/tests/plan_parser/recovery-results.json
```

This case is development-only and is not counted as a human-verified or held-out
pair. Without a verified full reference graph, wall precision/recall, room IoU,
opening accuracy, and scale error cannot be claimed for Plan 2. The nine faces
are structural closures, not nine verified room identities. OCR labels, door
and window types/extents, calibration, and acceptance/reopen behavior still
require review. The evaluated GLB uses the harness's arbitrary 12 m test width;
it does not establish a real building dimension. No authoritative saved layout
or production worker was changed by this parser evaluation.
