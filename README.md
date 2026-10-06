# Property Viewer

An interactive property tour SaaS for estate agencies. Teams create properties, compose multi-level layouts with indoor and outdoor spaces, attach photos, generate an open-top 3D model, preview the tour, and publish a link or iframe embed. The application uses React, Vite, TypeScript, Tailwind CSS, Supabase, Konva, React Three Fiber, a Python reconstruction worker, and Stripe.

## Prerequisites

- Node.js 20.19+ or 22.13+ and npm
- A Supabase project (or the Supabase CLI and Docker for a local project)
- A Stripe account in test mode for billing verification

## Local setup with a hosted Supabase project

Run commands from this repository's **outer** `property-viewer-saas` directory, the one containing this README and `supabase/`. A second Vite starter was generated inside this checkout and moved to `.local-backups/` to prevent accidentally running it.

1. Run `npm install`.
2. Copy `.env.example` to `.env.local`. Set `VITE_SUPABASE_URL` to the **Project URL** from Supabase's Connect panel and `VITE_SUPABASE_ANON_KEY` to its **publishable key** (the variable name is retained for compatibility). Do not use the Postgres connection string or a secret/service-role key in the frontend. Restart Vite after changing `.env.local`.
3. Sign into the bundled CLI with `npx supabase login`, then run `npx supabase link --project-ref YOUR_PROJECT_REF`. Linking selects the remote project; it does **not** install the application's tables or Edge Functions.
4. Run `npx supabase db push --dry-run` and inspect the pending migrations. Then run `npx supabase db push` once. The initial migration creates the original tour schema, RLS, and private Storage buckets. The layout migrations add levels, typed spaces, openings, stairs, and safe level deletion. The reconstruction migration adds private model storage, jobs, models, and width scale. If you already ran SQL directly in the Supabase SQL Editor, inspect `npx supabase migration list` before pushing so it is not applied twice.
5. Set the core function secret with `npx supabase secrets set APP_URL=http://localhost:5173`, then deploy `npx supabase functions deploy public-tour`. This function is needed for every published tour. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to hosted functions; do not set or commit them yourself.
6. Optionally run `supabase/seed.sql` **once in a disposable development project** through the Supabase SQL Editor. It adds a public sample at `/tour/the-willow-residence`, using SVG assets in `public/demo/`.
7. In Supabase Authentication → URL Configuration, set the test project's Site URL to `http://localhost:5173` and allow `http://localhost:5173/**` as a redirect URL. Enable Email provider. Confirm the sign-up email, or disable confirmation only in a disposable test project.
8. Run `npm run check:setup`. All three core checks should pass. Then run `npm run dev` and open `http://localhost:5173`.

Stripe is optional for the first property-tour test. When ready, set `STRIPE_SECRET_KEY`, `STRIPE_PRO_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET` as Supabase Edge Function secrets, then deploy `create-checkout`, `customer-portal`, and `stripe-webhook` with `npx supabase functions deploy FUNCTION_NAME`. The included `supabase/config.toml` disables gateway JWT checks; the billing functions verify the signed-in owner themselves, and the webhook verifies Stripe's signature.

For a fully local Supabase stack, start Docker Desktop, run `npx supabase start` (which applies the migration and seed), and `npx supabase functions serve --env-file supabase/.env.local`. Use the local API URL and publishable/anon key printed by `npx supabase status` in `.env.local`. Put local function secrets in `supabase/.env.local`; this file is ignored by Git. Use `stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook` for local Stripe webhooks and set the printed signing secret. The local function `APP_URL` should be `http://localhost:5173`.

## Stripe setup

Create one recurring Professional price in Stripe test mode. Put its `price_...` ID in `STRIPE_PRO_PRICE_ID`. Enable the customer portal in Stripe. Create a webhook endpoint at `https://YOUR_PROJECT.supabase.co/functions/v1/stripe-webhook`, subscribe it to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`, and set its signing secret as `STRIPE_WEBHOOK_SECRET`.

Checkout and portal sessions are created only by Edge Functions after verifying the signed-in user is an organization owner. Subscription records can only be changed by the service role through the signed webhook. The database enforces one published tour on Free and unlimited tours on Professional. If Professional ends while several tours are live, the webhook keeps the oldest published tour and unpublishes the rest. Stripe is the source of truth for subscription status. Run a test checkout using a Stripe test card, return to Billing, and confirm the plan changes after the webhook arrives. Then open Manage Subscription and test cancellation through the portal.

## Layout composer and product workflow

Sign up, create an organization and property, then open **Layout composer**. A property has ordered levels (Site / Outdoor, Ground Floor, upper floors, basement, roof terrace, or custom). Each level has its own elevation and building footprint; the property boundary is shared across levels. Upload a JPG, PNG, or WebP floor plan as a tracing background or draw on the blank canvas. The image is a reference, not automatically extracted geometry.

New levels use a shared-wall graph. Use the explicit toolbar in this order:

1. **Property boundary**: optionally trace the land extent. It must be one valid closed polygon.
2. **Building boundary**: trace the exterior footprint inside the property boundary, if present. This creates exterior vertices and wall segments. An upper floor can have a different footprint.
3. **Partition**: start on an existing wall or vertex, add bends if needed, and end on an existing wall or vertex. Nearby vertices and wall edges snap within a screen-space tolerance; the orange marker shows the snap target. The editor splits existing walls at junctions and rejects crossings, disconnected ends, zero-length segments, duplicate walls, and sliver faces.
4. **Add room**: select a room type, then click an unassigned enclosed face. Its polygon is derived from shared walls and stored for selection, photos, and the public floor plan. Drag a shared vertex or interior wall in Select mode to update adjacent rooms together. The building layer can be locked while arranging rooms.
5. **Door / Double door**: click P1 and P2 on the *same* wall to set width, then click P3 off the wall to choose swing side. **Window / Wide window** takes two points on one wall. Openings cannot overlap or exceed the wall. The simplified door arc and window mark appear in the editor and tour floor plan.
6. **Outdoor space**: trace a garden, pool, parking area, driveway, patio, or yard inside the property boundary and outside the building. Outdoor regions become flat surfaces or metadata, not full-height building walls.

Layer checkboxes control visibility of the property boundary, building walls, spaces, doors, windows, and tracing image. Select mode supports wall/opening deletion and session undo/redo for graph edits, including room creation when no photos have subsequently been added. Spaces retain their existing `rooms` IDs and photos. A stairs space can still connect levels.

Existing properties keep their independent room polygons in **Legacy geometry needs review** mode. They continue to load and publish. **Review safe conversion** proposes a shared graph only when indoor polygons form one exact, non-overlapping tessellation and there are no legacy openings to reinterpret. Conversion requires an explicit confirmation, preserves room/photo/tour IDs, and leaves ambiguous layouts untouched for manual review. Starter templates remain a legacy layout option on empty legacy properties; they cannot replace a traced graph.

Upload original photos to each space. Preview the tour, then publish when every space across all levels has at least one photo and one area. The Publish screen retains the same `/tour/:slug` URL and iframe code. Unpublishing removes public function access immediately; signed media URLs already issued may remain valid for up to one hour.

## 3D reconstruction worker

The **Generate 3D model** action on a property's detail page queues a database job. The Python service claims jobs, reads each level's authoritative vertices, shared wall segments, wall openings, derived room areas, and photo metadata, then generates `model.glb` and `scene.json`. Each physical wall is extruded once. Door P1–P2 and window P1–P2 remove actual wall panels; window sill and header height are respected. Door P3 contributes swing metadata only. Floors and camera anchors come from room areas, while outdoor spaces remain flat. Legacy levels dissolve exact coincident room edges before extrusion. Each level uses its own elevation and footprint. The files are versioned in the private `property-models` bucket; photos remain full-resolution room media. A previous model stays available while a rebuild runs or fails.

Run locally in a **separate terminal** after applying migrations:

```powershell
cd services/reconstruction
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = 'YOUR_SERVICE_ROLE_KEY'
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Use the **service_role** key from Supabase Project Settings → API Keys only in this server-side process. Do not put it in `.env.local`, a `VITE_` variable, Netlify, or Git. `GET http://127.0.0.1:8000/healthz` confirms the worker is running. Keep exactly one worker process per project; it polls the database every five seconds. Its `POLL_SECONDS` environment variable can be changed. The FastAPI service has no public job-creation endpoint: authenticated editors queue jobs through RLS, and only the service role can claim and write them. The UI shows Queued, Processing, Completed, or Failed with errors. A failed job can be retried with **Rebuild 3D model**.

For a hosted worker, deploy `services/reconstruction/Dockerfile` to a container host with one always-on instance and a health check on `/healthz`. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as server-side secrets on that host; do not expose the service publicly beyond its health endpoint unless access control is added. Netlify hosts only the Vite frontend; its functions do not run this long-lived poller. If the worker is stopped, queued jobs wait safely in Postgres until it returns. For local Docker, build from the `services/reconstruction` directory and provide the same two environment variables to `docker run`.

Run `node scripts/test-topology.mjs` for the 40 × 30 ft, nine-room graph fixture, and `services/reconstruction/.venv/Scripts/python.exe -m pytest services/reconstruction/test_geometry.py -q` for GLB export, shared-wall counts, door/window cuts, and a distinct upper-floor footprint. After generation, open the private preview and choose **3D Tour**. The same room selection drives the GLB, floor plan, room list, and photo view. The public function issues short-lived signed GLB/scene URLs only for published tours. Existing tour links and iframe embeds continue to work; tours without a model offer Floor Plan and Photos.

### Migration notes

`20261002000000_layout_composer.sql` retains existing room, photo, polygon, property, and tour IDs. `20261002010000_layout_safety.sql` protects level deletion. `20261002020000_reconstruction.sql` adds model jobs and private model storage. The `20261006...topology...` migrations add a property boundary, a per-level graph, a legacy/topology mode flag, an atomic graph-and-derived-polygon save RPC, safe legacy conversion support, RLS, and integrity guards. Existing levels are marked legacy; newly created levels default to topology. The public Edge Function includes published topology in the floor-plan payload. Apply all migrations before deploying the updated frontend and `public-tour` function. The legacy `floor_plan` field stays in the tour payload for compatibility.

Uploads are limited to 15 MB and accepted image MIME types in both the client and private Supabase buckets. Paths begin with the organization UUID. Storage policies restrict access to organization members. The public viewer gets only a published property's necessary data and short-lived signed media URLs from `public-tour`; it has no direct anonymous table or bucket access. `tour_views` stores a minimal view count without visitor identifiers.

Room photos are uploaded as the selected files and displayed from those originals; the app does not create a higher-resolution version. Use the full-resolution photo, ideally at least 1600 × 1200 pixels, rather than a downloaded thumbnail. The editor labels low-resolution existing photos and warns before uploading new ones below 1200 × 900 pixels. To improve an existing tour, upload the original photo to its room and remove the small copy.

## Checks

Run `npm run typecheck`, `npm run lint`, `npm run build`, `node scripts/test-topology.mjs`, and the Python geometry tests. In a configured Supabase development project:

1. Confirm an old property still opens in legacy mode and its published `/tour/:slug` and iframe work.
2. Create a new property. Trace a property boundary, a building footprint, partitions, and room faces. Reload to confirm wall IDs and derived room areas persist.
3. Place a door with P1/P2/P3 and a window with P1/P2; try an off-wall endpoint and overlapping opening to confirm rejection. Move a shared wall and use Undo/Redo; adjacent rooms and the opening should remain aligned.
4. Create a second level with a different footprint and a site outdoor region. Generate a GLB, inspect its scene manifest and wall nodes, and check Floor Plan and 3D Tour in a WebGL-capable browser.
5. With another organization and an anonymous client, confirm graph and polygon RLS prevents cross-tenant access and direct mutation of derived areas.
6. Test Stripe checkout, webhook, and portal in test mode if billing is configured. Test the public tour and its iframe from another origin after deploying the frontend and `public-tour` Edge Function.

## Deployment

For Netlify, import the GitHub repository with `main` as the production branch. `netlify.toml` runs `npm run build` and publishes `dist/`; Vite copies `public/_redirects` and `public/_headers` so direct client routes load, private routes cannot be framed, and `/tour/*` remains embeddable. In Netlify's Project configuration → Environment variables, set `VITE_SUPABASE_URL` to the Supabase Project URL and `VITE_SUPABASE_ANON_KEY` to its publishable key. Both variables must be available to the **Builds** scope and **Production** deploy context. Trigger a new build and deploy after changing them; Vite embeds their values during the build. A production build now fails if either setting is missing or still uses the example placeholder. You can also run `npm run build` locally and upload `dist/`, which contains the same routing files. Never add the Supabase service-role key or Stripe secrets as `VITE_` variables.

After Netlify assigns the permanent HTTPS origin, set the Supabase Edge Function secret `APP_URL` to that origin (for example, `npx supabase secrets set APP_URL=https://YOUR_SITE.netlify.app`). In Supabase Auth URL Configuration, set the production Site URL and add both `https://YOUR_SITE.netlify.app/**` and `http://localhost:5173/**` to the redirect allow list if local sign-in is still needed. The frontend uses its current origin for public links and iframe snippets. Open `/tour/:slug` directly in a fresh browser and test the iframe on a page served from a different origin. Deploy the migration, functions, and Stripe webhook before enabling billing. Storage objects are private; back up the database and Storage according to your Supabase plan.

## Structure

- `src/pages/`: dashboard, property management, editor, tour, publishing, billing, and settings
- `src/components/`: shared UI, topology-aware Konva composer, and tour floor plan canvas
- `src/lib/`: typed domain models, topology/face derivation and validation, legacy templates, Supabase queries, upload validation
- `supabase/migrations/`: relational schema, indexes, triggers, RLS, and storage policies
- `supabase/functions/`: public tour and Stripe server-side operations
- `supabase/seed.sql` and `public/demo/`: sample public tour

The tour response is a presentation payload assembled at the backend edge. The Python worker consumes ordered levels, shared wall graphs, derived room areas, heights, openings, and linked photos and exports a GLB with room and wall IDs. Future photographic reconstruction is outlined in `NEXT_PHASE.md`.
