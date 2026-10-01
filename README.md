# Property Viewer

An interactive property tour SaaS for estate agencies. Teams create properties, add rooms and photos, draw clickable areas over a floor plan, preview the tour, and publish a link or iframe embed. The application uses React, Vite, TypeScript, Tailwind CSS, shadcn style UI primitives, Supabase, Konva, and Stripe.

## Prerequisites

- Node.js 20.19+ or 22.13+ and npm
- A Supabase project (or the Supabase CLI and Docker for a local project)
- A Stripe account in test mode for billing verification

## Local setup with a hosted Supabase project

Run commands from this repository's **outer** `property-viewer-saas` directory, the one containing this README and `supabase/`. A second Vite starter was generated inside this checkout and moved to `.local-backups/` to prevent accidentally running it.

1. Run `npm install`.
2. Copy `.env.example` to `.env.local`. Set `VITE_SUPABASE_URL` to the **Project URL** from Supabase's Connect panel, `VITE_SUPABASE_ANON_KEY` to its **publishable key** (the variable name is retained for compatibility), and `VITE_APP_URL=http://localhost:5173`. Do not use the Postgres connection string or a secret/service-role key in the frontend. Restart Vite after changing `.env.local`.
3. Sign into the bundled CLI with `npx supabase login`, then run `npx supabase link --project-ref YOUR_PROJECT_REF`. Linking selects the remote project; it does **not** install the application's tables or Edge Functions.
4. Run `npx supabase db push --dry-run` and inspect the pending migration. Then run `npx supabase db push` once. This applies `supabase/migrations/20261001000000_initial.sql`, including RLS and private Storage buckets. If you already ran that SQL directly in the Supabase SQL Editor, do not apply it a second time; use `npx supabase migration list` to inspect the migration history first.
5. Set the core function secret with `npx supabase secrets set APP_URL=http://localhost:5173`, then deploy `npx supabase functions deploy public-tour`. This function is needed for every published tour. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to hosted functions; do not set or commit them yourself.
6. Optionally run `supabase/seed.sql` **once in a disposable development project** through the Supabase SQL Editor. It adds a public sample at `/tour/the-willow-residence`, using SVG assets in `public/demo/`.
7. In Supabase Authentication → URL Configuration, set the test project's Site URL to `http://localhost:5173` and allow `http://localhost:5173/**` as a redirect URL. Enable Email provider. Confirm the sign-up email, or disable confirmation only in a disposable test project.
8. Run `npm run check:setup`. All three core checks should pass. Then run `npm run dev` and open `http://localhost:5173`.

Stripe is optional for the first property-tour test. When ready, set `STRIPE_SECRET_KEY`, `STRIPE_PRO_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET` as Supabase Edge Function secrets, then deploy `create-checkout`, `customer-portal`, and `stripe-webhook` with `npx supabase functions deploy FUNCTION_NAME`. The included `supabase/config.toml` disables gateway JWT checks; the billing functions verify the signed-in owner themselves, and the webhook verifies Stripe's signature.

For a fully local Supabase stack, start Docker Desktop, run `npx supabase start` (which applies the migration and seed), and `npx supabase functions serve --env-file supabase/.env.local`. Use the local API URL and publishable/anon key printed by `npx supabase status` in `.env.local`. Put local function secrets in `supabase/.env.local`; this file is ignored by Git. Use `stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook` for local Stripe webhooks and set the printed signing secret. The local function `APP_URL` should be `http://localhost:5173`.

## Stripe setup

Create one recurring Professional price in Stripe test mode. Put its `price_...` ID in `STRIPE_PRO_PRICE_ID`. Enable the customer portal in Stripe. Create a webhook endpoint at `https://YOUR_PROJECT.supabase.co/functions/v1/stripe-webhook`, subscribe it to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`, and set its signing secret as `STRIPE_WEBHOOK_SECRET`.

Checkout and portal sessions are created only by Edge Functions after verifying the signed-in user is an organization owner. Subscription records can only be changed by the service role through the signed webhook. The database enforces one published tour on Free and unlimited tours on Professional. If Professional ends while several tours are live, the webhook keeps the oldest published tour and unpublishes the rest. Stripe is the source of truth for subscription status. Run a test checkout using a Stripe test card, return to Billing, and confirm the plan changes after the webhook arrives. Then open Manage Subscription and test cancellation through the portal.

## Product workflow

Sign up, create an organization, create a property, and open its Floor Plan Editor. Add rooms and upload a JPG, PNG, or WebP floor plan. Select a room, click **Draw room area**, click at least three corners, and click **Finish polygon**. Select a saved area to drag its white vertices or delete it. Upload multiple photos to each room. Preview the tour, then publish it when every room has at least one photo and polygon. The Publish screen provides the public URL and iframe code. Unpublishing removes access through the public function immediately; signed image URLs already issued may remain valid for up to one hour.

Uploads are limited to 15 MB and accepted image MIME types in both the client and private Supabase buckets. Paths begin with the organization UUID. Storage policies restrict access to organization members. The public viewer gets only a published property's necessary data and short-lived signed media URLs from `public-tour`; it has no direct anonymous table or bucket access. `tour_views` stores a minimal view count without visitor identifiers.

Room photos are uploaded as the selected files and displayed from those originals; the app does not create a higher-resolution version. Use the full-resolution photo, ideally at least 1600 × 1200 pixels, rather than a downloaded thumbnail. The editor labels low-resolution existing photos and warns before uploading new ones below 1200 × 900 pixels. To improve an existing tour, upload the original photo to its room and remove the small copy.

## Checks

Run `npm run typecheck`, `npm run lint`, and `npm run build`. Then verify in a configured Supabase project:

1. Sign up, confirm email, sign in, and create an organization.
2. Create/edit a property; upload a floor plan; add a room and multiple photos.
3. Draw, select, reshape, and delete a polygon; refresh and confirm normalized geometry persists at different viewport widths.
4. Navigate rooms and photos in private preview and the published `/tour/:slug` route.
5. Paste the iframe snippet into a page on a different origin and verify room switching; unpublish and confirm the route stops loading.
6. With a second account and organization, attempt direct reads/updates and storage access to the first organization's IDs. They must be denied by RLS/storage policies. Anonymous table reads must be denied.
7. In Stripe test mode, complete checkout, receive webhook, open the customer portal, and cancel. Confirm `subscriptions` updates and Free publishing limits apply.

## Deployment

Build with `npm run build` and deploy `dist/` to any static host with a catch-all rewrite to `/index.html` for client routes. Set production `VITE_APP_URL` to the public app origin and the same origin as Edge Function `APP_URL`. Add the production origin to Supabase Auth URL Configuration. Serve the frontend over HTTPS. Allow external sites to frame `/tour/*` in your host's `Content-Security-Policy: frame-ancestors` and do not set `X-Frame-Options: DENY` on that route. Keep private dashboard routes out of embeds through host policy if desired. Deploy the migration, functions, and Stripe webhook before enabling billing. Storage objects are private; back up the database and Storage according to your Supabase plan.

## Structure

- `src/pages/`: dashboard, property management, editor, tour, publishing, billing, and settings
- `src/components/`: shared UI and Konva floor plan canvas
- `src/lib/`: typed domain models, Supabase queries, upload validation
- `supabase/migrations/`: relational schema, indexes, triggers, RLS, and storage policies
- `supabase/functions/`: public tour and Stripe server-side operations
- `supabase/seed.sql` and `public/demo/`: sample public tour

The tour response is a presentation payload assembled at the backend edge. A future processing worker can write room geometry and assets into the same domain tables, and a 3D viewer can consume an additional representation alongside the V1 floor plan without changing property or organization ownership.
