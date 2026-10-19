# Clean orthogonal floor-plan baseline — 18 October 2026

## Scope and outcome

Parser `0.2.0-orthogonal-baseline` reconstructs continuous structural wall axes
before labels, semantic inference or opening detection. The supported baseline is
one clean dark-on-white or grayscale orthogonal floor plan. This is not a claim
of general floor-plan support or held-out production accuracy.

The two authored regression plans pass in both CV-only and semantic-enabled modes.
The supplied 416 × 287 development plan now produces an editable structural
candidate instead of failing closure. It still needs manual corrections described
below. Existing authoritative geometry is unchanged until explicit acceptance.

## Review findings and fixes

The previous implementation processed small rasters at native scale, allowed a
semantic mask to replace wall evidence, ran OCR before graph reconstruction and
refused incomplete graph evidence as one monolithic extraction failure. Door gaps
and thin annotations could therefore prevent any usable candidate.

The revised sequence is:

1. Preserve raw bytes; normalize a separate bounded working copy. Small sources
   target a minimum dimension of 900 px (upscaling capped at 4×). Larger sources
   are bounded at 2,200 px. Store the exact working-pixel to original-pixel matrix.
2. Combine dark, gray and adaptive threshold evidence. Directional morphology
   extracts horizontal/vertical runs; LSD records independent line evidence.
3. Estimate structural stroke width from substantial long runs. Cluster parallel
   detections into axes, remove thin annotation/furniture evidence, merge collinear
   runs and bridge bounded, supported gaps unless a transverse wall contradicts it.
4. Snap endpoints/intersections using stroke-derived tolerance. GEOS nodes the
   shared graph. Select the dominant exterior cycle and polygonize connected faces.
   Disconnected furniture cycles cannot become independent building rooms.
5. Run optional model inference and OCR only after valid structure exists. OCR can
   try 0/90/180/270° orientations and maps all boxes back to working coordinates.
   It cannot change geometry. Model failures and poor labels cannot discard structure.
6. Attach opening evidence to reconstructed walls. A semantic window rectangle
   needs raster-gap corroboration; otherwise retain it for review. Door swing remains
   unresolved unless supported. Host walls stay continuous through opening gaps.
7. Return separate structure, semantic, opening and scale confidence domains.
   `USABLE` and `NEEDS_REVIEW` open the existing composer; `FAILED` identifies the
   failed structural stage. Low label/opening confidence alone never means failure.

All confidence values are heuristic evidence ratings, not calibrated probabilities.
Scale remains unknown until the reviewer measures a selected wall. No site boundary
or absolute dimensions are guessed from pixels.

## Evaluation data and provenance

### Authored regression references

`services/reconstruction/tests/plan_parser/regression-manifest.json` pairs:

- `clean-dark.png`: 500 × 400, thick dark orthogonal walls, four raster gaps.
- `gray-furnished.png`: 500 × 400, medium-gray walls, thin furniture, room labels,
  external dimension annotations, door swing and four raster gaps.

Each has an explicit centerline reference LayoutGraph, three faces, ten segments,
two door records and two window records. Images/reference graphs were authored
from the same geometric specification and visually inspected by the coding agent.
They are **analytic regression references, not human-verified real plans or held-out
benchmark ground truth**. No external or user data was relabeled as verified.

Tests also resize the gray plan to widths of 350, 600 and 1,400 px, and cover concave
footprints, exact shared junctions, optional evidence failure, virtual partitions,
blank images, malformed openings and all three result states.

### Supplied real development image

Original user source: 416 × 287, SHA256
`d253a47a3c47f34da3062665781b07747516710699dda011450ce9c179f07b73`.
The editor screenshot of that image remains a review reference only. No private
source image or user graph is committed. There is no independently human-verified
reference graph for this image, so wall/room accuracy scores are not fabricated.

## Structural results

Machine-readable output: `services/reconstruction/tests/plan_parser/regression-results.json`.
Both modes return the same structural metrics because model/OCR evidence cannot
replace the structural pass. All four runs return `NEEDS_REVIEW` with valid geometry.

| Metric | Clean dark | Gray furnished |
|---|---:|---:|
| Wall precision | 1.000 | 1.000 |
| Wall recall | 1.000 | 1.000 |
| Mean endpoint distance / image width | 0.000629 | 0.000628 |
| Footprint IoU | 0.997041 | 0.997049 |
| Detected / reference faces | 3 / 3 | 3 / 3 |
| Mean matched room IoU | 0.994590 | 0.994593 |
| Room adjacency precision / recall | 1.000 / 1.000 | 1.000 / 1.000 |
| Python topology errors | 0 | 0 |
| Existing TypeScript validateGraph | Pass | Pass |
| Existing GLB generation | Pass | Pass |
| Physical walls extruded | 10, once each | 10, once each |

These numbers are regression results on two authored plans; they do not establish
real-world accuracy or tracing-time savings. Estimated structural edit operations
are zero under the harness tolerance. Actual correction time is unmeasured.

### Openings, OCR and scale — separate from structural success

Four raster gaps per fixture are retained as wall-bound review proposals. Accepted
door/window detection precision/recall is currently 0 against these fixture opening
records; uncertain semantic boxes are not forced into the graph. The semantic model
does not demonstrate an opening improvement on these fixtures. Opening attachment
accuracy is unmeasured where there are no matched detections. Room-label accuracy
is unmeasured without verified label assignments; raw OCR and confidence remain in
candidate metadata. Scale error is unmeasured because no calibrated scale is supplied.
These limitations do not reject a structurally valid candidate.

### Supplied real image: before and after

`development-diagnostics.json` preserves the prior failures and current results.

| Mode | Previous v0.1 | Current v0.2 |
|---|---|---|
| CV-only | Refused; 77% of structural evidence would be discarded | NEEDS_REVIEW; 35 wall segments, 9 faces, valid TypeScript graph, GLB succeeds |
| Semantic-enabled | Refused; disconnected footprint / courtyard | NEEDS_REVIEW; same 35-segment, 9-face structure; valid TypeScript graph, GLB succeeds |

The nine faces are **not claimed to be nine correct rooms**. Bathtub and laundry
fixture outlines still create false subdivisions. Those partitions need deletion
or adjustment in review. Family/Dining/Kitchen remains one open physical face;
use virtual room boundaries to assign separate open-plan areas. Opening kinds,
extents and five unidentified room labels need review. Semantic mode can add
more unresolved symbol proposals; it cannot change the structural graph.

## Model

Optional model: Yytsi/floorplan-to-3d-walls, ResNet34 UNet, revision
`68843a3ab7b12aa03b23c36f955a0d8099b4e2ee`, published MIT weights with CubiCasa5K
training provenance. Model card, source weights hash, ONNX hash and license notices
are documented in `services/reconstruction/plan_parser/MODELS.md`. Original CubiCasa
noncommercial weights/data are not bundled. Export parity error was approximately
0.00001717 on the fixed conversion input; this is not an accuracy measurement.

## Debug artifacts and reproducibility

Development runs write ten private/local PNGs per input hash:

1. `01_preprocessed.png`
2. `02_thresholds.png`
3. `03_structural_mask.png`
4. `04_raw_line_candidates.png`
5. `05_merged_wall_axes.png`
6. `06_junction_graph.png`
7. `07_building_boundary.png`
8. `08_room_faces.png`
9. `09_ocr_overlay.png`
10. `10_opening_candidates.png`

Stages not reached after failure are explicitly marked. Production diagnostics
are not publicly exposed. The local authored regression overlays are in
`.local-backups/plan-parser-baseline/`; supplied-plan diagnostics remain local in
`.local-backups/plan-parser-v2/`. Use the documented benchmark command with
`--debug-dir` or set `PLAN_PARSER_DEBUG_DIR` only in development.

## Required checks

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed; existing large 3D chunk advisory remains.
- `node scripts/test-topology.mjs`: passed.
- Parser and existing Python geometry tests: 38 passed.
- Four regression evaluations: TypeScript validation and GLB generation passed.
- Linked Supabase acceptance/RLS rollback-only test: passed with `NEEDS_REVIEW`.
  No fixture records were retained. Migration `20261018060000` allows the new
  structural states while keeping older candidate jobs readable.

The production worker must be restarted with the updated code/dependencies for
new analyses to use v0.2. This review did not claim a completed live browser
Analyze → Accept → 3D workflow; that earlier check still depends on the worker.

## Remaining limits

- No human-verified held-out image/graph pairs are bundled. `benchmark-results.json`
  explicitly records `no_verified_fixtures` and `production_ready:false`.
- Heavy/connected furniture strokes can resemble small physical partitions.
- Very short wall fragments and large unsupported gaps may need manual tracing.
- OCR, opening type/swing and scale can require manual review even with good structure.
- Perspective photos, sketches, curved walls, arbitrary marketing colors and
  multi-floor discovery remain outside this clean orthogonal baseline.

See the benchmark README to add genuinely human-verified pairs, preserve held-out
separation, and measure actual correction time before promoting general claims.
