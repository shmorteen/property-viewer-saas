# Verified plan benchmark

Unit tests construct analytic drawings and are **not** evidence of real-plan accuracy.
The supplied 416 × 287 user plan is development-only. Its editor screenshot is a
review reference, not another raw plan or verified graph. No private images are
committed. `development-diagnostics.json` records both real-plan failure cases.

## Add a real verified pair

1. Obtain permission to use the original raster and keep benchmark data outside production storage.
2. Trace and verify its shared-wall LayoutGraph manually, including physical walls,
   virtual open-area boundaries, openings, room seeds and building vertex ring.
3. Record the reviewer, date, image SHA256, rooms, and defensible scale if known.
4. Put the image and truth JSON beside a local manifest. Assign each image to exactly
   one split. Reserve held-out plans before tuning; never move a tuned plan into held-out.

Manifest example (paths relative to the manifest):

```json
{"fixtures":[{"id":"plan-001","split":"held-out","image":"plan-001.png","truth":"plan-001.truth.json","correction_seconds":null}]}
```

Truth JSON contract:

```json
{"verified_by":"human reviewer","verified_at":"2026-10-18","image_sha256":"actual SHA256","width_m":null,"graph":{},"rooms":[{"id":"UUID matching graph room_id","space_type":"kitchen"}]}
```

Replace `graph` with the complete existing LayoutGraph. Empty or invented ground
truth is rejected. `width_m` is the existing image-width scale, not the building's
bounding-box width. Omit correction_seconds until someone measures an actual
review session; the harness's estimated_edit_operations is a separate estimate.

```powershell
$env:PYTHONPATH='services/reconstruction'
services/reconstruction/.venv/Scripts/python.exe -m plan_parser.evaluate path/to/manifest.json --split development --output development-results.json
services/reconstruction/.venv/Scripts/python.exe -m plan_parser.evaluate path/to/manifest.json --split held-out --output benchmark-results.json
```

The harness runs CV-only and configured semantic-model modes, validates graphs
with Python and the existing TypeScript validator, reports wall precision/recall,
endpoint error, footprint/room IoU, room count, adjacency, opening detection and
attachment, labels, scale, unresolved elements, topology errors, estimated edit
operations and recorded correction time. Successful graphs go through existing
GLB generation. Refused cases remain in the report. No-model cases are explicit.

Public dataset evaluation uses the same format: convert licensed annotations to
the existing shared graph, preserve attribution/splits, and manually verify that
conversion. Do not treat a dataset bounding box as a shared wall graph. CubiCasa5K
is noncommercial; it is not bundled or represented as a commercial benchmark.
An empty held-out split produces `no_verified_fixtures`, never a success score.

## Real-plan structural observations without a verified graph

`recovery-manifest.json` contains the Plan 2 lower-right-office observation.
Its image path points into the private `.local-backups/` evidence directory, so
the case runs only in a workspace with that original source. The evaluator
checks its SHA256 and three observed face points, then reports closed-face
count, physical wall count, shared-boundary lengths, topology validity and GLB
generation. It does **not** compute wall accuracy or room IoU from invented
ground truth. `reference_counts.observed_real_unverified` keeps this case
separate from verified pairs. See `RECOVERY_SLICE_2_PLAN2_REPORT.md` for the
before/after measurements and remaining uncertainty.

```powershell
$env:PYTHONPATH='services/reconstruction'
services/reconstruction/.venv/Scripts/python.exe -m plan_parser.evaluate services/reconstruction/tests/plan_parser/recovery-manifest.json --split development --output services/reconstruction/tests/plan_parser/recovery-results.json
```


## Clean orthogonal regression baseline (v0.2)

`regression-manifest.json` pairs two authored images with their explicit centerline
reference graphs. They are analytic regression references, visually inspected by
the coding agent; they are not human-verified real plans or held-out accuracy data.
The fixtures include host-wall gaps. The gray fixture adds furniture, labels,
a swing arc and external dimensions. Reference opening records are scored
separately, so missing openings cannot turn structural success into failure.

```powershell
$env:PYTHONPATH='services/reconstruction'
services/reconstruction/.venv/Scripts/python.exe -m plan_parser.evaluate services/reconstruction/tests/plan_parser/regression-manifest.json --split development --output services/reconstruction/tests/plan_parser/regression-results.json --debug-dir .local-backups/plan-parser-baseline
```

Or set `PLAN_PARSER_DEBUG_DIR` for development worker diagnostics. It writes ten
numbered PNGs per input hash (preprocessed, thresholds, structural mask, raw axes,
merged axes, junction graph, footprint, faces, OCR and opening proposals). Unreached
stages are explicitly marked after failures. Debug output is local/private and is
not enabled by default in production; do not publish images from user uploads.

Result states: `USABLE`, `NEEDS_REVIEW`, `FAILED`. A valid unlabeled graph is
`NEEDS_REVIEW`. Only failed structural reconstruction produces `FAILED`; OCR/model
failure is diagnostic metadata. The review UI and acceptance RPC also read legacy
`candidate`/`refused` results during rollout. Acceptance always reruns existing
TypeScript `validateGraph` and server validation, and still requires calibration.
