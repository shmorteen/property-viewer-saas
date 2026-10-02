# Property Viewer

An interactive property tour SaaS for estate agencies. Teams create properties, compose multi-level layouts with indoor and outdoor spaces, attach photos, preview the tour, and publish a link or iframe embed. The application uses React, Vite, TypeScript, Tailwind CSS, shadcn style UI primitives, Supabase, Konva, and Stripe.

## Prerequisites

- Node.js 20.19+ or 22.13+ and npm
- A Supabase project (or the Supabase CLI and Docker for a local project)
- A Stripe account in test mode for billing verification

## Local setup with a hosted Supabase project

Run commands from this repository's **outer** `property-viewer-saas` directory, the one containing this README and `supabase/`. A second Vite starter was generated inside this checkout and moved to `.local-backups/` to prevent accidentally running it.

1. Run `npm install`.
2. Copy `.env.example` to `.env.local`. Set `VITE_SUPABASE_URL` to the **Project URL** from Supabase's Connect panel and `VITE_SUPABASE_ANON_KEY` to its **publishable key** (the variable name is retained for compatibility). Do not use the Postgres connection string or a secret/service-role key in the frontend. Restart Vite after changing `.env.local`.
3. Sign into the bundled CLI with `npx supabase login`, then run `npx supabase link --project-ref YOUR_PROJECT_REF`. Linking selects the remote project; it does **not** install the application's tables or Edge Functions.
4. Run `npx supabase db push --dry-run` and inspect the pending migrations. Then run `npx supabase db push` once. The initial migration creates the original tour schema, RLS, and private Storage buckets. The layout migrations add levels, typed spaces, openings, stairs, and safe level deletion. If you already ran SQL directly in the Supabase SQL Editor, inspect `npx supabase migration list` before pushing so it is not applied twice.
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

Sign up, create an organization and property, then open **Layout composer**. A property contains ordered **levels** (Site / Outdoor, Ground Floor, upper floors, basement, roof terrace, or custom). Each level has a name, type, elevation in metres, a drawing canvas, and an optional JPG, PNG, or WebP floor-plan background. Add, rename, and reorder levels in the top strip. An empty level can be deleted once its spaces, background, and incoming stair connections have been removed.

Each level contains typed **spaces**, stored in the existing `rooms` table so existing photo associations and public URLs remain intact. Indoor spaces include living rooms, bedrooms, kitchens, bathrooms, corridors, and utility rooms. Site levels can hold building footprints, pools, parking, gardens, driveways, patios, and yards. Every space has a category, type, editable name, height, description, sort order, and normalized polygon area. The same canvas works with or without a background image. Click **Draw area**, place at least three corners, and finish. Select an area to drag it or its white vertices. Snapping to a grid and nearby corners can be toggled. Invalid or overlapping areas are rejected. Undo and redo cover polygon moves and vertex edits, and opening moves during the current editing session.

For a new empty layout, choose **Upload plan** on the selected level or one of seven editable starter templates: studio, one to three bedroom apartments, a three bedroom bungalow, and three or four bedroom duplexes. Templates create structured levels, spaces, polygons, and duplex stair connections in one database transaction; they are not images. Once applied, every space and level can be edited. Templates are available only while the property has no spaces or floor-plan image.

Select a space with a polygon, choose **Door**, **Double door**, **Window**, or **Wide window**, and click its wall. The opening stores the wall segment, relative position, width, height, and sill height. Drag its marker along the wall and edit its width in the inspector. A stairs space can connect its source level to another level with a straight, L-shaped, or U-shaped stair type. This is tour geometry metadata, not construction detail.

Upload multiple original photos to each space and remove them in the selected-space inspector. Preview the tour, then publish when **every** space across all levels has at least one photo and one polygon. A floor-plan background is optional. The Publish screen provides the same public `/tour/:slug` URL and iframe code as before. Unpublishing removes access through the public function immediately; signed image URLs already issued may remain valid for up to one hour.

### Migration notes

`20261002000000_layout_composer.sql` adds the new tables and columns without replacing legacy room, photo, polygon, property, or tour IDs. It creates one Ground Floor for every existing property, attaches old rooms and floor plans to it, and keeps legacy polygons and photos. `20261002010000_layout_safety.sql` restricts direct level deletion and keeps stair connections consistent when a space changes type. Both migrations use organization ownership rules; newly added tables have RLS. Deploy the updated `public-tour` Edge Function after migrating so published tours return levels, spaces, openings, and stairs. The legacy `floor_plan` field remains in the tour payload for compatibility.

Uploads are limited to 15 MB and accepted image MIME types in both the client and private Supabase buckets. Paths begin with the organization UUID. Storage policies restrict access to organization members. The public viewer gets only a published property's necessary data and short-lived signed media URLs from `public-tour`; it has no direct anonymous table or bucket access. `tour_views` stores a minimal view count without visitor identifiers.

Room photos are uploaded as the selected files and displayed from those originals; the app does not create a higher-resolution version. Use the full-resolution photo, ideally at least 1600 × 1200 pixels, rather than a downloaded thumbnail. The editor labels low-resolution existing photos and warns before uploading new ones below 1200 × 900 pixels. To improve an existing tour, upload the original photo to its room and remove the small copy.

## Checks

Run `npm run typecheck`, `npm run lint`, and `npm run build`. Then verify in a configured Supabase project:

1. Sign up, confirm email, sign in, and create an organization.
2. Create/edit a property; upload a Ground Floor plan; add several spaces and multiple photos.
3. Draw, select, move, and reshape polygons; test snapping and undo/redo; refresh and confirm normalized geometry persists.
4. Add First Floor and Site levels. Add rooms upstairs, pool/parking/garden polygons outside, wall-attached doors/windows, and a stair connection between floors.
5. Apply a template to another empty property, modify its spaces, and refresh. Preview and navigate its levels and photos.
6. Navigate the existing published `/tour/:slug` route. Paste its iframe snippet into a page on a different origin and verify level/space switching; unpublish and confirm the route stops loading.
7. With a second account and organization, attempt direct reads/updates and storage access to the first organization's IDs. They must be denied by RLS/storage policies. Anonymous table reads must be denied.
8. In Stripe test mode, complete checkout, receive webhook, open the customer portal, and cancel. Confirm `subscriptions` updates and Free publishing limits apply.

## Deployment

For Netlify, import the GitHub repository with `main` as the production branch. `netlify.toml` runs `npm run build` and publishes `dist/`; Vite copies `public/_redirects` and `public/_headers` so direct client routes load, private routes cannot be framed, and `/tour/*` remains embeddable. In Netlify's Project configuration → Environment variables, set `VITE_SUPABASE_URL` to the Supabase Project URL and `VITE_SUPABASE_ANON_KEY` to its publishable key. Both variables must be available to the **Builds** scope and **Production** deploy context. Trigger a new build and deploy after changing them; Vite embeds their values during the build. A production build now fails if either setting is missing or still uses the example placeholder. You can also run `npm run build` locally and upload `dist/`, which contains the same routing files. Never add the Supabase service-role key or Stripe secrets as `VITE_` variables.

After Netlify assigns the permanent HTTPS origin, set the Supabase Edge Function secret `APP_URL` to that origin (for example, `npx supabase secrets set APP_URL=https://YOUR_SITE.netlify.app`). In Supabase Auth URL Configuration, set the production Site URL and add both `https://YOUR_SITE.netlify.app/**` and `http://localhost:5173/**` to the redirect allow list if local sign-in is still needed. The frontend uses its current origin for public links and iframe snippets. Open `/tour/:slug` directly in a fresh browser and test the iframe on a page served from a different origin. Deploy the migration, functions, and Stripe webhook before enabling billing. Storage objects are private; back up the database and Storage according to your Supabase plan.

## Structure

- `src/pages/`: dashboard, property management, editor, tour, publishing, billing, and settings
- `src/components/`: shared UI and Konva floor plan canvas
- `src/lib/`: typed domain models, template geometry, polygon validation, Supabase queries, upload validation
- `supabase/migrations/`: relational schema, indexes, triggers, RLS, and storage policies
- `supabase/functions/`: public tour and Stripe server-side operations
- `supabase/seed.sql` and `public/demo/`: sample public tour

The tour response is a presentation payload assembled at the backend edge. A future Python geometry processor can consume ordered levels (including elevations), spaces and their normalized polygons, types and heights, wall openings, stair connections, and photos. A later 3D viewer can consume derived GLB geometry alongside the current 2D tour without changing property ownership or `/tour/:slug`.
