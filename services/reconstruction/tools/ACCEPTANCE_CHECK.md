# Acceptance persistence check (disposable database only)

This check uses the existing CLI login and database functions. It does not read or
print API keys, retrieve browser tokens, upload private images, or modify existing
user properties. Run it only against a designated disposable linked project.

The seed intentionally commits two new QA properties and their accepted layouts.
It leaves them for inspection. Its authenticated-role context is simulated using
the first existing test user; this is **not** a browser sign-in/PostgREST test.
An original parser result must already be available locally as private JSON.

```powershell
node services/reconstruction/tools/prepare_acceptance_roundtrip.mjs path/to/private-result.json .local-backups/acceptance-run
npx supabase db query --linked --file .local-backups/acceptance-run/seed.sql
# Separate request/connection, after COMMIT:
npx supabase db query --linked --file .local-backups/acceptance-run/readback.sql | Set-Content -Encoding utf8 .local-backups/acceptance-run/readback.response.json
node services/reconstruction/tools/verify_acceptance_roundtrip.mjs .local-backups/acceptance-run/expected.json .local-backups/acceptance-run/readback.response.json
services/reconstruction/.venv/Scripts/python.exe services/reconstruction/tools/verify_saved_layouts_geometry.py .local-backups/acceptance-run/verified-layouts.json .local-backups/acceptance-run/models
```

The output directory must be new (`expected.json` is created exclusively). The
review helper mints independent persistent room IDs for each copy of the same
analysis. The check changes one room name/type, uses a declared 9.25 m QA wall
measurement, and places one door on an exterior wall. The measurement tests the
calibration contract; it is not asserted to be the real building's measured scale.
No storage object is uploaded for the prepared floor-plan metadata. Therefore these
database fixtures alone cannot prove the full upload/background-image browser flow.

The verifier compares independent persisted reads of room identities, names,
types/categories, graph, openings, scale and topology-managed room polygons. The
geometry verifier uses those persisted rows, checks manifest identities and wall
counts, and compares exported mesh volume against a closed-wall control to verify
the actual door void. Private JSON, GLBs and source-derived diagnostics belong in
the ignored local output folder.

Complete browser validation separately on a build of the recovery branch: upload
the original to a disposable QA property, review/correct, calibrate, accept, reload
the page, reopen the editor, and verify both successful and rejected saves. A CLI
SQL role simulation does not replace that gate.
