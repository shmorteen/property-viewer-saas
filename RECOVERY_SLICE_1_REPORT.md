# Reconstruction recovery — slice 1: acceptance and persistence

Date: 20 October 2026 (Africa/Lagos).

**Status: focused code/database corrections verified; browser acceptance/reopen
gate pending. Phase 2 is not declared complete. Later extraction slices have not
been started. Stop here for review, as requested.**

## A. Repository baseline

- Repository: `shmorteen/property-viewer-saas`.
- Original branch: `main`.
- Original/local and fetched `origin/main` commit:
  `32c7b63428c6918dc8e20e614e1eea0ca30b60cc`.
- Recovery branch: `codex/reconstruction-acceptance-recovery`.
- Baseline working tree was clean.

The existing architecture remains: FastAPI worker → OpenCV/NumPy structural axes
and GEOS shared-wall topology → optional semantic/OCR evidence → candidate result
→ existing React composer → Supabase acceptance/save RPCs → derived room polygons
and authoritative LayoutGraph → existing Python GLB builder and tour viewer.

No parser threshold, architectural classification, geometry generator, topology
constraint, database schema, RLS policy or product category was changed in this slice.

## Evidence inventory and failure matrix

`C:/Users/HP/Downloads/pvs test.zip` contains 14 images: five original plans and
nine review/layout/diagnostic screenshots. All were inspected. Exact originals
and all screenshots remain private under `.local-backups/recovery-20261020/evidence/`.
The private `evidence-index.json` records all 14 hashes, dimensions and byte counts.
No user image or source-derived graph is committed.

| Case and original SHA256 | Observed evidence | Expected interpretation / suspected stage | Executed path and independent acceptance gate |
|---|---|---|---|
| Plan 1 — `d253a47a3c47f34da3062665781b07747516710699dda011450ce9c179f07b73` | `p01cr`, `p01al`, `p01d`: 35 segments, 9 faces, fixture-derived subdivisions, zero accepted openings | Preserve genuine small rooms; bathtub/laundry outlines are not architectural partitions. Classification/reconciliation remain next-slice investigations. | Stored real candidate passed TypeScript and server acceptance on isolated QA records. Repeated acceptance reproduced SQLSTATE 23505 before the ID fix. Two corrected review copies committed and survived a separate read after the fix. Parser was not rerun/tuned in this slice. |
| Plan 2 — `cbcf98d38a3d26559d5e798948d067e7149193d0d198feee5f6830388c17fbe1` | `p02cr`, `p02al`, `p02d`: lower-right office absent; reported 45 segments/8 faces, zero accepted openings | Recover the visible office without inventing walls. Lost wall/junction/exterior/face stage remains unconfirmed. | Original/screenshot and stored candidate inspected; stored graph passed client validation. No new parser reproduction or office correction claimed. Later gate: office face + persistence + GLB. |
| Plan 3 — `4bbc7a6bd403ca2e11ad6d7ae979f399588c46d20d1739acc46fa83b3014cca4` | `p03cr`, `p03al`, `p03d`: lower balcony outside retained indoor geometry; zero accepted openings | Balcony must remain outdoor with floor/railing behavior. Review currently blocks outdoor edits and acceptance creates indoor rooms only. | Source, screenshots, stored candidate and code paths inspected. No balcony fix executed in this slice. Later gate: outdoor category survives accept/reopen/GLB. |
| White A — `da38db48dd80057c32972a182e56239c83cc2905e56321a0968437f132a0f013` | Original inspected; disconnected/courtyard failure reported in brief. No matching failure screenshot in archive. | Fine-line structural reconstruction or localized manual recovery; exact failing stage unconfirmed. | Not rerun in this slice. Do not count as reproduced. Later gate: CV/semantic diagnostics and defensible graph or localized partial evidence. |
| White B — `9e777f4669fb7d8b425ff429daa8c25b4b90746c59eb877ba993ae7ae98baf78` | Original inspected; no supplied result screenshot | Test irregular orthogonal perimeter/open passages without invented closure. | Not executed in this slice. Later gate is the same explicit structural/recovery check. |

The screenshots labeled accepted-layout are observed local editor states, not
proof of a committed save. A read-only inspection found stored completed candidates
with no persisted rooms on the inspected test level. The screenshots do not expose
the original failed request/response; its historical SQL error remains unknown.

## B. Confirmed root causes versus hypotheses

### Confirmed: generic SDK errors render as `[object Object]`

`src/lib/supabase.ts:errorMessage()` and composer catch handlers used
`error instanceof Error ? error.message : String(error)`. A real PostgREST-shaped
plain object reproduced `[object Object]` in `scripts/test-errors.mjs` before the
fix. The formatter now reads bounded message/code fields and excludes arbitrary
response details, headers and contexts. Recognizable tokens/credentials are redacted.
The composer consistently uses that formatter. Acceptance errors include action context.

### Confirmed: identical images reuse global persistent room IDs

`plan_parser/vectorize.py:vectorize()` intentionally derives stable image evidence
IDs. `PlanAnalysisPanel.openReview()` copied those IDs directly to `public.rooms`.
The first QA acceptance succeeded; the second independent acceptance of the same
candidate failed with the captured PostgreSQL response:

```json
{"code":"23505","message":"duplicate key value violates unique constraint \"rooms_pkey\""}
```

This response came from an executed SQL/RPC path through the Supabase Management
API, not from an intercepted historical browser PostgREST request. It confirms a
repeated-image persistence defect; it does not prove that this was the error in
every reported screenshot incident.

`src/lib/plan-review.ts:preparePlanReview()` now copies the analysis and mints new
persistent room identities once when review opens. Seeds, room candidates and
confidence references are remapped together. Source analysis remains immutable;
IDs remain stable through local edits, retry, acceptance and readback.

### Confirmed: review closed before persisted editor reload

`PlanAnalysisPanel.onAccept()` previously executed `close()` before awaiting the
editor reload. A failed reload could therefore discard the review UI prematurely.
It now verifies persisted graph/rooms/polygons/scale, awaits the editor reload,
then closes. `completePlanAcceptance()` retains review after failure and retries
a known committed save as a read. A lost acknowledgement checks the accepted job
receipt before any repeat write. A changed payload after a known save is rejected
with instructions to reopen the persisted layout, rather than silently overwriting it.

### Unconfirmed historical incident causes

Calibration mismatch, stale replaced source, ownership, unmatched face assignments,
and other constraint errors were not inferred from `[object Object]`. The raw Plan 1
candidate accepted successfully on an isolated QA setup before the identity fix,
so there is no evidence that all candidate acceptance calls fail. No validator or
RLS condition was bypassed to manufacture success.

## C–D. Before/after acceptance and persistence evidence

Before:

- Formatter regression returned `[object Object]`.
- Repeated-image QA acceptance returned `23505 / rooms_pkey`.
- Review closure preceded reload in source code.

After:

- Three focused JS suites pass: safe errors, independent review identities, and
  failure/retry ordering (including lost acknowledgements and read failure).
- Two independent reviews of the real Plan 1 candidate were accepted and **committed**
  on newly created isolated QA properties. One room name/type was corrected, a
  declared 9.25 m QA wall measurement was calibrated, and one physical door was placed.
  This declared QA measurement is not a claim about actual building dimensions.
- A separate CLI request/connection read the committed state under an authenticated
  test-role context. The verifier matched 18 room identities, names, space types,
  indoor categories, complete graphs, openings, derived polygons and calibrated scales.
- An invalid wall payload was rejected without partial rooms. A later invalid room
  specification also failed after earlier room/scale write attempts; all attempted
  writes rolled back, with `P0001 / Invalid candidate room` captured.
- The two committed QA fixtures remain for inspection. Existing user properties,
  media, layouts and tour references were not modified.

Private reproducible evidence: `.local-backups/recovery-20261020/`, including
`probe-duplicate-room-ids.sql`, `probe-midwrite-rejection.sql`, the original candidate
response capture, and `roundtrip/expected.json`, SQL, readback and verified rows.

**Browser limitation:** browser control initially timed out; after reconnection the
user-requested public Netlify app was reached and was signed out. Sign-in has been
requested. The recovery branch is not deployed to that public site. No successful browser
upload → accept → hard reload → reopen result is claimed. The CLI test uses an
authenticated-role simulation, not a browser auth session. Prepared floor-plan
metadata was used; no private source image was uploaded for these QA database rows.
Consequently Phase 2's full browser gate remains pending.

## E. Persisted database → 3D contract

The geometry check consumed the separately read persisted rows, not local review
state. Both GLBs preserve nine room identities/names/types/categories and 35
physical walls, represented once each. Each manifest contains the accepted door.
Each GLB is 28,308 bytes. Comparing exported triangle volumes with a closed-wall
control measured a 0.349702 m³ door void versus 0.349701 m³ expected from the stored
calibrated wall, opening interval, height and thickness.

The graph remains the current extracted architecture, including known false
fixture faces. This verifies persistence/3D continuity, not architectural accuracy.
Existing virtual-boundary/geometry tests still pass. No balcony/proposal UI fix is
claimed by the manually placed QA door test.

## F. Executed regression checks

- Safe SDK/PostgREST error-rendering regression: failed before fix; passes after fix.
- Review identity/provenance regression: passes.
- Rejected save, retained review, read-before-close, reload-only retry and lost-ack
  receipt regression: passes.
- TypeScript typecheck, ESLint and production build: passed (existing large 3D
  chunk advisory remains).
- Existing TypeScript topology suite: passed.
- Existing parser and Python geometry suites: 38 passed.
- Original repeated-ID database fault: reproduced and rolled back.
- Corrected repeated-image acceptance: 2/2 committed and separately read back.
- Mid-write rejected acceptance: atomic rollback verified.
- Persisted-rows GLB generation: 2/2, with identity/wall/door-void checks passed.
- Browser page reload, production deployment and five-plan parser/semantic
  cross-regression: not executed successfully in this slice; not counted as passes.
- Human correction time and held-out extraction accuracy: unmeasured.

## G. Change inventory and operation

Core additions: `src/lib/errors.ts`, `plan-review.ts`, `plan-acceptance.ts`.
Updated: `supabase.ts` formatter export, composer catches, candidate preparation,
acceptance error context, persisted verification, and review completion ordering.
Tests: `scripts/test-errors.mjs`, `test-plan-review.mjs`, `test-plan-acceptance.mjs`.
Reproducibility tools: `prepare_acceptance_roundtrip.mjs`,
`verify_acceptance_roundtrip.mjs`, `verify_saved_layouts_geometry.py`; instructions
in `services/reconstruction/tools/ACCEPTANCE_CHECK.md`.

No new dependencies or migrations. The unique room constraint, topology validators,
calibration/source guards and ownership checks remain intact. Deploy a frontend
build of this branch to use the fix; parser/worker behavior is unchanged.

## H. Remaining risks and review boundary

The historical browser response is unavailable, and browser reopening is unverified
(public app sign-in and a branch build are still required).
The public site has not been changed by this branch. Parser furniture false positives,
Plan 2's office, white-wall recovery, balcony acceptance and opening-proposal actions
remain unresolved. Do not treat increased room counts or successful meshes as proof
that those architectural defects have been corrected.

## I. Next narrow task

First complete the pending Phase 2 browser round trip on a build of this recovery
branch and a disposable QA property, capturing a real rejected PostgREST response
and a successful page reload. After review/approval of this slice, the next parser
slice is Plan 1 fixture-derived walls/faces, with no simultaneous office/white-wall/
balcony rewrite. No unrelated slice was started here.
