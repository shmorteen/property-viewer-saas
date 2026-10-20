# Reconstruction recovery — slice 1: acceptance and persistence

Date: 20 October 2026 (Africa/Lagos).

**Status: focused code/database corrections and a real authenticated browser
upload → extraction → correction → rejected RPC → retry → acceptance → full reload
→ reopen round trip verified on an isolated recovery build and QA draft. The
historical incident's raw network response is unavailable; its exact SQL cause
remains unproven. Later extraction slices have not been started. Stop here for
review, as requested.**

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

### Authenticated browser continuation

After the user signed in, the existing Netlify session allowed a separate test
deployment of the already checked frontend build from code commit `8afe0d3`:

- Test URL: `https://zesty-creponne-f0bd37.netlify.app`.
- Netlify deployment ID: `6ad714597893e206f37c52cc`.
- The primary `propertyviewersaas.netlify.app` deployment was not replaced.
- This is a manual test deployment, not a GitHub branch deploy or a release to main.

A new draft, **Recovery browser QA — Plan 1**, was created within the isolated
**Recovery acceptance QA** organization. Property ID:
`d062924e-776e-4860-8d0c-56cc6a51dcb9`; level:
`2d839237-cc28-4108-80f6-4cf62bb76126`; extraction:
`5e19b2de-df09-44a6-bb61-1bf7a9ee7aa9`.

The original Plan 1 PNG was uploaded through the browser into private Supabase
Storage. Clicking Analyze queued a job that the connected worker actually completed.
Its result records the original SHA256 listed above and parser version
`0.2.0-orthogonal-baseline`; no stored result was seeded for this browser test.
The result still contains the known 35 walls and nine faces, including false fixture
faces. This run is not an extraction improvement or five-plan regression claim.

On the recovery build, review changed `BEDROOM#2` to **Browser QA corrected office**
with type `office`. A selected interior wall was calibrated using a declared **3.5 m
QA measurement**, yielding a persisted image width of **29.75 m**. This is a test
measurement, not an assertion about the building. A standard **0.90 m door** was
deliberately placed and its swing confirmed with the existing tool.

To exercise a genuine server rejection, an ID/organization-guarded CLI update
temporarily changed only this disposable extraction's status to `rejected` while
review remained open. Clicking Accept produced this actual browser RPC diagnostic:

```text
Could not accept detected layout: A successful reviewed candidate is required [P0001]
```

The corrected name, type and calibration remained in review. The guarded update
restored `completed`, and retry accepted the retained review. The application
verified the persisted graph/rooms/polygons/scale and reloaded the editor before
closing review. A full browser reload, navigation to property details, and reopening
the editor retained the corrected room and accepted status. Property details showed
the saved 29.75 m scale.

A separate CLI connection then read only this QA property. An offline verifier
matched the original wall/vertex geometry, all nine fresh persistent room identities,
name/type/category metadata, nine derived polygons, door span and calibrated wall
length. Thus the browser result is supported by a separate persistent read, not
solely by local React state or an authenticated-role simulation.

Private evidence is under `.local-backups/recovery-20261020/`:
`browser-qa-state.sql`, `browser-reject-once.sql`, `browser-restore-candidate.sql`,
`browser-readback.sql`, `browser-readback.response.json`, `verify-browser.mjs`,
`browser-verified-layouts.json`, and `browser-reopened-room.jpg`.

**Limits:** the browser API exposes console logs but no supported network-response
capture facility. The current RPC message/code above was observed through the
application's real PostgREST error path; no raw response body or HTTP status is
claimed. The original historical failed request is still unavailable. The two
earlier CLI-only fixtures retain metadata without uploaded images and display
`Object not found` in their editors; use the new browser QA draft for inspection.

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

The browser-accepted QA rows also passed the existing persisted-row GLB check:
nine rooms, 35 physical walls represented once, one door, **28,292-byte GLB**,
identity/name/type/category preservation, and measured/expected door void both
**0.188999 m³**. Artifacts are in the private `browser-models/` directory. This
geometry check used the independently read browser save; it was not a live 3D-tour
rendering or public-tour publication test.

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
- Actual browser RPC rejection, retained corrected review and successful retry:
  passed on the isolated recovery build.
- Original image upload and worker extraction, browser acceptance, full page reload
  and editor reopen: passed on the new disposable QA draft.
- Independent readback and GLB check of that browser save: passed (9 rooms, 35 walls,
  1 door, matching calibration and derived polygons).
- Isolated manual Netlify test deployment: succeeded. Primary production deployment,
  live public-tour/iframe checks and five-plan parser/semantic cross-regression were
  not executed in this slice and are not counted as passes.
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

The historical browser response remains unavailable. Browser reopening is verified
on the isolated test build; the primary public site has not been changed by this
branch. The workspace selector reset to the first organization after full reload;
the QA property still loaded under normal RLS, and QA was reselected for inspection.
That existing workspace-selection behavior is outside this acceptance slice.
Parser furniture false positives,
Plan 2's office, white-wall recovery, balcony acceptance and opening-proposal actions
remain unresolved. Do not treat increased room counts or successful meshes as proof
that those architectural defects have been corrected.

## I. Next narrow task

Review this acceptance slice and its isolated QA draft. The authenticated browser
round trip and rejected-RPC recovery gate are now executed; the historical raw
network capture remains unavailable and is not inferred from the reproduced faults.
After review/approval, the next parser slice is Plan 1 fixture-derived walls/faces,
with no simultaneous office/white-wall/balcony rewrite. No unrelated slice was
started here. The code/report remain on the separate recovery branch; no merge or
primary production release is implied by the isolated test deployment.
